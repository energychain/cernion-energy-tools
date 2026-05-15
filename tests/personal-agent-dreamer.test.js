'use strict';

/**
 * tests/personal-agent-dreamer.test.js
 * Unit tests for src/personal-agent-dreamer.js
 *
 * AK1: Atomic L2 profile enrichment — confidence-based conflict resolution + OCC retry
 * AK2: L1 tenant memory dedup — cosine-similarity > 0.95 threshold
 * AK3: Pure append-only audit trail — SHA-256 integrity hash per entry
 */

jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));

jest.mock('../src/job-store', () => {
  const jobs = new Map();
  const byIdempotency = new Map();
  let seq = 0;

  function mergeJob(jobId, patch, options = {}) {
    const current = jobs.get(jobId) || { jobId };

    if (Object.prototype.hasOwnProperty.call(options, 'expectedRev')) {
      if (options.expectedRev !== current._rev) {
        const error = new Error('job revision conflict');
        error.code = 409;
        error.type = 'JOB_OCC_CONFLICT';
        throw error;
      }
    }

    const next = {
      ...current,
      ...patch,
      _rev: Number.isFinite(Number(current._rev)) ? Number(current._rev) + 1 : 1,
    };
    jobs.set(jobId, next);
    return next;
  }

  return {
    startJob: jest.fn(async (_ctx, _meta, _worker, options = {}) => {
      const idempotencyKey = String(options.idempotencyKey || '');
      const existingJobId = byIdempotency.get(idempotencyKey);
      if (existingJobId) {
        const existing = jobs.get(existingJobId);
        if (existing && (existing.status === 'queued' || existing.status === 'running')) {
          return { jobId: existingJobId, status: 'queued', reused: true };
        }
      }

      seq += 1;
      const jobId = `job-${seq}`;
      byIdempotency.set(idempotencyKey, jobId);
      jobs.set(jobId, {
        jobId,
        status: 'queued',
        idempotencyKey,
        dreamSchedule: null,
        _rev: 1,
      });
      return { jobId, status: 'queued', reused: false };
    }),
    findJobByIdempotencyKey: jest.fn((service, action, idempotencyKey) => {
      const jobId = byIdempotency.get(String(idempotencyKey || ''));
      if (!jobId) return null;
      const job = jobs.get(jobId);
      if (!job) return null;
      return {
        jobId,
        service,
        action,
        idempotencyKey,
        status: job.status,
      };
    }),
    getJob: jest.fn((jobId) => jobs.get(jobId) || null),
    updateJob: jest.fn((jobId, patch, options = {}) => mergeJob(jobId, patch, options)),
    deleteJob: jest.fn((jobId) => {
      const had = jobs.has(jobId);
      if (!had) return false;
      const job = jobs.get(jobId);
      if (job?.idempotencyKey) {
        byIdempotency.delete(job.idempotencyKey);
      }
      jobs.delete(jobId);
      return true;
    }),
    __reset: jest.fn(() => {
      jobs.clear();
      byIdempotency.clear();
      seq = 0;
    }),
  };
});

const {
  extractFacts,
  enrichL2Profile,
  computeCosineSimilarity,
  enrichL1TenantMemory,
  appendAuditEntry,
  runDreamPipeline,
  scheduleDream,
  cancelDream,
  isDreamPending,
  buildDreamIdempotencyKey,
  COSINE_DEDUP_THRESHOLD,
  OCC_MAX_RETRIES,
} = require('../src/personal-agent-dreamer');

