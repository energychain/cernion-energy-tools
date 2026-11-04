'use strict';

// Release traceability: the running build names its package version and the commit it was
// deployed from. CET_BUILD_COMMIT wins (container builds); otherwise the checkout's git metadata
// is read once without spawning git; an immutable release directory named after its commit counts
// as well. Nothing here is secret: the repository is public.
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const SHA = /^[0-9a-f]{40}$/u;
let cached;

function gitDir(root) {
  const entry = path.join(root, '.git');
  const stat = fs.statSync(entry, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isDirectory()) return entry;
  // A worktree checkout keeps "gitdir: <path>" in a .git file.
  const pointer = fs
    .readFileSync(entry, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('gitdir:'));
  return pointer ? path.resolve(root, pointer.slice('gitdir:'.length).trim()) : null;
}

function refCommit(dir, ref) {
  const loose = path.join(dir, ref);
  if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
  // Shared refs of a worktree live in the common directory.
  const common = fs.existsSync(path.join(dir, 'commondir'))
    ? path.resolve(dir, fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim())
    : dir;
  const sharedLoose = path.join(common, ref);
  if (fs.existsSync(sharedLoose)) return fs.readFileSync(sharedLoose, 'utf8').trim();
  const packed = path.join(common, 'packed-refs');
  if (!fs.existsSync(packed)) return '';
  const line = fs
    .readFileSync(packed, 'utf8')
    .split('\n')
    .find((entry) => entry.endsWith(` ${ref}`));
  return line ? line.split(' ')[0] : '';
}

function gitCommit(root) {
  try {
    const dir = gitDir(root);
    if (!dir) return '';
    const head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
    const commit = head.startsWith('ref: ') ? refCommit(dir, head.slice(5).trim()) : head;
    return SHA.test(commit) ? commit : '';
  } catch (error) {
    // Unreadable git metadata only means the commit is unknown; it never blocks a start.
    process.emitWarning(`Build commit unknown: ${error.code || error.message}`);
    return '';
  }
}

function buildInfo({ root = ROOT, env = process.env } = {}) {
  if (cached && root === ROOT && env === process.env) return cached;
  const configured = String(env.CET_BUILD_COMMIT || '')
    .trim()
    .toLowerCase();
  // An immutable release directory carries no git metadata but is named after its commit.
  const releaseDir = path.basename(root).toLowerCase();
  let commit = gitCommit(root) || (SHA.test(releaseDir) ? releaseDir : '');
  if (/^[0-9a-f]{7,40}$/u.test(configured)) commit = configured;
  const info = Object.freeze({
    version,
    commit: commit.slice(0, 12) || 'unknown',
    fingerprint: `cet-${version}-${commit.slice(0, 12) || 'unknown'}`,
  });
  if (root === ROOT && env === process.env) cached = info;
  return info;
}

module.exports = { buildInfo };
