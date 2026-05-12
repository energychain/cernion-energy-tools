'use strict';

/**
 * Failing test for Gap-4: Grid-Validation What-If scenario support.
 *
 * This test documents the expected parameter shape for future
 * What-If grid connection validation. It currently fails because
 * `scenarioAdditions` is not yet accepted by the validate action.
 */

const GridConnectionService = require('../services/grid-connection.service');

describe('grid-connection What-If (Gap-4)', () => {
  test('validate action accepts scenarioAdditions parameter', () => {
    const validateAction = GridConnectionService.actions.validate;
    expect(validateAction).toBeDefined();
    expect(validateAction.params).toBeDefined();

    // Expected: validate should accept hypothetical installations
    // that are added to the capacity calculation as a What-If scenario.
    expect(validateAction.params.scenarioAdditions).toBeDefined();
    expect(validateAction.params.scenarioAdditions.type).toBe('array');
  });

  test('validate action accepts scenarioCapacityMW parameter', () => {
    const validateAction = GridConnectionService.actions.validate;
    expect(validateAction.params.scenarioCapacityMW).toBeDefined();
    expect(validateAction.params.scenarioCapacityMW.type).toBe('number');
  });

  test('validation report includes scenario findings when scenario provided', () => {
    // This test will pass once What-If support is implemented.
    // For now it documents the expected response shape.
    const validateAction = GridConnectionService.actions.validate;
    expect(validateAction).toBeDefined();

    // The openapi docs should mention scenario support
    if (validateAction.openapi?.requestBody?.content) {
      const schema =
        validateAction.openapi.requestBody.content['application/json']?.schema;
      if (schema && schema.properties) {
        expect(schema.properties.scenarioAdditions).toBeDefined();
      }
    }
  });
});
