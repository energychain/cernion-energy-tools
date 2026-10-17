'use strict';

const { formatDatasetNumber } = require('./dataset-query');
const { KEY_DISTINCT_RATIO } = require('./dataset-table-quality');

function namedSheetCandidates(records, question) {
  let text = String(question).toLocaleLowerCase('de-DE');
  const exactToken = require('./workbench-codes').exactToken;
  for (const name of new Set(records.map((record) => record.sourceName).filter(Boolean))) {
    if (exactToken(text, name.toLocaleLowerCase('de-DE')))
      text = text.replaceAll(name.toLocaleLowerCase('de-DE'), ' ');
  }
  return records.filter(
    (record) => record.sheet && exactToken(text, record.sheet.toLocaleLowerCase('de-DE'))
  );
}

function sameTableColumns(left, right) {
  return (
    left.columns.length === right.columns.length &&
    left.columns.every(
      (column, i) => column.name === right.columns[i].name && column.type === right.columns[i].type
    )
  );
}

function sameSheetStructure(left, right) {
  return (
    Boolean(left.sourceName) &&
    left.sourceName === right.sourceName &&
    left.tenantId === right.tenantId &&
    left.provenance?.projectId === right.provenance?.projectId &&
    left.provenance?.objectId === right.provenance?.objectId &&
    sameTableColumns(left, right)
  );
}

function variantKeys(left, right) {
  if (!sameTableColumns(left, right)) return [];
  return left.columns.filter(
    (column) =>
      ['string', 'number'].includes(column.type) &&
      column.distinctRatio >= KEY_DISTINCT_RATIO &&
      right.columns.find((entry) => entry.name === column.name).distinctRatio >= KEY_DISTINCT_RATIO
  );
}

