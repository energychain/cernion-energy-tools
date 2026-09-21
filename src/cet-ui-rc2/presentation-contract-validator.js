'use strict';

const Ajv2020 = require('ajv/dist/2020');
const presentationContractSchema = require('./schema/presentation-contract.schema.json');

function buildAjv() {
  return new Ajv2020({ allErrors: true, strict: true });
}

const ajv = buildAjv();
const validateSchema = ajv.compile(presentationContractSchema);

function formatValidationErrors(errors = []) {
  return errors
    .map((error) => {
      const path = error.instancePath || '/';
      if (error.keyword === 'required') {
        return `${path} requires ${error.params?.missingProperty}`;
      }
      if (error.keyword === 'not') {
        return `${path} violates ${error.message}`;
      }
      return `${path} ${error.message}`;
    })
    .join('; ');
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertSingleRecordBoundary(statement) {
  if (statement.granularitaet !== 'einzeldatensatz') return;
  if (statement.materialisierung !== 'hash_ref_only') {
    throw new Error('einzeldatensatz statements require materialisierung hash_ref_only');
  }
  if (Object.prototype.hasOwnProperty.call(statement, 'wert')) {
    throw new Error('einzeldatensatz statements must not materialize wert; use hash_ref_only');
  }
  if (!statement.hashRef?.wert) {
    throw new Error('einzeldatensatz statements require hashRef');
  }
}

function assertStructuredRawValueBoundary(item, label) {
  if (!Object.prototype.hasOwnProperty.call(item, 'wert')) return;
  const value = item.wert;
  if (value !== null && typeof value === 'object') {
    throw new Error(`${label} wert must be scalar; raw object or array values are not presentation-contract material`);
  }
}

function validatePresentationContract(contract) {
  assertPlainObject(contract, 'presentation contract');
  if (contract.projectionStatus === 'nicht_projiziert') {
    throw new Error('nicht_projiziert operation result is not a presentation contract');
  }

  for (const statement of contract.aussagen || []) {
    assertSingleRecordBoundary(statement);
    assertStructuredRawValueBoundary(statement, 'aussage');
  }
  for (const finding of contract.befunde || []) {
    assertStructuredRawValueBoundary(finding, 'befund');
  }

  const valid = validateSchema(contract);
  if (!valid) {
    throw new Error(`Invalid presentation contract: ${formatValidationErrors(validateSchema.errors)}`);
  }

  return { valid: true, contract };
}

function classifyOperationResult(result) {
  assertPlainObject(result, 'operation result');
  if (result.projectionStatus === 'projected') {
    validatePresentationContract(result.presentationContract);
    return {
      kind: 'projected_result',
      projectionStatus: 'projected',
      hasMarkerSemantics: true,
      hasAggregatzustand: true,
    };
  }
  if (result.projectionStatus === 'nicht_projiziert') {
    return {
      kind: 'unprojected_raw_result',
      projectionStatus: 'nicht_projiziert',
      hasMarkerSemantics: false,
      hasAggregatzustand: false,
    };
  }
  throw new Error('Operation result must declare projectionStatus projected or nicht_projiziert');
}

module.exports = {
  classifyOperationResult,
  validatePresentationContract,
};
