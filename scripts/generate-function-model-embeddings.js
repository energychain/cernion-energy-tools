#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { compareCanonicalStrings } = require('../src/canonical-order');
const {
  TEXT_VERSION,
  capabilityText,
  textHash,
  validEntry,
} = require('./function-model-embeddings');

async function updateEmbeddingCache({
  capabilities,
  operations = [],
  semanticDomains = [],
  cache = {},
  client,
  parameters,
}) {
  const configuration = client.embeddingConfiguration();
  const entries = {};
  for (const cap of [...capabilities].sort((a, b) =>
    compareCanonicalStrings(a.capability, b.capability)
  )) {
    const text = capabilityText(cap, operations, semanticDomains);
    const hash = textHash(text);
    const previous = cache.entries?.[cap.capability];
    if (
      validEntry(previous) &&
      previous.textHash === hash &&
      previous.provider === configuration.provider &&
      previous.model === configuration.model
    ) {
      entries[cap.capability] = previous;
      continue;
    }
    const [vector] = await client.embeddings([text]);
    const entry = {
      textHash: hash,
      ...configuration,
      dimension: vector?.length,
      vector: vector?.map((value) => Number(value.toFixed(parameters.embeddingDecimals))),
    };
    if (!validEntry(entry)) throw new Error(`Invalid embedding for ${cap.capability}`);
    entries[cap.capability] = entry;
  }
  return { schemaVersion: '1', textVersion: TEXT_VERSION, entries };
}

async function main() {
  require('dotenv').config({ quiet: true });
  const file = path.join(__dirname, '..', 'function-model.embeddings.json');
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const { CURATED_CAPABILITIES: capabilities } = require('../src/capability-catalog');
  const { operations } = require('../operation-capability-index.json');
  const { semanticDomains } = require('../src/semantic-domains');
  const result = await updateEmbeddingCache({
    capabilities,
    operations,
    semanticDomains,
    cache,
    client: require('../src/llm-client'),
    parameters: require('../function-model.parameters.json'),
  });
  // Write only after all requests succeed; failures preserve the existing cache.
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[function-model-embeddings] ${Object.keys(result.entries).length} entries`);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { updateEmbeddingCache };
