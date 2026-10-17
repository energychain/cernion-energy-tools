'use strict';

const { principal } = require('./domain-router-policy');

async function readChatEvidence(ctx, selected, question) {
  const p = principal(ctx);
  const evidence = [],
    gaps = [];
  let quantityFields = [];
  try {
    let row, value, location, origin;
    if (selected.sourceType === 'dataset') {
      const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
      const scoped = require('./workbench-data-scope').scopedDatasets(records, question, {
        tenantEvidenceIds: [selected.sourceId],
      });
      row = scoped.find(
        (item) =>
          item.id === selected.sourceId &&
          item.current !== false &&
          !item.provenance?.projectId &&
          !item.quality?.unusable
      );
      if (!row || row.tenantId !== p.tenantId || row.hash !== selected.provenance.hash)
        throw new Error('Evidence changed');
      origin = await chatEvidenceOrigin(ctx, row);
      assertSelection(row, selected, p, origin);
      const result = await ctx.call('dataset.query', {
        id: row.id,
        question,
        conversationId: ctx.params?.conversationId,
      });
      if (
        ['unavailable', 'unusable'].includes(result.status) ||
        !result.datasetId ||
        result.rowCount === 0
      )
        throw new Error('Evidence unavailable');
      value = result.responseText;
      quantityFields = (row.columns || [])
        .filter(
          (column) =>
            column.type === 'number' &&
            !column.sensitive &&
            result.unitFields?.includes(column.name)
        )
        .map((column) => ({ name: column.name, unit: row.semantic?.units?.[column.name] || '' }));
      location = row.sheet ? `Blatt ${row.sheet}` : 'Tabelle';
    } else {
      row = await ctx.call('knowledge-rag.documentGet', { id: selected.sourceId });
      if (
        row.tenantId !== p.tenantId ||
        row.status !== 'active' ||
        row.hash !== selected.provenance.hash
      )
        throw new Error('Evidence changed');
      origin = await chatEvidenceOrigin(ctx, row);
      assertSelection(row, selected, p, origin);
      const parts = require('./tenant-document-knowledge').sections(row);
      const { normalizePhrase } = require('./function-resolver');
      const terms = [...new Set(normalizePhrase(question).match(/[\p{L}\p{N}]{3,}/gu) || [])];
      const chosen = parts
        .map((part) => ({
          ...part,
          score: terms.filter((term) => normalizePhrase(part.text).includes(term)).length,
        }))
        .sort((a, b) => b.score - a.score || a.start - b.start)
        .slice(0, 4);
      value = chosen.map((part) => `${part.text}\nFundstelle: ${part.location}`).join('\n\n');
      location = chosen.map((part) => part.location).join('; ');
    }
    if (!String(value || '').trim()) throw new Error('Empty evidence');
    const filename = row.sourceName || row.name;
    const label = `${filename}${row.sheet ? `, ${row.sheet}` : ''}`;
    evidence.push({
      source: selected.sourceType === 'dataset' ? 'dataset.query' : 'knowledge-rag.documentGet',
      value: `${value}\nDatei: ${filename}; Fundstelle: ${location}; Hash: ${row.hash}${origin.displayRef ? `; Fall ${origin.displayRef}` : ''}.`,
      metadata: {
        tenantId: p.tenantId,
        evidenceQuality: 'validated',
        sourceType: selected.sourceType,
        sourceId: row.id,
        datasetId: selected.sourceType === 'dataset' ? row.id : undefined,
        workbenchDocument: selected.sourceType === 'document' ? row.id : undefined,
        filename,
        sourceLabel: label,
        location,
        hash: row.hash,
        version: row.version,
        quantityFields,
        ...origin,
      },
    });
  } catch (_error) {
    gaps.push(`Für „${selected.title}“ ist kein aktueller autorisierter Lesezugriff verfügbar.`);
  }
  return { evidence, gaps, trace: [], title: selected.title };
}

function assertSelection(row, selected, p, origin) {
  if (
    origin.inaccessible ||
    require('./tenant-evidence-descriptor').descriptorInput(selected.sourceType, row)
      .fingerprint !== selected.descriptorFingerprint ||
    (row.evidenceCorrections || []).some(
      (correction) => correction.actorId === p.actorId && correction.kind === 'reject'
    )
  )
    throw new Error('Evidence selection changed');
}

async function chatEvidenceOrigin(ctx, row) {
  const p = principal(ctx);
  const workbench = ctx.broker?.getLocalService?.('workbench');
  if (!workbench?.store) return {};
  const refs = [...(row.refs || []), ...(row.provenance ? [row.provenance] : [])];
  let origin = { conversationId: refs.find((ref) => ref.conversationId)?.conversationId };
  for (const ref of refs) {
    try {
      let caseIds = ref.caseId ? [ref.caseId] : [];
      if (!caseIds.length && ref.conversationId) {
        if (ref.channel) {
          const conversation = await workbench.store.resolveConversation(
            { tenantId: p.tenantId, client: ref.channel, conversationId: ref.conversationId },
            { optional: true }
          );
          caseIds = [conversation?.cetCaseId].filter(Boolean);
        } else {
          // Older records did not retain the client; resolve only this tenant's conversation refs.
          const prefix = `conversation:${encodeURIComponent(p.tenantId)}:`;
          const page = await workbench.store.conversationsDb.allDocs({
            startkey: prefix,
            endkey: `${prefix}\uffff`,
            include_docs: true,
          });
          caseIds = page.rows
            .map(({ doc }) => doc)
            .filter((doc) => doc.conversationId === ref.conversationId)
            .map((doc) => doc.cetCaseId)
            .filter(Boolean);
        }
      }
      for (const caseId of new Set(caseIds)) {
        const state = await workbench.loadVisibleCase(ctx, p, caseId);
        if (state.disposition === 'discarded') continue;
        const displayRef = await workbench.store.caseDisplayRef({ tenantId: p.tenantId, caseId });
        if (!origin.caseId) origin = { caseId, displayRef, conversationId: ref.conversationId };
      }
    } catch (_error) {
      return { inaccessible: true };
    }
  }
  return origin;
}
module.exports = { readChatEvidence, chatEvidenceOrigin };
