'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'assistant-policy.json');
const SAFE_TRANSPORT = 'cli';
const SAFE_TOOLSET = 'bot_room';
const MODES = Object.freeze(['read_only', 'shadow', 'low_risk', 'scoped', 'productive']);
const LOW_RISK_ACTIONS = Object.freeze([
  'ask_question',
  'archive_intake_noise',
  'delegate_followup',
  'schedule_wakeup',
  'return_for_completion',
]);
const SCOPED_ACTIONS = Object.freeze(['set_owner', 'set_priority']);
const ACTIONS = Object.freeze([...LOW_RISK_ACTIONS, ...SCOPED_ACTIONS]);

function invalid(reason) {
  const error = new Error(`assistant_config_invalid: ${reason}`);
  error.code = 'ASSISTANT_CONFIG_INVALID';
  throw error;
}

function integer(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalid(name);
  return value;
}

function actionAllowlist(value) {
  if (value === undefined) return Object.freeze([]);
  if (
    !Array.isArray(value) ||
    value.some((action) => typeof action !== 'string' || !ACTIONS.includes(action)) ||
    new Set(value).size !== value.length
  ) {
    invalid('actionAllowlist must contain unique supported actions');
  }
  return Object.freeze([...value]);
}

function validateModeFlags(value, allowlist) {
  if (!MODES.includes(value.mode)) invalid('invalid mode');
  if (typeof value.writesEnabled !== 'boolean') invalid('writesEnabled must be boolean');
  if (typeof value.matrixHandoffEnabled !== 'boolean')
    invalid('matrixHandoffEnabled must be boolean');
  if (['read_only', 'shadow'].includes(value.mode)) {
    if (value.writesEnabled || value.matrixHandoffEnabled || allowlist.length) {
      invalid(
        `${value.mode} requires writes, Matrix handoff, and action allowlist to remain disabled`
      );
    }
    return;
  }
  if (!value.enabled && (value.writesEnabled || value.matrixHandoffEnabled)) {
    invalid('disabled assistant cannot enable writes or Matrix handoff');
  }
  if (value.matrixHandoffEnabled && !value.writesEnabled) {
    invalid('Matrix handoff requires writes');
  }
  if (!value.writesEnabled) invalid(`${value.mode} requires writesEnabled`);
  if (!allowlist.length) invalid(`${value.mode} requires a non-empty action allowlist`);
  const permitted = value.mode === 'low_risk' ? LOW_RISK_ACTIONS : ACTIONS;
  if (allowlist.some((action) => !permitted.includes(action))) {
    invalid(`${value.mode} action allowlist exceeds the mode boundary`);
  }
}

function loadAssistantConfig(options = {}) {
  const configPath = path.resolve(options.configPath || DEFAULT_CONFIG_PATH);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_error) {
    invalid('configuration is not readable JSON');
  }
  if (!value || value.version !== 1) invalid('unsupported version');
  if (typeof value.enabled !== 'boolean') invalid('enabled must be boolean');
  const allowlist = actionAllowlist(value.actionAllowlist);
  validateModeFlags(value, allowlist);
  if (!value.limits || typeof value.limits !== 'object') invalid('limits are required');
  const limits = {
    maxMessageChars: integer(value.limits.maxMessageChars, 'maxMessageChars', 1, 4000),
    maxContextChars: integer(value.limits.maxContextChars, 'maxContextChars', 1, 12000),
    recentMessageCount: integer(value.limits.recentMessageCount, 'recentMessageCount', 0, 50),
    sessionRotateMessages: integer(
      value.limits.sessionRotateMessages,
      'sessionRotateMessages',
      2,
      200
    ),
  };
  const transport = value.transport;
  if (!transport || transport.type !== SAFE_TRANSPORT) invalid('transport must be cli');
  if (transport.safeMode !== true) invalid('safeMode must be true');
  if (typeof transport.executable !== 'string' || !path.isAbsolute(transport.executable)) {
    invalid('executable must be an absolute path');
  }
  if (value.enabled) {
    try {
      fs.accessSync(transport.executable, fs.constants.X_OK);
    } catch (_error) {
      invalid('executable is missing or not executable');
    }
  }
  if (transport.profile !== 'rhajaina') invalid('profile must be rhajaina');
  if (transport.toolset !== SAFE_TOOLSET) invalid('toolset must be bot_room');
  if (!Array.isArray(transport.extraArgs) || transport.extraArgs.length !== 0) {
    invalid('unsafe transport flags');
  }
  const normalizedTransport = {
    type: SAFE_TRANSPORT,
    safeMode: true,
    executable: path.resolve(transport.executable),
    profile: 'rhajaina',
    toolset: SAFE_TOOLSET,
    timeoutMs: integer(transport.timeoutMs, 'timeoutMs', 1000, 300000),
    runBudgetSeconds: integer(transport.runBudgetSeconds, 'runBudgetSeconds', 1, 300),
    maxTurns: integer(transport.maxTurns, 'maxTurns', 1, 1),
    source: transport.source,
    extraArgs: [],
  };
  if (normalizedTransport.source !== 'tool') invalid('source must be tool');
  return Object.freeze({
    version: 1,
    enabled: value.enabled,
    mode: value.mode,
    writesEnabled: value.writesEnabled,
    matrixHandoffEnabled: value.matrixHandoffEnabled,
    actionAllowlist: allowlist,
    limits: Object.freeze(limits),
    transport: Object.freeze(normalizedTransport),
    configPath,
  });
}

function toBrowserAssistantConfig(config) {
  return {
    enabled: config.enabled,
    mode: config.mode,
    writesEnabled: config.writesEnabled,
    matrixHandoffEnabled: config.matrixHandoffEnabled,
    actionAllowlist: [...(config.actionAllowlist || [])],
    limits: {
      maxMessageChars: config.limits.maxMessageChars,
      maxContextChars: config.limits.maxContextChars,
    },
  };
}

module.exports = {
  ACTIONS,
  DEFAULT_CONFIG_PATH,
  LOW_RISK_ACTIONS,
  MODES,
  SCOPED_ACTIONS,
  loadAssistantConfig,
  toBrowserAssistantConfig,
};
