'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONTRACT_PATH = path.join(__dirname, '..', 'config', 'production-contract.json');
const ACTION_CLASSES = Object.freeze([
  'ask_question',
  'archive_intake_noise',
  'delegate_followup',
  'schedule_wakeup',
  'return_for_completion',
]);
const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'contractId',
  'effectiveDate',
  'status',
  'interface',
  'management',
  'assistant',
  'databasePaths',
  'safety',
  'rollback',
  'evidence',
]);

function invalid(reason) {
  const error = new Error(`production_contract_invalid: ${reason}`);
  error.code = 'PRODUCTION_CONTRACT_INVALID';
  throw error;
}

function exactFields(value, fields, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${location} object`);
  const actual = Object.keys(value);
  if (actual.some((field) => !fields.has(field)) || actual.length !== fields.size) {
    invalid(`${location} fields`);
  }
}

function exactStrings(value, expected, location) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((item, index) => item !== expected[index])
  ) {
    invalid(location);
  }
}

function loadProductionContract(options = {}) {
  const contractPath = path.resolve(options.contractPath || DEFAULT_CONTRACT_PATH);
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (_error) {
    invalid('configuration is not readable JSON');
  }
  exactFields(contract, TOP_LEVEL_FIELDS, 'contract');
  if (contract.schemaVersion !== 3) invalid('schemaVersion');
  if (contract.contractId !== 'management-cockpit-production-v3') invalid('contractId');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contract.effectiveDate)) invalid('effectiveDate');
  if (contract.status !== 'active') invalid('status');

  exactFields(
    contract.interface,
    new Set(['path', 'mode', 'label', 'legacyFallbackPath']),
    'interface'
  );
  if (
    contract.interface.path !== '/management' ||
    contract.interface.mode !== 'low_risk' ||
    contract.interface.label !== 'Assistenz · begrenzte Aktionen' ||
    contract.interface.legacyFallbackPath !== '/'
  ) {
    invalid('interface values');
  }

  exactFields(
    contract.management,
    new Set([
      'enabled',
      'decisionWritesEnabled',
      'shadowOnly',
      'defaultView',
      'decisionExecuteEnabled',
      'decisionExecuteActionClasses',
      'decisionExecuteRequiresProductionSmoke',
    ]),
    'management'
  );
  if (
    contract.management.enabled !== true ||
    contract.management.decisionWritesEnabled !== false ||
    contract.management.shadowOnly !== true ||
    contract.management.defaultView !== 'management' ||
    contract.management.decisionExecuteEnabled !== false ||
    contract.management.decisionExecuteRequiresProductionSmoke !== true
  ) {
    invalid('management values');
  }
  exactStrings(
    contract.management.decisionExecuteActionClasses,
    DECISION_EXECUTE_ACTION_CLASSES,
    'management.decisionExecuteActionClasses'
  );

  exactFields(
    contract.assistant,
    new Set([
      'enabled',
      'mode',
      'writesEnabled',
      'matrixHandoffEnabled',
      'confirmationRequired',
      'actionClasses',
      'profile',
      'matrixSender',
    ]),
    'assistant'
  );
  if (
    contract.assistant.enabled !== true ||
    contract.assistant.mode !== 'low_risk' ||
    contract.assistant.writesEnabled !== true ||
    contract.assistant.matrixHandoffEnabled !== true ||
    contract.assistant.confirmationRequired !== true ||
    contract.assistant.profile !== 'rhajaina' ||
    !/^@[^:]+:[^:]+$/.test(contract.assistant.matrixSender)
  ) {
    invalid('assistant values');
  }
  exactStrings(contract.assistant.actionClasses, ACTION_CLASSES, 'assistant.actionClasses');

  exactFields(
    contract.databasePaths,
    new Set(['management', 'assistant', 'kanbanRoot']),
    'databasePaths'
  );
  for (const value of Object.values(contract.databasePaths)) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) invalid('databasePaths values');
  }

  exactFields(
    contract.safety,
    new Set(['excludedBoards', 'blockedActionClasses', 'writeRequirements']),
    'safety'
  );
  if (
    !Array.isArray(contract.safety.excludedBoards) ||
    !contract.safety.excludedBoards.includes('twl-netze-private') ||
    !Array.isArray(contract.safety.blockedActionClasses) ||
    !Array.isArray(contract.safety.writeRequirements)
  ) {
    invalid('safety values');
  }

  exactFields(
    contract.rollback,
    new Set([
      'assistantPolicyMode',
      'writesEnabled',
      'matrixHandoffEnabled',
      'managementEnabled',
      'defaultView',
      'kanbanRestorePermitted',
    ]),
    'rollback'
  );
  if (
    contract.rollback.assistantPolicyMode !== 'read_only' ||
    contract.rollback.writesEnabled !== false ||
    contract.rollback.matrixHandoffEnabled !== false ||
    contract.rollback.managementEnabled !== false ||
    contract.rollback.defaultView !== 'legacy' ||
    contract.rollback.kanbanRestorePermitted !== false
  ) {
    invalid('rollback values');
  }

  exactFields(
    contract.evidence,
    new Set(['productionSmoke', 'decisionExecuteProductionSmoke', 'decisionExecuteProductionSmokeStatus']),
    'evidence'
  );
  if (contract.evidence.productionSmoke.includes('..')) invalid('evidence path');
  if (contract.evidence.decisionExecuteProductionSmoke.includes('..')) invalid('evidence path');
  if (!['pending', 'passed'].includes(contract.evidence.decisionExecuteProductionSmokeStatus)) {
    invalid('evidence decisionExecuteProductionSmokeStatus');
  }
  return Object.freeze({ ...contract, contractPath });
}

function buildOperatingStatus({ contract, management, assistant }) {
  const runtime = {
    management: {
      enabled: Boolean(management.enabled),
      decisionWritesEnabled: Boolean(management.decisionWritesEnabled),
      shadowOnly: Boolean(management.shadowOnly),
      defaultView: management.defaultView,
      decisionExecuteEnabled: Boolean(management.decisionExecuteEnabled),
      decisionExecuteActionClasses: [...(management.decisionExecuteActionClasses || [])],
      decisionExecuteRequiresProductionSmoke: Boolean(
        management.decisionExecuteRequiresProductionSmoke
      ),
    },
    assistant: {
      enabled: Boolean(assistant.enabled),
      mode: assistant.mode,
      writesEnabled: Boolean(assistant.writesEnabled),
      matrixHandoffEnabled: Boolean(assistant.matrixHandoffEnabled),
      actionClasses: [...(assistant.actionAllowlist || [])],
    },
  };
  const mismatches = [];
  for (const [field, expected] of Object.entries(contract.management)) {
    const actual = runtime.management[field];
    const matches = Array.isArray(expected)
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : actual === expected;
    if (!matches) mismatches.push(`management.${field}`);
  }
  for (const field of ['enabled', 'mode', 'writesEnabled', 'matrixHandoffEnabled']) {
    if (runtime.assistant[field] !== contract.assistant[field])
      mismatches.push(`assistant.${field}`);
  }
  if (
    JSON.stringify(runtime.assistant.actionClasses) !==
    JSON.stringify(contract.assistant.actionClasses)
  ) {
    mismatches.push('assistant.actionClasses');
  }
  return {
    contractId: contract.contractId,
    contractStatus: contract.status,
    effectiveDate: contract.effectiveDate,
    declaredMode: contract.interface.mode,
    label: contract.interface.label,
    runtime,
    aligned: mismatches.length === 0,
    mismatches,
  };
}

module.exports = {
  ACTION_CLASSES,
  DEFAULT_CONTRACT_PATH,
  buildOperatingStatus,
  loadProductionContract,
};
const DECISION_EXECUTE_ACTION_CLASSES = Object.freeze([
  'choose',
  'delegate',
  'question',
  'schedule',
  'reject',
  'return-to-rhajaina',
]);
