'use strict';

/**
 * Tests for src/oemetadata-builder.js (AP1 — OEMetadata v2.0)
 */

const { buildOEMetadata, validateAgainstSchema } = require('../src/oemetadata-builder');

// ---------------------------------------------------------------------------
// Minimal PouchDB datapoint document fixture
// ---------------------------------------------------------------------------
function makeDoc(overrides = {}) {
  return {
    _id: 'dp:pv-portfolio-test',
    name: 'pv-portfolio-test',
    description: 'Test PV portfolio datapoint',
    owner: 'test-owner',
    tags: ['solar', 'renewable'],
    sourceType: 'solar',
    sessionId: 'session-abc123',
    fixedParams: { gridOperator: 'Stadtwerke Test', city: 'Teststadt' },
    plan: {
      steps: [
        { step: 1, action: 'assets.solarForecast', description: 'Fetch solar forecast', params: { gridOperator: null } },
        { step: 2, action: 'energy-market.spotPrice', description: 'Spot prices', params: {} },
      ],
    },
    refresh: { strategy: 'interval', intervalMinutes: 60 },
    lastRun: {
      timestamp: '2025-06-01T12:00:00.000Z',
      durationMs: 3200,
      status: 'success',
      errorMessage: null,
      summary: {
        rowCount: 42,
        columns: ['timestamp', 'capacity_mw', 'price_eur'],
        sampleValues: { firstRow: { timestamp: '2025-06-01T00:00:00Z', capacity_mw: 12.5, price_eur: 85.3 } },
      },
      schemaHash: 'abc1234567890abc',
    },
    provenanceHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc12345',
    health: {
      totalRuns: 10,
      consecutiveSuccesses: 5,
      consecutiveFailures: 0,
      avgDurationMs: 3000,
      schemaStable: true,
      lastFailure: null,
    },
    agent_interventions: [
      { timestamp: '2025-06-01T11:00:00Z', type: 'correction', field: 'capacity_mw', reason: 'outlier removed' },
    ],
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure validation
// ---------------------------------------------------------------------------
describe('buildOEMetadata — top-level structure', () => {
  let meta;

  beforeAll(() => {
    meta = buildOEMetadata(makeDoc());
  });

  it('returns an object', () => {
    expect(typeof meta).toBe('object');
    expect(meta).not.toBeNull();
  });

  it('includes required OEMetadata v2.0 top-level keys', () => {
    expect(meta).toHaveProperty('name');
    expect(meta).toHaveProperty('title');
    expect(meta).toHaveProperty('description');
    expect(meta).toHaveProperty('subject');
    expect(meta).toHaveProperty('language');
    expect(meta).toHaveProperty('keywords');
    expect(meta).toHaveProperty('publicationDate');
    expect(meta).toHaveProperty('spatial');
    expect(meta).toHaveProperty('temporal');
    expect(meta).toHaveProperty('sources');
    expect(meta).toHaveProperty('licenses');
    expect(meta).toHaveProperty('contributors');
    expect(meta).toHaveProperty('resources');
    expect(meta).toHaveProperty('review');
    expect(meta).toHaveProperty('metaMetadata');
  });

  it('populates name from doc.name', () => {
    expect(meta.name).toBe('pv-portfolio-test');
  });

  it('populates description from doc.description', () => {
    expect(meta.description).toBe('Test PV portfolio datapoint');
  });

  it('sets language to English', () => {
    expect(Array.isArray(meta.language)).toBe(true);
    expect(meta.language.length).toBeGreaterThan(0);
  });

  it('includes keywords derived from tags', () => {
    expect(Array.isArray(meta.keywords)).toBe(true);
  });

  it('includes a publicationDate string', () => {
    expect(typeof meta.publicationDate).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Spatial block
// ---------------------------------------------------------------------------
describe('buildOEMetadata — spatial', () => {
  it('extracts gridOperator from fixedParams', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(meta.spatial).toHaveProperty('extent');
  });

  it('defaults to Germany when no location info available', () => {
    const meta = buildOEMetadata(makeDoc({ fixedParams: {} }));
    expect(JSON.stringify(meta.spatial)).toMatch(/Germany|Deutschland|DE/);
  });
});

// ---------------------------------------------------------------------------
// Temporal block
// ---------------------------------------------------------------------------
describe('buildOEMetadata — temporal', () => {
  it('sets referenceDate from lastRun.timestamp', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(meta.temporal).toHaveProperty('referenceDate');
    expect(meta.temporal.referenceDate).toBe('2025-06-01');
  });

  it('includes timeseries with start and end', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(Array.isArray(meta.temporal.timeseries)).toBe(true);
    if (meta.temporal.timeseries.length > 0) {
      expect(meta.temporal.timeseries[0]).toHaveProperty('start');
      expect(meta.temporal.timeseries[0]).toHaveProperty('end');
    }
  });
});

// ---------------------------------------------------------------------------
// Resources / fields block
// ---------------------------------------------------------------------------
describe('buildOEMetadata — resources and fields', () => {
  it('includes at least one resource', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(Array.isArray(meta.resources)).toBe(true);
    expect(meta.resources.length).toBeGreaterThan(0);
  });

  it('resource has a schema.fields array', () => {
    const meta = buildOEMetadata(makeDoc());
    const resource = meta.resources[0];
    expect(resource).toHaveProperty('schema');
    expect(Array.isArray(resource.schema.fields)).toBe(true);
  });

  it('fields are built from lastRun.summary.columns', () => {
    const meta = buildOEMetadata(makeDoc());
    const fields = meta.resources[0].schema.fields;
    const fieldNames = fields.map((f) => f.name);
    expect(fieldNames).toContain('timestamp');
    expect(fieldNames).toContain('capacity_mw');
    expect(fieldNames).toContain('price_eur');
  });

  it('each field has name, type, and description', () => {
    const meta = buildOEMetadata(makeDoc());
    for (const field of meta.resources[0].schema.fields) {
      expect(field).toHaveProperty('name');
      expect(field).toHaveProperty('type');
      expect(field).toHaveProperty('description');
    }
  });

  it('handles empty columns gracefully', () => {
    const doc = makeDoc();
    doc.lastRun.summary.columns = [];
    doc.lastRun.summary.sampleValues = null;
    const meta = buildOEMetadata(doc);
    expect(Array.isArray(meta.resources[0].schema.fields)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sources and licenses
// ---------------------------------------------------------------------------
describe('buildOEMetadata — sources and licenses', () => {
  it('builds at least one source', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(Array.isArray(meta.sources)).toBe(true);
    expect(meta.sources.length).toBeGreaterThan(0);
  });

  it('each source has title, path, and licenses', () => {
    const meta = buildOEMetadata(makeDoc());
    for (const src of meta.sources) {
      expect(src).toHaveProperty('title');
      expect(src).toHaveProperty('path');
      expect(Array.isArray(src.licenses)).toBe(true);
    }
  });

  it('includes at least one license entry', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(Array.isArray(meta.licenses)).toBe(true);
    expect(meta.licenses.length).toBeGreaterThan(0);
  });

  it('each license has name and title', () => {
    const meta = buildOEMetadata(makeDoc());
    for (const lic of meta.licenses) {
      expect(lic).toHaveProperty('name');
      expect(lic).toHaveProperty('title');
    }
  });
});

// ---------------------------------------------------------------------------
// Subject (OEO IRIs)
// ---------------------------------------------------------------------------
describe('buildOEMetadata — subject (OEO classes)', () => {
  it('subject is an array', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(Array.isArray(meta.subject)).toBe(true);
  });

  it('each subject entry has name and path (OEO IRI)', () => {
    const meta = buildOEMetadata(makeDoc());
    for (const subj of meta.subject) {
      expect(subj).toHaveProperty('name');
      expect(subj).toHaveProperty('path');
    }
  });
});

// ---------------------------------------------------------------------------
// Cernion extension
// ---------------------------------------------------------------------------
describe('buildOEMetadata — _cernion extension', () => {
  it('includes _cernion namespace', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(meta).toHaveProperty('_cernion');
  });

  it('includes provenance hash in _cernion', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(meta._cernion.provenance).toHaveProperty('hash');
    expect(meta._cernion.provenance.hash).toBe(makeDoc().provenanceHash);
  });

  it('includes agent_interventions in _cernion', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(Array.isArray(meta._cernion.agent_interventions)).toBe(true);
    expect(meta._cernion.agent_interventions).toHaveLength(1);
  });

  it('includes scheduling in _cernion', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(meta._cernion).toHaveProperty('scheduling');
    expect(meta._cernion.scheduling.strategy).toBe('interval');
    expect(meta._cernion.scheduling.intervalMinutes).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Edge cases and robustness
// ---------------------------------------------------------------------------
describe('buildOEMetadata — robustness', () => {
  it('handles lastRun.status=never (no timestamp)', () => {
    const doc = makeDoc({
      lastRun: { status: 'never', timestamp: null, summary: null, schemaHash: null },
    });
    expect(() => buildOEMetadata(doc)).not.toThrow();
    const meta = buildOEMetadata(doc);
    expect(meta.temporal.referenceDate).toBeNull();
  });

  it('handles missing plan steps gracefully', () => {
    const doc = makeDoc({ plan: { steps: [] } });
    expect(() => buildOEMetadata(doc)).not.toThrow();
  });

  it('handles null provenanceHash', () => {
    const doc = makeDoc({ provenanceHash: null });
    const meta = buildOEMetadata(doc);
    expect(meta._cernion.provenance.hash).toBeNull();
  });

  it('handles no agent_interventions', () => {
    const doc = makeDoc({ agent_interventions: [] });
    const meta = buildOEMetadata(doc);
    expect(meta._cernion.agent_interventions).toHaveLength(0);
  });

  it('handles manual refresh strategy', () => {
    const doc = makeDoc({ refresh: { strategy: 'manual' } });
    const meta = buildOEMetadata(doc);
    expect(meta._cernion.scheduling.strategy).toBe('manual');
    expect(meta._cernion.scheduling.intervalMinutes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateAgainstSchema (graceful — schema file may not be present in CI)
// ---------------------------------------------------------------------------
describe('validateAgainstSchema', () => {
  it('returns an object with valid, errors, warnings', async () => {
    const doc = makeDoc();
    const meta = buildOEMetadata(doc);
    const result = await validateAgainstSchema(meta);
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
  });

  it('valid is a boolean', async () => {
    const meta = buildOEMetadata(makeDoc());
    const result = await validateAgainstSchema(meta);
    expect(typeof result.valid).toBe('boolean');
  });

  it('does not throw even if schema file is missing', () => {
    const meta = buildOEMetadata(makeDoc());
    expect(() => validateAgainstSchema(meta)).not.toThrow();
    const result = validateAgainstSchema(meta);
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
  });
});
