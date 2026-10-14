'use strict';

const { randomUUID } = require('node:crypto');
const store = require('./tenant-memory-store');
const { deny } = require('./domain-router-policy');
const MAX_ATTEMPTS = 3;

async function audit(ctx, p, kind, details = {}) {
  await store.put(ctx, p, {
    id: randomUUID(),
    type: 'tenant_memory_audit',
    tenantId: p.tenantId,
    sensitivityFlags: details.sensitivityFlags || [],
    actorId: p.actorId,
    at: new Date().toISOString(),
    kind,
    ...details,
  });
}
async function change(ctx, p, id, kind, basis, { confirmed = false, admin = false } = {}) {
  if (!['revoked', 'corrected', 'deleted'].includes(kind)) deny('Invalid memory change');
  if (admin && !p.roles.includes('ROLE_TENANT_ADMIN')) deny('Tenant administrator required');
  const previous = (await store.get(ctx, p, id)).payload;
  if (previous.type !== 'tenant_memory_fact') deny('Statement required');
  const foreign = previous.person.actorId !== p.actorId;
  if (foreign && !admin && !confirmed) deny('Confirmation required');
  const fact = await store.mutate(ctx, p, id, (value) => {
    if (value.status !== 'valid' && kind !== 'deleted') return null;
    const entry = {
      kind,
      actorId: p.actorId,
      at: new Date().toISOString(),
      basis,
      confirmed,
      admin,
      previousText: kind === 'deleted' ? undefined : value.text,
    };
    const next = { ...value, status: kind, checking: 'complete', audit: [...value.audit, entry] };
    if (kind === 'deleted') {
      next.glossary = undefined;
      next.statementKind = undefined;
      next.text = '';
      next.basis = '';
      next.message = '';
      next.time = {};
      next.commitment = '';
      next.recoveryPrincipal = undefined;
      next.anchors = [];
      next.anchorKeys = [];
      next.checkingEvidence = [];
      next.plausibility = [];
      next.audit = next.audit.map(({ previousText: _text, basis: _basis, ...item }) => item);
    }
    return next;
  });
  await audit(ctx, p, kind, {
    factId: id,
    confirmed,
    admin,
    sensitivityFlags: previous.sensitivityFlags || [],
  });
  if (foreign && !admin && fact.text?.trim() && ctx.broker.getLocalService('notices'))
    await ctx.call('notices.enqueueMemory', {
      tenantId: p.tenantId,
      actorId: previous.person.actorId,
      relationId: id,
      factIds: [id],
      change: true,
    });
  return fact;
}
async function adminList(ctx, p) {
  if (!p.roles.includes('ROLE_TENANT_ADMIN')) deny('Tenant administrator required');
  const facts = await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
  await audit(ctx, p, 'admin_list', { count: facts.length });
  return { statements: facts };
}
async function exhaust(ctx, p, fact) {
  const limit = require('./tenant-memory').recoveryOptions().maxAttempts;
  if (fact.checking !== 'pending' || Number(fact.attempts || 0) < limit) return false;
  await store.mutate(ctx, p, fact.id, (value) =>
    value.checking === 'pending' && Number(value.attempts || 0) >= limit
      ? {
          ...value,
          checking: 'failed',
          checkingFailure: value.checkingFailure || {
            errorClass: 'AttemptLimit',
            message: 'Versuchsgrenze erreicht',
            tenantId: p.tenantId,
          },
          audit: [
            ...value.audit,
            {
              kind: 'checking_failed',
              actorId: p.actorId,
              at: new Date().toISOString(),
              reason: 'attempt_limit',
              attempts: value.attempts,
            },
          ],
        }
      : null
  );
  return true;
}
async function cleanup(ctx, p) {
  if (!p.roles.includes('ROLE_TENANT_ADMIN')) deny('Tenant administrator required');
  const facts = await store.query(ctx, p, {
    'payload.type': 'tenant_memory_fact',
    'payload.checking': 'pending',
  });
  let failed = 0;
  for (const fact of facts) if (await exhaust(ctx, p, fact)) failed++;
  await audit(ctx, p, 'admin_cleanup', { failed });
  return { failed };
}
// Only this audited administrative path upgrades persisted legacy anchors.
async function migrateAnchors(ctx, p, reason, originalMessages = []) {
  if (!p.roles.includes('ROLE_TENANT_ADMIN')) deny('Tenant administrator required');
  if (typeof reason !== 'string' || !reason.trim()) deny('Migration reason required');
  return require('./tenant-memory').serialized(p, async () => {
    const facts = await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
    const corpus = await store.frequencyCorpus(ctx, p);
    const originals = new Map();
    for (const source of originalMessages) {
      const fact = facts.find((item) => item.id === source.id);
      if (
        !fact ||
        !store.active(fact) ||
        originals.has(source.id) ||
        !require('./tenant-memory').basisMatches(fact.basis || fact.text, source.message)
      )
        deny('Original message does not match accessible active statement');
      originals.set(source.id, source.message);
    }
    const normalized = facts.map((previous) => {
      const fact = originals.has(previous.id)
        ? { ...previous, message: originals.get(previous.id) }
        : previous;
      const anchors = store.groundedAnchors(
        fact.anchors || [],
        fact.message || fact.basis || fact.text,
        facts,
        corpus
      );
      return {
        ...fact,
        basis: store.literalBasis(
          fact.basis || fact.text,
          fact.message || fact.basis || fact.text,
          anchors
        ),
        text: anchors.every((anchor) =>
          ` ${store.normalizeAnchor(fact.text)} `.includes(
            ` ${store.normalizeAnchor(anchor.value)} `
          )
        )
          ? fact.text
          : store.literalBasis(
              fact.basis || fact.text,
              fact.message || fact.basis || fact.text,
              anchors
            ),
        anchors,
        anchorKeys: [...new Set(anchors.flatMap(store.anchorKeys))],
        person: {
          ...fact.person,
          functionLabel: store.humanFunctionLabel(fact.person.functionLabel),
        },
        checkingEvidence: store.compactEvidence(fact.checkingEvidence || []),
        plausibility: [...new Set(fact.plausibility || [])],
      };
    });
    const changedIds = new Set(
      normalized
        .filter((fact, index) =>
          [
            'basis',
            'text',
            'message',
            'anchors',
            'anchorKeys',
            'person',
            'checkingEvidence',
            'plausibility',
          ].some(
            (field) =>
              JSON.stringify(
                fact[field] ||
                  (field === 'person' ? {} : ['basis', 'text', 'message'].includes(field) ? '' : [])
              ) !==
              JSON.stringify(
                facts[index][field] ||
                  (field === 'person' ? {} : ['basis', 'text', 'message'].includes(field) ? '' : [])
              )
          )
        )
        .map((fact) => fact.id)
    );
    const requeue = new Set();
    for (const fact of normalized.filter((item) => changedIds.has(item.id) && store.active(item))) {
      const before = new Set(
        store
          .candidates(
            facts.find((item) => item.id === fact.id),
            facts,
            corpus
          )
          .map((item) => item.id)
      );
      for (const candidate of store.candidates(
        fact,
        normalized,
        corpus.map((item) => normalized.find((next) => next.id === item.id) || item)
      )) {
        if (!before.has(candidate.id)) {
          requeue.add(fact.id);
          requeue.add(candidate.id);
        }
      }
    }
    let changed = 0,
      requeued = 0;
    for (const fact of normalized) {
      if (!changedIds.has(fact.id) && !requeue.has(fact.id)) continue;
      let written = false;
      const queue = requeue.has(fact.id) && store.active(fact);
      await store.mutate(ctx, p, fact.id, (latest) => {
        written = false;
        // A concurrent revocation/redaction must never be undone by migration.
        if (latest.status !== fact.status) return null;
        const at = new Date().toISOString();
        written = true;
        return {
          ...latest,
          basis: fact.basis,
          text: fact.text,
          ...(fact.message ? { message: fact.message } : {}),
          anchors: fact.anchors,
          anchorKeys: fact.anchorKeys,
          person: fact.person,
          checkingEvidence: fact.checkingEvidence,
          plausibility: fact.plausibility,
          ...(queue
            ? {
                checking: 'pending',
                attempts: 0,
                nextAttemptAt: '',
                checkingFailure: null,
                recoveryPrincipal: latest.recoveryPrincipal || {
                  tenantId: latest.tenantId,
                  actorId: latest.person.actorId,
                  roles: latest.person.roles || [],
                  clearance: latest.sensitivityFlags || [],
                },
              }
            : {}),
          audit: [
            ...(latest.audit || []),
            {
              kind: 'anchors_migrated',
              migration: 'anchor-canonical-v3',
              actorId: p.actorId,
              at,
              reason,
              requeued: queue,
              originalRestored: originals.has(fact.id),
            },
          ],
        };
      });
      if (written) {
        changed += Number(changedIds.has(fact.id));
        requeued += Number(queue);
      }
    }
    const originalMessagesRequired = normalized
      .filter(
        (fact, index) =>
          store.active(fact) &&
          [
            ...fact.anchors,
            ...(originals.has(fact.id)
              ? []
              : (facts[index].anchors || []).filter(
                  (anchor) =>
                    !fact.anchors.some((next) =>
                      ` ${store.normalizeAnchor(store.qualifiedAnchor(anchor).value)} `.includes(
                        ` ${store.normalizeAnchor(next.value)} `
                      )
                    )
                )),
          ].some(
            (anchor) =>
              !store.anchorKeys(anchor).some((key) => {
                const base = JSON.parse(key)[0];
                return (
                  ` ${store.normalizeAnchor(fact.basis)} `.includes(` ${base} `) &&
                  ` ${store.normalizeAnchor(fact.text)} `.includes(` ${base} `)
                );
              })
          )
      )
      .map((fact) => fact.id);
    const result = {
      migration: 'anchor-canonical-v3',
      scanned: facts.length,
      changed,
      requeued,
      ...(originalMessagesRequired.length ? { originalMessagesRequired } : {}),
    };
    await audit(ctx, p, 'admin_migrate_anchors', { ...result, reason });
    return result;
  });
}
module.exports = { audit, change, adminList, cleanup, exhaust, MAX_ATTEMPTS, migrateAnchors };
