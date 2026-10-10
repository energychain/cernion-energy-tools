'use strict';
const path = require('node:path'),
  Module = require('node:module'),
  { execFileSync } = require('node:child_process');
const root = process.cwd();
const fixture = require(path.join(root, 'tests/fixtures/capability-routing-eval.json'));
const baseline = require(path.join(root, 'tests/fixtures/capability-routing-baseline.json'));
function archived(file, append = '') {
  const filename = path.join(root, file);
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(
    execFileSync('/usr/bin/git', ['show', `${baseline.baseCommit}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 5e6,
    }) + append,
    filename
  );
  return m;
}
const catalog = archived('src/capability-catalog.js').exports;
const filename = path.join(root, 'services/capability-broker.service.js');
const broker = new Module(filename, module);
broker.filename = filename;
broker.paths = Module._nodeModulePaths(path.dirname(filename));
const original = broker.require.bind(broker);
broker.require = (id) => (id === '../src/capability-catalog' ? catalog : original(id));
broker._compile(
  execFileSync(
    '/usr/bin/git',
    ['show', `${baseline.baseCommit}:services/capability-broker.service.js`],
    {
      encoding: 'utf8',
      maxBuffer: 5e6,
    }
  ) + '\nmodule.exports.selectForEval=findBestCapability;',
  filename
);
const mismatches = [];
for (const row of fixture.cases) {
  const selected = broker.exports.selectForEval(row.query, { primaryDomain: row.primaryDomain });
  const prior = baseline.results.find((item) => item.id === row.id);
  if (selected.capability.capability !== prior.capabilities[0]) mismatches.push(row.id);
}
console.log(
  JSON.stringify({
    baseCommit: baseline.baseCommit,
    cases: fixture.cases.length,
    top1Mismatches: mismatches,
  })
);
if (mismatches.length) process.exitCode = 1;
