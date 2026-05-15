'use strict';

/**
 * personal-agent-dreamer.js — v0.52.3
 *
 * Post-session async Dream pipeline triggered by inactivity.
 * Runs deterministically; no LLM calls except optional embeddings for cosine dedup.
 *
 * Acceptance Criteria:
 *   AK1: Atomic L2 profile enrichment — confidence-based conflict resolution,
 *        optimistic concurrency via updatedAt version guard (retry up to 3x).
 *   AK2: L1 tenant memory dedup — cosine-similarity > 0.95 threshold (local, no Qdrant).
 *        Gracefully degrades (skip dedup, always write) if embeddings unavailable.
 *   AK3: Pure append-only audit trail — SHA-256 integrity hash per entry.
 */

const crypto = require('crypto');
const { embeddings: llmEmbeddings, capabilities: llmCapabilities } = require('./llm-client');
const jobStore = require('./job-store');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DREAM_INACTIVITY_MS = Number(process.env.DREAM_INACTIVITY_MS || 300_000); // 5 min
const DREAM_AUDIT_NAMESPACE = 'personal_agent_dream_audit';
const TENANT_MEMORY_NAMESPACE = 'personal_agent_tenant_memory';
const OCC_MAX_RETRIES = 3;
const COSINE_DEDUP_THRESHOLD = 0.95;
const DREAM_JOB_SERVICE = 'personal-agent';
const DREAM_JOB_ACTION = 'dream-pipeline';
const DREAM_SCHEDULER_SLICE_MS = Number(process.env.DREAM_SCHEDULER_SLICE_MS || 1000);
const DREAM_JOB_CAS_RETRIES = Number(process.env.DREAM_JOB_CAS_RETRIES || 8);

