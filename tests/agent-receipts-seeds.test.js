'use strict';

const { RECEIPT_SEEDS } = require('../src/agent-receipts-seeds');
const { validateReceipt } = require('../src/agent-receipts-schema');

describe('agent receipt seeds', () => {
  it('ARS-001: all seeded receipts validate against receipt schema', () => {
    for (const receipt of RECEIPT_SEEDS) {
      const result = validateReceipt(receipt);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('ARS-002: Netzbetreiber flexibility receipt requires numeric source discipline', () => {
    const receipt = RECEIPT_SEEDS.find(
      (candidate) => candidate.receiptId === 'netzbetreiber-flexibility-potential-v1'
    );

    expect(receipt).toBeDefined();
    expect(receipt.responsePolicy.verified).toMatch(/Markdown table|Markdown-Tabelle/i);
    expect(receipt.forbiddenInferences).toContain('unverified_mw_capacity_claim');
    expect(receipt.toolPlan.steps.map((step) => step.action)).toEqual(
      expect.arrayContaining([
        'grid-operations.operatorAnalysis',
        'assets.redispatchCount',
        'grid-operations.controlMeasures',
      ])
    );
  });
});
