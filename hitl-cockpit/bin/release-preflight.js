#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RELEASE_PREFIX = 'hitl-cockpit/';
const RELEASE_TOP_LEVEL_FILES = new Set([
  'README.md',
  'ecosystem.config.js',
  'package.json',
  'server.js',
]);
const RELEASE_DIRECTORIES = ['bin/', 'config/', 'lib/', 'public/'];
const RELEASE_TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.sql']);
const DOCUMENTED_UNTRACKED_EXCEPTIONS = new Set([
  'agent-operating-system/rhajaina-assistant-channel-production-smoke-v1.md',
]);
const RUNTIME_CONFIG_FIELDS = new Set([
  'schemaVersion',
  'flags',
  'databasePaths',
  'requiredProfiles',
  'excludedBoards',
]);
const RUNTIME_FLAG_VALUES = Object.freeze({
  managementCockpitEnabled: false,
  managementCockpitWriteEnabled: false,
  managementCockpitShadowOnly: true,
  managementCockpitDefaultView: 'legacy',
  assistantEnabled: false,
  assistantMode: 'read_only',
  assistantWritesEnabled: false,
  assistantMatrixHandoffEnabled: false,
});
const DATABASE_PATH_FIELDS = new Set(['management', 'assistant', 'kanbanRoot']);
const REQUIRED_PROFILES = Object.freeze(['infrastructure', 'rhajaina']);
const EXCLUDED_BOARDS = Object.freeze(['twl-netze-private']);
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[oprsu]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/i,
];

function git(repository, args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repository,
      encoding: options.binary ? null : 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])])
    );
  }
  return value;
}

function serialize(value) {
  return `${JSON.stringify(stableJson(value), null, 2)}\n`;
}

function normalizeRelative(candidate) {
  const normalized = candidate.split(path.sep).join('/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.isAbsolute(candidate)
  ) {
    throw new Error(`path must be repository-relative: ${candidate}`);
  }
  return normalized;
}

function readCommittedFile(repository, commit, relativePath, binary = false) {
  return git(repository, ['show', `${commit}:${relativePath}`], { binary });
}

function assertExactFields(value, allowed, location) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown runtime config field: ${location}.${key}`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`runtime config field is required: ${location}.${key}`);
    }
  }
}

function assertExactStringArray(actual, expected, location) {
  if (!Array.isArray(actual) || actual.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${location} must be a string array`);
  }
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(`${location} must equal ${JSON.stringify(expected)}`);
  }
}

function validateNonSecretPath(value, location) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    !/^\/[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw new Error(`${location} must be a normalized absolute non-secret path`);
  }
  scanForSecret(Buffer.from(value), location);
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateRuntimeConfig(runtimeConfig) {
  if (!runtimeConfig || typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) {
    throw new Error('runtime config must be a JSON object');
  }
  assertExactFields(runtimeConfig, RUNTIME_CONFIG_FIELDS, 'runtimeConfig');
  if (runtimeConfig.schemaVersion !== 1) throw new Error('runtime config schemaVersion must be 1');

  const flags = runtimeConfig.flags;
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    throw new Error('runtimeConfig.flags must be an object');
  }
  assertExactFields(flags, new Set(Object.keys(RUNTIME_FLAG_VALUES)), 'runtimeConfig.flags');
  if (flags.managementCockpitEnabled !== false) {
    throw new Error('management cockpit must remain disabled in the release baseline');
  }
  if (flags.managementCockpitWriteEnabled !== false || flags.assistantWritesEnabled !== false) {
    throw new Error('write flag must remain false');
  }
  if (flags.managementCockpitShadowOnly !== true) {
    throw new Error('management cockpit shadow-only flag must remain true');
  }
  if (flags.managementCockpitDefaultView !== 'legacy') {
    throw new Error('default view must remain legacy');
  }
  if (flags.assistantEnabled !== false || flags.assistantMode !== 'read_only') {
    throw new Error('assistant must remain disabled and read_only');
  }
  if (flags.assistantMatrixHandoffEnabled !== false) {
    throw new Error('assistant Matrix handoff must remain disabled');
  }

  const databasePaths = runtimeConfig.databasePaths;
  if (!databasePaths || typeof databasePaths !== 'object' || Array.isArray(databasePaths)) {
    throw new Error('runtimeConfig.databasePaths must be an object');
  }
  assertExactFields(databasePaths, DATABASE_PATH_FIELDS, 'runtimeConfig.databasePaths');
  for (const name of DATABASE_PATH_FIELDS) {
    validateNonSecretPath(databasePaths[name], `databasePaths.${name}`);
  }
  if (path.resolve(databasePaths.management) === path.resolve(databasePaths.assistant)) {
    throw new Error('management and assistant databases must use separate paths');
  }
  for (const name of ['management', 'assistant']) {
    if (isWithin(databasePaths.kanbanRoot, databasePaths[name])) {
      throw new Error(`databasePaths.${name} must not be inside kanbanRoot`);
    }
  }

  assertExactStringArray(runtimeConfig.requiredProfiles, REQUIRED_PROFILES, 'requiredProfiles');
  assertExactStringArray(runtimeConfig.excludedBoards, EXCLUDED_BOARDS, 'excludedBoards');
  scanForSecret(Buffer.from(serialize(runtimeConfig)), 'runtime-config.json');
  return runtimeConfig;
}

