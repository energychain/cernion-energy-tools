'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { Errors } = require('moleculer');
const { principal, visible, deny } = require('./domain-router-policy');
const { writeCapability, documentNamespace } = require('./tenant-document-policy');
const { normalizePhrase } = require('./function-resolver');
const { documentSections } = require('./workbench-document');
const { chunkText } = require('./knowledge-rag-chunker');
const queues = new Map();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const idParam = { type: 'string', min: 1, max: 256 };

function scoped(ctx) {
  const p = principal(ctx);
  return {
    p,
    ctx: Object.assign(Object.create(ctx), {
      meta: { ...ctx.meta, tenantId: p.tenantId, documentKnowledgeWrite: writeCapability },
    }),
  };
}
async function serial(tenantId, work) {
  const prior = queues.get(tenantId) || Promise.resolve();
  const job = prior.catch(() => {}).then(work);
  queues.set(tenantId, job);
  try {
    return await job;
  } finally {
    if (queues.get(tenantId) === job) queues.delete(tenantId);
  }
}
async function withDocumentSource(ctx, id, work) {
  const { p, ctx: safe } = scoped(ctx);
  return serial(p.tenantId, async () => {
    const row = (
      await safe.call(
        'object-store.get',
        { namespace: documentNamespace(p.tenantId), key: id },
        { meta: safe.meta }
      )
    ).payload;
    if (row.status !== 'active' || !visible(p, row)) deny('Document not accessible');
    if (!(await require('./project-dataset-catalog').visibleProjectDatasets(ctx, [row])).length)
      deny('Document not accessible');
    return work();
  });
}
async function* recordPages(service, ctx, p, selector = {}) {
  for (let skip = 0; ; skip += 1000) {
    const page = await service.objectQuery(
      ctx,
      documentNamespace(p.tenantId),
      selector,
      1000,
      skip
    );
    yield await require('./project-dataset-catalog').visibleProjectDatasets(
      ctx,
      page.docs.map((doc) => doc.payload)
    );
    if (page.docs.length < 1000) return;
  }
}
async function records(service, ctx, p, selector = {}, metadataOnly = false) {
  const rows = [];
  for await (const page of recordPages(service, ctx, p, selector))
    rows.push(...page.map((row) => (metadataOnly ? publicRecord(row) : row)));
  return rows;
}
function publicRecord(row) {
  const { text: _text, audit: _audit, ...rest } = row;
  return rest;
}
function sourceText(row, location = '') {
  return `${row.title}, Version ${row.version}${location ? `, ${location}` : ''}; eingebracht von ${row.person.name}${row.person.functionLabel ? ` (${row.person.functionLabel})` : ''} am ${row.at.slice(0, 10)}${row.standDate ? `, Stand ${row.standDate}` : ''}`;
}
function sections(row) {
  let ordinal = 0;
  return documentSections(row.text, 4000).flatMap((section) =>
    (section.locations || [section]).flatMap((span) =>
      chunkText(row.text.slice(span.start, span.end), { mode: 'paragraph' }).map((text) => ({
        text,
        location: `${
          row.sourceLocation
            ? Object.entries(row.sourceLocation)
                .map(([key, value]) => `${key} ${value}`)
                .join(', ') + ', '
            : ''
        }${span.chapter}${span.page ? `, Seite ${span.page}` : ''}, Abschnitt ${++ordinal}`,
        start: span.start,
      }))
    )
  );
}

