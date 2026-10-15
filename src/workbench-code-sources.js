'use strict';

const { exactToken } = require('./workbench-codes');
const sourceCatalog = require('./workbench-knowledge-sources.json');

function citedSource(source, code) {
  const excerpt = String(
    source.excerpt || source.value || source.summary || source.content || source.text || ''
  );
  const title = source.title || source.documentTitle || source.metadata?.title;
  const section = source.sectionId || source.section || source.metadata?.sectionId;
  const url = source.url || source.metadata?.url;
  const family = code.family || code.tag;
  return title &&
    (section || url) &&
    require('./edifact-message-adapter').exactCodeToken(excerpt, code.value) &&
    (!family || exactToken(excerpt, family))
    ? { title, sectionId: section || '', url: url || '', excerpt }
    : null;
}

async function resolveReferencedCodes(ctx, references, access) {
  const adapter = require('./edifact-message-adapter');
  const results = [];
  for (const reference of references.slice(0, 20)) {
    const code = { ...reference, tag: reference.family };
    const resolved = await adapter.resolve(
      {
        ...ctx,
        meta: {
          ...ctx.meta,
          workbenchEvidenceAccess: access,
        },
      },
      [code]
    );
    const sources = (resolved[0]?.sources || [])
      .map((source) => citedSource(source, code))
      .filter(Boolean)
      .map((source) => ({ ...source, source: 'willi-mako' }));
    const trace = [];
    for (const id of ['knowledge-rag', 'knowledge-rag-federated']) {
      const started = performance.now();
      let status = 'skipped',
        found = [];
      if (access[id] !== false) {
        try {
          const adapters = require('./personal-agent-knowledge-rag');
          const query =
            id === 'knowledge-rag'
              ? adapters.queryKnowledgeEvidence
              : adapters.queryFederatedEvidence;
          const result = await query(ctx, {
            query: `${reference.family} ${reference.value}`,
            limit: 5,
            summaryMaxChars: 1200,
            timeoutMs: sourceCatalog.sources.find((item) => item.id === id).timeoutMs,
          });
          found = (result.hits || []).map((source) => citedSource(source, code)).filter(Boolean);
          status = found.length ? 'available' : 'empty';
        } catch {
          status = 'unavailable';
        }
      }
      sources.push(...found.map((source) => ({ ...source, source: id })));
      trace.push({
        source: id,
        status,
        hitCount: found.length,
        called: status !== 'skipped',
        ms: Math.round(performance.now() - started),
      });
    }
    results.push({
      ...reference,
      kind: reference.family,
      status: sources.length ? 'resolved' : 'unresolved',
      sources,
      trace,
    });
  }
  return results;
}

function codeAnswer(resolutions) {
  return resolutions
    .map((code) =>
      code.sources?.length
        ? code.sources
            .map(
              (source) =>
                `Code ${code.value}: ${source.excerpt}\nFundstelle: ${source.title} · ${source.sectionId || source.url}`
            )
            .join('\n\n')
        : `Bedeutung von ${code.value} nicht belegt. Zur Klärung wird eine auffindbare, gültige Quelle mit Code-Familie und Fundstelle benötigt.`
    )
    .join('\n\n');
}

module.exports = { citedSource, resolveReferencedCodes, codeAnswer };
