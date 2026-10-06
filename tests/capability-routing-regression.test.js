'use strict';
const { ServiceBroker } = require('moleculer');
const service = require('../services/capability-broker.service');
const { classifyDomain } = require('../src/domain-router');
const fixtures = require('./fixtures/capability-routing-eval.json');

describe('broker and router #730 regression', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(service);
    await broker.start();
  });
  afterAll(async () => {
    await broker.stop();
  });
  test.each(fixtures.cases.filter((r) => r.source === 'issue-730'))('$id', async (row) => {
    const result = await broker.call('capability-broker.recommend', {
      task: row.query,
      primaryDomain: row.primaryDomain,
    });
    expect(
      result.capability === row.expectedCapabilities[0] ||
        (result.uncertain &&
          result.candidates.some((r) => r.capabilityId === row.expectedCapabilities[0]))
    ).toBe(true);
    expect(result.capability === 'vnb_delta_signal_classifier' && result.confidence >= 0.8).toBe(
      false
    );
    expect(result.scoringBreakdown.semantic.path).toBe('lexical');
  });
  test('uncertain recommendation remains candidates and requests clarification', async () => {
    const result = await classifyDomain(
      { userRequest: 'Netzanschlussanfrage prüfen' },
      {
        recommend: async (input) => {
          expect(input.primaryDomain).toBe('grid_connection');
          return {
            uncertain: true,
            candidateCapabilities: [{ capability: 'example' }],
            recommendedCapabilities: [{ capability: 'example' }],
            scoringBreakdown: { uncertain: true, activatesCoverage: false },
          };
        },
      }
    );
    expect(result.selectedCapabilities).toEqual([]);
    expect(result.candidateCapabilities).toHaveLength(1);
    expect(result.requiredClarifications.length).toBeGreaterThan(0);
    expect(result.scoringBreakdown.activatesCoverage).toBe(false);
  });
  test('handoff cannot promote uncertain candidates to fixed selection', async () => {
    const result = await classifyDomain(
      { userRequest: 'Netzanschluss prüfen', requestedMode: 'handoff' },
      {
        recommend: async () => ({
          uncertain: true,
          recommendedCapabilities: [{ capability: 'example' }],
        }),
      }
    );
    expect(result.transition.type).toBe('handoff');
    expect(result.selectedCapabilities).toEqual([]);
    expect(result.requiredClarifications.length).toBeGreaterThan(0);
  });
  test.each(
    fixtures.cases.filter(
      (r) =>
        ['known-correct'].includes(r.source) ||
        (r.source === 'independent-regression' &&
          ['redispatch', 'target_grid_planning'].includes(r.primaryDomain))
    )
  )('preserves $id', async (row) => {
    const result = await broker.call('capability-broker.recommend', {
      task: row.query,
      primaryDomain: row.primaryDomain,
    });
    expect(row.expectedCapabilities).toContain(result.capability);
  });
});
