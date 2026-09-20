'use strict';

const Ajv2020 = require('ajv/dist/2020');
const schema = require('../src/stadtwerk-governance-architecture/schema-pack/cr-lka-rv-001.schema.json');
const {
  buildAssetToDecisionProjection,
} = require('../src/stadtwerk-governance-architecture/resolution-value-projection');
const fixture = require('../src/stadtwerk-governance-architecture/fixtures/red/asset-to-decision.red.json');

function validateProjectionAgainstSchema(projection) {
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(projection);
  if (!valid) {
    throw new Error(`Projection schema validation failed: ${JSON.stringify(validate.errors)}`);
  }
  return valid;
}

describe('stadtwerk governance architecture asset-to-decision projection', () => {
  test('keeps asset state to budget committee decisions draft until evidence and role boundaries are present', () => {
    const projection = buildAssetToDecisionProjection({
      ...fixture.input,
      handoverSources: fixture.handoverSources,
    });

    expect(validateProjectionAgainstSchema(projection)).toBe(true);

    expect(projection.candidateId).toBe(fixture.candidateId);
    expect(projection.candidateId).toBe('CRC004');
    expect(projection.runCardId).toBe(fixture.input.runCardId);
    expect(projection.workedExample).toBe('asset_to_decision');

    expect(projection.evidenceState.missingEvidence).toEqual(
      expect.arrayContaining(fixture.input.missingEvidence),
    );
    expect(projection.readiness.committeeReady).toBe(false);
    expect(projection.readiness.drl).toBeLessThan(3);
    expect(projection.readiness.rcr).toBeLessThanOrEqual(2);

    expect(projection.forbiddenActions).toEqual(
      expect.arrayContaining(fixture.forbiddenActions),
    );
    fixture.forbiddenActions.forEach((action) => {
      expect(projection.allowedActions).not.toContain(action);
    });

    expect(projection.resolutionValue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'forecast_budget_confidence',
          evidenceStatus: expect.stringMatching(/^(partial|missing)$/),
          confidence: 'low',
          qualitativeImpact: expect.stringMatching(/budget|committee/i),
        }),
      ]),
    );

    const roleProjectionText = JSON.stringify(projection.roleProjection).toLowerCase();
    expect(roleProjectionText).toMatch(/asset/);
    expect(roleProjectionText).toMatch(/controlling|finance|budget/);
    expect(roleProjectionText).toMatch(/committee/);

    expect(projection.handoverSources).toEqual(fixture.handoverSources);
  });
});
