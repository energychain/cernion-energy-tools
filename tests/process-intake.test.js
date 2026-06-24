'use strict';

/**
 * Generic Process Intake / Write Boundary tests (issue energychain/cernion-energy-tools#272).
 *
 * Covers the new prepareProcessIntent action on services/copilot-process.service.js —
 * deliberately a SEPARATE test file from tests/evidence-router.test.js so the two
 * contracts' test surfaces stay as distinguishable as the contracts themselves.
 */

const { ServiceBroker } = require('moleculer');
const CopilotProcessService = require('../services/copilot-process.service');

describe('Process Intake (prepareProcessIntent)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(CopilotProcessService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  test('creates a pending_confirmation intent for a generic process/write request', async () => {
    const result = await broker.call('copilot-process.prepareProcessIntent', {
      operationFamily: 'customer_master_data_correction',
      proposedAction: 'correct_metering_point_address',
      targetType: 'meteringPoint',
      targetId: 'MP-12345',
      payload: { newAddress: 'Musterstr. 1, 69168 Wiesloch' },
      reason: 'Kunde meldet falsche Adresse',
    });

    expect(result.success).toBe(true);
    expect(result.resolved).toEqual({ kind: 'process_intake', source: 'process_intent_store' });
    expect(result.receipt.status).toBe('pending_confirmation');
    expect(result.receipt.requiresHumanConfirmation).toBe(true);
    expect(typeof result.receipt.intentId).toBe('string');
    expect(result.policy).toEqual({
      readOnly: false,
      sideEffects: 'pending_human_confirmation',
      tenantScoped: true,
      externalSideEffects: false,
      hitlRequired: true,
    });
  });

  test('rejects a reserved operationFamily (must use its dedicated prepare* action)', async () => {
    await expect(
      broker.call('copilot-process.prepareProcessIntent', {
        operationFamily: 'vdmi',
        proposedAction: 'inject_evidence',
      })
    ).rejects.toMatchObject({
      code: 409,
      type: 'PROCESS_INTAKE_RESERVED_OPERATION_FAMILY',
    });
  });

  test.each(['gridConnection', 'znp', 'connectionRejectionEvidence'])(
    'rejects reserved operationFamily "%s"',
    async (operationFamily) => {
      await expect(
        broker.call('copilot-process.prepareProcessIntent', {
          operationFamily,
          proposedAction: 'anything',
        })
      ).rejects.toMatchObject({ code: 409, type: 'PROCESS_INTAKE_RESERVED_OPERATION_FAMILY' });
    }
  );

  test('rejects a proposedAction that resolves to a registered read-only action (use Evidence Router instead)', async () => {
    await expect(
      broker.call('copilot-process.prepareProcessIntent', {
        operationFamily: 'misuse_attempt',
        proposedAction: 'energy-market.co2Intensity',
      })
    ).rejects.toMatchObject({
      code: 409,
      type: 'PROCESS_INTAKE_TARGET_IS_READ_ONLY',
    });
  });

  test('a generically-created intent can never be auto-executed without a developer-added dispatch case', async () => {
    const created = await broker.call('copilot-process.prepareProcessIntent', {
      operationFamily: 'some_future_family',
      proposedAction: 'some_future_action',
      payload: {},
    });

    await expect(
      broker.call('copilot-process.executeProcessIntent', { intentId: created.receipt.intentId })
    ).rejects.toMatchObject({ code: 400, type: 'UNKNOWN_OPERATION_FAMILY' });
  });

  test('a generically-created intent can still be rejected by a human via the existing lifecycle', async () => {
    const created = await broker.call('copilot-process.prepareProcessIntent', {
      operationFamily: 'some_future_family',
      proposedAction: 'some_future_action',
      payload: {},
    });

    const rejected = await broker.call('copilot-process.rejectProcessIntent', {
      intentId: created.receipt.intentId,
      reason: 'Not authorized',
    });

    expect(rejected.status).toBe('rejected');
  });

  test('response shape is structurally distinguishable from an Evidence Router response', async () => {
    const result = await broker.call('copilot-process.prepareProcessIntent', {
      operationFamily: 'distinguishability_check',
      proposedAction: 'noop',
    });

    expect(result.resolved.kind).toBe('process_intake');
    expect(result.resolved.kind).not.toBe('evidence_plan');
    expect(result).not.toHaveProperty('recommendedEndpoints');
    expect(result).not.toHaveProperty('coverage');
    expect(result).toHaveProperty('receipt');
    expect(result.policy.readOnly).toBe(false);
  });
});