const { embeddings: mockEmbeddings, capabilities: mockCapabilities } = require('../src/llm-client');
const jobStore = require('../src/job-store');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(store = {}) {
  const _store = { ...store };
  return {
    meta: {},
    call: jest.fn(async (action, params) => {
      if (action === 'object-store.get') {
        const key = `${params.namespace}::${params.key}`;
        if (!_store[key]) {
          const err = new Error('not found');
          err.code = 'NOT_FOUND';
          throw err;
        }
        return _store[key];
      }
      if (action === 'object-store.put') {
        const key = `${params.namespace}::${params.key}`;
        const existing = _store[key] || null;
        const hasRevToken = Object.prototype.hasOwnProperty.call(params, '_rev');
        const expectedRev = hasRevToken ? params._rev : undefined;
        const currentRev = existing?._rev ?? null;

        if (hasRevToken && expectedRev !== currentRev) {
          const err = new Error('revision conflict');
          err.code = 409;
          err.type = 'OBJECT_OCC_CONFLICT';
          throw err;
        }

        const nextRev = existing ? String(Number(existing._rev || '0') + 1) : '1';
        _store[key] = {
          payload: params.payload,
          key: params.key,
          updatedAt: new Date().toISOString(),
          _rev: nextRev,
        };
        return { ok: true, _rev: nextRev };
      }
      if (action === 'object-store.query') {
        const prefix = params.namespace;
        const docs = Object.entries(_store)
          .filter(([k]) => k.startsWith(prefix + '::'))
          .map(([k, v]) => ({ key: k.split('::')[1], ...v }));
        return { docs };
      }
      throw new Error(`Unknown action: ${action}`);
    }),
    _store,
  };
}

// ---------------------------------------------------------------------------
// extractFacts
// ---------------------------------------------------------------------------

