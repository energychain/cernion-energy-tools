'use strict';

const { createHash } = require('node:crypto');
const { principal, deny } = require('./domain-router-policy');
const { canViewEvidence, assertSensitivityAllowed } = require('./workbench-evidence');
const { buildOEMetadata } = require('./oemetadata-builder');

function catalogPrefix(tenantId) {
  return `dataset:${createHash('sha256').update(tenantId).digest('hex')}:`;
}

// Stored in the existing datapoint DB, outside the public dp: namespace.
// Thus legacy datapoint listing/export endpoints cannot expose tenant records.
const datasetCatalogActions = {
  datasetCatalog: {
    visibility: 'protected',
    params: {
      operation: { type: 'enum', values: ['list', 'put', 'remove'] },
      record: { type: 'object', optional: true },
      id: { type: 'string', optional: true },
    },
    async handler(ctx) {
      const p = principal(ctx),
        prefix = catalogPrefix(p.tenantId);
      if (ctx.params.operation === 'list') {
        const { rows } = await this.db.allDocs({
          startkey: prefix,
          endkey: `${prefix}\uffff`,
          include_docs: true,
        });
        return rows
          .map((row) => row.doc)
          .filter((doc) => canViewEvidence(doc, p.clearance, p.tenantId))
          .map((doc) => doc.data.value);
      }
      const input = ctx.params.record;
      const id = ctx.params.id || input?.id;
      if (!/^ds_[a-f0-9]{32}$/.test(id || '')) deny('Invalid dataset ID');
      let previous;
      try {
        previous = await this.db.get(`${prefix}${id}`);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (previous && !canViewEvidence(previous, p.clearance, p.tenantId))
        deny('Dataset not accessible');
      if (ctx.params.operation === 'remove') {
        if (previous) {
          await this.db.put({
            _id: `dataset-audit:${createHash('sha256').update(p.tenantId).digest('hex')}:${Date.now()}:${id}`,
            type: 'dataset_audit',
            tenantId: p.tenantId,
            datasetId: id,
            kind: 'deleted',
            actorId: p.actorId,
            at: new Date().toISOString(),
          });
          await this.db.remove(previous);
          await this.db.compact();
        }
        return { removed: Boolean(previous) };
      }
      if (input.tenantId !== p.tenantId) deny('Tenant mismatch');
      assertSensitivityAllowed(input.sensitivityLevel, p.clearance);
      const doc = {
        _id: `${prefix}${id}`,
        ...(previous ? { _rev: previous._rev } : {}),
        tenantId: p.tenantId,
        sensitivityLevel: input.sensitivityLevel,
        name: id,
        description: input.title,
        owner: input.provenance.person,
        sourceType: 'user-dataset',
        tags: ['dataset', 'Nutzerangabe'],
        createdAt: input.provenance.at,
        fieldProfiles: input.columns,
        lastRun: { timestamp: input.provenance.at, summary: { rowCount: input.rowCount } },
        provenanceHash: input.hash,
        data: { value: input },
      };
      const { oemetadata: _oldMetadata, ...value } = input;
      const metadata = buildOEMetadata(doc);
      metadata._cernion.dataset = { ...value, audit: undefined };
      doc.data.value = { ...value, oemetadata: metadata };
      await this.db.put(doc);
      return { stored: true };
    },
  },
};

module.exports = { datasetCatalogActions, catalogPrefix };
