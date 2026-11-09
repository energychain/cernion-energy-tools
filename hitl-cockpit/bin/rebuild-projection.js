#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadProjectionSource, defaultManagementDatabase } = require('../lib/kanban-source');
const { readRoomRegistry } = require('../lib/context-links');
const { ScopedApprovalReader } = require('../lib/scoped-approval-reader');
const { ManagementStore } = require('../lib/management-store');
const { readArtifactRegistry } = require('../lib/topic-projector');
const {
  buildClassificationAudit,
  buildProjection,
  classifyShadow,
  project,
} = require('../lib/projector');

function parseArgs(argv) {
  const options = { dryRun: false, incremental: false, shadow: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--incremental') options.incremental = true;
    else if (arg === '--no-shadow') options.shadow = false;
    else if (arg === '--fixture-home' || arg === '--hermes-home')
      options.hermesHome = argv[++index];
    else if (arg === '--database') options.database = argv[++index];
    else if (arg === '--scope-ledger') options.scopeLedger = argv[++index];
    else if (arg === '--artifact-registry') options.artifactRegistryPath = argv[++index];
    else if (arg === '--room-registry') options.roomRegistryPath = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function summary(data, source, audits) {
  const topicDiagnostics = data.projection.topicDiagnostics || {};
  return {
    ok: true,
    dryRun: Boolean(data.dryRun),
    mode: data.incremental ? 'incremental' : 'full',
    sourceCount: source.count,
    successfulBoards: source.boards.map((board) => board.board),
    boardErrors: source.errors,
    projected: {
      topics: data.projection.topics.length,
      decisions: data.projection.decisions.length,
      outcomes: data.projection.outcomes.length,
      wakeups: data.projection.wakeups.length,
      digestItems: data.projection.digestItems.length,
      agentBriefs: data.projection.agentBriefs.length,
      classificationAudit: audits.length,
    },
    scopeLedger: source.scopeLedger,
    topicAggregation: {
      sourceTasks: topicDiagnostics.sourceTasks || 0,
      topics: topicDiagnostics.topics || 0,
      aggregatedTopics: topicDiagnostics.aggregatedTopics || 0,
      mergedTaskCount: topicDiagnostics.mergedTaskCount || 0,
      uncertainCandidateGroups: (topicDiagnostics.uncertainMatches || []).length,
      uncertainAutoMergeCount: topicDiagnostics.uncertainAutoMergeCount || 0,
    },
    artifactRegistry: data.artifactRegistryDiagnostics,
    roomRegistry: data.roomRegistryDiagnostics,
    contextLinks: data.projection.contextLinkDiagnostics,
    digest: data.projection.digestDiagnostics,
    agentBriefs: data.projection.agentBriefDiagnostics,
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const hermesHome = path.resolve(
    options.hermesHome || process.env.HERMES_HOME || '/home/clawd/.hermes'
  );
  const rawSource = loadProjectionSource({ hermesHome });
  const scopeReader = new ScopedApprovalReader({
    ledgerPath: options.scopeLedger,
  }).load();
  const source = scopeReader.enrichSource(rawSource);
  const artifactRegistry = readArtifactRegistry(
    path.resolve(
      options.artifactRegistryPath || path.join(hermesHome, 'agent-os-artifact-registry.json')
    )
  );
  const roomRegistry = readRoomRegistry(
    path.resolve(options.roomRegistryPath || path.join(hermesHome, 'matrix-agent-rooms.json'))
  );
  const projectionOptions = { ...options, artifactRegistry, roomRegistry };
  const projection = buildProjection(source, projectionOptions);
  const audits = buildClassificationAudit(source, options);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        summary(
          {
            ...options,
            projection,
            artifactRegistryDiagnostics: artifactRegistry.diagnostics,
            roomRegistryDiagnostics: roomRegistry.diagnostics,
          },
          source,
          audits
        ),
        null,
        2
      )
    );
    return;
  }

  const database = path.resolve(options.database || defaultManagementDatabase(hermesHome));
  const store = new ManagementStore({ database });
  store.initialize();
  project(store, source, projectionOptions);
  if (options.shadow) classifyShadow(store, source, options);
  console.log(
    JSON.stringify(
      {
        ...summary(
          {
            ...options,
            projection,
            artifactRegistryDiagnostics: artifactRegistry.diagnostics,
            roomRegistryDiagnostics: roomRegistry.diagnostics,
          },
          source,
          audits
        ),
        database,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