function assertRequiredProfiles(profileRoot, requiredProfiles) {
  if (typeof profileRoot !== 'string' || !path.isAbsolute(profileRoot)) {
    throw new Error('an explicit absolute profileRoot is required');
  }
  for (const profile of requiredProfiles) {
    const profilePath = path.join(profileRoot, profile);
    try {
      if (!fs.statSync(profilePath).isDirectory()) throw new Error('not a directory');
      fs.accessSync(profilePath, fs.constants.R_OK);
    } catch (_error) {
      throw new Error(`required profile is missing or unreadable: ${profile}`);
    }
  }
}

function schemaVersion(sql, name) {
  if (!/CREATE TABLE/i.test(sql)) throw new Error(`${name} schema contains no CREATE TABLE`);
  const match = sql.match(/PRAGMA\s+user_version\s*=\s*(\d+)\s*;/i);
  if (!match) throw new Error(`${name} schema has no user_version`);
  return Number(match[1]);
}

function assertCleanTree(repository, allowUntracked = []) {
  const allowed = new Set(
    allowUntracked.map((candidate) => {
      const normalized = normalizeRelative(candidate);
      if (!DOCUMENTED_UNTRACKED_EXCEPTIONS.has(normalized)) {
        throw new Error(`untracked exception is not allowed: ${normalized}`);
      }
      return normalized;
    })
  );
  const entries = git(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    .split('\0')
    .filter(Boolean);
  const violations = [];
  for (const entry of entries) {
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (status === '??' && allowed.has(normalizeRelative(file))) continue;
    violations.push(`${status} ${file}`);
  }
  if (violations.length) {
    throw new Error(`working tree is not clean: ${violations.join(', ')}`);
  }
}

function normalizeCommit(repository, commit) {
  return git(repository, ['rev-parse', '--verify', `${commit}^{commit}`]).trim();
}

function preflight(options) {
  const repository = path.resolve(options.repository);
  const commit = normalizeCommit(repository, options.commit || 'HEAD');
  const head = normalizeCommit(repository, 'HEAD');
  if (commit !== head) throw new Error(`release commit must equal HEAD (${head})`);
  if (options.baseRef) {
    git(repository, ['merge-base', '--is-ancestor', options.baseRef, commit]);
  }
  assertCleanTree(repository, options.allowUntracked || []);
  const runtimeConfig = validateRuntimeConfig(options.runtimeConfig);
  assertRequiredProfiles(options.profileRoot, runtimeConfig.requiredProfiles);

  const managementSchema = readCommittedFile(
    repository,
    commit,
    'hitl-cockpit/lib/projection-schema.sql'
  );
  const assistantSchema = readCommittedFile(
    repository,
    commit,
    'hitl-cockpit/lib/assistant-schema.sql'
  );
  const schemas = {
    management: schemaVersion(managementSchema, 'management'),
    assistant: schemaVersion(assistantSchema, 'assistant'),
  };
  if (schemas.management !== 6 || schemas.assistant !== 6) {
    throw new Error(
      `unexpected schema versions: management=${schemas.management}, assistant=${schemas.assistant}`
    );
  }

  const policy = JSON.parse(
    readCommittedFile(repository, commit, 'hitl-cockpit/config/assistant-policy.json')
  );
  if (
    policy.enabled !== false ||
    policy.mode !== 'read_only' ||
    policy.writesEnabled !== false ||
    policy.matrixHandoffEnabled !== false
  ) {
    throw new Error('committed assistant policy is not release-safe');
  }

  return {
    ok: true,
    commit,
    baseRef: options.baseRef || null,
    schemas,
    requiredProfiles: [...runtimeConfig.requiredProfiles].sort(),
  };
}

function releaseSourcePaths(repository, commit) {
  const files = git(repository, ['ls-tree', '-r', '--name-only', commit, '--', RELEASE_PREFIX])
    .split('\n')
    .filter(Boolean);
  return files.filter((file) => {
    const relative = file.slice(RELEASE_PREFIX.length);
    return (
      RELEASE_TOP_LEVEL_FILES.has(relative) ||
      RELEASE_DIRECTORIES.some((directory) => relative.startsWith(directory))
    );
  });
}

function scanForSecret(content, relativePath) {
  if (content.includes(0)) throw new Error(`NUL or binary content in release file ${relativePath}`);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch (_error) {
    throw new Error(`NUL or binary content in release file ${relativePath}`);
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(text)) throw new Error(`possible secret in release file ${relativePath}`);
  }
}

