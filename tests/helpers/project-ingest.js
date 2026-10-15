'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { crc32, deflateRawSync } = require('node:zlib');
const { ServiceBroker } = require('moleculer');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const auth = (tenantId = 'tenant-a', clearance = [], actorId = 'actor-a') => ({
  apiToken: { id: actorId, tenantId, roles: ['ROLE_ALPHA'], sensitivityFlags: clearance },
});

async function harness(dir, settings = {}) {
  const broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 0 });
  const store = broker.createService({
    ...require('../../services/object-store.service'),
    settings: { dbPath: path.join(dir, 'objects') },
  });
  broker.createService(require('../../services/project-file.service'));
  const upload = broker.createService({
    ...require('../../services/project-upload.service'),
    settings: { dataPath: path.join(dir, 'originals'), ...settings },
  });
  await broker.start();
  const call = (action, params, meta = auth(), options = {}) =>
    broker.call(action, params, { ...options, meta: structuredClone(meta) });
  const create = async (meta = auth()) =>
    (await call('project-file.create', { title: 'Synthetic bundle' }, meta)).projectId;
  const start = (projectId, bytes, extra = {}, meta = auth()) =>
    call(
      'project-upload.start',
      {
        projectId,
        name: 'synthetic.txt',
        size: bytes.length,
        hash: hash(bytes),
        ...extra,
      },
      meta
    );
  const send = async (started, bytes, meta = auth()) => {
    for (const index of started.missing) {
      const chunk = bytes.subarray(index * started.chunkSize, (index + 1) * started.chunkSize);
      await call(
        'project-upload.chunk',
        { uploadId: started.uploadId, index, hash: hash(chunk), bytes: chunk },
        meta
      );
    }
  };
  const complete = async (uploadId, meta = auth()) => {
    const job = await call('project-upload.complete', { uploadId }, meta);
    if (!job.jobId) return job;
    const deadline = Date.now() + 120000;
    const jobs = require('../../src/job-store');
    while (Date.now() < deadline) {
      const state = jobs.getJob(job.jobId);
      if (['completed', 'error'].includes(state.status)) return state;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Project ingest job timed out');
  };
  return { broker, store, upload, call, create, start, send, complete };
}

// Generates small adversarial/valid archives; large fixtures are generated incrementally.
function zip(items, { zip64 = false } = {}) {
  const local = [],
    central = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name),
      bytes = item.bytes || Buffer.from('synthetic');
    const method = item.method ?? 8,
      flags = item.flags || 0;
    const compressed = method === 8 ? deflateRawSync(bytes) : bytes;
    const header = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc32(bytes), 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(item.expanded ?? bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(item.attributes || 0, 38);
    directory.writeUInt32LE(offset, 42);
    const extra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(1);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(item.expanded ?? bytes.length), 4);
      extra.writeBigUInt64LE(BigInt(compressed.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
      directory.writeUInt32LE(0xffffffff, 20);
      directory.writeUInt32LE(0xffffffff, 24);
      directory.writeUInt32LE(0xffffffff, 42);
      directory.writeUInt16LE(extra.length, 30);
    }
    local.push(header, name, compressed);
    central.push(directory, name, extra);
    offset += header.length + name.length + compressed.length;
  }
  const c = Buffer.concat(central),
    end = Buffer.alloc(22),
    records = [];
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(c.length, 12);
  end.writeUInt32LE(offset, 16);
  if (zip64) {
    const record = Buffer.alloc(56),
      locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(items.length), 24);
    record.writeBigUInt64LE(BigInt(items.length), 32);
    record.writeBigUInt64LE(BigInt(c.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50);
    locator.writeBigUInt64LE(BigInt(offset + c.length), 8);
    locator.writeUInt32LE(1, 16);
    end.writeUInt16LE(0xffff, 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffffffff, 12);
    end.writeUInt32LE(0xffffffff, 16);
    records.push(record, locator);
  }
  return Buffer.concat([...local, c, ...records, end]);
}

module.exports = { harness, hash, auth, zip };
