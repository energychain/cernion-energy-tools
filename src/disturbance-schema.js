'use strict';

const DISTURBANCE_PATTERN = Object.freeze([
  'REPEATING_FAULT',
  'CAPACITY_BOTTLENECK',
  'VOLTAGE_DROP',
  'MAINTENANCE_SPIKE',
  'UNKNOWN_ANOMALY'
]);

const DISTURBANCE_SEVERITY = Object.freeze(['low', 'medium', 'high', 'critical']);

function normalizeDisturbancePattern(pattern) {
  const value = String(pattern || '').trim().toUpperCase();
  if (!DISTURBANCE_PATTERN.includes(value)) {
    throw new Error(`Invalid disturbance pattern: ${pattern}`);
  }
  return value;
}

function normalizeDisturbanceSeverity(severity) {
  const value = String(severity || 'low').trim().toLowerCase();
  if (!DISTURBANCE_SEVERITY.includes(value)) {
    throw new Error(`Invalid disturbance severity: ${severity}`);
  }
  return value;
}

module.exports = {
  DISTURBANCE_PATTERN,
  DISTURBANCE_SEVERITY,
  normalizeDisturbancePattern,
  normalizeDisturbanceSeverity
};
