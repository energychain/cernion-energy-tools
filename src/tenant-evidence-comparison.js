'use strict';

const { answerNumbers } = require('./project-manifest-numbers');
const { normalizePhrase } = require('./function-resolver');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const fieldName = (field) => field.replace(/\([^)]*\)|\[[^\]]*\]/gu, ' ').trim();
const fieldPattern = (name) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${escape(fieldName(name))}(?![\\p{L}\\p{N}_])`, 'giu');

function sourceQuantities(entry, field, fields) {
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])([-+]?(?:\\d{1,3}(?:[\\s'’.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)(?:[eE][-+]?\\d+)?)\\s*${escape(field.unit)}(?![\\p{L}\\p{N}_])`,
    'gu'
  );
  const text = String(entry.value)
    .normalize('NFKC')
    .replace(/−/gu, '-')
    .split(/\n(?:Datei:|Herkunft:)/u)[0];
  let heading = '';
  const quantities = text.split(/\n/u).flatMap((line) => {
    if (/^#{1,6}\s/u.test(line)) {
      heading = line.replace(/^#+\s*/u, '');
      return [];
    }
    return line.split(/(?<=[.!?])\s+|;/u).flatMap((statement) => {
      const labels = [...statement.matchAll(fieldPattern(field.name))];
      const parts = labels.map((label) => {
        const rest = statement.slice(label.index + label[0].length);
        // Stop at another field. A value of another variable cannot prove this one.
        const next = fields
          .flatMap((other) => [...rest.matchAll(fieldPattern(other.name))])
          .map((match) => match.index);
        return rest.slice(0, next.length ? Math.min(...next) : rest.length);
      });
      if (
        !parts.length &&
        normalizePhrase(fieldName(heading)) === normalizePhrase(fieldName(field.name)) &&
        /^\s*[-+]?\d/u.test(statement)
      )
        parts.push(statement);
      // The executor may render a scalar without repeating its field name.
      // Its explicit single-field binding is sufficient; a guessed field is not.
      if (
        !parts.length &&
        entry.metadata?.sourceType === 'dataset' &&
        entry.metadata.quantityFields?.length === 1 &&
        entry.metadata.quantityFields[0].name === field.name
      )
        parts.push(statement);
      return parts.flatMap((part) => {
        const match = [...part.matchAll(pattern)][0];
        if (!match) return [];
        const value = answerNumbers(match[1])[0];
        return value == null ? [] : [{ value, stated: `${match[1]} ${field.unit}` }];
      });
    });
  });
  return [...new Map(quantities.map((q) => [q.value, q])).values()].slice(0, 8);
}

// Same named field and literal unit only. Matching values never establish a shared date/basis.
function evidenceComparisons(evidence) {
  const fields = [
    ...new Map(
      evidence
        .flatMap((entry) => entry.metadata?.quantityFields || [])
        .filter((field) => field.unit && fieldName(field.name))
        .map((field) => [
          JSON.stringify([normalizePhrase(fieldName(field.name)), field.unit]),
          field,
        ])
    ).values(),
  ].slice(0, 32);
  const comparisons = [];
  for (const field of fields) {
    const sources = evidence
      .map((entry) => ({ entry, quantities: sourceQuantities(entry, field, fields) }))
      .filter((source) => source.quantities.length);
    for (let left = 0; left < sources.length && comparisons.length < 8; left++) {
      for (let right = left + 1; right < sources.length && comparisons.length < 8; right++) {
        const a = sources[left],
          b = sources[right];
        if (a.entry.metadata.sourceId === b.entry.metadata.sourceId) continue;
        const citation = (source) =>
          `${source.entry.metadata.sourceLabel}, ${source.entry.metadata.location}`;
        const common = a.quantities.filter((q) =>
          b.quantities.some((other) => other.value === q.value)
        );
        const different = a.quantities.some((q) =>
          b.quantities.some((other) => other.value !== q.value)
        );
        const values = (source) => source.quantities.map((q) => q.stated).join(', ');
        const text = [
          `Gegenüberstellung zu „${field.name}“: ${values(a)} (${citation(a)}) stehen ${values(b)} (${citation(b)}) gegenüber.`,
          common.length
            ? `Übereinstimmung: ${common.map((q) => q.stated).join(', ')} sind in beiden Fundstellen belegt (${citation(a)}; ${citation(b)}).`
            : '',
          different
            ? `Die Angaben weichen ab (${citation(a)}; ${citation(b)}); ein Widerspruch bei identischer Bezugsbasis ist damit noch nicht belegt.`
            : '',
          `Aus der Gegenüberstellung allein bleibt offen, ob Zeitraum und Bezugsbasis vollständig übereinstimmen (${citation(a)}; ${citation(b)}).`,
        ]
          .filter(Boolean)
          .join(' ');
        comparisons.push({
          sourceIds: [a.entry.metadata.sourceId, b.entry.metadata.sourceId],
          field: field.name,
          text,
        });
      }
    }
  }
  return comparisons.slice(0, 8);
}

module.exports = { evidenceComparisons };
