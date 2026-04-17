'use strict';

/**
 * MaStR Monitor — Email notification module
 * Sends delta / confirmation / no-changes emails via nodemailer.
 * All SMTP settings are read from environment variables.
 */

const nodemailer = require('nodemailer');

// ─── helpers ────────────────────────────────────────────────────────────────

function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER);
}

function assertSmtpConfigured() {
  if (!isSmtpConfigured()) {
    const err = new Error('SMTP not configured (SMTP_HOST / SMTP_USER missing)');
    err.code = 'SMTP_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }
}

function buildSmtpConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || '',
    },
  };
}

function createTransport() {
  return nodemailer.createTransport(buildSmtpConfig());
}

function baseUrl() {
  return String(process.env.MASTR_MONITOR_BASE_URL || 'https://api.cernion.de').replace(/\/$/, '');
}

function fromAddress() {
  return process.env.SMTP_FROM || `MaStR Monitor <noreply@cernion.de>`;
}

function maxDetailItems() {
  const parsed = Number.parseInt(String(process.env.MASTR_MONITOR_EMAIL_DETAIL_LIMIT || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
}

// ─── text builders ──────────────────────────────────────────────────────────

function buildDeltaSection(label, items, lang, detailLimit) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const header = lang === 'en' ? label.en : label.de;
  const safeLimit = Math.max(1, Number(detailLimit) || 100);
  const visible = items.slice(0, safeLimit);
  const omitted = Math.max(0, items.length - visible.length);

  const lines = [`${header}:`, '─'.repeat(40)];
  for (const item of visible) {
    const id = item.mastrNummer || item.id || '?';
    if (item.changes && item.changes.length > 0) {
      lines.push(`  ${id}`);
      for (const ch of item.changes) {
        lines.push(`    ${ch.field}: ${ch.from} → ${ch.to}`);
      }
    } else {
      lines.push(`  ${id}`);
    }
  }

  if (omitted > 0) {
    lines.push(lang === 'en'
      ? `  … ${omitted} additional entries omitted (detail limit: ${safeLimit}).`
      : `  … ${omitted} weitere Einträge ausgeblendet (Detail-Limit: ${safeLimit}).`);
  }

  lines.push('');
  return lines.join('\n');
}

function buildDeltaBody(watch, delta, base, lang, detailLimit) {
  const isEn = lang === 'en';
  const summary = delta?.summary || {};
  const added = Number(summary.added || 0);
  const changed = Number(summary.changed || 0);
  const removed = Number(summary.removed || 0);
  const total = watch.installationCount || 0;

  const snapshotUrl = `${base}/api/mastr-monitor/watches/${delta.watchId}/snapshot?format=csv`;
  const deltaUrl = `${base}/api/mastr-monitor/watches/${delta.watchId}/deltas/${delta.deltaId}`;

  const lines = [
    isEn
      ? `MaStR Monitor — Changes detected for "${watch.name}"`
      : `MaStR Monitor — Änderungen erkannt für „${watch.name}"`,
    '',
    isEn ? 'SUMMARY' : 'ZUSAMMENFASSUNG',
    '═'.repeat(40),
    isEn ? `  New:     ${added}` : `  Neu:       ${added}`,
    isEn ? `  Changed: ${changed}` : `  Geändert:  ${changed}`,
    isEn ? `  Removed: ${removed}` : `  Entfernt:  ${removed}`,
    isEn ? `  Total:   ${total}` : `  Gesamt:    ${total}`,
    '',
    buildDeltaSection(
      { de: 'NEUE ANLAGEN', en: 'NEW INSTALLATIONS' },
      delta.added || [],
      lang,
      detailLimit
    ),
    buildDeltaSection(
      { de: 'GEÄNDERTE ANLAGEN', en: 'CHANGED INSTALLATIONS' },
      delta.changed || [],
      lang,
      detailLimit
    ),
    buildDeltaSection(
      { de: 'ENTFERNTE ANLAGEN', en: 'REMOVED INSTALLATIONS' },
      delta.removed || [],
      lang,
      detailLimit
    ),
    '─'.repeat(40),
    isEn ? `Full delta:    ${deltaUrl}` : `Vollständiges Delta:  ${deltaUrl}`,
    isEn ? `Snapshot CSV:  ${snapshotUrl}` : `Snapshot CSV:         ${snapshotUrl}`,
    '',
    isEn
      ? 'This notification was generated automatically by MaStR Monitor.'
      : 'Diese Benachrichtigung wurde automatisch von MaStR Monitor generiert.',
  ];

  return lines.join('\n');
}

function buildDeltaSubject(watchName, delta, lang) {
  const isEn = lang === 'en';
  const s = delta?.summary || {};
  const parts = [];
  if (s.added > 0) parts.push(isEn ? `+${s.added} new` : `+${s.added} neu`);
  if (s.changed > 0) parts.push(isEn ? `${s.changed} changed` : `${s.changed} geändert`);
  if (s.removed > 0) parts.push(isEn ? `-${s.removed} removed` : `-${s.removed} entfernt`);
  const summary = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return isEn
    ? `MaStR Monitor: Changes for "${watchName}"${summary}`
    : `MaStR Monitor: Änderungen bei „${watchName}"${summary}`;
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Send a delta notification email.
 * @param {object} subscription  PouchDB subscription payload
 * @param {object} watch         Watch payload
 * @param {object} delta         Delta payload
 * @param {string} [baseOverride] Override base URL (for testing)
 */
async function sendDeltaNotification(subscription, watch, delta, baseOverride) {
  assertSmtpConfigured();
  const lang = subscription.language || 'de';
  const base = baseOverride || baseUrl();
  const detailLimit = maxDetailItems();
  const transport = createTransport();

  await transport.sendMail({
    from: fromAddress(),
    to: subscription.email,
    subject: buildDeltaSubject(watch.name, delta, lang),
    text: buildDeltaBody(watch, delta, base, lang, detailLimit),
  });
}

/**
 * Send a subscription confirmation email.
 * @param {object} subscription  PouchDB subscription payload (must have tokenHash)
 * @param {object} watch         Watch payload
 * @param {string} [baseOverride] Override base URL (for testing)
 */
async function sendConfirmationEmail(subscription, watch, baseOverride) {
  assertSmtpConfigured();
  const lang = subscription.language || 'de';
  const isEn = lang === 'en';
  const base = baseOverride || baseUrl();

  const confirmUrl = `${base}/api/mastr-monitor/confirm/${subscription.token || subscription.tokenHash}`;

  const subject = isEn
    ? `MaStR Monitor: Confirm your subscription for "${watch.name}"`
    : `MaStR Monitor: Anmeldung bestätigen für „${watch.name}"`;

  const body = [
    isEn
      ? `Please confirm your subscription for MaStR Monitor watch "${watch.name}".`
      : `Bitte bestätigen Sie Ihre Anmeldung für den MaStR Monitor „${watch.name}".`,
    '',
    isEn ? 'Click the link below to activate notifications:' : 'Klicken Sie auf den folgenden Link, um Benachrichtigungen zu aktivieren:',
    '',
    confirmUrl,
    '',
    isEn
      ? 'If you did not request this, please ignore this email.'
      : 'Falls Sie diese Anmeldung nicht angefordert haben, ignorieren Sie diese E-Mail.',
  ].join('\n');

  const transport = createTransport();
  await transport.sendMail({
    from: fromAddress(),
    to: subscription.email,
    subject,
    text: body,
  });
}

/**
 * Send a "no changes" digest email (when onlyOnChanges is false).
 * @param {object} subscription  PouchDB subscription payload
 * @param {object} watch         Watch payload
 * @param {string} [baseOverride] Override base URL (for testing)
 */
async function sendNoChangesNotification(subscription, watch, baseOverride) {
  assertSmtpConfigured();
  const lang = subscription.language || 'de';
  const isEn = lang === 'en';
  const base = baseOverride || baseUrl();
  const snapshotUrl = `${base}/api/mastr-monitor/watches/${watch.watchId}/snapshot?format=csv`;

  const subject = isEn
    ? `MaStR Monitor: No changes for "${watch.name}"`
    : `MaStR Monitor: Keine Änderungen bei „${watch.name}"`;

  const body = [
    isEn
      ? `MaStR Monitor ran for "${watch.name}" — no changes detected.`
      : `MaStR Monitor-Lauf für „${watch.name}" abgeschlossen — keine Änderungen.`,
    '',
    isEn ? `Total installations: ${watch.installationCount || 0}` : `Anlagen gesamt: ${watch.installationCount || 0}`,
    isEn ? `Last run: ${watch.lastRun || '-'}` : `Letzter Lauf: ${watch.lastRun || '-'}`,
    '',
    isEn ? `Snapshot CSV: ${snapshotUrl}` : `Snapshot CSV: ${snapshotUrl}`,
  ].join('\n');

  const transport = createTransport();
  await transport.sendMail({
    from: fromAddress(),
    to: subscription.email,
    subject,
    text: body,
  });
}

module.exports = {
  isSmtpConfigured,
  sendDeltaNotification,
  sendConfirmationEmail,
  sendNoChangesNotification,
};
