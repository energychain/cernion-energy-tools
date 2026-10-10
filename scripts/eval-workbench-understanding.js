'use strict';

// Offline plumbing evaluation, not a claim about live model understanding quality.
const fs = require('node:fs');
const path = require('node:path');
const { classifyDomain } = require('../src/domain-router');
const { rankCapabilities } = require('../src/capability-routing');
const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
const { generateStructured } = require('../tests/helpers/workbench-llm-stub');
const { catalogsForEval } = (() => {
  const { getFunctionModel } = require('../src/function-model');
  return {
    catalogsForEval: () => ({
      domains: [...new Set(CURATED_CAPABILITIES.map((item) => item.domain))],
      functions: getFunctionModel().functions.map((fn) => ({ id: fn.functionId })),
    }),
  };
})();
const corpus = require('../tests/fixtures/capability-routing-eval.json').cases;
async function evaluateUnderstandingRouting() {
  const foreign = [
    ...new Map(
      corpus
        .filter((row) => row.source === 'independent-regression')
        .map((row) => [row.primaryDomain, row])
    ).values(),
  ];
  const rows = [];
  for (const row of [
    ...corpus,
    ...foreign.map((item) => ({
      ...item,
      id: `foreign:${item.id}`,
      query: `Weitergeleitete Mail des Gegenübers: ${item.query}\nKannst du mir helfen?`,
    })),
  ]) {
    const understood = await generateStructured(
      {},
      JSON.stringify({ message: row.query, catalog: catalogsForEval() })
    );
    const input = {
      userRequest: `${understood.concern}\n${understood.situation}`,
      knownContext: { situation: understood },
      actorRoles: ['ROLE_GRID_OPERATOR'],
    };
    const afterDomain = (await classifyDomain(input)).primaryDomain;
    const beforeDomain = (
      await classifyDomain({ ...input, userRequest: row.query, knownContext: {} })
    ).primaryDomain;
    const score = (query, domain) =>
      rankCapabilities(query, CURATED_CAPABILITIES, { primaryDomain: domain })
        .matches.slice(0, 3)
        .map((hit) => hit.capability.capability);
    const before = score(row.query, beforeDomain),
      after = score(input.userRequest, afterDomain);
    rows.push({
      id: row.id,
      expectedDomain: row.primaryDomain,
      beforeDomain,
      afterDomain,
      before,
      after,
      expectedCapabilities: row.expectedCapabilities,
    });
  }
  const metrics = (items, prefix) => ({
    count: items.length,
    top1: items.filter((row) => row.expectedCapabilities.includes(row[prefix][0])).length,
    top3: items.filter((row) => row[prefix].some((id) => row.expectedCapabilities.includes(id)))
      .length,
    unknownDomain: items.filter((row) => row[`${prefix}Domain`] === 'unknown').length,
    wrongDomain: items.filter(
      (row) => row[`${prefix}Domain`] !== row.expectedDomain && row[`${prefix}Domain`] !== 'unknown'
    ).length,
  });
  const report = {
    methodology:
      'Offline deterministic facade stub and production classifyDomain/rankCapabilities. No model-quality inference. Full frozen #730 corpus plus one foreign-text wrapper per existing independent-regression domain.',
    corpus: {
      before: metrics(
        rows.filter((row) => !row.id.startsWith('foreign:')),
        'before'
      ),
      after: metrics(
        rows.filter((row) => !row.id.startsWith('foreign:')),
        'after'
      ),
    },
    foreign: {
      before: metrics(
        rows.filter((row) => row.id.startsWith('foreign:')),
        'before'
      ),
      after: metrics(
        rows.filter((row) => row.id.startsWith('foreign:')),
        'after'
      ),
    },
    rows,
  };
  fs.writeFileSync(
    path.join(__dirname, '../docs/validation/739-routing.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  console.log(JSON.stringify({ corpus: report.corpus, foreign: report.foreign }));
}
evaluateUnderstandingRouting().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
