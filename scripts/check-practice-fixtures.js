'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { writePracticeCatalog } = require('./generate-practice-evaluation-fixtures');
const { auditPracticeFixtures } = require('./practice-evaluation-checks');
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../tests/fixtures/practice-evaluation.generated.json'),
    'utf8'
  )
);
const errors = auditPracticeFixtures(fixture);
if (!writePracticeCatalog({ check: true })) errors.push('Generator output is stale');
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exitCode = 1;
} else
  process.stdout.write(
    'Praxis-Fixtures: ausschließlich generierte, pseudonymisierte Daten; synchron.\n'
  );
