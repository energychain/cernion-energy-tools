'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildInfo } = require('../src/build-info');
const { version } = require('../package.json');

const SHA = 'a'.repeat(8) + 'b'.repeat(32);

describe('build info (release traceability)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('reads a loose branch ref of the checkout', () => {
    fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(dir, '.git', 'refs', 'heads', 'main'), `${SHA}\n`);
    expect(buildInfo({ root: dir, env: {} })).toEqual({
      version,
      commit: SHA.slice(0, 12),
      fingerprint: `cet-${version}-${SHA.slice(0, 12)}`,
    });
  });

  test('follows a worktree pointer to packed refs in the common directory', () => {
    const common = path.join(dir, 'repo.git');
    const worktree = path.join(common, 'worktrees', 'w');
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(common, 'packed-refs'), `# pack-refs\n${SHA} refs/heads/feature\n`);
    fs.writeFileSync(path.join(worktree, 'HEAD'), 'ref: refs/heads/feature\n');
    fs.writeFileSync(path.join(worktree, 'commondir'), '../..\n');
    const checkout = path.join(dir, 'checkout');
    fs.mkdirSync(checkout);
    fs.writeFileSync(path.join(checkout, '.git'), `gitdir: ${worktree}\n`);
    expect(buildInfo({ root: checkout, env: {} }).commit).toBe(SHA.slice(0, 12));
  });

  test('a configured commit wins; without metadata the commit is unknown', () => {
    expect(buildInfo({ root: dir, env: { CET_BUILD_COMMIT: 'ABCDEF1234567' } }).commit).toBe(
      'abcdef123456'
    );
    expect(buildInfo({ root: dir, env: { CET_BUILD_COMMIT: 'not a sha' } }).commit).toBe('unknown');
  });

  test('the running checkout reports a commit', () => {
    expect(buildInfo().fingerprint).toMatch(/^cet-\d+\.\d+\.\d+.*-([0-9a-f]{12}|unknown)$/u);
  });
});
