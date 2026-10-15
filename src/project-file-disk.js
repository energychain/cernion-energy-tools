'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { ingestError, setting } = require('./project-file-ingest-policy');

function segment(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value))
    ingestError('Invalid storage identity');
  const encoded = `id-${encodeURIComponent(value)}`;
  if (Buffer.byteLength(encoded) > 240) ingestError('Storage identity too long');
  return encoded;
}

async function safeDirectory(base, ...parts) {
  const root = path.resolve(base);
  // Reject symlinks in the configured path and every managed descendant.
  let current = path.parse(root).root;
  for (const part of [...root.slice(current.length).split(path.sep).filter(Boolean), ...parts]) {
    current = path.join(current, part);
    await fsp.mkdir(current, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (!(await fsp.lstat(current)).isDirectory()) ingestError('Unsafe storage directory');
  }
  return current;
}

async function projectDirectory(base, tenantId, projectId) {
  return safeDirectory(base, segment(tenantId), segment(projectId));
}

async function diskSpace(directory, required) {
  const stats = await fsp.statfs(directory, { bigint: true });
  const reserve = BigInt(setting('MIN_FREE_BYTES', 64 * 1024 ** 2));
  if (stats.bavail * stats.bsize < BigInt(required) + reserve)
    ingestError('Insufficient project storage space', 507, 'PROJECT_DISK_FULL');
}

async function regularFile(filename) {
  const stat = await fsp.lstat(filename);
  if (!stat.isFile()) ingestError('Unsafe storage file');
  return stat;
}

async function writeChunk(directory, source, expected, expectedHash) {
  await diskSpace(directory, expected);
  const temp = path.join(directory, `pending-${randomUUID()}`);
  const hash = createHash('sha256');
  let size = 0;
  const byteCounter = new Transform({
    transform(bytes, _encoding, cb) {
      size += bytes.length;
      if (size > expected) return cb(Object.assign(new Error('Chunk too large'), { code: 413 }));
      hash.update(bytes);
      cb(null, bytes);
    },
  });
  try {
    await pipeline(source, byteCounter, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    const actual = hash.digest('hex');
    if (size !== expected || actual !== expectedHash)
      ingestError('Chunk size or SHA-256 mismatch', 422, 'PROJECT_HASH_MISMATCH');
    const target = path.join(directory, actual);
    try {
      await fsp.link(temp, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if ((await regularFile(target)).size !== size) ingestError('Corrupt stored chunk');
    }
    return { hash: actual, size };
  } finally {
    await fsp.rm(temp, { force: true });
  }
}

async function* objectBytes(directory, chunks) {
  for (const chunk of chunks) {
    const filename = path.join(directory, chunk.hash);
    if ((await regularFile(filename)).size !== chunk.size)
      ingestError('Stored chunk size mismatch');
    const hash = createHash('sha256');
    for await (const bytes of fs.createReadStream(filename)) {
      hash.update(bytes);
      yield bytes;
    }
    if (hash.digest('hex') !== chunk.hash)
      ingestError('Stored chunk hash mismatch', 422, 'PROJECT_HASH_MISMATCH');
  }
}

async function verifyObject(directory, object, progress) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const bytes of objectBytes(directory, object.chunks)) {
    size += bytes.length;
    hash.update(bytes);
    await progress(size);
  }
  if (size !== object.size || hash.digest('hex') !== object.hash)
    ingestError('Object SHA-256 or total size mismatch', 422, 'PROJECT_HASH_MISMATCH');
}

// A bounded writable spool is needed only for random-access archive inspection/scanners.
async function spoolObject(directory, object) {
  await diskSpace(directory, object.size);
  const filename = path.join(directory, `pending-${randomUUID()}`);
  try {
    await pipeline(
      objectBytes(directory, object.chunks),
      fs.createWriteStream(filename, {
        flags: 'wx',
        mode: 0o600,
      })
    );
    return filename;
  } catch (error) {
    await fsp.rm(filename, { force: true });
    throw error;
  }
}

module.exports = {
  segment,
  safeDirectory,
  projectDirectory,
  diskSpace,
  regularFile,
  writeChunk,
  objectBytes,
  verifyObject,
  spoolObject,
};
