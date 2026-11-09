#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { defaultManagementDatabase, loadTasks } = require('../lib/kanban-source');
const {
  appendSnapshot,
  collectTelemetry,
  compareHistory,
  readHistory,
} = require('../lib/telemetry');

function parseArgs(argv) {
  const options = { stdoutOnly: false, windowDays: 14 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--stdout-only') options.stdoutOnly = true;
    else if (arg === '--database') options.database = argv[++index];
    else if (arg === '--history') options.history = argv[++index];
    else if (arg === '--hermes-home') options.hermesHome = argv[++index];
    else if (arg === '--window-days') options.windowDays = Number(argv[++index]);
    else if (arg === '--now') options.now = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.windowDays) || options.windowDays < 1 || options.windowDays > 90) {
    throw new Error('window-days must be an integer between 1 and 90');
  }
  if (options.now !== undefined && (!Number.isFinite(options.now) || options.now <= 0)) {
    throw new Error('now must be a positive epoch timestamp');
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const hermesHome = path.resolve(
    options.hermesHome || process.env.HERMES_HOME || '/home/clawd/.hermes'
  );
  const database = path.resolve(options.database || defaultManagementDatabase(hermesHome));
  const history = path.resolve(
    options.history || path.join(hermesHome, 'management-cockpit', 'telemetry-shadow.jsonl')
  );
  const legacySource = loadTasks({ hermesHome });
  const snapshot = collectTelemetry({
    database,
    legacySource,
    projectionErrorCount: legacySource.errors.length,
    now: options.now,
  });

  let historyPath = null;
  if (!options.stdoutOnly) historyPath = appendSnapshot(history, snapshot);
  const snapshots = options.stdoutOnly ? [...readHistory(history), snapshot] : readHistory(history);
  const comparison = compareHistory(snapshots, {
    now: snapshot.capturedAt,
    windowDays: options.windowDays,
  });

  const report = {
    ok: true,
    mode: 'shadow',
    shadowOnly: true,
    operationalEffect: false,
    sourceWritePerformed: false,
    telemetryPersisted: !options.stdoutOnly,
    historyPath,
    snapshot,
    comparison,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        mode: 'shadow',
        operationalEffect: false,
        sourceWritePerformed: false,
        error: error.message,
      })
    );
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
