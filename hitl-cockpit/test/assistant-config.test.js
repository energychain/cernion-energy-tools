'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { loadAssistantConfig, toBrowserAssistantConfig } = require('../lib/assistant-config');

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-config-'));
  roots.push(root);
  const executable = path.join(root, 'hermes');
  fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const config = {
    version: 1,
    enabled: false,
    mode: 'read_only',
    writesEnabled: false,
    matrixHandoffEnabled: false,
    limits: {
      maxMessageChars: 4000,
      maxContextChars: 12000,
      recentMessageCount: 12,
      sessionRotateMessages: 20,
    },
    transport: {
      type: 'cli',
      safeMode: true,
      executable,
      profile: 'rhajaina',
      toolset: 'bot_room',
      timeoutMs: 120000,
      runBudgetSeconds: 90,
      maxTurns: 1,
      source: 'tool',
      extraArgs: [],
    },
    ...overrides,
  };
  const configPath = path.join(root, 'assistant-policy.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  return { configPath, executable };
}

test('loads fail-closed read-only defaults', () => {
  const { configPath } = fixture();
  const config = loadAssistantConfig({ configPath });
  assert.equal(config.enabled, false);
  assert.equal(config.mode, 'read_only');
  assert.equal(config.writesEnabled, false);
  assert.equal(config.matrixHandoffEnabled, false);
  assert.equal(config.limits.maxMessageChars, 4000);
  assert.equal(config.limits.maxContextChars, 12000);
  assert.equal(config.limits.sessionRotateMessages, 20);
  assert.equal(config.transport.safeMode, true);
});

test('disabled config does not require the Hermes executable to exist', () => {
  const item = fixture();
  const raw = JSON.parse(fs.readFileSync(item.configPath, 'utf8'));
  raw.transport.executable = path.join(path.dirname(item.configPath), 'does-not-exist');
  fs.writeFileSync(item.configPath, JSON.stringify(raw));
  const config = loadAssistantConfig({ configPath: item.configPath });
  assert.equal(config.enabled, false);
  assert.equal(config.transport.executable, raw.transport.executable);
});

test('rejects invalid mode, missing executable when enabled, and unsafe transport flags', () => {
  assert.throws(
    () => loadAssistantConfig({ configPath: fixture({ mode: 'autonomous' }).configPath }),
    /assistant_config_invalid/
  );

  const missing = fixture();
  const raw = JSON.parse(fs.readFileSync(missing.configPath, 'utf8'));
  raw.enabled = true;
  raw.transport.executable = path.join(path.dirname(missing.configPath), 'missing-hermes');
  fs.writeFileSync(missing.configPath, JSON.stringify(raw));
  assert.throws(() => loadAssistantConfig({ configPath: missing.configPath }), /executable/);

  const unsafe = fixture();
  const unsafeRaw = JSON.parse(fs.readFileSync(unsafe.configPath, 'utf8'));
  unsafeRaw.transport.extraArgs = ['--format', 'stream-json'];
  fs.writeFileSync(unsafe.configPath, JSON.stringify(unsafeRaw));
  assert.throws(() => loadAssistantConfig({ configPath: unsafe.configPath }), /unsafe/);
});

test('cannot enable writes or Matrix handoff in read-only mode', () => {
  assert.throws(
    () =>
      loadAssistantConfig({
        configPath: fixture({ writesEnabled: true, matrixHandoffEnabled: true }).configPath,
      }),
    /read_only/
  );
});

test('session rotation threshold is mandatory and bounded fail closed', () => {
  for (const sessionRotateMessages of [undefined, 0, 1, 201, 1.5, '20']) {
    const item = fixture();
    const raw = JSON.parse(fs.readFileSync(item.configPath, 'utf8'));
    if (sessionRotateMessages === undefined) delete raw.limits.sessionRotateMessages;
    else raw.limits.sessionRotateMessages = sessionRotateMessages;
    fs.writeFileSync(item.configPath, JSON.stringify(raw));
    assert.throws(
      () => loadAssistantConfig({ configPath: item.configPath }),
      /sessionRotateMessages/
    );
  }
});

test('requires the empty bot_room toolset and rejects configurable tool access', () => {
  const valid = loadAssistantConfig({ configPath: fixture().configPath });
  assert.equal(valid.transport.profile, 'rhajaina');
  assert.equal(valid.transport.toolset, 'bot_room');

  for (const toolset of ['default', 'messaging', '', null]) {
    const item = fixture();
    const raw = JSON.parse(fs.readFileSync(item.configPath, 'utf8'));
    raw.transport.toolset = toolset;
    fs.writeFileSync(item.configPath, JSON.stringify(raw));
    assert.throws(() => loadAssistantConfig({ configPath: item.configPath }), /toolset/);
  }
});

test('safe mode is mandatory and fails closed when missing or false', () => {
  for (const safeMode of [undefined, false, 'true', 1]) {
    const item = fixture();
    const raw = JSON.parse(fs.readFileSync(item.configPath, 'utf8'));
    if (safeMode === undefined) delete raw.transport.safeMode;
    else raw.transport.safeMode = safeMode;
    fs.writeFileSync(item.configPath, JSON.stringify(raw));
    assert.throws(() => loadAssistantConfig({ configPath: item.configPath }), /safeMode/);
  }
});

test('browser projection excludes executable, arguments, profile, and secrets', () => {
  const { configPath } = fixture();
  const browser = toBrowserAssistantConfig(loadAssistantConfig({ configPath }));
  assert.deepEqual(browser, {
    enabled: false,
    mode: 'read_only',
    writesEnabled: false,
    matrixHandoffEnabled: false,
    actionAllowlist: [],
    limits: { maxMessageChars: 4000, maxContextChars: 12000 },
  });
  const serialized = JSON.stringify(browser);
  assert.doesNotMatch(serialized, /hermes|rhajaina|transport|executable|token|secret/i);
});
