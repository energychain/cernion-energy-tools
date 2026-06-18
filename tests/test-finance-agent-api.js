const { ServiceBroker } = require('moleculer');
const FinanceAgentService = require('../services/finance-agent.service');

async function runTest() {
  const broker = new ServiceBroker({ logger: console });

  // Mock necessary downstream services
  broker.createService({
    name: 'knowledge-rag',
    actions: {
      query: {
        handler() {
          return {
            results: [
              {
                pointId: 'mastr-1',
                text: 'Laut BNetzA-Festlegung ist der Aufbau von intelligenten Messsystemen Bestandteil der genehmigten CAPEX-Kosten.',
                metadata: { oeoTags: ['ceo:CapitalExpenditure'] },
              },
              {
                pointId: 'enwg-1',
                text: 'Flexible Netzanschlussverträge (§ 14a EnWG) reduzieren den Netzausbaubedarf und verbessern den TOTEX-Effizienzfaktor.',
                metadata: { oeoTags: ['ceo:TotalExpenditure'] },
              },
            ],
          };
        },
      },
    },
  });

  broker.createService({
    name: 'object-store',
    actions: {
      get: {
        handler() {
          return null;
        },
      },
      list: {
        handler() {
          return [];
        },
      },
      query: {
        handler() {
          return [];
        },
      },
      put: {
        handler() {
          return true;
        },
      },
    },
  });

  broker.createService({
    name: 'datapoint',
    actions: {
      list: {
        handler() {
          return { data: [] };
        },
      },
      get: {
        handler() {
          return { data: [] };
        },
      },
      create: {
        handler() {
          return { id: 'dp-1' };
        },
      },
    },
  });

  broker.createService(FinanceAgentService);

  await broker.start();

  console.log('\n--- STARTING FINANCE AGENT TEST ---\n');

  try {
    const res = await broker.call('finance-agent.analyze', {
      query:
        'Die STROMDAO AG plant 3 Großwärmepumpen anzuschließen. Wir haben aber einen 81 MVA Engpass. Wie verhält sich ein flexibler Netzanschlussvertrag (fNAV) kaufmännisch auf unsere CAPEX und OPEX in der Regulierung?',
      mode: 'rule_plus_hyde',
      allowHypotheticals: true,
    });

    console.log('STATUS:', res.status);
    console.log('SUMMARY:', res.summary);
    console.log('ANSWER:', res.answer);
    console.log('\nCLAIMS:', JSON.stringify(res.claims, null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
  }

  await broker.stop();
}

runTest();
