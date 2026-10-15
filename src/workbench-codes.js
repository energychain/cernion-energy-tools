'use strict';
const defaults = require('./workbench-code-catalog.json');
const sourceDefaults = require('./workbench-knowledge-sources.json');

function captureCodes(message, catalog = defaults) {
  const found = new Map();
  for (const type of catalog.types) {
    for (const match of String(message || '').matchAll(new RegExp(type.pattern, 'g'))) {
      found.set(`${type.kind}:${match[1]}`, { kind: type.kind, value: match[1] });
    }
  }
  return [...found.values()].slice(0, 20);
}

function exactToken(text, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${escaped}(?=$|[^\p{L}\p{N}])`, 'u').test(text);
}

async function resolveCodes(
  ctx,
  situation,
  access,
  catalog = defaults,
  sourceCatalog = sourceDefaults
) {
  const referenced = await require('./workbench-code-sources').resolveReferencedCodes(
    ctx,
    situation.codeReferences || [],
    access
  );
  const evidence = [],
    resolutions = [],
    trace = [];
  // Current-turn schema classification supersedes retained identifier tags.
  // Legacy callers without the contract keep the established adapter path.
  const identifiers = Object.hasOwn(situation, 'codeReferences') ? [] : situation.identifiers || [];
  await Promise.all(
    identifiers.map(async (code) => {
      const type = catalog.types.find((entry) => entry.kind === code.kind);
      if (!type) return;
      const started = performance.now();
      let sources = [];
      let status = 'unresolved';
      const budget = sourceCatalog.sources.find((source) => source.id === type.source)?.timeoutMs;
      const permitted = access[type.source] !== false && Number.isFinite(budget) && budget > 0;
      if (permitted) {
        try {
          const result = await ctx.call(
            type.action,
            {
              ...type.params,
              query: type.query.replace('{value}', code.value),
            },
            { meta: ctx.meta, timeout: budget }
          );
          sources = result?.success === false ? [] : result?.data?.sources || [];
        } catch {
          status = 'unavailable';
        }
      }
      const exact = sources.filter((source) =>
        exactToken(String(source.excerpt || ''), code.value)
      );
      for (const source of exact)
        evidence.push({
          source: type.source,
          retrievalSource: type.source,
          title: source.title,
          value: source.excerpt,
          metadata: { sectionId: source.sectionId },
        });
      let sourceStatus = 'empty';
      if (!permitted) sourceStatus = 'skipped';
      else if (exact.length) sourceStatus = 'available';
      else if (status === 'unavailable') sourceStatus = 'unavailable';
      trace.push({
        source: type.source,
        status: sourceStatus,
        hitCount: exact.length,
        ms: Math.round(performance.now() - started),
        called: permitted,
      });
      resolutions.push({ ...code, status: exact.length ? 'resolved' : status });
    })
  );
  resolutions.sort(
    (a, b) =>
      identifiers.findIndex((code) => code.kind === a.kind && code.value === a.value) -
      identifiers.findIndex((code) => code.kind === b.kind && code.value === b.value)
  );
  for (const code of referenced) {
    const index = resolutions.findIndex((entry) => entry.value === code.value);
    if (index >= 0) resolutions[index] = code;
    else resolutions.push(code);
    trace.push(...code.trace);
    for (const source of code.sources)
      evidence.push({
        source: source.source,
        retrievalSource: source.source,
        title: source.title,
        value: source.excerpt,
        metadata: { sectionId: source.sectionId, url: source.url },
      });
  }
  return { evidence, resolutions, trace };
}

function unresolvedQuestions(resolutions, preferences = {}) {
  return resolutions
    .filter((entry) => entry.status !== 'resolved')
    .map((entry) => ({
      key: `code:${entry.kind}:${entry.value}`,
      question: `Code ${entry.value} kann ich nicht sicher zuordnen – was steht in ${preferences?.register === 'Sie' ? 'Ihrer' : 'eurer'} Antwortnachricht dazu?`,
      blocking: false,
    }));
}
module.exports = { captureCodes, resolveCodes, unresolvedQuestions, exactToken };
