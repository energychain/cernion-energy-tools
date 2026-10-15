'use strict';

const capability = Symbol('project-structure');
const VERSION = '1';
const ROW_SOURCE = Symbol('project-row-source');

function setting(name, fallback) {
  const value = Number(process.env[`CET_PROJECT_${name}`] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid project ${name}`);
  return value;
}

function objectType(object, prefix = '') {
  const suffix = object.name.split('.').at(-1).toLowerCase();
  const types = require('./file-channel-policy').TYPES;
  const extension = types[suffix]
    ? suffix
    : Object.entries(types).find(([, mime]) => mime === object.mimeType)?.[0] || suffix;
  if (
    ['csv', 'tsv'].includes(extension) ||
    /^(text\/csv|text\/tab-separated-values)$/.test(object.mimeType)
  )
    return 'csv';
  if (extension === 'xlsx') return 'xlsx';
  if (
    require('./structured-message-adapters.json').adapters.some((adapter) =>
      require(adapter.module).recognizes(prefix)
    )
  )
    return 'structured';
  if (['edi', 'edifact'].includes(extension)) return 'structured';
  if (['pdf', 'docx', 'pptx', 'txt', 'eml'].includes(extension)) return extension;
  return 'unknown';
}

function completed(object) {
  return (
    object.derivation?.version === VERSION &&
    object.derivation?.hash === object.hash &&
    object.extraction?.status === 'extracted'
  );
}

module.exports = { capability, VERSION, ROW_SOURCE, setting, objectType, completed };