describe('extractFacts', () => {
  test('returns empty facts for session with no history', () => {
    const result = extractFacts({});
    expect(result.tenantFacts).toEqual([]);
    expect(result.preferences).toEqual([]);
  });

  test('extracts Netzbetreiber fact from user messages', () => {
    const session = {
      l3: {
        history: [
          { role: 'user', text: 'Netzbetreiber: TWL Netze Ludwigshafen' },
        ],
      },
    };
    const result = extractFacts(session);
    expect(result.tenantFacts.some((f) => f.includes('TWL Netze Ludwigshafen'))).toBe(true);
  });

  test('extracts capacity fact from user messages', () => {
    const session = {
      l3: {
        history: [{ role: 'user', text: 'Wir haben 500 kWp installiert.' }],
      },
    };
    const result = extractFacts(session);
    expect(result.tenantFacts.some((f) => f.includes('500 kWp'))).toBe(true);
  });

  test('extracts language preference (German)', () => {
    const session = {
      l3: {
        history: [{ role: 'user', text: 'Bitte auf deutsch antworten.' }],
      },
    };
    const result = extractFacts(session);
    const langPref = result.preferences.find((p) => p.key === 'language');
    expect(langPref?.value).toBe('de');
    expect(langPref?.confidence).toBeGreaterThan(0.5);
  });

  test('extracts language preference (English)', () => {
    const session = {
      l3: {
        history: [{ role: 'user', text: 'Please answer in english.' }],
      },
    };
    const result = extractFacts(session);
    const langPref = result.preferences.find((p) => p.key === 'language');
    expect(langPref?.value).toBe('en');
  });

  test('extracts domain interest for redispatch', () => {
    const session = {
      l3: {
        history: [{ role: 'user', text: 'Zeig mir die redispatch Daten.' }],
      },
    };
    const result = extractFacts(session);
    const domainPref = result.preferences.find((p) => p.key === 'domainInterest' && p.value === 'redispatch');
    expect(domainPref).toBeDefined();
  });

  test('extracts outputDetail brief preference', () => {
    const session = {
      l3: {
        history: [{ role: 'user', text: 'Bitte kurz und knapp.' }],
      },
    };
    const result = extractFacts(session);
    const pref = result.preferences.find((p) => p.key === 'outputDetail');
    expect(pref?.value).toBe('brief');
  });

  test('deduplicates tenant facts across messages', () => {
    const session = {
      l3: {
        history: [
          { role: 'user', text: 'Netzbetreiber: TWL Netze' },
          { role: 'user', text: 'Netzbetreiber: TWL Netze' },
        ],
      },
    };
    const result = extractFacts(session);
    const matching = result.tenantFacts.filter((f) => f.includes('TWL Netze'));
    expect(matching.length).toBe(1);
  });

  test('ignores assistant messages for fact extraction', () => {
    const session = {
      l3: {
        history: [
          { role: 'assistant', text: 'Netzbetreiber: FakeNetz' },
        ],
      },
    };
    const result = extractFacts(session);
    expect(result.tenantFacts).toEqual([]);
  });

  test('limits tenant facts to 20', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: 'user',
      text: `Leistung: ${i + 1} kW`,
    }));
    const result = extractFacts({ l3: { history } });
    expect(result.tenantFacts.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// AK1 — enrichL2Profile (confidence-based conflict resolution + OCC)
// ---------------------------------------------------------------------------

describe('AK1 — enrichL2Profile', () => {
  const namespace = 'personal_agent_user_profiles:tenant1';
  const userId = 'user1';

  test('writes new preferences to empty profile', async () => {
    const ctx = makeCtx();
    const prefs = [{ key: 'language', value: 'de', confidence: 0.9, updatedAt: '2026-01-01T00:00:00Z' }];
    const result = await enrichL2Profile(ctx, 'tenant1', userId, namespace, prefs);
    expect(result.merged.language.value).toBe('de');
    expect(result.conflicts).toBe(0);
  });

  test('higher confidence preference wins over existing lower confidence', async () => {
    const ctx = makeCtx();
    // Seed with low-confidence preference
    await ctx.call('object-store.put', {
      namespace,
      key: userId,
      payload: { userId, preferences: { language: { value: 'en', confidence: 0.3, updatedAt: '2026-01-01T00:00:00Z' } } },
    });

    const prefs = [{ key: 'language', value: 'de', confidence: 0.9, updatedAt: '2026-01-02T00:00:00Z' }];
    const result = await enrichL2Profile(ctx, 'tenant1', userId, namespace, prefs);
    expect(result.merged.language.value).toBe('de');
    expect(result.conflicts).toBe(1);
  });

  test('lower confidence preference does NOT overwrite existing higher confidence', async () => {
    const ctx = makeCtx();
    await ctx.call('object-store.put', {
      namespace,
      key: userId,
      payload: { userId, preferences: { language: { value: 'de', confidence: 0.95, updatedAt: '2026-01-01T00:00:00Z' } } },
    });

    const prefs = [{ key: 'language', value: 'en', confidence: 0.4, updatedAt: '2026-01-02T00:00:00Z' }];
    const result = await enrichL2Profile(ctx, 'tenant1', userId, namespace, prefs);
    expect(result.merged.language.value).toBe('de'); // existing wins
    expect(result.conflicts).toBe(0);
  });

  test('equal confidence: newer updatedAt wins', async () => {
    const ctx = makeCtx();
    await ctx.call('object-store.put', {
      namespace,
      key: userId,
      payload: { userId, preferences: { language: { value: 'en', confidence: 0.7, updatedAt: '2026-01-01T00:00:00Z' } } },
    });

    const prefs = [{ key: 'language', value: 'de', confidence: 0.7, updatedAt: '2026-06-01T00:00:00Z' }];
    const result = await enrichL2Profile(ctx, 'tenant1', userId, namespace, prefs);
    expect(result.merged.language.value).toBe('de'); // newer wins
  });

  test('returns early with empty result when no preferences provided', async () => {
    const ctx = makeCtx();
    const result = await enrichL2Profile(ctx, 'tenant1', userId, namespace, []);
    expect(result.merged).toEqual({});
    expect(result.conflicts).toBe(0);
  });

  test('OCC: retries on write failure and succeeds within OCC_MAX_RETRIES', async () => {
    const ctx = makeCtx();
    let callCount = 0;
    const originalCall = ctx.call.bind(ctx);
    ctx.call = jest.fn(async (action, params, opts) => {
      if (action === 'object-store.put') {
        callCount += 1;
        if (callCount === 1) throw new Error('transient write error');
      }
      return originalCall(action, params, opts);
    });

    const prefs = [{ key: 'language', value: 'de', confidence: 0.8, updatedAt: new Date().toISOString() }];
    const result = await enrichL2Profile(ctx, 'tenant1', userId, namespace, prefs);
    expect(result.retries).toBeGreaterThanOrEqual(1);
    expect(result.merged.language.value).toBe('de');
  });

  test('null confidence is treated as lowest priority', async () => {
    const ctx = makeCtx();
    await ctx.call('object-store.put', {
      namespace,
      key: userId,
      payload: { userId, preferences: { language: { value: 'de', confidence: 0.5, updatedAt: '2026-01-01T00:00:00Z' } } },
    });

    const prefs = [{ key: 'language', value: 'en', confidence: null, updatedAt: '2026-06-01T00:00:00Z' }];
    const result = await enrichL2Profile(ctx, 'tenant1', userId, namespace, prefs);
    expect(result.merged.language.value).toBe('de'); // null confidence loses
  });
});

// ---------------------------------------------------------------------------
// computeCosineSimilarity
// ---------------------------------------------------------------------------

describe('computeCosineSimilarity', () => {
  test('identical vectors return 1', () => {
    const vec = [1, 2, 3];
    expect(computeCosineSimilarity(vec, vec)).toBeCloseTo(1.0);
  });

  test('orthogonal vectors return 0', () => {
    expect(computeCosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  test('opposite vectors return -1', () => {
    expect(computeCosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  test('returns 0 for empty vectors', () => {
    expect(computeCosineSimilarity([], [])).toBe(0);
  });

  test('returns 0 for mismatched lengths', () => {
    expect(computeCosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  test('returns 0 for zero vectors', () => {
    expect(computeCosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  test(`COSINE_DEDUP_THRESHOLD is ${COSINE_DEDUP_THRESHOLD}`, () => {
    expect(COSINE_DEDUP_THRESHOLD).toBe(0.95);
  });

  test('very similar vectors exceed threshold', () => {
    const base = [1, 0.01, 0.01];
    const similar = [1, 0.02, 0.02];
    expect(computeCosineSimilarity(base, similar)).toBeGreaterThan(COSINE_DEDUP_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// AK2 — enrichL1TenantMemory (cosine dedup > 0.95)
// ---------------------------------------------------------------------------

describe('AK2 — enrichL1TenantMemory', () => {
  beforeEach(() => {
    mockEmbeddings.mockReset();
    mockCapabilities.mockReturnValue({ embeddings: true });
  });

  test('adds new facts when store is empty', async () => {
    mockEmbeddings.mockResolvedValue([]);
    const ctx = makeCtx();
    const result = await enrichL1TenantMemory(ctx, 'tenant1', ['Netzbetreiber: TWL Netze']);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
  });

  test('skips exact duplicate facts', async () => {
    const ctx = makeCtx();
    // Pre-seed the namespace
    const ns = 'personal_agent_tenant_memory:tenant1';
    await ctx.call('object-store.put', {
      namespace: ns,
      key: 'fact:abc',
      payload: { text: 'Netzbetreiber: TWL Netze', addedAt: '2026-01-01T00:00:00Z', source: 'dream-pipeline' },
    });
    mockEmbeddings.mockResolvedValue([[1, 0, 0]]);
    const result = await enrichL1TenantMemory(ctx, 'tenant1', ['Netzbetreiber: TWL Netze']);
    expect(result.skipped).toBe(1);
    expect(result.added).toBe(0);
  });

  test('AK2: skips semantically similar fact (cosine > 0.95)', async () => {
    const ctx = makeCtx();
    const ns = 'personal_agent_tenant_memory:tenant1';
    await ctx.call('object-store.put', {
      namespace: ns,
      key: 'fact:existing',
      payload: { text: 'Leistung: 500 kW', addedAt: '2026-01-01T00:00:00Z', source: 'dream-pipeline' },
    });

    // Existing embedding: [1, 0, 0]
    // New fact embedding (very similar): [0.999, 0.001, 0]
    mockEmbeddings
      .mockResolvedValueOnce([[1, 0, 0]])        // existing facts batch
      .mockResolvedValueOnce([[0.999, 0.001, 0]]); // new fact

    const sim = computeCosineSimilarity([1, 0, 0], [0.999, 0.001, 0]);
    expect(sim).toBeGreaterThan(COSINE_DEDUP_THRESHOLD);

    const result = await enrichL1TenantMemory(ctx, 'tenant1', ['Leistung: 500 kW similar']);
    expect(result.skipped).toBe(1);
    expect(result.added).toBe(0);
    expect(result.deduped).toBe(true);
  });

  test('AK2: adds fact with cosine < 0.95 (sufficiently different)', async () => {
    const ctx = makeCtx();
    const ns = 'personal_agent_tenant_memory:tenant1';
    await ctx.call('object-store.put', {
      namespace: ns,
      key: 'fact:existing',
      payload: { text: 'Leistung: 500 kW', addedAt: '2026-01-01T00:00:00Z', source: 'dream-pipeline' },
    });

    // Orthogonal vectors → cosine = 0
    mockEmbeddings
      .mockResolvedValueOnce([[1, 0, 0]])   // existing
      .mockResolvedValueOnce([[0, 1, 0]]);  // new (different)

    const result = await enrichL1TenantMemory(ctx, 'tenant1', ['Netzbetreiber: Bayernwerk']);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
  });

  test('degrades gracefully when embeddings unavailable', async () => {
    mockCapabilities.mockReturnValue({ embeddings: false });
    const ctx = makeCtx();
    const result = await enrichL1TenantMemory(ctx, 'tenant1', ['fact without embeddings']);
    expect(result.added).toBe(1);
    expect(result.deduped).toBe(false);
  });

  test('handles empty fact list gracefully', async () => {
    const ctx = makeCtx();
    const result = await enrichL1TenantMemory(ctx, 'tenant1', []);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test('adds newly persisted vector for intra-batch dedup in same dream run', async () => {
    const ctx = makeCtx();
    mockCapabilities.mockReturnValue({ embeddings: true });
    mockEmbeddings
      .mockResolvedValueOnce([[1, 0, 0]])
      .mockResolvedValueOnce([[0.999, 0.001, 0]]);

    const result = await enrichL1TenantMemory(ctx, 'tenant1', [
      'Fact A',
      'Fact B semantically duplicate of A',
    ]);

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AK3 — appendAuditEntry (append-only + SHA-256 integrity hash)
// ---------------------------------------------------------------------------

describe('AK3 — appendAuditEntry', () => {
  test('writes entry with integrityHash', async () => {
    const ctx = makeCtx();
    const { key, hash } = await appendAuditEntry(ctx, 'tenant1', { sessionId: 'sess1', l1FactsAdded: 2 });
    expect(key).toMatch(/^dream:/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('integrity hash matches payload content', async () => {
    const crypto = require('crypto');
    const ctx = makeCtx();
    const { key } = await appendAuditEntry(ctx, 'tenant1', { sessionId: 'sess2', note: 'test' });

    // Retrieve the stored entry
    const ns = 'personal_agent_dream_audit:tenant1';
    const stored = ctx._store[`${ns}::${key}`];
    const payload = stored.payload;
    const { integrityHash, ...rest } = payload;
    const recomputed = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    expect(integrityHash).toBe(recomputed);
  });

  test('each entry gets a unique key (append-only guarantee)', async () => {
    const ctx = makeCtx();
    const [a, b] = await Promise.all([
      appendAuditEntry(ctx, 'tenant1', { sessionId: 'a' }),
      appendAuditEntry(ctx, 'tenant1', { sessionId: 'b' }),
    ]);
    expect(a.key).not.toBe(b.key);
  });

  test('entry includes recordedAt timestamp', async () => {
    const ctx = makeCtx();
    const { key } = await appendAuditEntry(ctx, 'tenant1', { sessionId: 'sess3' });
    const ns = 'personal_agent_dream_audit:tenant1';
    const stored = ctx._store[`${ns}::${key}`];
    expect(stored.payload.recordedAt).toBeDefined();
    expect(new Date(stored.payload.recordedAt).getTime()).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// runDreamPipeline (integration)
// ---------------------------------------------------------------------------

describe('runDreamPipeline', () => {
  beforeEach(() => {
    mockEmbeddings.mockReset();
    mockCapabilities.mockReturnValue({ embeddings: false }); // keep tests deterministic
  });

  test('completes all 4 steps and returns success', async () => {
    const ctx = makeCtx();
    const session = {
      l3: {
        history: [
          { role: 'user', text: 'Netzbetreiber: TWL Netze' },
          { role: 'user', text: 'Bitte auf deutsch.' },
        ],
      },
    };
    const result = await runDreamPipeline(ctx, 'sess1', 'tenant1', 'user1', 'personal_agent_user_profiles:tenant1', session);
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('sess1');
    expect(result.steps.extractFacts.ok).toBe(true);
    expect(result.steps.enrichL2Profile.ok).toBe(true);
    expect(result.steps.enrichL1TenantMemory.ok).toBe(true);
    expect(result.steps.appendAuditEntry.ok).toBe(true);
    expect(result.auditHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('audit entry records fact and preference counts', async () => {
    const ctx = makeCtx();
    const session = {
      l3: {
        history: [
          { role: 'user', text: 'Netzbetreiber: Bayernwerk' },
          { role: 'user', text: 'Bitte kurz.' },
        ],
      },
    };
    const result = await runDreamPipeline(ctx, 'sess2', 'tenant1', 'user1', 'personal_agent_user_profiles:tenant1', session);
    expect(result.steps.extractFacts.tenantFactsCount).toBeGreaterThanOrEqual(1);
    expect(result.steps.extractFacts.preferencesCount).toBeGreaterThanOrEqual(1);
  });

  test('completes even when session has no history', async () => {
    const ctx = makeCtx();
    const result = await runDreamPipeline(ctx, 'sess3', 'tenant1', 'user1', 'personal_agent_user_profiles:tenant1', {});
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Durable scheduling (scheduleDream / cancelDream / isDreamPending)
// ---------------------------------------------------------------------------

describe('Dream durable scheduling', () => {
  const broker = {
    call: jest.fn(async () => ({ ok: true })),
  };

  beforeEach(() => {
    jobStore.__reset();
  });

  test('isDreamPending returns false when no timer set', () => {
    expect(isDreamPending('tenant1', 'no-session')).toBe(false);
  });

  test('isDreamPending returns true after scheduleDream', async () => {
    await scheduleDream({
      broker,
      tenantId: 'tenant1',
      sessionId: 'sess-x',
      userId: 'user1',
      profileNamespace: 'personal_agent_user_profiles:tenant1',
      authMeta: { authUser: { userId: 'user1' }, roles: ['test-role'] },
      runFn: jest.fn(),
    });
    expect(isDreamPending('tenant1', 'sess-x')).toBe(true);
    await cancelDream('tenant1', 'sess-x');
  });

  test('cancelDream removes pending schedule', async () => {
    await scheduleDream({
      broker,
      tenantId: 'tenant1',
      sessionId: 'sess-y',
      userId: 'user1',
      profileNamespace: 'personal_agent_user_profiles:tenant1',
      authMeta: { authUser: { userId: 'user1' } },
      runFn: jest.fn(),
    });
    await cancelDream('tenant1', 'sess-y');
    expect(isDreamPending('tenant1', 'sess-y')).toBe(false);
  });

  test('scheduleDream updates generation on idempotent re-schedule', async () => {
    const first = await scheduleDream({
      broker,
      tenantId: 'tenant1',
      sessionId: 'sess-z',
      userId: 'user1',
      profileNamespace: 'personal_agent_user_profiles:tenant1',
      authMeta: { authUser: { userId: 'user1' }, scopes: ['dream:run'] },
      runFn: jest.fn(),
    });
    const second = await scheduleDream({
      broker,
      tenantId: 'tenant1',
      sessionId: 'sess-z',
      userId: 'user1',
      profileNamespace: 'personal_agent_user_profiles:tenant1',
      authMeta: { authUser: { userId: 'user1' }, scopes: ['dream:run'] },
      runFn: jest.fn(),
    });

    expect(second.jobId).toBe(first.jobId);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(isDreamPending('tenant1', 'sess-z')).toBe(true);
  });

  test('buildDreamIdempotencyKey is tenant-scoped and deterministic', () => {
    const keyA = buildDreamIdempotencyKey('tenant1', 'session1');
    const keyB = buildDreamIdempotencyKey('tenant1', 'session1');
    const keyC = buildDreamIdempotencyKey('tenant2', 'session1');
    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });

  test('scheduleDream payload is minimal and excludes full session snapshot', async () => {
    await scheduleDream({
      broker,
      tenantId: 'tenant1',
      sessionId: 'sess-minimal',
      userId: 'user1',
      profileNamespace: 'personal_agent_user_profiles:tenant1',
      authMeta: {
        authUser: { userId: 'user1' },
        requestHeaders: {
          authorization: 'Bearer SECRET',
          'x-request-id': 'req-1',
        },
      },
      runFn: jest.fn(),
    });

    const existing = jobStore.findJobByIdempotencyKey(
      'personal-agent',
      'dream-pipeline',
      buildDreamIdempotencyKey('tenant1', 'sess-minimal')
    );
    const job = jobStore.getJob(existing.jobId);
    expect(job.dreamSchedule.payload.session).toBeUndefined();
    expect(job.dreamSchedule.payload.sessionId).toBe('sess-minimal');
    expect(job.dreamSchedule.payload.tenantId).toBe('tenant1');
    expect(job.dreamSchedule.payload.authMeta.requestHeaders).toBeUndefined();
  });
});