function variantDifference(pool, left, right) {
  if (left.tenantId !== right.tenantId) return null;
  const candidates = variantKeys(left, right);
  if (!candidates.length) return null;
  const db = pool.tenant(left.tenantId),
    a = pool.table(left.id),
    b = pool.table(right.id);
  const leftCount = db.prepare(`SELECT COUNT(*) AS n FROM ${a}`).get().n;
  const rightCount = db.prepare(`SELECT COUNT(*) AS n FROM ${b}`).get().n;
  const largest = Math.max(leftCount, rightCount);
  const textualKeys = candidates.filter((column) => column.type !== 'number' || column.sensitive);
  const keyCandidates = textualKeys.length ? textualKeys : candidates;
  const scoredKeys = keyCandidates.flatMap((column) => {
    const i = left.columns.findIndex((entry) => entry.name === column.name);
    if (
      db
        .prepare(
          `SELECT 1 FROM ${a} WHERE c${i} IS NULL UNION ALL SELECT 1 FROM ${b} WHERE c${i} IS NULL LIMIT 1`
        )
        .get()
    )
      return [];
    const matches = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT DISTINCT c${i} FROM ${a} INTERSECT SELECT DISTINCT c${i} FROM ${b})`
      )
      .get().n;
    return matches >= 2 && matches / largest >= KEY_DISTINCT_RATIO ? [{ column, matches }] : [];
  });
  const descriptors = scoredKeys.filter(
    ({ column }) => column.type !== 'number' || column.sensitive
  );
  const eligible = descriptors.length ? descriptors : scoredKeys;
  const bestOverlap = Math.max(0, ...eligible.map((entry) => entry.matches));
  const keys = eligible
    .filter((entry) => entry.matches === bestOverlap)
    .map((entry) => entry.column);
  if (!keys.length) return null;
  const keyIndexes = keys.map((key) =>
    left.columns.findIndex((column) => column.name === key.name)
  );
  const keyList = keyIndexes.map((i) => `c${i}`).join(',');
  // Duplicate or missing identities cannot provide a reliable row comparison.
  for (const table of [a, b]) {
    if (
      db
        .prepare(
          `SELECT 1 FROM ${table} WHERE ${keyIndexes.map((i) => `c${i} IS NULL`).join(' OR ')} LIMIT 1`
        )
        .get() ||
      db.prepare(`SELECT 1 FROM ${table} GROUP BY ${keyList} HAVING COUNT(*) > 1 LIMIT 1`).get()
    )
      return null;
  }
  const join = keyIndexes.map((i) => `a.c${i} = b.c${i}`).join(' AND ');
  const overlap = db.prepare(`SELECT COUNT(*) AS n FROM ${a} a JOIN ${b} b ON ${join}`).get().n;
  if (overlap < 2 || overlap / largest < KEY_DISTINCT_RATIO) return null;
  const measured = left.columns.flatMap((column, i) =>
    column.type === 'number' && !column.sensitive ? [{ column, i }] : []
  );
  const different = measured.map(({ i }) => `a.c${i} IS NOT b.c${i}`).join(' OR ');
  const changedRows = different
    ? db.prepare(`SELECT COUNT(*) AS n FROM ${a} a JOIN ${b} b ON ${join} WHERE ${different}`).get()
        .n
    : 0;
  return {
    keys: keys.map((key) => key.name),
    overlap,
    changedRows,
    onlyLeft: leftCount - overlap,
    onlyRight: rightCount - overlap,
  };
}

async function registerDatasetVariants(ctx, pool, record, records) {
  const peers = records.filter(
    (other) =>
      other.id !== record.id &&
      other.current !== false &&
      !other.quality?.unusable &&
      other.sourceName === record.sourceName &&
      other.sheet !== record.sheet &&
      other.provenance?.projectId === record.provenance?.projectId &&
      other.provenance?.objectId === record.provenance?.objectId
  );
  record.variants = [];
  for (const peer of peers) {
    const difference = variantDifference(pool, record, peer);
    if (!difference) continue;
    record.variants.push(peer.id);
    peer.variants = [...new Set([...(peer.variants || []), record.id])];
    await ctx.call('datapoint.datasetCatalog', { operation: 'put', record: peer });
  }
  await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
}

// Every displayed value is derived from executed aggregate queries, never catalog statistics.
function compareDatasetResults(records, answers, differences) {
  const lines = [];
  for (let i = 1; i < records.length; i++) {
    const left = records[0],
      right = records[i],
      difference = differences[i - 1];
    lines.push(`Variantenvergleich: ${left.title} ↔ ${right.title}.`);
    if (difference)
      lines.push(
        `${difference.changedRows} gemeinsame Zeilen mit geänderten Werten; ${difference.onlyLeft} Zeilen nur in ${left.sheet}, ${difference.onlyRight} nur in ${right.sheet}.`
      );
    const leftAnswer = answers[0],
      rightAnswer = answers[i];
    for (const a of leftAnswer.filtered ? [] : leftAnswer.summaries || []) {
      const b = rightAnswer.summaries?.find((entry) => entry.field === a.field);
      if (a.sum == null || b?.sum == null) continue;
      if (a.unit !== b.unit) {
        lines.push(
          `${a.field}: Einheiten unterscheiden sich; keine numerische Differenz berechnet.`
        );
        continue;
      }
      lines.push(
        `${a.field}: Datensummen ${formatDatasetNumber(a.sum)} (${left.sheet}) und ${formatDatasetNumber(b.sum)} (${right.sheet}); Differenz ${formatDatasetNumber(b.sum - a.sum)} ${a.unit}.`
      );
    }
    // Bind groups and metrics to the executed plan, including numeric group labels.
    const aggregation = leftAnswer.aggregation;
    if (!aggregation) continue;
    const labels = aggregation.groupBy || [];
    for (const a of leftAnswer.result || []) {
      const b = rightAnswer.result?.find((row) => labels.every((key) => row[key] === a[key]));
      if (!b) {
        lines.push(
          `${labels.map((key) => `${key}: ${a[key]}`).join(', ')}: nur im Abfrageergebnis von ${left.sheet}.`
        );
        continue;
      }
      const deltas = aggregation.metrics.flatMap((metric) => {
        const rightMetric = rightAnswer.aggregation?.metrics.find(
          (entry) => entry.fn === metric.fn && entry.field === metric.field
        );
        if (
          !rightMetric ||
          typeof a[metric.as] !== 'number' ||
          typeof b[rightMetric.as] !== 'number'
        )
          return [];
        const label = `${{ count: 'Anzahl', sum: 'Summe', avg: 'Mittelwert', min: 'Minimum', max: 'Maximum' }[metric.fn]}${metric.field ? ` (${metric.field})` : ''}`;
        const unitLeft =
          metric.fn === 'count'
            ? 'Zeilen'
            : require('./dataset-unit-question').datasetUnits(left)[metric.field] ||
              'Einheit ungeklärt';
        const unitRight =
          metric.fn === 'count'
            ? 'Zeilen'
            : require('./dataset-unit-question').datasetUnits(right)[metric.field] ||
              'Einheit ungeklärt';
        if (unitLeft !== unitRight)
          return [`${label}: Einheiten unterscheiden sich; keine Differenz berechnet`];
        return [
          `${label}: ${formatDatasetNumber(a[metric.as])} (${left.sheet}), ${formatDatasetNumber(b[rightMetric.as])} (${right.sheet}); Differenz ${formatDatasetNumber(b[rightMetric.as] - a[metric.as])} ${unitLeft}`,
        ];
      });
      if (deltas.length && (labels.length || leftAnswer.filtered))
        lines.push(
          `${labels.map((key) => `${key}: ${a[key]}`).join(', ')}${labels.length ? ' — ' : ''}${deltas.join('; ')}.`
        );
    }
  }
  return lines.join('\n');
}

function expandVariantCandidates(selected, current, question, conversationId, comparison = false) {
  const ids = new Set(selected.flatMap((record) => [record.id, ...(record.variants || [])]));
  const related = current.filter(
    (record) => ids.has(record.id) || selected.some((entry) => sameSheetStructure(entry, record))
  );
  const explicit = namedSheetCandidates(related, question);
  if (explicit.length) return explicit;
  const preferred = related.filter((record) =>
    record.selectedInConversations?.includes(conversationId)
  );
  if (
    !comparison &&
    preferred.length &&
    selected.some((record) =>
      preferred.some((item) => item.id === record.id || item.variants?.includes(record.id))
    )
  )
    return preferred;
  return related;
}

async function queryDatasetVariants(ctx, records, params) {
  records = [...records].sort((a, b) =>
    require('./canonical-order').compareCanonicalStrings(a.sheet, b.sheet)
  );
  const answers = [];
  for (const record of records)
    answers.push(await ctx.call('dataset.query', { ...params, id: record.id }));
  const measured = (answers[0].filtered ? [] : answers[0].summaries || [])
    .filter(
      (left) =>
        left.sum != null &&
        answers
          .slice(1)
          .some((answer) =>
            answer.summaries?.some((right) => right.field === left.field && right.sum != null)
          )
    )
    .map((entry) => entry.field);
  if (measured.length) {
    const current = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
    for (const answer of answers) {
      const record = current.find((entry) => entry.id === answer.datasetId);
      if (record)
        answer.responseText += await require('./dataset-unit-question').answerUnitQuestion(
          ctx,
          record,
          { ...answer, unitFields: [...(answer.unitFields || []), ...measured] },
          params.conversationId
        );
    }
  }
  const differences = records.slice(1).map((record) => {
    const found = answers[0].variantDifferences?.find((entry) => entry.datasetId === record.id);
    if (!found) return null;
    const difference = { ...found };
    delete difference.datasetId;
    return difference;
  });
  return {
    responseText: [
      ...answers.map((answer) => answer.responseText),
      compareDatasetResults(records, answers, differences),
    ].join('\n\n'),
    datasets: records.map(({ id, title, version }) => ({ id, title, version })),
    comparisons: differences,
    answers,
  };
}

module.exports = {
  queryDatasetVariants,
  namedSheetCandidates,
  sameSheetStructure,
  variantKeys,
  variantDifference,
  registerDatasetVariants,
  compareDatasetResults,
  expandVariantCandidates,
};
