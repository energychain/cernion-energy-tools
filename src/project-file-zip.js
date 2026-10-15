'use strict';

const fs = require('node:fs');
const { createInflateRaw } = require('node:zlib');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { assertArchiveEntry } = require('./archive-entry-policy');
const { ingestError } = require('./project-file-ingest-policy');

// CRC32 is checked while streaming, without retaining expanded entries.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

async function readAt(handle, size, position, fileSize) {
  if (!Number.isSafeInteger(position) || position < 0 || position + size > fileSize)
    ingestError('Invalid ZIP offset');
  const bytes = Buffer.alloc(size);
  if ((await handle.read(bytes, 0, size, position)).bytesRead !== size)
    ingestError('Truncated ZIP');
  return bytes;
}

function safe64(bytes, offset) {
  if (offset + 8 > bytes.length) ingestError('Truncated ZIP64 field');
  const n = bytes.readBigUInt64LE(offset);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) ingestError('ZIP64 field out of range');
  return Number(n);
}

function zip64Values(extra, fields) {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const tag = extra.readUInt16LE(offset),
      size = extra.readUInt16LE(offset + 2);
    if (offset + 4 + size > extra.length) ingestError('Invalid ZIP extra field');
    if (tag === 1) {
      let pos = offset + 4;
      for (const key of ['expanded', 'compressed', 'local']) {
        if (fields[key] === 0xffffffff) {
          if (pos + 8 > offset + 4 + size) ingestError('Missing ZIP64 field');
          fields[key] = safe64(extra, pos);
          pos += 8;
        }
      }
      return fields;
    }
    offset += 4 + size;
  }
  if (Object.values(fields).includes(0xffffffff)) ingestError('Missing ZIP64 extra');
  return fields;
}

async function zipDirectory(filename, limits) {
  const handle = await fs.promises.open(filename, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    const tail = await readAt(
      handle,
      Math.min(fileSize, 65557),
      Math.max(0, fileSize - 65557),
      fileSize
    );
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        end = i;
        break;
      }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6))
      ingestError('Invalid or multi-disk ZIP');
    let count = tail.readUInt16LE(end + 10);
    let centralSize = tail.readUInt32LE(end + 12),
      offset = tail.readUInt32LE(end + 16);
    let centralEnd = fileSize - tail.length + end;
    if (count === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff) {
      const locator = await readAt(handle, 20, centralEnd - 20, fileSize);
      if (
        locator.readUInt32LE(0) !== 0x07064b50 ||
        locator.readUInt32LE(4) ||
        locator.readUInt32LE(16) !== 1
      )
        ingestError('Invalid ZIP64 locator');
      centralEnd = safe64(locator, 8);
      const record = await readAt(handle, 56, centralEnd, fileSize);
      if (
        record.readUInt32LE(0) !== 0x06064b50 ||
        record.readUInt32LE(16) ||
        record.readUInt32LE(20) ||
        safe64(record, 24) !== safe64(record, 32)
      )
        ingestError('Invalid ZIP64 directory');
      count = safe64(record, 32);
      centralSize = safe64(record, 40);
      offset = safe64(record, 48);
    } else if (tail.readUInt16LE(end + 8) !== count) ingestError('Split ZIP directory');
    if (count > limits.entries || offset + centralSize > centralEnd)
      ingestError('ZIP entry limit or invalid directory', 413);
    const directoryEnd = offset + centralSize;
    const entries = [],
      names = new Set();
    let total = 0;
    for (let index = 0; index < count; index++) {
      const header = await readAt(handle, 46, offset, directoryEnd);
      if (header.readUInt32LE(0) !== 0x02014b50 || header.readUInt16LE(34))
        ingestError('Invalid ZIP entry');
      const nameLength = header.readUInt16LE(28),
        extraLength = header.readUInt16LE(30);
      const variable = await readAt(handle, nameLength + extraLength, offset + 46, directoryEnd);
      const name = variable.subarray(0, nameLength).toString('utf8');
      const flags = header.readUInt16LE(8),
        method = header.readUInt16LE(10);
      assertArchiveEntry({ name, flags, method }, { depth: limits.depth });
      const mode = header.readUInt32LE(38) >>> 16;
      if ((mode & 0xf000) === 0xa000 || names.has(name)) ingestError('ZIP link or duplicate entry');
      names.add(name);
      const fields = zip64Values(variable.subarray(nameLength), {
        compressed: header.readUInt32LE(20),
        expanded: header.readUInt32LE(24),
        local: header.readUInt32LE(42),
      });
      total += fields.expanded;
      if (
        total > limits.budget ||
        fields.expanded > limits.fileBytes ||
        fields.expanded / Math.max(1, fields.compressed) > limits.ratio
      )
        ingestError('ZIP expansion budget or compression ratio exceeded', 413);
      const local = await readAt(handle, 30, fields.local, offset);
      if (
        local.readUInt32LE(0) !== 0x04034b50 ||
        local.readUInt16LE(6) !== flags ||
        local.readUInt16LE(8) !== method
      )
        ingestError('ZIP local header mismatch');
      const localName = await readAt(handle, local.readUInt16LE(26), fields.local + 30, offset);
      if (!localName.equals(variable.subarray(0, nameLength)))
        ingestError('ZIP entry name mismatch');
      const start = fields.local + 30 + localName.length + local.readUInt16LE(28);
      if (start + fields.compressed > offset) ingestError('Invalid ZIP compressed range');
      offset += 46 + nameLength + extraLength + header.readUInt16LE(32);
      if (offset > directoryEnd) ingestError('Invalid ZIP directory size');
      if (!name.endsWith('/'))
        entries.push({ name, ...fields, start, method, crc: header.readUInt32LE(16) });
      else if (fields.expanded) ingestError('Non-empty ZIP directory');
    }
    if (offset !== directoryEnd) ingestError('ZIP directory size mismatch');
    return entries;
  } finally {
    await handle.close();
  }
}

async function extractZipEntry(filename, entry, destination) {
  const source = entry.compressed
    ? fs.createReadStream(filename, { start: entry.start, end: entry.start + entry.compressed - 1 })
    : Readable.from([]);
  let size = 0,
    crc = 0xffffffff;
  const meter = new Transform({
    transform(bytes, _encoding, cb) {
      size += bytes.length;
      if (size > entry.expanded) return cb(new Error('ZIP expanded size exceeded'));
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      cb(null, bytes);
    },
    flush(cb) {
      cb(
        size !== entry.expanded || (crc ^ 0xffffffff) >>> 0 !== entry.crc
          ? new Error('ZIP size or CRC32 mismatch')
          : null
      );
    },
  });
  await pipeline(
    source,
    ...(entry.method === 8 ? [createInflateRaw()] : []),
    meter,
    fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
  );
}

module.exports = { zipDirectory, extractZipEntry };
