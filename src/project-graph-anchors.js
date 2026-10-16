'use strict';
const { normalizeAnchor } = require('./tenant-memory-store');

// Only observed, source-scoped candidate values survive each document read.
async function documentAnchors(ctx, documents, objects, candidates, limits) {
  const report = {
    documents: documents.length,
    retained: 0,
    chars: 0,
    skipped: 0,
    truncatedDocuments: 0,
    truncated: false,
  };
  const versions = new Map(objects.map((object) => [object.objectId, object.derivation.version]));
  const byObject = new Map();
  for (const candidate of candidates) {
    if (versions.get(candidate.object_id) !== candidate.version) continue;
    const location = JSON.parse(candidate.location);
    if (location.column) continue;
    const value = normalizeAnchor(candidate.value);
    if (value.length < 4 || !/[a-z]/i.test(value)) continue;
    const group = byObject.get(candidate.object_id) || [];
    group.push({ value, location });
    byObject.set(candidate.object_id, group);
  }
  for (const document of documents) {
    // The full response and normalized text remain local to this iteration.
    const full = await ctx.call('knowledge-rag.documentGet', { id: document.id });
    const text = ` ${normalizeAnchor(full.text)} `;
    const values = new Set();
    const seen = new Set();
    let chars = 0,
      truncated = false;
    for (const { value, location } of byObject.get(document.provenance.objectId) || []) {
      if (
        seen.has(value) ||
        !['page', 'slide', 'chapter'].every(
          (key) => !location[key] || document.sourceLocation?.[key] === location[key]
        ) ||
        !text.includes(` ${value} `)
      )
        continue;
      seen.add(value);
      if (
        values.size >= limits.documentAnchors ||
        chars + value.length > limits.documentAnchorChars ||
        report.retained >= limits.runAnchors ||
        report.chars + value.length > limits.runAnchorChars
      ) {
        report.skipped++;
        truncated = true;
        continue;
      }
      values.add(value);
      chars += value.length;
      report.retained++;
      report.chars += value.length;
    }
    document.anchors = [...values];
    if (truncated) report.truncatedDocuments++;
  }
  report.truncated = report.truncatedDocuments > 0;
  return report;
}
module.exports = { documentAnchors };
