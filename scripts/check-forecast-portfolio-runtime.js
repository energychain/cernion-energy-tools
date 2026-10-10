'use strict';

// Run as the API service user with the API's environment before enabling forecast jobs.
const { spawnSync } = require('child_process');
const path = require('path');
const { resolvePortfolioPython } = require('../src/forecast-portfolio');
const python = resolvePortfolioPython();
console.log(`Forecast interpreter: ${python}`);
const checks = [
  ['-m', 'pip', 'check'],
  [
    '-c',
    'import sys, json, engine, runtime, product, starter, numpy, catboost, sklearn, skops, threadpoolctl; ' +
      'from zoneinfo import ZoneInfo; ZoneInfo("Europe/Berlin"); ' +
      'print(json.dumps({"executable": sys.executable, "numpy": numpy.__version__, ' +
      '"catboost": catboost.__version__, "scikit-learn": sklearn.__version__, ' +
      '"skops": skops.__version__, "threadpoolctl": threadpoolctl.__version__}))',
  ],
];
for (const args of checks) {
  const result = spawnSync(python, args, {
    cwd: path.join(__dirname, '../tools/forecast-portfolio'),
    stdio: 'inherit',
    timeout: 60000,
  });
  if (result.error || result.status !== 0) {
    console.error('Forecast runtime check failed:', result.error?.message || result.status);
    process.exit(1);
  }
}
console.log('Forecast portfolio runtime ready.');
