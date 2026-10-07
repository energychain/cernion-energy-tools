'use strict';
const defaults = require('./workbench-code-catalog.json');

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
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

async function resolveCodes(ctx, situation, access, catalog = defaults) {
  const evidence = [],
    resolutions = [],
    trace = [];
  const identifiers = situation.identifiers || [];
  await Promise.all(
    identifiers.map(async (code) => {
      const type = catalog.types.find((entry) => entry.kind === code.kind);
      if (!type) return;
      const started = performance.now();
      let sources = [];
      let status = 'unresolved';
      if (access[type.source] !== false) {
        try {
          const result = await ctx.call(
            type.action,
            {
              ...type.params,
              query: type.query.replace('{value}', code.value),
            },
            { meta: ctx.meta, timeout: 4000 }
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
      trace.push({
        source: type.source,
        status:
          access[type.source] === false
            ? 'skipped'
            : exact.length
              ? 'available'
              : status === 'unavailable'
                ? 'unavailable'
                : 'empty',
        hitCount: exact.length,
        ms: Math.round(performance.now() - started),
        called: access[type.source] !== false,
      });
      resolutions.push({ ...code, status: exact.length ? 'resolved' : status });
    })
  );
  resolutions.sort(
    (a, b) =>
      identifiers.findIndex((code) => code.kind === a.kind && code.value === a.value) -
      identifiers.findIndex((code) => code.kind === b.kind && code.value === b.value)
  );
  return { evidence, resolutions, trace };
}

function unresolvedQuestions(resolutions) {
  return resolutions
    .filter((entry) => entry.status !== 'resolved')
    .map((entry) => ({
      key: `code:${entry.kind}:${entry.value}`,
      question: `Code ${entry.value} kann ich nicht sicher zuordnen – was steht in eurer Antwortnachricht dazu?`,
      blocking: true,
    }));
}
module.exports = { captureCodes, resolveCodes, unresolvedQuestions };
