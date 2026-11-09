#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadProjectionSource } = require('../lib/kanban-source');
const { analyzeWakeups } = require('../lib/wakeup-service');

function parseArgs(argv) {
  const options = { pretty: true, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--hermes-home' || arg === '--fixture-home') options.hermesHome = argv[++index];
    else if (arg === '--now') options.now = argv[++index];
    else if (arg === '--migration-report') options.migrationReport = argv[++index];
    else if (arg === '--force') options.force = true;
    else if (arg === '--compact') options.pretty = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function migrationReport(result) {
  return {
    generatedAt: result.evaluatedAt,
    readOnly: true,
    policy: 'Historical scheduled tasks are reported only and are never reactivated.',
    count: result.historicalWithoutContract.length,
    items: result.historicalWithoutContract.map((item) => ({
      board: item.sourceBoard,
      taskId: item.sourceTaskId,
      missingFields: item.errors,
    })),
  };
}

function writeMigrationReport(file, result, options = {}) {
  const destination = path.resolve(file);
  if (fs.existsSync(destination) && !options.force) {
    throw new Error('migration_report_exists_use_force');
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(migrationReport(result), null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, destination);
  return destination;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const hermesHome = path.resolve(
    options.hermesHome || process.env.HERMES_HOME || '/home/clawd/.hermes'
  );
  const source = loadProjectionSource({ hermesHome });
  const tasks = source.boards.flatMap((board) => board.items);
  const result = analyzeWakeups(tasks, { now: options.now });
  result.source = {
    boardCount: source.boards.length,
    taskCount: source.count,
    boardErrors: source.errors,
  };
  if (options.migrationReport) {
    result.migrationReport = writeMigrationReport(options.migrationReport, result, options);
  }
  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, migrationReport, parseArgs, writeMigrationReport };
