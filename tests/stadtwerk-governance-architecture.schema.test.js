'use strict';

const Ajv2020 = require('ajv/dist/2020');
const schema = require('../src/stadtwerk-governance-architecture/schema-pack/cr-lka-rv-001.schema.json');
const {
  buildAssetToDecisionProjection,
  buildMakoResolutionValueProjection,
} = require('../src/stadtwerk-governance-architecture/resolution-value-projection');
const makoFixture = require('../src/stadtwerk-governance-architecture/fixtures/red/mako-resolution-value.red.json');
const assetFixture = require('../src/stadtwerk-governance-architecture/fixtures/red/asset-to-decision.red.json');

function compileProjectionSchema() {
  const ajv = new Ajv2020({ strict: false });
  return ajv.compile(schema);
}

const validateProjection = compileProjectionSchema();

function validationErrors() {
  return JSON.stringify(validateProjection.errors || [], null, 2);
}

function expectValidProjection(projection) {
  const valid = validateProjection(projection);
  if (!valid) {
    throw new Error(`Expected projection to validate, got errors: ${validationErrors()}`);
  }
  expect(valid).toBe(true);
}

function expectInvalidProjection(projection, expectedErrorFragment) {
  const valid = validateProjection(projection);
  if (valid) {
    throw new Error(`Expected projection to fail schema validation: ${JSON.stringify(projection, null, 2)}`);
  }
  expect(valid).toBe(false);
  expect(validationErrors()).toContain(expectedErrorFragment);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('CR-LKA projection schema contract', () => {
  test('accepts MaKo resolution value fixture projection with handover sources', () => {
    const projection = buildMakoResolutionValueProjection({
      ...makoFixture.input,
      handoverSources: makoFixture.handoverSources,
    });

    expectValidProjection(projection);
  });

  test('accepts MaKo resolution value default projection', () => {
    expectValidProjection(buildMakoResolutionValueProjection());
  });

  test('accepts asset-to-decision fixture projection with handover sources', () => {
    const projection = buildAssetToDecisionProjection({
      ...assetFixture.input,
      handoverSources: assetFixture.handoverSources,
    });

    expectValidProjection(projection);
  });

  test('accepts asset-to-decision default projection', () => {
    expectValidProjection(buildAssetToDecisionProjection());
  });

  test('rejects non-contract top-level projection fields', () => {
    const projection = buildMakoResolutionValueProjection();
    projection.readinessReason = 'legacy readiness explanation';

    expectInvalidProjection(projection, 'additionalProperties');
  });

  test('rejects legacy qualitative evidence status values', () => {
    const projection = clone(buildMakoResolutionValueProjection());
    projection.resolutionValue[0].evidenceStatus = 'qualitative';

    expectInvalidProjection(projection, 'evidenceStatus');
  });

  test('rejects string readiness DRL values', () => {
    const projection = clone(buildAssetToDecisionProjection());
    projection.readiness.drl = 'DRL_1_2';

    expectInvalidProjection(projection, '/readiness/drl');
  });

  test('requires resolution value and safety/HITL boundaries as part of the RC contract', () => {
    const projection = clone(buildMakoResolutionValueProjection());

    delete projection.resolutionValue;
    expectInvalidProjection(projection, "must have required property 'resolutionValue'");

    const withoutSafety = clone(buildMakoResolutionValueProjection());
    delete withoutSafety.safetyBoundary;
    expectInvalidProjection(withoutSafety, "must have required property 'safetyBoundary'");

    const withoutHitl = clone(buildMakoResolutionValueProjection());
    delete withoutHitl.hitlBoundary;
    expectInvalidProjection(withoutHitl, "must have required property 'hitlBoundary'");
  });

  test('requires complete readiness, safety, and HITL boundary objects', () => {
    const withoutDrl = clone(buildAssetToDecisionProjection());
    delete withoutDrl.readiness.drl;
    expectInvalidProjection(withoutDrl, "must have required property 'drl'");

    const withoutConsequentialActionBoundary = clone(buildAssetToDecisionProjection());
    delete withoutConsequentialActionBoundary.safetyBoundary.requiresHitlForConsequentialAction;
    expectInvalidProjection(
      withoutConsequentialActionBoundary,
      "must have required property 'requiresHitlForConsequentialAction'"
    );

    const withoutResolverRoles = clone(buildAssetToDecisionProjection());
    delete withoutResolverRoles.hitlBoundary.requiredResolverRoles;
    expectInvalidProjection(withoutResolverRoles, "must have required property 'requiredResolverRoles'");
  });
});
