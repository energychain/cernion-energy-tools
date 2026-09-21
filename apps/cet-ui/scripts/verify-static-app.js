'use strict';

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const distRoot = path.join(appRoot, 'dist');
const files = [
  'index.html',
  'src/main.js',
  'src/styles.css',
  'src/shared/ui-view-model.js',
  'src/shared/api-client.js',
  'src/shared/contract-validators.js',
  'src/shared/projection-helpers.js',
  'src/shared/role-tenant-helpers.js',
  'src/shared/wording-helpers.js',
  'src/shared/evidence-helpers.js',
];

for (const relative of files) {
  const source = path.join(appRoot, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing CET UI static asset: ${relative}`);
}

const index = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf-8');
if (!index.includes('./src/main.js') || !index.includes('./src/styles.css')) {
  throw new Error('CET UI index.html must reference the local static JS and CSS assets.');
}

fs.rmSync(distRoot, { recursive: true, force: true });
for (const relative of ['index.html', 'src/main.js', 'src/styles.css']) {
  const target = path.join(distRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(appRoot, relative), target);
}

console.log(`CET RC2 UI static bundle verified: ${distRoot}`);
