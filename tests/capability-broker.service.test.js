const { ServiceBroker } = require('moleculer');
const CapabilityBrokerService = require('../services/capability-broker.service');

describe('Capability Broker Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(CapabilityBrokerService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('returns fixed response schemaVersion when request schemaVersion is missing', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bewerte Residuallast für Stadtwerke München in 48h',
    });

    expect(result.schemaVersion).toBe('cernion.capabilityRecommendation.v1');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(
      result.warnings.some((w) =>
        w.includes('Missing request schemaVersion mapped to cernion.capabilityRecommendation.v1')
      )
    ).toBe(true);
  });

  it('maps unsupported request schemaVersion to v1 with warning', async () => {
    const result = await broker.call('capability-broker.recommend', {
      schemaVersion: 'legacy.v0',
      task: 'Löse VNB Identität für Stadtwerke München',
    });

    expect(result.schemaVersion).toBe('cernion.capabilityRecommendation.v1');
    expect(
      result.warnings.some((w) =>
        w.includes('Unsupported request schemaVersion mapped to cernion.capabilityRecommendation.v1')
      )
    ).toBe(true);
  });

  it('degrades next_step to initial when alreadyExecutedSteps is empty', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Residuallast für Stadtwerk analysieren',
      mode: 'next_step',
      alreadyExecutedSteps: [],
    });

    expect(result.mode).toBe('next_step');
    expect(result.effectiveMode).toBe('initial');
    expect(
      result.warnings.some((w) =>
        w.includes('Requested mode next_step but alreadyExecutedSteps was empty; degraded to initial recommendation.')
      )
    ).toBe(true);
  });

  it('enforces doNotUse by excluding forbidden actions from recommendedPlan', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Residuallast und CO2 für Stadtwerke X',
      doNotUse: ['grid-operations.marketPartners'],
    });

    const actions = result.recommendedPlan.map((step) => step.action);
    expect(actions.includes('grid-operations.marketPartners')).toBe(false);
    expect(result.doNotUse.some((entry) => entry.action === 'grid-operations.marketPartners')).toBe(
      true
    );
  });

  it('degrades compare to initial when compareCandidates are missing', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Vergleiche Service A und B für Residuallast',
      mode: 'compare',
      compareCandidates: [],
    });

    expect(result.mode).toBe('compare');
    expect(result.effectiveMode).toBe('initial');
    expect(
      result.warnings.some((w) =>
        w.includes('Requested mode compare but no candidates were provided; degraded to initial recommendation.')
      )
    ).toBe(true);
  });
});
