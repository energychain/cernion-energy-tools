'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { crc32 } = require('node:zlib');
const { harness, auth, hash } = require('./project-ingest');

// Stored ZIP with three generated formats, no in-memory archive or checked-in fixture.
// The comment makes the archive itself >= requestedBytes while keeping archive+entries
// within the 2 GiB project budget when requestedBytes is 1 GiB.
async function generateBundle(filename, requestedBytes) {
  const handle = await fs.promises.open(filename, 'wx');
  const central = [],
    names = ['generated.txt', 'generated.csv', 'generated.pdf'];
  let offset = 0;
  const payloadSize = requestedBytes - 3000;
  try {
    for (let index = 0; index < names.length; index++) {
      const size =
        Math.floor(payloadSize / names.length) + (index === 0 ? payloadSize % names.length : 0);
      const name = Buffer.from(names[index]),
        local = Buffer.alloc(30),
        directory = Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50);
      local.writeUInt16LE(20, 4);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26);
      const localOffset = offset;
      await handle.write(local, 0, local.length, offset);
      offset += local.length;
      await handle.write(name, 0, name.length, offset);
      offset += name.length;
      let crc = 0;
      const buffer = Buffer.alloc(256 * 1024, 120);
      for (let done = 0; done < size;) {
        const n = Math.min(buffer.length, size - done);
        // Distinct blocks defeat accidental deduplication in the measured storage path.
        buffer.fill(120);
        buffer.write(
          index === 2 && done === 0
            ? '%PDF-1.4\n% synthetic\n'
            : `\nformat,${index},offset,${done}\n`
        );
        const bytes = buffer.subarray(0, n);
        crc = crc32(bytes, crc);
        await handle.write(bytes, 0, n, offset);
        offset += n;
        done += n;
      }
      local.writeUInt32LE(crc, 14);
      await handle.write(local, 0, local.length, localOffset);
      directory.writeUInt32LE(0x02014b50);
      directory.writeUInt16LE(20, 6);
      directory.writeUInt32LE(crc, 16);
      directory.writeUInt32LE(size, 20);
      directory.writeUInt32LE(size, 24);
      directory.writeUInt16LE(name.length, 28);
      directory.writeUInt32LE(localOffset, 42);
      central.push(directory, name);
    }
    const directory = Buffer.concat(central),
      end = Buffer.alloc(22),
      comment = Buffer.alloc(4096, 32);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(names.length, 8);
    end.writeUInt16LE(names.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(comment.length, 20);
    for (const bytes of [directory, end, comment]) {
      await handle.write(bytes, 0, bytes.length, offset);
      offset += bytes.length;
    }
    return offset;
  } finally {
    await handle.close();
  }
}

async function runLarge(
  dir,
  requestedBytes = Number(process.env.CET_PROJECT_LARGE_BYTES || 16 * 1024 ** 2)
) {
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 65536 || requestedBytes > 1024 ** 3)
    throw new Error('CET_PROJECT_LARGE_BYTES must be between 64 KiB and 1 GiB');
  const before = process.memoryUsage(),
    peak = { ...before };
  const sample = () => {
    const memory = process.memoryUsage();
    for (const key of ['rss', 'heapUsed']) peak[key] = Math.max(peak[key], memory[key]);
  };
  const timer = setInterval(sample, 20),
    startedAt = Date.now();
  let h;
  try {
    const filename = path.join(dir, 'synthetic-bundle.zip');
    const bytes = await generateBundle(filename, requestedBytes);
    const digest = createHash('sha256');
    for await (const part of fs.createReadStream(filename)) digest.update(part);
    h = await harness(dir);
    const projectId = await h.create();
    const started = await h.call('project-upload.start', {
      projectId,
      name: 'synthetic-bundle.zip',
      size: bytes,
      hash: digest.digest('hex'),
      mimeType: 'application/zip',
    });
    const handle = await fs.promises.open(filename, 'r');
    try {
      const buffer = Buffer.alloc(started.chunkSize);
      for (const index of started.missing) {
        const offset = index * started.chunkSize,
          n = Math.min(started.chunkSize, bytes - offset);
        const read = await handle.read(buffer, 0, n, offset);
        if (read.bytesRead !== n) throw new Error('Truncated generated input');
        const part = buffer.subarray(0, n);
        await h.call('project-upload.chunk', {
          uploadId: started.uploadId,
          index,
          hash: hash(part),
          bytes: part,
        });
        sample();
      }
    } finally {
      await handle.close();
    }
    const job = await h.complete(started.uploadId);
    if (job.status !== 'completed') throw new Error(`Large ingest failed: ${job.error}`);
    const objects = await h.call('project-upload.objects', { projectId });
    if (objects.length !== 4 || objects.some((o) => o.status !== 'received'))
      throw new Error('Mixed bundle incomplete');
    sample();
    const result = {
      archiveBytes: bytes,
      storedBytes: objects.reduce((sum, o) => sum + o.size, 0),
      objects: objects.length,
      chunkBytes: started.chunkSize,
      beforeRss: before.rss,
      peakRss: peak.rss,
      deltaRss: peak.rss - before.rss,
      beforeHeapUsed: before.heapUsed,
      peakHeapUsed: peak.heapUsed,
      deltaHeapUsed: peak.heapUsed - before.heapUsed,
      elapsedMs: Date.now() - startedAt,
    };
    // Fixed memory envelope, independent of archive length.
    if (result.deltaRss > 256 * 1024 ** 2 || result.deltaHeapUsed > 128 * 1024 ** 2)
      throw new Error(`Ingest memory envelope exceeded: ${JSON.stringify(result)}`);
    await h.call('project-file.delete', { projectId }, auth());
    return result;
  } finally {
    clearInterval(timer);
    if (h) await h.broker.stop();
  }
}

module.exports = { generateBundle, runLarge };
