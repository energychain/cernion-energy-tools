'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  ACTION_CLASSES,
  buildOperatingStatus,
  loadProductionContract,
} = require('../lib/production-contract');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const contract = loadProductionContract();
const currentDocuments = [
  'agent-operating-system/management-cockpit-policy-v1.md',
  'agent-operating-system/management-cockpit-rhajaina-assistant-channel-v1.md',
  'agent-operating-system/management-cockpit-operations-v1.md',
  'hitl-cockpit/README.md',
];

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

test('production contract is closed, secret-free, and names the active low-risk lane', () => {
  assert.equal(contract.contractId, 'management-cockpit-production-v3');
  assert.equal(contract.status, 'active');
  assert.equal(contract.interface.mode, 'low_risk');
  assert.equal(contract.interface.label, 'Assistenz · begrenzte Aktionen');
  assert.deepEqual(contract.assistant.actionClasses, [...ACTION_CLASSES]);
  assert.equal(contract.assistant.writesEnabled, true);
  assert.equal(contract.assistant.matrixHandoffEnabled, true);
  assert.equal(contract.assistant.confirmationRequired, true);
  assert.equal(contract.management.decisionWritesEnabled, false);
  assert.equal(contract.management.decisionExecuteEnabled, false);
  assert.equal(contract.management.decisionExecuteRequiresProductionSmoke, true);
  assert.equal(contract.evidence.decisionExecuteProductionSmokeStatus, 'pending');
  assert.equal(contract.rollback.kanbanRestorePermitted, false);
  assert.doesNotMatch(
    JSON.stringify(contract),
    /(access[_-]?token|api[_-]?key|password|private[_-]?key|authorization|bearer\s+[a-z0-9])/i
  );
});

test('operating status proves exact runtime alignment without exposing transport or secrets', () => {
  const status = buildOperatingStatus({
    contract,
    management: {
      enabled: true,
      decisionWritesEnabled: false,
      shadowOnly: true,
      defaultView: 'management',
      decisionExecuteEnabled: false,
      decisionExecuteActionClasses: [
        'choose',
        'delegate',
        'question',
        'schedule',
        'reject',
        'return-to-rhajaina',
      ],
      decisionExecuteRequiresProductionSmoke: true,
    },
    assistant: {
      enabled: true,
      mode: 'low_risk',
      writesEnabled: true,
      matrixHandoffEnabled: true,
      actionAllowlist: [...ACTION_CLASSES],
      transport: { executable: '/secret/path', profile: 'rhajaina' },
    },
  });
  assert.equal(status.aligned, true);
  assert.deepEqual(status.mismatches, []);
  assert.equal(status.declaredMode, 'low_risk');
  assert.doesNotMatch(JSON.stringify(status), /executable|transport|secret\/path/i);
});

test('operating status reports drift fail visibly instead of claiming alignment', () => {
  const status = buildOperatingStatus({
    contract,
    management: {
      enabled: true,
      decisionWritesEnabled: false,
      shadowOnly: true,
      defaultView: 'management',
      decisionExecuteEnabled: false,
      decisionExecuteActionClasses: [
        'choose',
        'delegate',
        'question',
        'schedule',
        'reject',
        'return-to-rhajaina',
      ],
      decisionExecuteRequiresProductionSmoke: true,
    },
    assistant: {
      enabled: true,
      mode: 'shadow',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      actionAllowlist: [],
    },
  });
  assert.equal(status.aligned, false);
  assert.deepEqual(status.mismatches, [
    'assistant.mode',
    'assistant.writesEnabled',
    'assistant.matrixHandoffEnabled',
    'assistant.actionClasses',
  ]);
});

test('current operating documents point to exactly one production contract and no stale current-state claims', () => {
  const forbiddenCurrentClaims = [
    /aktueller status[^\n]{0,120}(nur|ausschließlich) read-only/i,
    /stand dieses pakets:[\s\S]{0,300}einzige zulässige modus ist `read_only`/i,
    /management-aktionen laufen aktuell ausschließlich als shadow/i,
    /managementsicht[^\n]{0,120}nicht produktiv aktiviert/i,
    /writes und matrix-handoff[^\n]{0,80}(technisch )?auf `false`/i,
  ];
  for (const relativePath of currentDocuments) {
    const body = read(relativePath);
    assert.match(body, /management-cockpit-production-contract-v3\.md/);
    for (const pattern of forbiddenCurrentClaims) {
      assert.doesNotMatch(body, pattern, `${relativePath} contains stale current-state wording`);
    }
  }
  const contractReferences = currentDocuments.filter((relativePath) =>
    read(relativePath).includes('management-cockpit-production-contract-v3.md')
  );
  assert.equal(contractReferences.length, currentDocuments.length);
});

test('production smoke evidence remains versioned and internally complete', () => {
  const evidencePath = contract.evidence.productionSmoke;
  const body = read(evidencePath);
  assert.match(body, /Gesamtergebnis: \*\*bestanden\*\*/);
  assert.match(body, /Matrix-Event/);
  assert.match(body, /Idempotenz nach Neustart/);
  assert.doesNotMatch(body, /(access[_-]?token|api[_-]?key|password)\s*[:=]\s*\S+/i);
});
