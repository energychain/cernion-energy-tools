'use strict';

const { classifyDomain } = require('../src/domain-router');
const { getFunctionModel } = require('../src/function-model');

describe('candidate confirmation is not a new routing request', () => {
  const model = {
    functions: [
      {
        capabilities: ['candidate-a'],
        domains: ['grid-connection'],
        displayLabel: 'Redispatch Lastgang – Management Budget',
      },
    ],
  };

  test.each(['grid_connection', 'unknown'])(
    'number and cross-domain label preserve identical %s state and context',
    async (domain) => {
      const prior = await classifyDomain(
        {
          userRequest: 'Netzanschluss am Umspannwerk prüfen',
          knownContext: { stationId: 'station-nord', missingEvidence: ['voltage'] },
        },
        {
          model,
          recommend: async () => ({
            uncertain: true,
            candidates: [
              {
                capabilityId: 'candidate-a',
                displayLabel: model.functions[0].displayLabel,
                score: 1,
              },
            ],
          }),
        }
      );
      const previous = {
        cetCaseId: 'case-a',
        currentDomain: domain,
        lastClassification: { ...prior, primaryDomain: domain },
      };
      const dependencies = {
        previousState: previous,
        model,
        recommend: jest.fn(),
        selectReceipts: jest.fn(),
        knowledge: jest.fn(),
        domainRoutes: jest.fn(),
      };
      const confirmed = [];
      for (const userRequest of ['Nummer 1', model.functions[0].displayLabel]) {
        confirmed.push(
          await classifyDomain({ userRequest, actorRoles: ['ROLE_GRID_OPERATOR'] }, dependencies)
        );
      }
      expect(confirmed[0]).toEqual(confirmed[1]);
      expect(confirmed[0]).toMatchObject({
        primaryDomain: domain,
        uncertain: false,
        selectedCapabilities: [{ capability: 'candidate-a', score: 1 }],
        currentStation: 'station-nord',
        missingEvidence: expect.arrayContaining(['voltage']),
        scoringBreakdown: { activatesCoverage: true, selectionSource: 'person' },
        sourceDiagnostics: { receipts: 'skipped', knowledge: 'skipped' },
      });
      for (const fn of [
        dependencies.recommend,
        dependencies.selectReceipts,
        dependencies.knowledge,
        dependencies.domainRoutes,
      ])
        expect(fn).not.toHaveBeenCalled();
    }
  );

  test('a real model label containing a foreign domain does not reclassify a prior case', async () => {
    const model = getFunctionModel();
    const fn = model.functions.find(
      (row) =>
        row.domains.some((domain) => domain === 'grid-connection') &&
        /zielnetz|redispatch|management|budget/i.test(row.displayLabel)
    );
    expect(fn).toBeDefined();
    const previousState = {
      currentDomain: 'grid_connection',
      lastClassification: {
        uncertain: true,
        candidateCapabilities: [{ capability: fn.capabilities[0] }],
        ambiguityFlags: ['uncertain_capability_selection'],
        alternativeDomains: [],
      },
    };
    const number = await classifyDomain({ userRequest: 'Nummer 1' }, { previousState });
    const label = await classifyDomain({ userRequest: fn.displayLabel }, { previousState });
    expect(number).toEqual(label);
    expect(label.primaryDomain).toBe('grid_connection');
  });
});
