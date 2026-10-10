'use strict';

// CR-LKA-RV-001 RC v1.0 Option A decision:
// governance.evaluatePolicy stays internal-only for UAT until its contract is stable.
// Do not add a REST/API alias for this action during the first RC.
const fs = require('fs');
const path = require('path');

const GovernanceService = require('../services/governance.service');

const API_SERVICE_PATH = path.join(__dirname, '..', 'services', 'api.service.js');
const API_SERVICE_SOURCE = fs.readFileSync(API_SERVICE_PATH, 'utf8');

const FORBIDDEN_REST_ALIAS_TARGETS = [
  "'governance.evaluatePolicy'",
  '"governance.evaluatePolicy"',
  '`governance.evaluatePolicy`',
];

const FORBIDDEN_REST_ROUTE_PATHS = [
  '/governance/evaluate-policy',
  '/governance/evaluatePolicy',
  '/governance/policy/evaluate',
];

describe('CR-LKA-RV-001 RC v1.0 Option A API alias decision', () => {
  it('keeps governance.evaluatePolicy internal-only and absent from explicit /api aliases', () => {
    const evaluatePolicyAction = GovernanceService.actions.evaluatePolicy;

    expect(evaluatePolicyAction).toBeDefined();
    expect(typeof evaluatePolicyAction.handler).toBe('function');
    expect(evaluatePolicyAction.openapi).toEqual(
      expect.objectContaining({
        summary: expect.any(String),
        tags: expect.arrayContaining(['Governance']),
      })
    );
    expect(Object.prototype.hasOwnProperty.call(evaluatePolicyAction, 'rest')).toBe(false);

    for (const forbiddenTarget of FORBIDDEN_REST_ALIAS_TARGETS) {
      expect(API_SERVICE_SOURCE).not.toContain(forbiddenTarget);
    }

    for (const forbiddenRoutePath of FORBIDDEN_REST_ROUTE_PATHS) {
      expect(API_SERVICE_SOURCE).not.toContain(forbiddenRoutePath);
    }
  });
});
