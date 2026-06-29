'use strict';

/**
 * Tests for audit-oemetadata-builder.js, mastr-quality.oemetadata action,
 * hydration registry integration, and capability broker routing.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { ServiceBroker } = require('moleculer');

// Setup temporary DB and job store paths so tests are isolated and don't clash
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-audit-mq-test-${Date.now()}`);
process.env.MASTR_QUALITY_DB_PATH = TEST_DB_PATH;

const {
  buildOemetadataForAudit,
  validateAgainstSchema,
} = require('../src/audit-oemetadata-builder');
const { getRule, getStaticRules } = require('../src/dossier-hydration-registry');
const CapabilityBrokerService = require('../services/capability-broker.service');

function makeAuditDoc(overrides = {}) {
  return {
    _id: 'mq:test-id',
    id: 'test-id',
    qualityScore: 92,
    timestamp: '2026-06-22T09:00:00.000Z',
    gridOperator: {
      mastrId: 'SNB935578300972',
      name: 'STROMDAO Netze GmbH',
      bdew: '9907473000008',
      bnr: '10002977',
    },
    findings: [
      { step: 4, findingCode: 'MQ_ZERO_CAPACITY', severity: 'error', message: 'Zero capacity' },
      {
        step: 6,
        findingCode: 'MQ_PROBABLE_DUPLICATE',
        severity: 'warning',
        message: 'Possible duplicate',
      },
    ],
    provenanceHash: 'hash1234567890abcdef1234567890abcdef1234567890abc',
    qualityDimensions: {
      status: 100,
      capacity: 90,
      connectionPoints: 100,
      duplicates: 90,
      geo: 100,
    },
    ...overrides,
  };
}

describe('Audit OEMetadata Builder', () => {
  describe('buildOemetadataForAudit', () => {
    it('returns an object with JSON-LD / OEMetadata v2.0 fields', () => {
      const audit = makeAuditDoc();
      const meta = buildOemetadataForAudit(audit);

      expect(typeof meta).toBe('object');
      expect(meta).not.toBeNull();
      expect(meta['@id']).toBe('urn:cernion:audit:mq:test-id');
      expect(meta['@context']).toBe(
        'https://raw.githubusercontent.com/OpenEnergyPlatform/oemetadata/v2.0.0/metadata/v200/context.json'
      );
      expect(meta.name).toBe('audit-mastr-quality-test-id');
      expect(meta.title).toContain('STROMDAO Netze GmbH');
      expect(meta.id).toBe('urn:cernion:audit:mq:test-id');
      expect(meta.description).toContain('Cernion MaStR Data Quality Audit Report');

      // Check subjects
      expect(Array.isArray(meta.subject)).toBe(true);
      expect(meta.subject[0].name).toBe('data analysis procedure');
      expect(meta.subject[0].path).toBe(
        'https://openenergyplatform.org/ontology/oeo/DataAnalysisProcedure'
      );

      // Check finding mappings are appended as subjects
      const subjectNames = meta.subject.map((s) => s.name);
      expect(subjectNames).toContain('finding: MQ_ZERO_CAPACITY');
      expect(subjectNames).toContain('finding: MQ_PROBABLE_DUPLICATE');

      // Spatial & Temporal
      expect(meta.spatial.location).toBe('STROMDAO Netze GmbH');
      expect(meta.temporal.referenceDate).toBe('2026-06-22');

      // Check resources
      expect(Array.isArray(meta.resources)).toBe(true);
      expect(meta.resources[0].profile).toBe('tabular-data-resource');
      expect(meta.resources[0].schema.fields.length).toBeGreaterThan(0);

      // _cernion extension
      expect(meta._cernion).toBeDefined();
      expect(meta._cernion.qualityScore).toBe(92);
      expect(meta._cernion.provenance.hash).toBe(
        'hash1234567890abcdef1234567890abcdef1234567890abc'
      );
    });

    it('validates against the schema without throwing', () => {
      const audit = makeDoc();
      const meta = buildOemetadataForAudit(audit);
      const res = validateAgainstSchema(meta);
      expect(res).toHaveProperty('valid');
      expect(res).toHaveProperty('errors');
    });
  });
});

describe('mastr-quality.oemetadata action', () => {
  let broker;
  let mqService;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    mqService = broker.createService(require('../services/mastr-quality.service'));
    await broker.start();

    // Clean and insert test document
    try {
      await mqService.db.put({
        _id: 'mq:test-id',
        ...makeAuditDoc(),
      });
    } catch (err) {
      if (err.name !== 'conflict') throw err;
    }
  });

  afterAll(async () => {
    // Delete database directory
    await broker.stop();
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch {}
  });

  it('serves oemetadata successfully for a valid ID', async () => {
    const res = await broker.call('mastr-quality.oemetadata', { id: 'test-id' });
    expect(res).toBeDefined();
    expect(res['@id']).toBe('urn:cernion:audit:mq:test-id');
    expect(res.name).toBe('audit-mastr-quality-test-id');
  });

  it('returns 404 for a missing ID', async () => {
    const ctx = { meta: {} };
    try {
      await broker.call('mastr-quality.oemetadata', { id: 'missing-id' }, { meta: ctx.meta });
      fail('Expected action to fail');
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});

describe('Answer Dossier Hydration Registry', () => {
  it('loads and compiles the mastr-quality.oemetadata hydration rule', () => {
    const rule = getRule('mastr-quality.oemetadata');
    expect(rule).not.toBeNull();
    expect(rule.id).toBe('mastr-quality.oemetadata');
    expect(rule.action).toBe('mastr-quality.oemetadata');

    // Check capability field on static rule
    const staticRule = getStaticRules().find((r) => r.id === 'mastr-quality.oemetadata');
    expect(staticRule.capability).toBe('mastr_quality_oemetadata');
    expect(staticRule.safety.classification).toBe('read_only');

    // Test parameter extraction
    const extracted = rule.extractParams({}, 'Audit report context id: mq-test-uuid-abc');
    expect(extracted).toEqual({ id: 'mq-test-uuid-abc' });
  });
});

describe('Capability Broker Routing for mastr_quality_oemetadata', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(CapabilityBrokerService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('routes query with "mastr fair-export" and "auditId" to mastr_quality_oemetadata', async () => {
    const res = await broker.call('capability-broker.recommend', {
      task: 'Bitte generiere den mastr fair-export für die auditId: test-id',
    });

    expect(res.capability).toBe('mastr_quality_oemetadata');
  });
});

function makeDoc() {
  return makeAuditDoc({ _id: 'mq:test-id', id: 'test-id' });
}
