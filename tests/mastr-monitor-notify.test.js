'use strict';

jest.mock('nodemailer');

const nodemailer = require('nodemailer');
const notify = require('../src/mastr-monitor-notify');

describe('mastr-monitor-notify', () => {
  let sendMailMock;

  beforeEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;
    delete process.env.MASTR_MONITOR_BASE_URL;

    sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test-id' });
    nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;
    delete process.env.MASTR_MONITOR_BASE_URL;
  });

  function setSmtp() {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
  }

  const {
    isSmtpConfigured,
    sendDeltaNotification,
    sendConfirmationEmail,
    sendNoChangesNotification,
  } = notify;

  const watch = {
    watchId: 'twl-solar_abc',
    name: 'TWL Solar Monitoring',
    installationCount: 42,
    lastRun: '2026-04-17T06:00:00.000Z',
  };

  const sub = {
    email: 'netzplanung@twl.de',
    language: 'de',
    onlyOnChanges: true,
    tokenHash: 'abc123',
    token: 'raw-token-abc',
    watchId: 'twl-solar_abc',
    status: 'confirmed',
  };

  const delta = {
    watchId: 'twl-solar_abc',
    deltaId: '2026-04-17',
    summary: { added: 2, changed: 1, removed: 0 },
    added: [{ mastrNummer: 'SEE900000001' }, { mastrNummer: 'SEE900000002' }],
    changed: [{ mastrNummer: 'SEE900000003', changes: [{ field: 'nettonennleistung', from: '100', to: '110' }] }],
    removed: [],
  };

  // ─── isSmtpConfigured ────────────────────────────────────────────────────

  test('isSmtpConfigured returns false when env vars missing', () => {
    expect(isSmtpConfigured()).toBe(false);
  });

  test('isSmtpConfigured returns true when SMTP_HOST and SMTP_USER set', () => {
    setSmtp();
    expect(isSmtpConfigured()).toBe(true);
  });

  // ─── sendDeltaNotification ───────────────────────────────────────────────

  test('sendDeltaNotification throws SMTP_NOT_CONFIGURED when env missing', async () => {
    await expect(sendDeltaNotification(sub, watch, delta))
      .rejects.toMatchObject({ code: 'SMTP_NOT_CONFIGURED' });
  });

  test('sendDeltaNotification sends email with correct subject (DE)', async () => {
    setSmtp();
    await sendDeltaNotification(sub, watch, delta, 'https://test.cernion.de');

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toBe('netzplanung@twl.de');
    expect(mail.subject).toContain('TWL Solar Monitoring');
    expect(mail.subject).toContain('+2 neu');
    expect(mail.subject).toContain('1 geändert');
  });

  test('sendDeltaNotification body contains MaStR numbers', async () => {
    setSmtp();
    await sendDeltaNotification(sub, watch, delta, 'https://test.cernion.de');

    const body = sendMailMock.mock.calls[0][0].text;
    expect(body).toContain('SEE900000001');
    expect(body).toContain('SEE900000002');
    expect(body).toContain('SEE900000003');
    expect(body).toContain('nettonennleistung');
    expect(body).toContain('100 → 110');
  });

  test('sendDeltaNotification body contains delta URL and snapshot CSV URL', async () => {
    setSmtp();
    await sendDeltaNotification(sub, watch, delta, 'https://test.cernion.de');

    const body = sendMailMock.mock.calls[0][0].text;
    expect(body).toContain('https://test.cernion.de/api/mastr-monitor/watches/twl-solar_abc/deltas/2026-04-17');
    expect(body).toContain('https://test.cernion.de/api/mastr-monitor/watches/twl-solar_abc/snapshot?format=csv');
  });

  test('sendDeltaNotification uses English when language is en', async () => {
    setSmtp();
    const enSub = { ...sub, language: 'en' };
    await sendDeltaNotification(enSub, watch, delta, 'https://test.cernion.de');

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.subject).toContain('Changes for');
    expect(mail.text).toContain('SUMMARY');
    expect(mail.text).toContain('New:');
  });

  // ─── sendConfirmationEmail ───────────────────────────────────────────────

  test('sendConfirmationEmail throws SMTP_NOT_CONFIGURED when env missing', async () => {
    await expect(sendConfirmationEmail(sub, watch))
      .rejects.toMatchObject({ code: 'SMTP_NOT_CONFIGURED' });
  });

  test('sendConfirmationEmail sends email with confirmation URL', async () => {
    setSmtp();
    await sendConfirmationEmail(sub, watch, 'https://test.cernion.de');

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toBe('netzplanung@twl.de');
    expect(mail.subject).toContain('TWL Solar Monitoring');
    expect(mail.text).toContain('https://test.cernion.de/api/mastr-monitor/confirm/raw-token-abc');
  });

  // ─── sendNoChangesNotification ───────────────────────────────────────────

  test('sendNoChangesNotification sends digest email', async () => {
    setSmtp();
    await sendNoChangesNotification(sub, watch, 'https://test.cernion.de');

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.subject).toContain('Keine Änderungen');
    expect(mail.text).toContain('42');
  });
});
