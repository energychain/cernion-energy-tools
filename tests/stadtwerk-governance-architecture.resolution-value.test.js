'use strict';

const Ajv2020 = require('ajv/dist/2020');
const schema = require('../src/stadtwerk-governance-architecture/schema-pack/cr-lka-rv-001.schema.json');
const {
  buildMakoResolutionValueProjection,
} = require('../src/stadtwerk-governance-architecture/resolution-value-projection');
const fixture = require('../src/stadtwerk-governance-architecture/fixtures/red/mako-resolution-value.red.json');

describe('stadtwerk governance architecture MaKo resolution value projection', () => {
  test('builds qualitative cashflow acceleration projection while preserving MaKo evidence gates', () => {
    const projection = buildMakoResolutionValueProjection({
      runCardId: fixture.input.runCardId,
      missingEvidence: fixture.input.missingEvidence,
    });

    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    const valid = validate(projection);
    if (!valid) {
      throw new Error(`Projection schema validation failed: ${JSON.stringify(validate.errors)}`);
    }
    expect(valid).toBe(true);

    expect(projection.candidateId).toBe('CRC001');
    expect(projection.workedExample).toBe('mako_m2c_resolution_value');
    expect(projection.evidenceState.missingEvidence).toEqual(
      expect.arrayContaining([
        'confirmed_invoice_amount',
        'market_partner_confirmation',
        'owner_approval',
      ]),
    );
    expect(projection.resolutionValue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'cashflow_acceleration',
          evidenceStatus: 'partial',
          confidence: 'low',
          qualitativeImpact: expect.stringContaining('Cashflow'),
        }),
      ]),
    );
    expect(projection.hitlBoundary).toEqual(
      expect.objectContaining({
        requiresHitl: fixture.expected.mustRequireHitl,
      }),
    );
    expect(projection.forbiddenActions).toEqual(
      expect.arrayContaining(fixture.forbiddenActions),
    );
    expect(projection.allowedActions).not.toContain('approve_invoice');
  });
});