function buildDreamIdempotencyKey(tenantId, sessionId) {
  return `personal-agent:dream:${tenantId}:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Durable dream scheduling via v0.52.2 job-store
// ---------------------------------------------------------------------------

/**
 * Schedule (or re-schedule) a Dream run for the given session.
 * Durable execution mode: creates/reuses one idempotent async job per tenant+session.
 * Re-scheduling updates the persisted dueAt generation in the job record.
 *
 * @param {object} options
 * @param {object} options.broker - Moleculer broker instance
 * @param {string} options.sessionId
 * @param {string} options.tenantId
 * @param {string} options.userId
 * @param {string} options.profileNamespace
 * @param {object} options.session
 * @param {Function} options.runFn - async (payload) => void
 * @returns {Promise<{jobId:string,generation:number,dueAt:string}|null>}
 */
async function scheduleDream(options = {}) {
  const {
    broker,
    sessionId,
    tenantId,
    userId,
    profileNamespace,
    authMeta,
    runFn,
  } = options;

  if (!broker || typeof broker.call !== 'function') {
    throw new Error('scheduleDream requires a broker instance');
  }
  if (!sessionId || !tenantId || !userId || typeof runFn !== 'function') {
    throw new Error('scheduleDream requires sessionId, tenantId, userId and runFn');
  }

  const idempotencyKey = buildDreamIdempotencyKey(tenantId, sessionId);
  const dueAt = new Date(Date.now() + DREAM_INACTIVITY_MS).toISOString();

  const pseudoCtx = {
    broker,
    meta: {
      $gateway: true,
      tenantId,
      requestHeaders: {
        'x-idempotency-key': idempotencyKey,
      },
    },
  };

  const descriptor = await jobStore.startJob(
    pseudoCtx,
    { service: DREAM_JOB_SERVICE, action: DREAM_JOB_ACTION },
    async (jobId) => {
      while (true) {
        const job = jobStore.getJob(jobId);
        if (!job) {
          return { status: 'deleted' };
        }
        const schedule = job?.dreamSchedule || null;
        if (!schedule) {
          await _sleep(DREAM_SCHEDULER_SLICE_MS, { unref: true });
          continue;
        }
        if (schedule.status === 'canceled') {
          jobStore.deleteJob(jobId);
          return { status: 'canceled' };
        }

        const dueAtMs = Date.parse(schedule.dueAt || '');
        if (Number.isNaN(dueAtMs)) {
          return { status: 'invalid_due_at' };
        }

        const waitMs = dueAtMs - Date.now();
        if (waitMs > 0) {
          await _sleep(Math.min(waitMs, DREAM_SCHEDULER_SLICE_MS), { unref: true });
          continue;
        }

        const latestJob = jobStore.getJob(jobId);
        const latestSchedule = latestJob?.dreamSchedule || null;
        if (!latestSchedule) {
          await _sleep(DREAM_SCHEDULER_SLICE_MS, { unref: true });
          continue;
        }
        if (latestSchedule.status === 'canceled') {
          jobStore.deleteJob(jobId);
          return { status: 'canceled' };
        }

        const startedAt = new Date().toISOString();
        const runningSchedule = await updateDreamScheduleCas(jobId, (currentSchedule) => {
          if (!currentSchedule || currentSchedule.status === 'canceled') {
            return null;
          }
          return {
            ...currentSchedule,
            status: 'running',
            startedAt,
          };
        });
        if (!runningSchedule || runningSchedule.status === 'canceled') {
          jobStore.deleteJob(jobId);
          return { status: 'canceled' };
        }

        try {
          await runFn(runningSchedule.payload || {});
          await updateDreamScheduleCas(jobId, (currentSchedule) => {
            if (!currentSchedule || currentSchedule.status === 'canceled') {
              return null;
            }
            return {
              ...currentSchedule,
              status: 'completed',
              startedAt,
              completedAt: new Date().toISOString(),
            };
          });
          jobStore.deleteJob(jobId);
          return { status: 'completed' };
        } catch (err) {
          await updateDreamScheduleCas(jobId, (currentSchedule) => {
            if (!currentSchedule) {
              return null;
            }
            return {
              ...currentSchedule,
              status: 'failed',
              startedAt,
              failedAt: new Date().toISOString(),
              lastError: String(err?.message || err),
            };
          });
          throw err;
        }
      }
    },
    {
      idempotencyKey,
      wakeContext: {
        service: DREAM_JOB_SERVICE,
        action: DREAM_JOB_ACTION,
        params: { tenantId, sessionId },
      },
    }
  );

  const existing = jobStore.findJobByIdempotencyKey(
    DREAM_JOB_SERVICE,
    DREAM_JOB_ACTION,
    idempotencyKey
  );
  const jobId = descriptor?.jobId || existing?.jobId;
  if (!jobId) {
    return null;
  }

  const updatedSchedule = await updateDreamScheduleCas(jobId, (currentSchedule) => {
    const baseSchedule =
      currentSchedule && typeof currentSchedule === 'object' ? currentSchedule : {};
    const generation = Number(baseSchedule.generation || 0) + 1;
    return {
      ...baseSchedule,
      status: 'scheduled',
      dueAt,
      generation,
      updatedAt: new Date().toISOString(),
      payload: {
        tenantId,
        sessionId,
        userId,
        profileNamespace,
        authMeta: authMeta && typeof authMeta === 'object' ? authMeta : {},
      },
    };
  });

  return {
    jobId,
    generation: Number(updatedSchedule?.generation || 0),
    dueAt,
  };
}

/**
 * Cancel a pending Dream schedule for tenant+session.
 * Uses durable job metadata instead of process-local timers.
 *
 * @param {string} tenantId
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function cancelDream(tenantId, sessionId) {
  const idempotencyKey = buildDreamIdempotencyKey(tenantId, sessionId);
  const existing = jobStore.findJobByIdempotencyKey(
    DREAM_JOB_SERVICE,
    DREAM_JOB_ACTION,
    idempotencyKey
  );
  if (!existing?.jobId) {
    return false;
  }

  await updateDreamScheduleCas(existing.jobId, (currentSchedule = {}) => ({
    ...currentSchedule,
    status: 'canceled',
    canceledAt: new Date().toISOString(),
  }));
  jobStore.deleteJob(existing.jobId);
  return true;
}

/**
 * Returns true if a dream is currently scheduled or running for tenant+session.
 * @param {string} tenantId
 * @param {string} sessionId
 * @returns {boolean}
 */
function isDreamPending(tenantId, sessionId) {
  const idempotencyKey = buildDreamIdempotencyKey(tenantId, sessionId);
  const existing = jobStore.findJobByIdempotencyKey(
    DREAM_JOB_SERVICE,
    DREAM_JOB_ACTION,
    idempotencyKey
  );
  if (!existing?.jobId) {
    return false;
  }

  const current = jobStore.getJob(existing.jobId);
  const scheduleStatus = current?.dreamSchedule?.status;
  return scheduleStatus === 'scheduled' || scheduleStatus === 'running';
}

async function updateDreamScheduleCas(jobId, scheduleBuilder) {
  let attempt = 0;
  while (attempt < DREAM_JOB_CAS_RETRIES) {
    attempt += 1;
    const current = jobStore.getJob(jobId);
    if (!current) return null;

    const nextSchedule = scheduleBuilder(current.dreamSchedule || null, current);
    if (nextSchedule === null) {
      return current.dreamSchedule || null;
    }

    try {
      const updated = jobStore.updateJob(
        jobId,
        { dreamSchedule: nextSchedule },
        { expectedRev: current._rev }
      );
      return updated?.dreamSchedule || null;
    } catch (err) {
      if (!_isConflict(err)) {
        throw err;
      }
      await _sleep(Math.min(20 * attempt, 120), { unref: true });
    }
  }

  throw new Error(`Dream schedule CAS retry exhausted for job ${jobId}`);
}

// ---------------------------------------------------------------------------
// Fact extraction (heuristic, deterministic — no LLM required)
// ---------------------------------------------------------------------------

/**
 * Extract L1 tenant facts and L2 user preference signals from session L3 history.
 *
 * L1 tenant facts: short factual statements the user mentioned about their organisation/grid.
 * L2 user preferences: key-value preference signals with confidence scores (0–1).
 *
 * @param {{ l1?: object, l2?: object, l3?: { history?: Array<{role:string, text:string}> } }} session
 * @returns {{ tenantFacts: string[], preferences: Array<{key:string, value:string, confidence:number, updatedAt:string}> }}
 */
function extractFacts(session) {
  const history = session?.l3?.history || [];
  const userMessages = history
    .filter((e) => e?.role === 'user' && typeof e.text === 'string' && e.text.trim().length > 0)
    .map((e) => e.text.trim());

  const tenantFacts = [];
  const preferences = [];

  const now = new Date().toISOString();

  for (const msg of userMessages) {
    // ---- L1: tenant facts (grid operator mentions, capacity figures) --------
    const gridMatch = msg.match(/\b(Netzbetreiber|grid operator|VNB|GNB|SNB)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß0-9 .,\-]+)/i);
    if (gridMatch) {
      const fact = `Netzbetreiber: ${gridMatch[2].trim().slice(0, 120)}`;
      if (!tenantFacts.includes(fact)) tenantFacts.push(fact);
    }

    const capacityMatch = msg.match(/(\d[\d.,]*)\s*(kWp|MWp|kW|MW|GW)/i);
    if (capacityMatch) {
      const fact = `Leistung erwähnt: ${capacityMatch[0].trim()}`;
      if (!tenantFacts.includes(fact)) tenantFacts.push(fact);
    }

    // ---- L2: user preference signals ---------------------------------------
    // Language preference
    const dePattern = /\b(bitte auf deutsch|german please|auf deutsch)\b/i;
    const enPattern = /\b(please in english|english please|in english)\b/i;
    if (dePattern.test(msg)) {
      preferences.push({ key: 'language', value: 'de', confidence: 0.9, updatedAt: now });
    } else if (enPattern.test(msg)) {
      preferences.push({ key: 'language', value: 'en', confidence: 0.9, updatedAt: now });
    }

    // Domain interest signals
    const domains = [
      { pattern: /\bredispatch\b/i, key: 'domainInterest', value: 'redispatch' },
      { pattern: /\bsolar|photovoltaik|pv\b/i, key: 'domainInterest', value: 'solar' },
      { pattern: /\bwind\b/i, key: 'domainInterest', value: 'wind' },
      { pattern: /\bspeicher|battery|storage\b/i, key: 'domainInterest', value: 'storage' },
      { pattern: /\bnetzanschluss|grid connection\b/i, key: 'domainInterest', value: 'grid-connection' },
    ];
    for (const d of domains) {
      if (d.pattern.test(msg)) {
        preferences.push({ key: d.key, value: d.value, confidence: 0.7, updatedAt: now });
      }
    }

    // Output detail preference
    if (/\b(kurz|knapp|brief|concise|short)\b/i.test(msg)) {
      preferences.push({ key: 'outputDetail', value: 'brief', confidence: 0.8, updatedAt: now });
    } else if (/\b(ausführlich|detail|verbose|komplett)\b/i.test(msg)) {
      preferences.push({ key: 'outputDetail', value: 'verbose', confidence: 0.8, updatedAt: now });
    }
  }

  // Deduplicate preferences: keep the highest confidence per key (last wins on equal conf)
  const prefMap = new Map();
  for (const pref of preferences) {
    const existing = prefMap.get(pref.key);
    if (!existing || pref.confidence >= existing.confidence) {
      prefMap.set(pref.key, pref);
    }
  }

  return {
    tenantFacts: tenantFacts.slice(0, 20),
    preferences: Array.from(prefMap.values()),
  };
}

// ---------------------------------------------------------------------------
// L2 profile enrichment — AK1 (OCC + confidence-based conflict resolution)
// ---------------------------------------------------------------------------

/**
 * Merge extracted preference facts into the persisted L2 user profile.
 * Uses an updatedAt-based optimistic concurrency guard with up to OCC_MAX_RETRIES retries.
 * Conflict resolution: higher confidence wins; equal confidence → newer updatedAt wins.
 *
 * @param {object} ctx - Moleculer context (or compatible call shim)
 * @param {string} tenantId
 * @param {string} userId
 * @param {string} profileNamespace - e.g. 'personal_agent_user_profiles:<tenantId>'
 * @param {Array<{key:string,value:string,confidence:number,updatedAt:string}>} preferences
 * @returns {Promise<{merged: object, conflicts: number, retries: number}>}
 */
async function enrichL2Profile(ctx, tenantId, userId, profileNamespace, preferences) {
  if (!preferences || preferences.length === 0) {
    return { merged: {}, conflicts: 0, retries: 0 };
  }

  let retries = 0;
  let conflicts = 0;

  for (let attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
    // 1. Read current profile
    let currentDoc;
    try {
      currentDoc = await ctx.call('object-store.get', { namespace: profileNamespace, key: userId }, { meta: ctx.meta });
    } catch (err) {
      if (_isNotFound(err)) {
        currentDoc = null;
      } else {
        throw err;
      }
    }

    const currentPayload = currentDoc?.payload || { userId, preferences: {} };
    const snapshotRev = currentDoc?._rev ?? null;

    // 2. Merge preferences using confidence-based resolution
    const mergedPrefs = { ...(currentPayload.preferences || {}) };

    for (const pref of preferences) {
      const existing = mergedPrefs[pref.key];
      if (!existing) {
        mergedPrefs[pref.key] = { value: pref.value, confidence: pref.confidence, updatedAt: pref.updatedAt };
      } else {
        // AK1: higher confidence wins; tie-break = newer updatedAt
        const existingConf = existing.confidence ?? 0;
        const newConf = pref.confidence ?? 0;
        if (newConf > existingConf) {
          conflicts += 1;
          mergedPrefs[pref.key] = { value: pref.value, confidence: pref.confidence, updatedAt: pref.updatedAt };
        } else if (newConf === existingConf && pref.updatedAt > (existing.updatedAt || '')) {
          mergedPrefs[pref.key] = { value: pref.value, confidence: pref.confidence, updatedAt: pref.updatedAt };
        }
        // else: existing wins, no-op
      }
    }

    const newPayload = {
      ...currentPayload,
      preferences: mergedPrefs,
      updatedAt: new Date().toISOString(),
    };

    // 3. Write with native revision CAS (_rev) on every attempt
    try {
      await ctx.call(
        'object-store.put',
        {
          namespace: profileNamespace,
          key: userId,
          payload: newPayload,
          _rev: snapshotRev,
        },
        { meta: ctx.meta }
      );
      return { merged: mergedPrefs, conflicts, retries };
    } catch (writeErr) {
      if (_isConflict(writeErr)) {
        retries += 1;
        if (attempt >= OCC_MAX_RETRIES - 1) throw writeErr;
        await _sleep(50 * (attempt + 1));
        continue;
      }
      retries += 1;
      if (attempt >= OCC_MAX_RETRIES - 1) throw writeErr;
      // Brief backoff before retry
      await _sleep(50 * (attempt + 1));
    }
  }

  return { merged: {}, conflicts, retries };
}

// ---------------------------------------------------------------------------
// Cosine similarity — AK2 (local, no external dependencies)
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two numeric vectors.
 * Returns a value in [-1, 1]; 1 = identical direction.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
function computeCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ---------------------------------------------------------------------------
// L1 tenant memory enrichment — AK2 (cosine dedup > 0.95)
// ---------------------------------------------------------------------------

/**
 * Load all existing tenant memory entries for a tenant.
 * @param {object} ctx
 * @param {string} namespace
 * @returns {Promise<Array<{key:string,payload:object}>>}
 */
async function _loadTenantMemory(ctx, namespace) {
  try {
    const result = await ctx.call('object-store.query', { namespace, limit: 500 }, { meta: ctx.meta });
    return Array.isArray(result?.docs) ? result.docs : [];
  } catch (err) {
    if (_isNotFound(err) || _isActionUnavailable(err)) return [];
    throw err;
  }
}

/**
 * Enrich L1 tenant memory with new facts.
 * Skips facts whose cosine similarity to any existing entry exceeds COSINE_DEDUP_THRESHOLD.
 * Gracefully degrades (always writes) if embeddings are unavailable.
 *
 * @param {object} ctx
 * @param {string} tenantId
 * @param {string[]} tenantFacts - raw fact strings
 * @returns {Promise<{added: number, skipped: number, deduped: boolean}>}
 */
async function enrichL1TenantMemory(ctx, tenantId, tenantFacts) {
  if (!tenantFacts || tenantFacts.length === 0) {
    return { added: 0, skipped: 0, deduped: false };
  }

  const namespace = `${TENANT_MEMORY_NAMESPACE}:${tenantId}`;
  const existingDocs = await _loadTenantMemory(ctx, namespace);
  const now = new Date().toISOString();

  // Check if embeddings are available
  let embeddingsAvailable = false;
  try {
    const caps = llmCapabilities();
    embeddingsAvailable = Boolean(caps?.embeddings);
  } catch (_err) {
    embeddingsAvailable = false;
  }

  const existingTexts = existingDocs.map((d) => d?.payload?.text || '').filter(Boolean);
  let existingVectors = [];

  if (embeddingsAvailable && existingTexts.length > 0) {
    try {
      existingVectors = await llmEmbeddings(existingTexts);
    } catch (_embErr) {
      embeddingsAvailable = false;
    }
  }

  let added = 0;
  let skipped = 0;
  const deduped = embeddingsAvailable && existingTexts.length > 0;

  for (const fact of tenantFacts) {
    if (!fact || typeof fact !== 'string') continue;
    let newVec = null;

    // Exact dedup first (cheap check)
    if (existingTexts.includes(fact)) {
      skipped += 1;
      continue;
    }

    // Cosine dedup — AK2
    if (embeddingsAvailable) {
      try {
        const result = await llmEmbeddings([fact]);
        newVec = Array.isArray(result) ? result[0] : result;
      } catch (_embErr) {
        newVec = null;
      }

      if (newVec && existingVectors.length > 0) {
        let isDuplicate = false;
        for (const existingVec of existingVectors) {
          const sim = computeCosineSimilarity(
            Array.isArray(existingVec) ? existingVec : existingVec?.vector || [],
            Array.isArray(newVec) ? newVec : newVec?.vector || []
          );
          if (sim > COSINE_DEDUP_THRESHOLD) {
            isDuplicate = true;
            break;
          }
        }
        if (isDuplicate) {
          skipped += 1;
          continue;
        }
      }
    }

    // Write new fact
    const key = `fact:${crypto.createHash('sha256').update(fact).digest('hex').slice(0, 16)}`;
    try {
      await ctx.call('object-store.put', {
        namespace,
        key,
        payload: { text: fact, addedAt: now, source: 'dream-pipeline' },
      }, { meta: ctx.meta });
      existingTexts.push(fact);
      if (newVec) {
        existingVectors.push(newVec);
      }
      added += 1;
    } catch (_writeErr) {
      // Non-fatal: continue with next fact
    }
  }

  return { added, skipped, deduped };
}

// ---------------------------------------------------------------------------
// Audit trail — AK3 (append-only, SHA-256 integrity hash)
// ---------------------------------------------------------------------------

/**
 * Append an immutable audit entry to the tenant's Dream audit trail.
 * Each entry carries a SHA-256 integrity hash over its content.
 * The key encodes a monotonic timestamp + random suffix to guarantee uniqueness.
 *
 * @param {object} ctx
 * @param {string} tenantId
 * @param {object} entry - arbitrary audit payload
 * @returns {Promise<{key: string, hash: string}>}
 */
async function appendAuditEntry(ctx, tenantId, entry) {
  const namespace = `${DREAM_AUDIT_NAMESPACE}:${tenantId}`;
  const ts = new Date().toISOString();
  const suffix = crypto.randomBytes(4).toString('hex');
  const key = `dream:${ts}:${suffix}`;

  const payload = {
    ...entry,
    recordedAt: ts,
  };

  // AK3: SHA-256 integrity hash over payload (excluding the hash field itself)
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  const storedPayload = { ...payload, integrityHash: hash };

  await ctx.call('object-store.put', {
    namespace,
    key,
    payload: storedPayload,
  }, { meta: ctx.meta });

  return { key, hash };
}

// ---------------------------------------------------------------------------
// Dream pipeline orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full Dream pipeline for a session.
 * Steps: extractFacts → enrichL2Profile → enrichL1TenantMemory → appendAuditEntry
 *
 * @param {object} ctx - Moleculer context (or compatible call shim)
 * @param {string} sessionId
 * @param {string} tenantId
 * @param {string} userId
 * @param {string} profileNamespace - e.g. tenantNamespace(PROFILE_NAMESPACE, tenantId)
 * @param {object} session - persisted session state (l1/l2/l3)
 * @returns {Promise<{success:boolean, sessionId:string, tenantId:string, steps:object[]}>}
 */
async function runDreamPipeline(ctx, sessionId, tenantId, userId, profileNamespace, session) {
  const startedAt = new Date().toISOString();
  const stepResults = {};

  // Step 1: Extract facts
  let facts = { tenantFacts: [], preferences: [] };
  try {
    facts = extractFacts(session);
    stepResults.extractFacts = { ok: true, tenantFactsCount: facts.tenantFacts.length, preferencesCount: facts.preferences.length };
  } catch (err) {
    stepResults.extractFacts = { ok: false, error: err.message };
  }

  // Step 2: Enrich L2 user profile (AK1)
  let l2Result = { merged: {}, conflicts: 0, retries: 0 };
  try {
    l2Result = await enrichL2Profile(ctx, tenantId, userId, profileNamespace, facts.preferences);
    stepResults.enrichL2Profile = { ok: true, ...l2Result };
  } catch (err) {
    stepResults.enrichL2Profile = { ok: false, error: err.message };
  }

  // Step 3: Enrich L1 tenant memory (AK2)
  let l1Result = { added: 0, skipped: 0, deduped: false };
  try {
    l1Result = await enrichL1TenantMemory(ctx, tenantId, facts.tenantFacts);
    stepResults.enrichL1TenantMemory = { ok: true, ...l1Result };
  } catch (err) {
    stepResults.enrichL1TenantMemory = { ok: false, error: err.message };
  }

  // Step 4: Append audit entry (AK3)
  const finishedAt = new Date().toISOString();
  const auditEntry = {
    sessionId,
    userId,
    tenantId,
    startedAt,
    finishedAt,
    extractedFacts: facts.tenantFacts.length,
    extractedPreferences: facts.preferences.length,
    l2Conflicts: l2Result.conflicts,
    l2Retries: l2Result.retries,
    l1FactsAdded: l1Result.added,
    l1FactsSkipped: l1Result.skipped,
    cosineDeduplicationActive: l1Result.deduped,
    steps: stepResults,
  };

  let auditRef = { key: null, hash: null };
  try {
    auditRef = await appendAuditEntry(ctx, tenantId, auditEntry);
    stepResults.appendAuditEntry = { ok: true, ...auditRef };
  } catch (err) {
    stepResults.appendAuditEntry = { ok: false, error: err.message };
  }

  return {
    success: true,
    sessionId,
    tenantId,
    startedAt,
    finishedAt,
    auditKey: auditRef.key,
    auditHash: auditRef.hash,
    steps: stepResults,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _isNotFound(err) {
  return (
    err?.code === 'NOT_FOUND' ||
    err?.type === 'NOT_FOUND' ||
    err?.message?.includes('NOT_FOUND') ||
    err?.message?.includes('not found') ||
    err?.message?.toLowerCase()?.includes('not found')
  );
}

function _isActionUnavailable(err) {
  return (
    err?.code === 'SERVICE_NOT_FOUND' ||
    err?.type === 'SERVICE_NOT_FOUND' ||
    err?.message?.includes('SERVICE_NOT_FOUND')
  );
}

function _isConflict(err) {
  return (
    err?.code === 409 ||
    err?.status === 409 ||
    err?.type === 'OBJECT_OCC_CONFLICT' ||
    err?.type === 'JOB_OCC_CONFLICT' ||
    err?.message?.toLowerCase?.().includes('conflict')
  );
}

function _sleep(ms, options = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (options.unref && typeof timer.unref === 'function') {
      timer.unref();
    }
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DREAM_INACTIVITY_MS,
  DREAM_AUDIT_NAMESPACE,
  TENANT_MEMORY_NAMESPACE,
  COSINE_DEDUP_THRESHOLD,
  OCC_MAX_RETRIES,
  scheduleDream,
  cancelDream,
  isDreamPending,
  extractFacts,
  enrichL2Profile,
  computeCosineSimilarity,
  enrichL1TenantMemory,
  appendAuditEntry,
  runDreamPipeline,
  buildDreamIdempotencyKey,
};
