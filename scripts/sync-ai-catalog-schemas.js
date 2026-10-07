#!/usr/bin/env node
'use strict';

// Pinned upstream fixtures: Apache-2.0, ARD project. No network access in tests.
const fs = require('node:fs');
const path = require('node:path');
const REVISION = 'b76f235a8f461876ad4f1e77abd0eb0eb302b48d';

async function main() {
  const directory = path.join(__dirname, '..', 'tests', 'fixtures', 'ai-catalog');
  fs.mkdirSync(directory, { recursive: true });
  for (const file of [
    'spec/schemas/ai-catalog.schema.json',
    'spec/schemas/ard-entry.schema.json',
    'LICENSE',
  ]) {
    const response = await fetch(
      `https://raw.githubusercontent.com/ards-project/ard-spec/${REVISION}/${file}`
    );
    if (!response.ok) throw new Error(`Schema sync failed: ${file} (${response.status})`);
    fs.writeFileSync(path.join(directory, path.basename(file)), await response.text());
  }
  console.log(`AI catalog schemas synced from ARD ${REVISION}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