function assertReleaseTextPath(relativePath) {
  if (!RELEASE_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    throw new Error(`unsupported non-text release file ${relativePath}`);
  }
}

function listFiles(root) {
  const results = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        if (!fs.lstatSync(absolute).isFile()) {
          throw new Error(`release artifact contains unsupported filesystem entry: ${relative}`);
        }
        results.push(relative);
      }
    }
  }
  visit(root);
  return results.sort();
}

function assertRegularFile(file, relativePath) {
  let metadata;
  try {
    metadata = fs.lstatSync(file);
  } catch (_error) {
    throw new Error(`${relativePath} is missing`);
  }
  if (!metadata.isFile()) {
    throw new Error(`release artifact contains unsupported filesystem entry: ${relativePath}`);
  }
}

function buildRelease(options) {
  const check = preflight(options);
  const repository = path.resolve(options.repository);
  const output = path.resolve(options.output);
  if (fs.existsSync(output) && fs.readdirSync(output).length) {
    throw new Error(`release output must be absent or empty: ${output}`);
  }
  fs.mkdirSync(path.join(output, 'runtime'), { recursive: true });

  const sourcePaths = releaseSourcePaths(repository, check.commit);
  if (!sourcePaths.includes('hitl-cockpit/server.js'))
    throw new Error('release source is incomplete');
  for (const sourcePath of sourcePaths) {
    const relative = sourcePath.slice(RELEASE_PREFIX.length);
    const content = readCommittedFile(repository, check.commit, sourcePath, true);
    scanForSecret(content, relative);
    assertReleaseTextPath(relative);
    const target = path.join(output, 'runtime', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  const runtimeConfigContent = Buffer.from(serialize(options.runtimeConfig));
  scanForSecret(runtimeConfigContent, 'runtime-config.json');
  fs.writeFileSync(path.join(output, 'runtime-config.json'), runtimeConfigContent, { mode: 0o600 });

  const packageJson = JSON.parse(
    readCommittedFile(repository, check.commit, 'hitl-cockpit/package.json')
  );
  const manifestFiles = listFiles(output).map((relativePath) => ({
    path: relativePath,
    sha256: sha256(fs.readFileSync(path.join(output, relativePath))),
  }));
  const manifest = {
    releaseFormat: 1,
    application: packageJson.name,
    version: packageJson.version,
    commit: check.commit,
    schemas: check.schemas,
    runtimeConfigSha256: sha256(runtimeConfigContent),
    files: manifestFiles,
  };
  fs.writeFileSync(path.join(output, 'release-manifest.json'), serialize(manifest), {
    mode: 0o600,
  });
  verifyArtifact(output);
  return manifest;
}

function verifyArtifact(artifact) {
  const root = path.resolve(artifact);
  const manifestPath = path.join(root, 'release-manifest.json');
  assertRegularFile(manifestPath, 'release-manifest.json');
  const manifestContent = fs.readFileSync(manifestPath);
  scanForSecret(manifestContent, 'release-manifest.json');
  const manifest = JSON.parse(manifestContent.toString('utf8'));
  if (manifest.releaseFormat !== 1 || !/^[a-f0-9]{40,64}$/.test(manifest.commit || '')) {
    throw new Error('release manifest identity is invalid');
  }
  const expected = new Set(manifest.files.map((entry) => entry.path));
  const actual = listFiles(root).filter((file) => file !== 'release-manifest.json');
  if (actual.length !== expected.size || actual.some((file) => !expected.has(file))) {
    throw new Error('release artifact file set differs from manifest');
  }
  for (const entry of manifest.files) {
    const file = path.join(root, normalizeRelative(entry.path));
    assertRegularFile(file, entry.path);
    const content = fs.readFileSync(file);
    scanForSecret(content, entry.path);
    assertReleaseTextPath(entry.path);
    const digest = sha256(content);
    if (digest !== entry.sha256) throw new Error(`release checksum mismatch: ${entry.path}`);
  }
  const runtimeConfigPath = path.join(root, 'runtime-config.json');
  assertRegularFile(runtimeConfigPath, 'runtime-config.json');
  const runtimeConfigContent = fs.readFileSync(runtimeConfigPath);
  validateRuntimeConfig(JSON.parse(runtimeConfigContent.toString('utf8')));
  const configDigest = sha256(runtimeConfigContent);
  if (configDigest !== manifest.runtimeConfigSha256) {
    throw new Error('runtime config checksum mismatch');
  }
  return manifest;
}

function copyVerifiedArtifact(source, target) {
  const manifest = verifyArtifact(source);
  const destination = path.resolve(target);
  if (fs.existsSync(destination)) throw new Error(`target already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(path.resolve(source), destination, { recursive: true, errorOnExist: true });
  verifyArtifact(destination);
  return manifest;
}

function promoteLastKnownGood({ artifact, target }) {
  return copyVerifiedArtifact(artifact, target);
}

function rollbackDryRun({ lastKnownGood, target }) {
  const destination = path.resolve(target);
  const reportPath = `${destination}-report.json`;
  if (fs.existsSync(reportPath)) throw new Error(`rollback report already exists: ${reportPath}`);
  const manifest = copyVerifiedArtifact(lastKnownGood, destination);
  const report = {
    verified: true,
    commit: manifest.commit,
    version: manifest.version,
    kanbanRestorePerformed: false,
    restoredScope: 'cockpit-code-and-documented-runtime-config-only',
  };
  fs.writeFileSync(reportPath, serialize(report), {
    mode: 0o600,
  });
  return report;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const values = { command, allowUntracked: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    const value = rest[index + 1];
    if (!option.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid option: ${option}`);
    }
    index += 1;
    const name = option.slice(2);
    if (name === 'allow-untracked') values.allowUntracked.push(value);
    else values[name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
  }
  return values;
}

function loadConfig(configPath) {
  if (!configPath) throw new Error('--config is required');
  return JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const repository = path.resolve(args.repo || path.join(__dirname, '..', '..'));
  const profileRoot =
    args.profileRoot ||
    (args.hermesHome ? path.join(path.resolve(args.hermesHome), 'profiles') : null);
  let result;
  if (args.command === 'preflight') {
    result = preflight({
      repository,
      commit: args.commit || 'HEAD',
      runtimeConfig: loadConfig(args.config),
      baseRef: args.baseRef || 'origin/main',
      allowUntracked: args.allowUntracked,
      profileRoot,
    });
  } else if (args.command === 'build') {
    if (!args.output) throw new Error('--output is required');
    result = buildRelease({
      repository,
      commit: args.commit || 'HEAD',
      output: args.output,
      runtimeConfig: loadConfig(args.config),
      baseRef: args.baseRef || 'origin/main',
      allowUntracked: args.allowUntracked,
      profileRoot,
    });
  } else if (args.command === 'promote-lkg') {
    if (!args.artifact || !args.target) throw new Error('--artifact and --target are required');
    result = promoteLastKnownGood({ artifact: args.artifact, target: args.target });
  } else if (args.command === 'rollback-dry-run') {
    if (!args.lkg || !args.target) throw new Error('--lkg and --target are required');
    result = rollbackDryRun({ lastKnownGood: args.lkg, target: args.target });
  } else {
    throw new Error(
      'usage: release-preflight.js <preflight|build|promote-lkg|rollback-dry-run> [options]'
    );
  }
  process.stdout.write(serialize(result));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`release-preflight: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildRelease,
  preflight,
  promoteLastKnownGood,
  rollbackDryRun,
  validateRuntimeConfig,
  verifyArtifact,
};
