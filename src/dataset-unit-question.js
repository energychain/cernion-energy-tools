'use strict';

function columnUnit(column, proposed, fallback) {
  if (column.type !== 'number') return '';
  const unit = [proposed, fallback].find(
    (value) => typeof value === 'string' && value.trim() && value.trim() !== column.type
  );
  if (unit) return unit.trim();
  return (
    column.name
      .match(/\[([^\]]+)\]|\(([^)]+)\)\s*$/)
      ?.slice(1)
      .find(Boolean)
      ?.trim() || ''
  );
}

function datasetUnits(record) {
  return Object.fromEntries(
    record.columns.map((column) => [
      column.name,
      columnUnit(column, record.semantic.units[column.name]),
    ])
  );
}

function unresolvedAnswerUnits(record, answer) {
  if (answer.status === 'unavailable') return [];
  const units = datasetUnits(record);
  return [...new Set(answer.unitFields || [])].filter(
    (field) =>
      record.columns.some(
        (column) => column.name === field && column.type === 'number' && !column.sensitive
      ) && !units[field]
  );
}

async function answerUnitQuestion(ctx, record, answer, conversationId) {
  const fields = unresolvedAnswerUnits(record, answer);
  if (!fields.length || record.semantic.unitQuestion) return '';
  record.semantic.unitQuestion = { fields, at: new Date().toISOString(), conversationId };
  await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
  return `\n\nWelche Einheit gilt in ${record.title} für ${fields.join(', ')}?`;
}

module.exports = { columnUnit, datasetUnits, unresolvedAnswerUnits, answerUnitQuestion };
