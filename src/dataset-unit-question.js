'use strict';

function unresolvedAnswerUnits(record, answer) {
  if (answer.status === 'unavailable') return [];
  return [...new Set(answer.unitFields || [])].filter(
    (field) =>
      record.columns.some(
        (column) => column.name === field && column.type === 'number' && !column.sensitive
      ) && !record.semantic.units[field]
  );
}

module.exports = { unresolvedAnswerUnits };
