'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { structureHarness } = require('./project-structure');
const { ProjectDatasetPool } = require('../../src/project-dataset-pool');

async function runLargeStructure(
  directory,
  rows = Number(process.env.CET_PROJECT_LARGE_ROWS || 1000000)
) {
  process.env.SQLITE_TMPDIR = directory;
  assert(Number.isSafeInteger(rows) && rows > 0);
  const filename = path.join(directory, 'generated.csv');
  const output = fs.createWriteStream(filename);
  const hash = createHash('sha256');
  const write = async (text) => {
    hash.update(text);
    if (!output.write(text)) await once(output, 'drain');
  };
  await write('Moment,Amount\n');
  for (let offset = 0; offset < rows; offset += 1000) {
    const lines = [];
    for (let index = offset; index < Math.min(rows, offset + 1000); index++)
      lines.push(`${new Date(Date.UTC(2000, 0, 1) + index * 900000).toISOString()},${index + 1}\n`);
    await write(lines.join(''));
  }
  output.end();
  await once(output, 'finish');
  const size = fs.statSync(filename).size;
  const h = await structureHarness(directory);
  const baseline = process.memoryUsage();
  let rssPeak = baseline.rss,
    heapPeak = baseline.heapUsed,
    maxBatchRows = 0;
  const sample = () => {
    const memory = process.memoryUsage();
    rssPeak = Math.max(rssPeak, memory.rss);
    heapPeak = Math.max(heapPeak, memory.heapUsed);
  };
  const originalAppend = ProjectDatasetPool.prototype.appendRows;
  ProjectDatasetPool.prototype.appendRows = function (...args) {
    maxBatchRows = Math.max(maxBatchRows, args[1].length);
    sample();
    const result = originalAppend.apply(this, args);
    sample();
    return result;
  };
  const timer = setInterval(sample, 20);
  const startedAt = Date.now();
  try {
    const projectId = await h.create();
    const started = await h.call('project-upload.start', {
      projectId,
      name: 'generated.csv',
      size,
      hash: hash.digest('hex'),
    });
    const file = await fs.promises.open(filename, 'r');
    try {
      const buffer = Buffer.alloc(started.chunkSize);
      for (let offset = 0, index = 0; offset < size; offset += started.chunkSize, index++) {
        const length = Math.min(started.chunkSize, size - offset);
        assert.equal((await file.read(buffer, 0, length, offset)).bytesRead, length);
        const bytes = buffer.subarray(0, length);
        await h.call('project-upload.chunk', {
          uploadId: started.uploadId,
          index,
          hash: createHash('sha256').update(bytes).digest('hex'),
          bytes,
        });
        sample();
      }
    } finally {
      await file.close();
    }
    const job = await h.complete(started.uploadId);
    assert.equal(job.status, 'completed', JSON.stringify(job.error));
    const objects = await h.call('project-upload.objects', { projectId });
    assert.equal(objects[0].extraction.status, 'extracted', objects[0].extraction.reason);
    const records = await h.call('datapoint.datasetCatalog', { operation: 'list' });
    assert.equal(records.length, 1);
    assert.equal(records[0].rowCount, rows);
    const answer = await h.call('dataset.query', { id: records[0].id, question: 'Summe Amount' });
    sample();
    assert.equal(answer.result[0].sum_Amount, (rows * (rows + 1)) / 2);
    assert(rssPeak - baseline.rss < 256 * 1024 ** 2, 'RSS exceeds fixed +256 MiB budget');
    assert(heapPeak - baseline.heapUsed < 128 * 1024 ** 2, 'Heap exceeds fixed +128 MiB budget');
    assert(maxBatchRows <= Number(process.env.CET_PROJECT_DATASET_BATCH_ROWS || 1000));
    await h.call('project-file.delete', { projectId });
    return {
      rows,
      bytes: size,
      sum: answer.result[0].sum_Amount,
      maxBatchRows,
      durationMs: Date.now() - startedAt,
      rssBaseline: baseline.rss,
      rssPeak,
      rssDelta: rssPeak - baseline.rss,
      heapBaseline: baseline.heapUsed,
      heapPeak,
      heapDelta: heapPeak - baseline.heapUsed,
    };
  } finally {
    clearInterval(timer);
    ProjectDatasetPool.prototype.appendRows = originalAppend;
    await h.broker.stop();
  }
}

module.exports = { runLargeStructure };
