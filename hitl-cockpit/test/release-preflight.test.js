'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  buildRelease,
  preflight,
  promoteLastKnownGood,
  rollbackDryRun,
  verifyArtifact,
} = require('../bin/release-preflight');

const temporaryDirectories = [];
const DOCUMENTED_UNTRACKED_EXCEPTION =
  'agent-operating-system/rhajaina-assistant-channel-production-smoke-v1.md';

function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function runtimeConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    flags: {
      managementCockpitEnabled: false,
      managementCockpitWriteEnabled: false,
      managementCockpitShadowOnly: true,
      managementCockpitDefaultView: 'legacy',
      assistantEnabled: false,
      assistantMode: 'read_only',
      assistantWritesEnabled: false,
      assistantMatrixHandoffEnabled: false,
    },
    databasePaths: {
      management: '/srv/agentos/management-cockpit/management.db',
      assistant: '/srv/agentos/assistant/assistant-channel.db',
      kanbanRoot: '/srv/hermes/kanban/boards',
    },
    requiredProfiles: ['infrastructure', 'rhajaina'],
    excludedBoards: ['twl-netze-private'],
    ...overrides,
  };
}

function createRepository() {
  const root = temporaryDirectory('cockpit-release-repo-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'release@example.invalid'], { cwd: root });
  fs.mkdirSync(path.join(root, '.git', 'test-profiles', 'infrastructure'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git', 'test-profiles', 'rhajaina'), { recursive: true });

  write(
    root,
    'hitl-cockpit/package.json',
    `${JSON.stringify({ name: 'agentos-hitl-cockpit', version: '0.2.0' }, null, 2)}\n`
  );
  write(root, 'hitl-cockpit/README.md', '# Fixture\n');
  write(root, 'hitl-cockpit/server.js', "'use strict';\n");
  write(root, 'hitl-cockpit/bin/release-preflight.js', "'use strict';\n");
  write(root, 'hitl-cockpit/config/agents.json', '{"agents":[]}\n');
  write(
    root,
    'hitl-cockpit/config/assistant-policy.json',
    '{"enabled":false,"mode":"read_only","writesEnabled":false,"matrixHandoffEnabled":false}\n'
  );
  write(
    root,
    'hitl-cockpit/lib/projection-schema.sql',
    'CREATE TABLE x (id TEXT);\nPRAGMA user_version = 6;\n'
  );
  write(
    root,
    'hitl-cockpit/lib/assistant-schema.sql',
    'CREATE TABLE y (id TEXT);\nPRAGMA user_version = 10;\n'
  );
  write(root, 'hitl-cockpit/public/index.html', '<!doctype html>\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  return root;
}

function releaseOptions(repository, overrides = {}) {
  return {
    repository,
    runtimeConfig: runtimeConfig(),
    baseRef: 'main',
    profileRoot: path.join(repository, '.git', 'test-profiles'),
    ...overrides,
  };
}

function hashTree(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        entries.push([
          relative,
          crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
        ]);
      }
    }
  }
  visit(root);
  return entries.sort((left, right) => left[0].localeCompare(right[0]));
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test('preflight verifies commit, clean tree, schemas, safe flags, database paths and profiles', () => {
  const repository = createRepository();
  const commit = git(repository, 'rev-parse', 'HEAD');
  const result = preflight(releaseOptions(repository, { commit }));

  assert.equal(result.ok, true);
  assert.equal(result.commit, commit);
  assert.deepEqual(result.schemas, { management: 6, assistant: 10 });
  assert.deepEqual(result.requiredProfiles, ['infrastructure', 'rhajaina']);

  fs.rmSync(path.join(repository, '.git', 'test-profiles', 'rhajaina'), { recursive: true });
  assert.throws(
    () => preflight(releaseOptions(repository, { commit })),
    /required profile is missing or unreadable: rhajaina/
  );
});

test('preflight rejects tracked dirt and permits only the documented untracked exception', () => {
  const repository = createRepository();
  const commit = git(repository, 'rev-parse', 'HEAD');
  write(repository, DOCUMENTED_UNTRACKED_EXCEPTION, 'not AP17\n');

  assert.throws(
    () => preflight(releaseOptions(repository, { commit })),
    /working tree is not clean/
  );
  assert.equal(
    preflight(
      releaseOptions(repository, {
        commit,
        allowUntracked: [DOCUMENTED_UNTRACKED_EXCEPTION],
      })
    ).ok,
    true
  );
  assert.throws(
    () =>
      preflight(
        releaseOptions(repository, {
          commit,
          allowUntracked: ['separate-ap18.md'],
        })
      ),
    /untracked exception is not allowed/
  );

  write(repository, 'hitl-cockpit/server.js', "'use strict';\n// dirty\n");
  assert.throws(
    () =>
      preflight(
        releaseOptions(repository, {
          commit,
          allowUntracked: [DOCUMENTED_UNTRACKED_EXCEPTION],
        })
      ),
    /working tree is not clean/
  );
});

test('preflight rejects unsafe flags, unsafe database overlap and unknown runtime fields', () => {
  const repository = createRepository();
  const commit = git(repository, 'rev-parse', 'HEAD');

  assert.throws(
    () =>
      preflight(
        releaseOptions(repository, {
          commit,
          runtimeConfig: runtimeConfig({
            flags: { ...runtimeConfig().flags, managementCockpitWriteEnabled: true },
          }),
        })
      ),
    /write flag must remain false/
  );
  assert.throws(
    () =>
      preflight(
        releaseOptions(repository, {
          commit,
          runtimeConfig: runtimeConfig({
            databasePaths: {
              management: '/srv/hermes/kanban/boards/management.db',
              assistant: '/srv/agentos/assistant.db',
              kanbanRoot: '/srv/hermes/kanban/boards',
            },
          }),
        })
      ),
    /must not be inside kanbanRoot/
  );
  assert.throws(
    () =>
      preflight(
        releaseOptions(repository, {
          commit,
          runtimeConfig: runtimeConfig({
            releaseNote: 'sk-abcdefghijklmnopqrstuvwxyz123456',
          }),
        })
      ),
    /unknown runtime config field/
  );
  assert.throws(
    () =>
      preflight(
        releaseOptions(repository, {
          commit,
          runtimeConfig: runtimeConfig({ harmlessNote: 'looks harmless' }),
        })
      ),
    /unknown runtime config field/
  );
  assert.throws(
    () =>
      preflight(
        releaseOptions(repository, {
          commit,
          runtimeConfig: runtimeConfig({
            flags: { ...runtimeConfig().flags, harmlessFlag: false },
          }),
        })
      ),
    /unknown runtime config field/
  );
});

test('build is deterministic from commit plus runtime config and excludes workspace dirt', () => {
  const repository = createRepository();
  const commit = git(repository, 'rev-parse', 'HEAD');
  write(repository, DOCUMENTED_UNTRACKED_EXCEPTION, 'must not enter release\n');
  const first = temporaryDirectory('cockpit-release-a-');
  const second = temporaryDirectory('cockpit-release-b-');
  const options = releaseOptions(repository, {
    commit,
    allowUntracked: [DOCUMENTED_UNTRACKED_EXCEPTION],
  });

  buildRelease({ ...options, output: first });
  buildRelease({ ...options, output: second });

  assert.deepEqual(hashTree(first), hashTree(second));
  assert.equal(fs.existsSync(path.join(first, 'runtime', 'test')), false);
  assert.equal(fs.existsSync(path.join(first, 'runtime', DOCUMENTED_UNTRACKED_EXCEPTION)), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(first, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.version, '0.2.0');
  assert.ok(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));

  write(repository, 'hitl-cockpit/public/opaque.bin', Buffer.from([0x41, 0x00, 0xff, 0x42]));
  git(repository, 'add', 'hitl-cockpit/public/opaque.bin');
  git(repository, 'commit', '-qm', 'add binary fixture');
  const binaryCommit = git(repository, 'rev-parse', 'HEAD');

  assert.throws(
    () =>
      buildRelease({
        ...releaseOptions(repository),
        commit: binaryCommit,
        allowUntracked: [DOCUMENTED_UNTRACKED_EXCEPTION],
        output: temporaryDirectory('cockpit-release-nul-'),
      }),
    /NUL or binary content in release file public\/opaque.bin/
  );
});

test('last-known-good rollback dry-run restores only verified cockpit code and never Kanban', () => {
  const repository = createRepository();
  const commit = git(repository, 'rev-parse', 'HEAD');
  const release = temporaryDirectory('cockpit-release-');
  const lkg = path.join(temporaryDirectory('cockpit-lkg-parent-'), 'last-known-good');
  const target = path.join(temporaryDirectory('cockpit-rollback-parent-'), 'restored');

  buildRelease({ ...releaseOptions(repository), commit, output: release });
  promoteLastKnownGood({ artifact: release, target: lkg });
  const report = rollbackDryRun({ lastKnownGood: lkg, target });

  assert.equal(report.verified, true);
  assert.equal(report.kanbanRestorePerformed, false);
  assert.equal(report.commit, commit);
  assert.equal(fs.existsSync(path.join(target, 'runtime', 'server.js')), true);
  assert.equal(fs.existsSync(path.join(target, 'kanban')), false);
  assert.equal(fs.existsSync(path.join(target, 'rollback-dry-run-report.json')), false);
  assert.deepEqual(verifyArtifact(target), verifyArtifact(lkg));
  const persistedReport = JSON.parse(fs.readFileSync(`${target}-report.json`, 'utf8'));
  assert.deepEqual(persistedReport, report);
  assert.deepEqual(hashTree(path.join(target, 'runtime')), hashTree(path.join(lkg, 'runtime')));
});

test('artifact verification rejects symbolic links even when their content matches the manifest', () => {
  const repository = createRepository();
  const commit = git(repository, 'rev-parse', 'HEAD');
  const release = temporaryDirectory('cockpit-release-');
  const external = path.join(temporaryDirectory('cockpit-external-'), 'server.js');

  buildRelease({ ...releaseOptions(repository), commit, output: release });
  const server = path.join(release, 'runtime', 'server.js');
  fs.copyFileSync(server, external);
  fs.rmSync(server);
  fs.symlinkSync(external, server);

  assert.throws(
    () => verifyArtifact(release),
    /release artifact contains unsupported filesystem entry: runtime\/server\.js/
  );
});
