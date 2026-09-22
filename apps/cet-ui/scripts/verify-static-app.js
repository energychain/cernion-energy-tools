'use strict';

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const distRoot = path.join(appRoot, 'dist');
const requiredSources = [
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'src/main.tsx',
  'src/App.tsx',
  'src/styles.css',
  'src/shared/ui-view-model.js',
  'src/shared/api-client.js',
  'src/shared/contract-validators.js',
  'src/shared/projection-helpers.js',
  'src/shared/role-tenant-helpers.js',
  'src/shared/wording-helpers.js',
  'src/shared/evidence-helpers.js',
  'src/shared/prominence-helpers.js',
  'src/shared/audit-hooks.js',
];

for (const relative of requiredSources) {
  const source = path.join(appRoot, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing CET UI source asset: ${relative}`);
}

const index = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf-8');
if (
  !index.includes('<div id="root"></div>') ||
  !index.includes('type="module"') ||
  !index.includes('/src/main.tsx')
) {
  throw new Error('CET UI index.html must mount the Vite React TypeScript app shell.');
}
if (index.includes('./src/main.js')) {
  throw new Error('CET UI index.html must not reference the legacy static main.js script.');
}

const appSource = fs.readFileSync(path.join(appRoot, 'src', 'App.tsx'), 'utf-8');
for (const marker of [
  'Tagesfläche',
  'Vorgang',
  'Nachweisansicht',
  'Operationskonsole',
  'Nicht projiziert',
]) {
  if (!appSource.includes(marker))
    throw new Error(`CET UI React shell misses Feinkonzept marker: ${marker}`);
}

if (fs.existsSync(distRoot)) {
  const distIndex = path.join(distRoot, 'index.html');
  if (!fs.existsSync(distIndex)) throw new Error('CET UI Vite build must produce dist/index.html.');
  const distHtml = fs.readFileSync(distIndex, 'utf-8');
  if (!distHtml.includes('<div id="root"></div>') || !distHtml.includes('/assets/')) {
    throw new Error('CET UI Vite build output must contain the React root and bundled assets.');
  }
}

console.log(`CET RC2 UI Vite/React/TypeScript structure verified: ${appRoot}`);
