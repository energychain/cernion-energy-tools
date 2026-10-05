'use strict';
const fs = require('fs');
const crypto = require('crypto');
const Module = require('module');
const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
const { rankCapabilities } = require('../src/capability-routing');
const fixturePath = require.resolve('../tests/fixtures/capability-routing-eval.json');
const fixture = require(fixturePath);
const baseline = require('../tests/fixtures/capability-routing-baseline.json');
const hash = crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex');
if (hash !== baseline.fixtureHash) throw new Error('Evaluation corpus changed after baseline');
// Exercise the production selector, including existing explicit routes, without starting services
// or embedding a real request. This lexical evaluation never requires a key or network.
const brokerPath = require.resolve('../services/capability-broker.service');
const broker = new Module(brokerPath, module);
broker.filename = brokerPath;
broker.paths = Module._nodeModulePaths(require('path').dirname(brokerPath));
broker._compile(
  fs.readFileSync(brokerPath, 'utf8') + '\nmodule.exports.selectForEval = findBestCapability;',
  brokerPath
);
const after = fixture.cases.map((row) => {
  const deterministic = broker.exports.selectForEval(row.query, {
    primaryDomain: row.primaryDomain,
  });
  const ranked = rankCapabilities(row.query, CURATED_CAPABILITIES, {
    primaryDomain: row.primaryDomain,
    explicitCapability:
      !deterministic.ranked && !deterministic.usedFallback
        ? deterministic.capability.capability
        : undefined,
  });
  const fallback = (deterministic.usedFallback && !deterministic.ranked) || !ranked.matches.length;
  return {
    id: row.id,
    capabilities: fallback
      ? ['interface_placeholder']
      : ranked.matches.slice(0, 3).map((m) => m.capability.capability),
    confidence: fallback ? 0 : ranked.confidence,
    uncertain: fallback || ranked.uncertain,
    usedFallback: fallback,
  };
});
function metrics(rows, cases) {
  const observations = cases.map((row) => {
    const result = rows.find((r) => r.id === row.id);
    const correct = row.expectedCapabilities.includes(result.capabilities[0]);
    return {
      ...result,
      correct,
      top3: result.capabilities.some((c) => row.expectedCapabilities.includes(c)),
    };
  });
  const rate = (field) => observations.filter((r) => r[field]).length / observations.length;
  const bins = [0, 0.2, 0.4, 0.6, 0.8].map((lower) => {
    const values = observations.filter(
      (r) =>
        r.confidence >= lower && (lower === 0.8 ? r.confidence <= 1 : r.confidence < lower + 0.2)
    );
    return {
      lower,
      count: values.length,
      confidence: values.length
        ? values.reduce((sum, r) => sum + r.confidence, 0) / values.length
        : 0,
      accuracy: values.length ? values.filter((r) => r.correct).length / values.length : 0,
    };
  });
  return {
    count: observations.length,
    uncertaintyBreakdown: {
      fallback: observations.filter((row) => row.usedFallback).length,
      lowConfidence: observations.filter((row) => row.uncertain && !row.usedFallback).length,
    },
    correctFallback: observations.filter((row) => row.usedFallback && row.correct).length,
    top1: rate('correct'),
    top3: rate('top3'),
    uncertain: rate('uncertain'),
    interfacePlaceholder: rate('usedFallback'),
    brier:
      observations.reduce((sum, r) => sum + (r.confidence - Number(r.correct)) ** 2, 0) /
      observations.length,
    calibrationError:
      bins.reduce((sum, bin) => sum + bin.count * Math.abs(bin.accuracy - bin.confidence), 0) /
      observations.length,
    bins,
  };
}
const groups = ['all', ...new Set(fixture.cases.map((row) => row.source))];
const report = {
  fixtureHash: hash,
  baseCommit: baseline.baseCommit,
  path: 'lexical',
  groups: Object.fromEntries(
    groups.map((source) => {
      const cases =
        source === 'all' ? fixture.cases : fixture.cases.filter((r) => r.source === source);
      return [source, { before: metrics(baseline.results, cases), after: metrics(after, cases) }];
    })
  ),
  regressions: fixture.cases
    .filter((row) => {
      const b = baseline.results.find((r) => r.id === row.id),
        a = after.find((r) => r.id === row.id);
      return (
        row.expectedCapabilities.includes(b.capabilities[0]) &&
        !row.expectedCapabilities.includes(a.capabilities[0])
      );
    })
    .map((row) => row.id),
  previouslyCorrect: {
    count: fixture.cases.filter((row) =>
      row.expectedCapabilities.includes(
        baseline.results.find((item) => item.id === row.id).capabilities[0]
      )
    ).length,
    lost: fixture.cases
      .filter(
        (row) =>
          row.expectedCapabilities.includes(
            baseline.results.find((item) => item.id === row.id).capabilities[0]
          ) &&
          !row.expectedCapabilities.includes(
            after.find((item) => item.id === row.id).capabilities[0]
          )
      )
      .map((row) => ({
        id: row.id,
        query: row.query,
        expectedCapabilities: row.expectedCapabilities,
        before: baseline.results.find((item) => item.id === row.id).capabilities,
        after: after.find((item) => item.id === row.id).capabilities,
      })),
  },
  uncertaintyThreshold: require('../capability-routing.parameters.json').uncertaintyThreshold,
  results: after,
};
if (process.argv.includes('--write'))
  fs.writeFileSync(
    require('path').join(__dirname, '../docs/reviews/730-capability-routing-evaluation.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
