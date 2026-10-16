'use strict';

const path = require('node:path');
const { harness } = require('./project-ingest');

async function structureHarness(dir, { enabled = true } = {}) {
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'chat');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  return harness(dir, {}, async (broker) => {
    broker.createService({
      ...require('../../services/datapoint.service'),
      settings: { dbPath: path.join(dir, 'datapoints') },
    });
    broker.createService(require('../../services/dataset.service'));
    broker.createService(require('../../services/knowledge-rag.service'));
    if (enabled) broker.createService(require('../../services/project-structure.service'));
  });
}

async function addObject(h, projectId, bytes, name, meta) {
  const started = await h.start(projectId, bytes, { name }, meta);
  await h.send(started, bytes, meta);
  const job = await h.complete(started.uploadId, meta);
  if (job.status === 'error') throw new Error(JSON.stringify(job.error));
  return (await h.call('project-upload.objects', { projectId }, meta)).find(
    (object) => object.objectId === started.objectId
  );
}

module.exports = { structureHarness, addObject };