async function removeIndex(service, ctx, row) {
  for (;;) {
    const page = await service.objectQuery(
      ctx,
      service.getChunkNamespace(ctx),
      { 'payload.metadata.workbenchDocument': row.id },
      1000,
      0
    );
    for (const chunk of page.docs)
      await service.objectDelete(ctx, service.getChunkNamespace(ctx), chunk.key);
    if (page.docs.length < 1000) break;
  }
}
async function indexDocument(service, ctx, row) {
  try {
    service.ensureEmbeddingCapability();
    const collection = await service.getCollectionRecord(
      ctx,
      service.resolveTenantCollection(ctx),
      { createIfMissing: true }
    );
    await removeIndex(service, ctx, row);
    const parts = sections(row);
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      await service.persistDocumentChunks(ctx, collection, {
        id: `${row.id}-${index}`,
        text: part.text,
        title: row.title,
        version: row.version,
        metadata: {
          workbenchDocument: row.id,
          documentId: row.documentId,
          documentTitle: row.title,
          documentName: row.name,
          version: row.version,
          location: part.location,
          provenance: row.person,
          sensitivityFlags: row.sensitivityFlags,
          sourceTitle: sourceText(row, part.location),
          ...(row.provenance
            ? {
                provenance: row.provenance,
                projectId: row.provenance.projectId,
                objectId: row.provenance.objectId,
              }
            : {}),
        },
      });
    }
    row.indexState = 'indexed';
    delete row.indexError;
  } catch (error) {
    // The durable source stays searchable without vectors; repeated upload retries indexing.
    await removeIndex(service, ctx, row);
    row.indexState = 'pending';
    row.indexError = error.type || error.name;
  }
  await service.objectPut(ctx, documentNamespace(row.tenantId), row.id, row);
}
function scheduleIndex(service, ctx, row) {
  service.documentIndexJobs ||= new Set();
  const job = serial(row.tenantId, async () => {
    const current = (
      await ctx.call(
        'object-store.get',
        { namespace: documentNamespace(row.tenantId), key: row.id },
        { meta: ctx.meta }
      )
    ).payload;
    if (current.status === 'active' && current.indexState !== 'indexed')
      await indexDocument(service, ctx, current);
  })
    .catch((error) =>
      service.logger.warn('Document indexing pending', {
        errorClass: error.type || error.name,
      })
    )
    .finally(() => service.documentIndexJobs.delete(job));
  service.documentIndexJobs.add(job);
}
async function invalidateFacts(ctx, p, row, status) {
  const memory = require('./tenant-memory-store');
  const facts = await memory.query(ctx, p, {
    'payload.type': 'tenant_memory_fact',
    'payload.documentSource.id': row.id,
  });
  for (const fact of facts)
    await memory.mutate(ctx, p, fact.id, (value) => ({
      ...value,
      status,
      ...(status === 'deleted'
        ? {
            text: '',
            basis: '',
            anchors: [],
            anchorKeys: [],
            checkingEvidence: [],
            plausibility: [],
          }
        : {}),
      audit: [
        ...value.audit.map((entry) =>
          status === 'deleted' ? { ...entry, basis: undefined } : entry
        ),
        { kind: status, actorId: p.actorId, at: new Date().toISOString(), documentId: row.id },
      ],
    }));
}
async function ingestDocument(service, ctx, input) {
  const { p, ctx: safe } = scoped(ctx);
  if (
    input.provenance &&
    ctx.meta.projectStructure !== require('./project-structure-policy').capability
  )
    deny('Use project structure');
  if (!input.text.trim())
    throw new Errors.MoleculerClientError(
      'Das Dokument hat keinen lesbaren Text. Bitte aktiviere OCR in Open WebUI und lade es erneut hoch.',
      422,
      'DOCUMENT_TEXT_MISSING'
    );
  if (input.text.length > Number(process.env.WORKBENCH_DOCUMENT_MAX_CHARS || 4000000))
    throw new Errors.MoleculerClientError(
      'Das Dokument überschreitet die Aufnahmegrenze.',
      413,
      'DOCUMENT_LIMIT'
    );
  const sensitivityFlags = [...new Set(input.sensitivityFlags || [])];
  if (!visible(p, { tenantId: p.tenantId, sensitivityFlags }))
    deny('Sensitivity clearance required');
  return serial(p.tenantId, async () => {
    const rows = await records(
      service,
      safe,
      p,
      input.provenance
        ? {
            'payload.name': input.name,
            'payload.provenance.projectId': input.provenance.projectId,
            'payload.provenance.objectId': input.provenance.objectId,
          }
        : {}
    );
    const sha = hash(input.text);
    const family = rows.filter(
      (row) =>
        normalizePhrase(row.name) === normalizePhrase(input.name) &&
        row.provenance?.projectId === input.provenance?.projectId &&
        row.provenance?.objectId === input.provenance?.objectId
    );
    const documentId = family[0]?.documentId || `doc-${randomUUID()}`;
    // A same-name inaccessible source must not reveal itself or be superseded.
    if (family.some((row) => !visible(p, row))) deny('Document not accessible');
    // A replacement cannot silently downgrade the family's confidentiality.
    for (const old of family)
      for (const flag of old.sensitivityFlags || [])
        if (!sensitivityFlags.includes(flag)) sensitivityFlags.push(flag);
    const duplicate = rows.find(
      (row) =>
        visible(p, row) &&
        row.hash === sha &&
        row.provenance?.projectId === input.provenance?.projectId &&
        row.provenance?.objectId === input.provenance?.objectId &&
        JSON.stringify(row.sourceLocation) === JSON.stringify(input.sourceLocation) &&
        (row.sensitivityFlags || []).length === sensitivityFlags.length &&
        (row.sensitivityFlags || []).every((flag) => sensitivityFlags.includes(flag)) &&
        !['deleted', 'deleting', 'obsolete'].includes(row.status)
    );
    if (duplicate) {
      const refs = [
        ...new Set(
          [...(duplicate.refs || []), ...(input.refs || [])].map((ref) => JSON.stringify(ref))
        ),
      ].map((ref) => JSON.parse(ref));
      if (JSON.stringify(refs) !== JSON.stringify(duplicate.refs || [])) {
        duplicate.refs = refs;
        await service.objectPut(safe, documentNamespace(p.tenantId), duplicate.id, duplicate);
      }
      if (!duplicate.provenance?.projectId) {
        const descriptor = await require('./tenant-evidence-descriptor').ensureDescriptor(
          'document',
          duplicate,
          { broker: service.broker, logger: service.logger }
        );
        if (descriptor !== duplicate.evidenceDescriptor) {
          duplicate.evidenceDescriptor = descriptor;
          await service.objectPut(safe, documentNamespace(p.tenantId), duplicate.id, duplicate);
        }
      }
      if (duplicate.status === 'active' && duplicate.indexState !== 'indexed') {
        if (input.deferIndex) scheduleIndex(service, safe, duplicate);
        else await indexDocument(service, safe, duplicate);
      }
      return { ...publicRecord(duplicate), duplicate: true };
    }
    const version = Math.max(0, ...family.map((row) => row.version)) + 1;
    const at = new Date().toISOString();
    const row = {
      id: `${documentId}-v${version}`,
      documentId,
      type: 'tenant_document',
      tenantId: p.tenantId,
      name: input.name,
      title: input.title || input.name,
      ...(input.provenance
        ? { provenance: input.provenance, sourceLocation: input.sourceLocation }
        : {}),
      hash: sha,
      version,
      status: 'active',
      text: input.text,
      standDate:
        input.standDate ||
        input.text
          .slice(0, 4000)
          .match(/(?:^|\n)\s*Stand\s*:\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})/i)?.[1] ||
        '',
      at,
      sensitivityFlags,
      person: {
        actorId: p.actorId,
        name: input.personName || p.actorId,
        functionLabel: input.functionLabel || '',
      },
      refs: input.refs || [],
      indexState: 'pending',
      extractionState: 'pending',
      audit: [{ kind: 'stored', actorId: p.actorId, at }],
    };
    if (!row.provenance?.projectId)
      row.evidenceDescriptor = await require('./tenant-evidence-descriptor').ensureDescriptor(
        'document',
        row,
        { broker: service.broker, logger: service.logger }
      );
    await service.objectPut(safe, documentNamespace(p.tenantId), row.id, row);
    for (const old of family.filter((item) => item.status === 'active')) {
      old.status = 'superseded';
      old.audit.push({ kind: 'superseded', actorId: p.actorId, at, replacement: row.id });
      await service.objectPut(safe, documentNamespace(p.tenantId), old.id, old);
      await invalidateFacts(safe, p, old, 'corrected');
    }
    if (input.deferIndex) scheduleIndex(service, safe, row);
    else await indexDocument(service, safe, row);
    return { ...publicRecord(row), duplicate: false };
  });
}
async function searchDocuments(service, ctx, input = {}) {
  const { p, ctx: safe } = scoped(ctx);
  const wanted = [...new Set(normalizePhrase(input.query || '').match(/[\p{L}\p{N}]{3,}/gu) || [])];
  let results = [];
  for await (const page of recordPages(service, safe, p)) {
    for (const row of page.filter((row) => visible(p, row) && row.status === 'active')) {
      const hits = sections(row)
        .map((part) => ({
          row,
          part,
          score: wanted.filter((term) => normalizePhrase(`${row.name} ${part.text}`).includes(term))
            .length,
        }))
        .filter((entry) => !wanted.length || entry.score > 0);
      results = [...results, ...hits]
        .sort((a, b) => b.score - a.score || b.row.at.localeCompare(a.row.at))
        .slice(0, input.limit || 5);
    }
  }
  return results.map(({ row, part }) => ({
    source: 'tenant-documents',
    retrievalSource: 'tenant-documents',
    value: part.text,
    metadata: {
      workbenchDocument: row.id,
      sourceId: row.documentId,
      sectionId: part.location,
      documentTitle: sourceText(row, part.location),
      documentName: row.name,
      location: part.location,
      version: row.version,
      ...(row.provenance
        ? {
            provenance: row.provenance,
            projectId: row.provenance.projectId,
            objectId: row.provenance.objectId,
          }
        : {}),
    },
  }));
}
async function correctDocument(service, ctx, input) {
  const { p, ctx: safe } = scoped(ctx);
  return serial(p.tenantId, async () => {
    const row = (
      await safe.call(
        'object-store.get',
        { namespace: documentNamespace(p.tenantId), key: input.id },
        { meta: safe.meta }
      )
    ).payload;
    if (!visible(p, row)) deny('Document not accessible');
    const deleting = input.kind === 'delete';
    if (row.status === 'deleted') return { id: row.id, status: row.status };
    row.status = deleting ? 'deleting' : 'obsolete';
    row.audit.push({ kind: input.kind, actorId: p.actorId, at: new Date().toISOString() });
    // Hide first; failed cleanup is resumable and cannot expose obsolete evidence.
    await service.objectPut(safe, documentNamespace(p.tenantId), row.id, row);
    await removeIndex(service, safe, row);
    await invalidateFacts(safe, p, row, deleting ? 'deleted' : 'revoked');
    if (deleting) {
      row.status = 'deleted';
      row.text = '';
      row.refs = [];
      await service.objectPut(safe, documentNamespace(p.tenantId), row.id, row);
    }
    return { id: row.id, status: row.status };
  });
}
async function visibleChunks(service, ctx, chunks) {
  if (!chunks.some((row) => row.metadata?.workbenchDocument)) return chunks;
  let scope;
  try {
    scope = scoped(ctx);
  } catch (_error) {
    return chunks.filter((row) => !row.metadata?.workbenchDocument);
  }
  const rows = await records(service, scope.ctx, scope.p, {}, true);
  const permitted = new Set(
    rows.filter((row) => row.status === 'active' && visible(scope.p, row)).map((row) => row.id)
  );
  return chunks.filter(
    (row) => !row.metadata?.workbenchDocument || permitted.has(row.metadata.workbenchDocument)
  );
}
const mixin = {
  async stopped() {
    await Promise.allSettled([...(this.documentIndexJobs || [])]);
  },
  actions: {
    documentEvidenceCandidates: {
      visibility: 'protected',
      params: { question: { type: 'string', optional: true, max: 32000 } },
      async handler(ctx) {
        const { p, ctx: safe } = scoped(ctx);
        const descriptor = require('./tenant-evidence-descriptor');
        return serial(p.tenantId, async () => {
          const rows = await records(this, safe, p);
          const result = [];
          for (const row of rows.filter(
            (item) => item.status === 'active' && !item.provenance?.projectId && visible(p, item)
          )) {
            if ((await require('./tenant-evidence-read').chatEvidenceOrigin(ctx, row)).inaccessible)
              continue;
            if (descriptor.needsDescriptor('document', row, ctx.params.question, p.actorId)) {
              row.evidenceDescriptor = await descriptor.ensureDescriptor('document', row, {
                broker: this.broker,
                logger: this.logger,
              });
              await this.objectPut(safe, documentNamespace(p.tenantId), row.id, row);
            }
            result.push(descriptor.evidenceCandidate('document', row, p.actorId));
          }
          return result;
        });
      },
    },
    documentEvidenceCorrect: {
      visibility: 'protected',
      params: {
        correction: 'object',
        tenantId: 'string',
        actorId: 'string',
        correctionId: 'string',
        at: 'string',
        sequence: { type: 'number', integer: true, min: 0, optional: true },
      },
      async handler(ctx) {
        require('./shared-service-learning').correctionPrincipal(ctx.params, ctx.meta);
        const descriptor = require('./tenant-evidence-descriptor');
        const correction = descriptor.validateEvidenceCorrection(ctx.params.correction);
        if (correction.sourceType !== 'document') deny('Wrong evidence source');
        const { p, ctx: safe } = scoped(ctx);
        return serial(p.tenantId, async () => {
          const rows = await records(this, safe, p);
          const row = rows.find(
            (item) =>
              item.id === correction.sourceId &&
              item.status === 'active' &&
              !item.provenance?.projectId &&
              visible(p, item)
          );
          if (
            !row ||
            (await require('./tenant-evidence-read').chatEvidenceOrigin(ctx, row)).inaccessible
          )
            deny('Evidence not accessible');
          await this.objectPut(
            safe,
            documentNamespace(p.tenantId),
            row.id,
            descriptor.correctedEvidence(row, ctx.params)
          );
          return { corrected: true };
        });
      },
    },
    documentIngest: {
      visibility: 'protected',
      params: {
        name: idParam,
        text: { type: 'string', max: 4000000 },
        sensitivityFlags: { type: 'array', items: 'string', optional: true },
        personName: { type: 'string', optional: true },
        functionLabel: { type: 'string', optional: true },
        standDate: { type: 'string', optional: true },
        deferIndex: { type: 'boolean', optional: true },
        refs: { type: 'array', items: 'object', optional: true },
        provenance: { type: 'object', optional: true },
        sourceLocation: { type: 'object', optional: true },
        title: { type: 'string', optional: true },
      },
      handler(ctx) {
        return ingestDocument(this, ctx, ctx.params);
      },
    },
    documentExtractionState: {
      visibility: 'protected',
      params: { id: idParam, state: { type: 'enum', values: ['pending', 'complete'] } },
      async handler(ctx) {
        const { p, ctx: safe } = scoped(ctx);
        return serial(p.tenantId, async () => {
          const row = (
            await safe.call(
              'object-store.get',
              { namespace: documentNamespace(p.tenantId), key: ctx.params.id },
              { meta: safe.meta }
            )
          ).payload;
          if (!visible(p, row) || row.status !== 'active') deny('Document not accessible');
          row.extractionState = ctx.params.state;
          await this.objectPut(safe, documentNamespace(p.tenantId), row.id, row);
          return publicRecord(row);
        });
      },
    },
    documentSearch: {
      visibility: 'protected',
      params: {
        query: { type: 'string', optional: true, max: 32000 },
        limit: { type: 'number', min: 1, max: 20, optional: true },
      },
      handler(ctx) {
        return searchDocuments(this, ctx, ctx.params);
      },
    },
    documentList: {
      visibility: 'protected',
      params: {
        query: { type: 'string', optional: true },
        includeDeleting: { type: 'boolean', optional: true, default: false },
      },
      async handler(ctx) {
        const { p, ctx: safe } = scoped(ctx);
        if (
          ctx.params.includeDeleting &&
          ctx.meta.projectFileOriginals !== require('./project-file-policy').fileCapability
        )
          deny('Use project deletion');
        return (await records(this, safe, p, {}, !ctx.params.query))
          .filter(
            (row) =>
              visible(p, row) &&
              row.status !== 'deleted' &&
              (row.status !== 'deleting' || ctx.params.includeDeleting) &&
              (!ctx.params.query ||
                normalizePhrase(row.name + ' ' + row.text).includes(
                  normalizePhrase(ctx.params.query)
                ))
          )
          .map(publicRecord);
      },
    },
    documentGet: {
      visibility: 'protected',
      params: { id: idParam },
      async handler(ctx) {
        const { p, ctx: safe } = scoped(ctx);
        const row = (
          await safe.call(
            'object-store.get',
            { namespace: documentNamespace(p.tenantId), key: ctx.params.id },
            { meta: safe.meta }
          )
        ).payload;
        if (!visible(p, row) || ['deleted', 'deleting'].includes(row.status))
          deny('Document not accessible');
        if (!(await require('./project-dataset-catalog').visibleProjectDatasets(ctx, [row])).length)
          deny('Document not accessible');
        return row;
      },
    },
    documentCorrect: {
      visibility: 'protected',
      params: { id: idParam, kind: { type: 'enum', values: ['delete', 'obsolete'] } },
      handler(ctx) {
        return correctDocument(this, ctx, ctx.params);
      },
    },
  },
};
module.exports = { mixin, visibleChunks, sourceText, sections, scoped, withDocumentSource };
