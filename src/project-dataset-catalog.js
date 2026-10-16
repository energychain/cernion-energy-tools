'use strict';

const { fileCapability } = require('./project-file-policy');

async function visibleProjectDatasets(ctx, records) {
  if (!records.some((record) => record.provenance?.projectId)) return records;
  if (ctx.meta.projectFileOriginals === fileCapability) return records;
  const projects = await ctx.call('project-file.list', { routingOnly: true });
  return records.flatMap((record) => {
    if (!record.provenance?.projectId) return [record];
    const project = projects.find((entry) => entry.projectId === record.provenance.projectId);
    return project ? [{ ...record, projectActive: true, projectRefs: project.projectRefs }] : [];
  });
}

module.exports = { visibleProjectDatasets };
