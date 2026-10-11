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
      next.text = '';
      next.basis = '';
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
  if (foreign && ctx.broker.getLocalService('notices'))
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
module.exports = { audit, change, adminList, cleanup, exhaust, MAX_ATTEMPTS };
