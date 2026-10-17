'use strict';

const { createHash } = require('node:crypto');
const { principal, deny } = require('./domain-router-policy');
const { canViewEvidence, assertSensitivityAllowed } = require('./workbench-evidence');
const { buildOEMetadata } = require('./oemetadata-builder');

function catalogPrefix(tenantId) {
  return `dataset:${createHash('sha256').update(tenantId).digest('hex')}:`;
}

function visibleDataset(doc, p) {
  return (
    canViewEvidence(doc, p.clearance, p.tenantId) &&
    (doc.requiredClearance || []).every((level) =>
      canViewEvidence({ ...doc, sensitivityLevel: level }, p.clearance, p.tenantId)
    )
  );
}

// Stored in the existing datapoint DB, outside the public dp: namespace.
// Thus legacy datapoint listing/export endpoints cannot expose tenant records.
const datasetCatalogActions = {
  datasetCatalog: {
    visibility: 'protected',
    params: {
      operation: { type: 'enum', values: ['list', 'deleted', 'put', 'remove'] },
      record: { type: 'object', optional: true },
      id: { type: 'string', optional: true },
    },
    async handler(ctx) {
      const p = principal(ctx),
        prefix = catalogPrefix(p.tenantId);
      if (ctx.params.operation === 'deleted') {
        const auditPrefix = `dataset-audit:${createHash('sha256').update(p.tenantId).digest('hex')}:`;
        const { rows } = await this.db.allDocs({
          startkey: auditPrefix,
          endkey: `${auditPrefix}\uffff`,
          include_docs: true,
        });
        return rows
          .map((row) => row.doc)
          .filter((doc) => doc.hash && !doc.projectId && visibleDataset(doc, p))
          .map((doc) => ({ hash: doc.hash, id: doc.datasetId }));
      }
      if (ctx.params.operation === 'list') {
        const { rows } = await this.db.allDocs({
          startkey: prefix,
          endkey: `${prefix}\uffff`,
          include_docs: true,
        });
        const records = rows
          .map((row) => row.doc)
          .filter((doc) => visibleDataset(doc, p))
          .map((doc) => doc.data.value);
        return require('./project-dataset-catalog').visibleProjectDatasets(ctx, records);
      }
      return require('./dataset-evidence').mutateEvidence(this, p.tenantId, async () => {
        const input = ctx.params.record;
        const id = ctx.params.id || input?.id;
        if (!/^ds_[a-f0-9]{32}$/.test(id || '')) deny('Invalid dataset ID');
        let previous;
        try {
          previous = await this.db.get(`${prefix}${id}`);
        } catch (error) {
          if (error.status !== 404) throw error;
        }
        if (previous && !visibleDataset(previous, p)) deny('Dataset not accessible');
        if (ctx.params.operation === 'remove') {
          if (previous) {
            await this.db.put({
              _id: `dataset-audit:${createHash('sha256').update(p.tenantId).digest('hex')}:${Date.now()}:${id}`,
              type: 'dataset_audit',
              tenantId: p.tenantId,
              datasetId: id,
              kind: 'deleted',
              hash: previous.provenanceHash,
              ...(previous.data.value.provenance?.projectId
                ? { projectId: previous.data.value.provenance.projectId }
                : {}),
              sensitivityLevel: previous.sensitivityLevel,
              requiredClearance: previous.requiredClearance || [],
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
        for (const level of input.requiredClearance || [])
          assertSensitivityAllowed(level, p.clearance);
        if (previous?.data?.value?.evidenceCorrections || input.evidenceCorrections)
          input.evidenceCorrections =
            require('./tenant-evidence-descriptor').mergeEvidenceCorrections(
              previous?.data?.value?.evidenceCorrections,
              input.evidenceCorrections
            );
        if (!input.provenance?.projectId)
          input.evidenceDescriptor = require('./tenant-evidence-background').availableDescriptor(
            'dataset',
            input,
            previous?.data?.value
          );
        const doc = {
          _id: `${prefix}${id}`,
          ...(previous ? { _rev: previous._rev } : {}),
          tenantId: p.tenantId,
          sensitivityLevel: input.sensitivityLevel,
          requiredClearance: input.requiredClearance || [],
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
        const sourceHash = input.hash;
        const catalogId = doc._id;
        if (!input.provenance?.projectId)
          require('./tenant-evidence-background').scheduleDescriptor(
            this,
            'dataset',
            input,
            async (enriched) =>
              require('./dataset-evidence').mutateEvidence(this, p.tenantId, async () => {
                let current;
                try {
                  current = await this.db.get(catalogId);
                } catch (error) {
                  if (error.status === 404) return;
                  throw error;
                }
                const value = current.data.value;
                if (
                  value.hash !== sourceHash ||
                  value.evidenceDescriptor?.fingerprint !== enriched.fingerprint
                )
                  return;
                // CAS retains newer quality, metadata and correction writes; a conflict leaves the minimum.
                value.evidenceDescriptor = enriched;
                if (value.oemetadata?._cernion?.dataset)
                  value.oemetadata._cernion.dataset.evidenceDescriptor = enriched;
                await this.db.put(current);
              })
          );
        return { stored: true };
      });
    },
  },
};

module.exports = { datasetCatalogActions, catalogPrefix };
