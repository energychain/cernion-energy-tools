'use strict';

const { normalizeEvidenceInput, hashContent, canViewEvidence } = require('./workbench-evidence');

function documentSections(text, chunkChars = 12000) {
  if (!Number.isInteger(chunkChars) || chunkChars < 256) throw new Error('Invalid section budget');
  const markers = [
    ...text.matchAll(
      /^(?:#{1,6}\s+.+|(?:Kapitel|Chapter|Seite|Page)\s+\d+[^\n]*|\d+(?:\.\d+)*[.)]\s+[^\n|]+)$/gim
    ),
  ];
  const markerByOffset = new Map(markers.map((marker) => [marker.index, marker]));
  const starts = [...new Set([0, ...markers.map((marker) => marker.index), text.length])];
  const sections = [];
  let chapter = 'Dokument';
  let page = null;
  for (let i = 0; i < starts.length - 1; i++) {
    const marker = markerByOffset.get(starts[i]);
    if (marker) {
      const pageMatch = marker[0].match(/^(?:Seite|Page)\s+(\d+)/i);
      if (pageMatch) page = Number(pageMatch[1]);
      else chapter = marker[0].trim();
    }
    for (let offset = starts[i]; offset < starts[i + 1]; offset += chunkChars) {
      sections.push({
        chapter,
        page,
        start: offset,
        end: Math.min(offset + chunkChars, starts[i + 1]),
      });
    }
  }
  // Pack contiguous spans without losing the original chapter/page boundaries.
  const packed = [];
  for (const section of sections) {
    let offset = section.start;
    while (offset < section.end) {
      let current = packed[packed.length - 1];
      if (!current || current.end - current.start === chunkChars) {
        current = { ...section, start: offset, end: offset, locations: [] };
        packed.push(current);
      }
      const end = Math.min(section.end, offset + chunkChars - (current.end - current.start));
      current.locations.push({ ...section, start: offset, end });
      current.end = end;
      offset = end;
    }
  }
  return packed;
}

async function attachDocuments(store, identity, documents, options = {}) {
  if (!identity.tenantId || !identity.caseId || !identity.actorId)
    throw new Error('Document identity required');
  const maxChars = Number(options.maxChars ?? process.env.WORKBENCH_DOCUMENT_MAX_CHARS ?? 1000000);
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) throw new Error('Invalid document budget');
  if (documents.reduce((sum, doc) => sum + String(doc.text || '').length, 0) > maxChars) {
    throw Object.assign(new Error('Document budget exceeded; send a smaller document'), {
      type: 'WORKBENCH_DOCUMENT_LIMIT',
    });
  }
  const prepared = documents.map((document) => {
    if (typeof document.text !== 'string' || !document.text.trim())
      throw new Error('Document text required');
    const hash = hashContent(document.text);
    const evidence = normalizeEvidenceInput(
      {
        evidenceType: 'generic_document',
        sourceType: 'openwebui_file_ref',
        label: document.name,
        fileHash: hash,
        sourceRef: {
          fileName: document.name,
          fileHash: hash,
          size: Buffer.byteLength(document.text),
        },
      },
      identity
    );
    // The existing evidence store owns persistence and tenant/case scoping.
    evidence.extracts.document = {
      name: document.name,
      sourceId: document.id || null,
      text: document.text,
      completeness: options.completeness || 'unknown',
      sections: documentSections(document.text, options.chunkChars),
    };
    return evidence;
  });
  const saved = [];
  for (const evidence of prepared)
    saved.push(await store.saveEvidence({ ...evidence, ...identity }));
  return saved;
}

async function loadDocuments(store, identity) {
  if (!identity.tenantId || !identity.caseId) throw new Error('Document scope required');
  return (await store.listEvidence(identity))
    .filter(
      (entry) =>
        canViewEvidence(entry, identity.clearance, identity.tenantId) && entry.extracts?.document
    )
    .map((entry) => ({
      ...entry.extracts.document,
      evidenceId: entry.evidenceId,
      hash: entry.fileHash,
    }));
}

module.exports = { documentSections, attachDocuments, loadDocuments };
