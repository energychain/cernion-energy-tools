'use strict';

function stripJsonFence(raw) {
  const value = String(raw).trim();
  if (!value.startsWith('```') || !value.endsWith('```')) return value;
  const start = value.startsWith('```json') ? 7 : 3;
  return value.slice(start, -3).trim();
}
module.exports = { stripJsonFence };
