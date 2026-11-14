#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AssistantStore } = require('../lib/assistant-store');
const { createAssistantResultIngest } = require('../lib/assistant-result-ingest');
const { loadTaskReferences } = require('../lib/kanban-source');

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`${name.replace(/^--/, '')}_required`);
  return value;
}

async function main() {
  const database = path.resolve(required('--database'));
  const hermesHome = path.resolve(
    argument('--hermes-home', process.env.HERMES_HOME || path.join(process.env.HOME, '.hermes'))
  );
  const inputPath = argument('--input');
  const raw = inputPath
    ? fs.readFileSync(path.resolve(inputPath), 'utf8')
    : fs.readFileSync(0, 'utf8');
  const event = JSON.parse(raw);
  const allowedSenders = String(
    argument('--allowed-senders', process.env.ASSISTANT_RESULT_ALLOWED_SENDERS || '')
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const excludedBoards = new Set(
    String(argument('--exclude-boards', 'twl-netze-private'))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const store = new AssistantStore({ database });
  store.initialize();
  const ingest = createAssistantResultIngest({
    store,
    allowedSenders,
    readKanban(source) {
      const result = loadTaskReferences({
        hermesHome,
        excludedBoards,
        references: [source],
        timeout: 10000,
      });
      if (result.errors.length) throw new Error('assistant_result_source_read_failed');
      return result.items.find((item) => item.board === source.board && item.id === source.taskId);
    },
  });
  const result = await ingest.ingestMatrix(event);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.message || 'assistant_result_ingest_failed'}\n`);
  process.exitCode = 1;
});
