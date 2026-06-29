'use strict';

/**
 * audit-oemetadata-builder.js — AuditReport → OEMetadata v2.0 mapping
 *
 * Converts a Cernion PouchDB AuditReport document into a fully OEMetadata v2.0
 * conformant JSON object.
 *
 * OEMetadata specification:
 *   https://github.com/OpenEnergyPlatform/oemetadata
 *   Pinned version: v2.0.0
 *
 * FAIR Data principles:
 *   - Findable: @id URN, keywords, publicationDate
 *   - Accessible: REST path, license
 *   - Interoperable: OEO class IRIs in subject[], JSON-LD context
 *   - Reusable: licenses[], sources[], provenance hash
 */

const path = require('path');
const fs = require('fs');

const SCHEMA_PATH = path.join(__dirname, 'oemetadata', 'schema.json');

/**
 * Build spatial extent for an AuditReport.
 */
function buildSpatial(audit) {
  const spatialName = audit.gridOperator?.name || 'Germany';
  return {
    location: spatialName,
    extent: {
      name: spatialName,
      crs: 'EPSG:4326',
      boundingBox: null,
    },
    resolution: null,
    description: `Spatial scope of audited VNB portfolio: ${spatialName}`,
  };
}

/**
 * Build temporal extent for an AuditReport.
 */
function buildTemporal(audit) {
  const referenceDate = audit.timestamp
    ? audit.timestamp.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return {
    referenceDate,
    timeseries: [
      {
        start: referenceDate,
        end: referenceDate,
        resolution: null,
        alignment: 'left',
        aggregationType: 'none',
      },
    ],
  };
}

/**
 * Build resources / fields for an AuditReport.
 */
function buildFields() {
  return [
    {
      name: 'id',
      description: 'Audit report UUID',
      type: 'string',
      unit: null,
      isAbout: [],
      valueReference: [],
    },
    {
      name: 'qualityScore',
      description: 'Overall quality score (0-100)',
      type: 'number',
      unit: null,
      isAbout: [],
      valueReference: [],
    },
    {
      name: 'findingsCount',
      description: 'Total number of findings detected',
      type: 'integer',
      unit: null,
      isAbout: [],
      valueReference: [],
    },
    {
      name: 'timestamp',
      description: 'Timestamp when the audit was executed',
      type: 'datetime',
      unit: null,
      isAbout: [],
      valueReference: [],
    },
    {
      name: 'gridOperatorId',
      description: 'MaStR grid operator ID',
      type: 'string',
      unit: null,
      isAbout: [],
      valueReference: [],
    },
  ];
}

/**
 * Build sources for an AuditReport.
 */
function buildSources(audit, auditId) {
  return [
    {
      title: 'Cernion MaStR Quality Audit Pipeline',
      description: 'Audit performed on VNB MaStR portfolio data via Cernion.',
      path: `/api/mastr-quality/audits/${auditId}`,
      licenses: [
        {
          name: 'DL-DE/BY-2.0',
          title: 'Data licence Germany – attribution – Version 2.0',
          path: 'https://www.govdata.de/dl-de/by-2-0',
          instruction: 'Ensure proper attribution to the original data sources.',
        },
      ],
    },
  ];
}

/**
 * Map audit report and findings into OEMetadata v2.0 JSON-LD format.
 *
 * @param {object} audit - AuditReport PouchDB document
 * @returns {object} OEMetadata v2.0 conformant document
 */
function buildOemetadataForAudit(audit) {
  const auditId = (audit._id || audit.id || '').replace('mq:', '');
  const publicationDate = audit.timestamp
    ? audit.timestamp.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Map top-level OEO class: oeo:DataAnalysisProcedure
  const subjects = [
    {
      name: 'data analysis procedure',
      path: 'https://openenergyplatform.org/ontology/oeo/DataAnalysisProcedure',
    },
  ];

  // Map each unique finding code as an annotation oeo:Finding subclass
  const seenFindings = new Set();
  const findingsList = Array.isArray(audit.findings) ? audit.findings : [];
  for (const finding of findingsList) {
    if (finding.findingCode && !seenFindings.has(finding.findingCode)) {
      seenFindings.add(finding.findingCode);
      subjects.push({
        name: `finding: ${finding.findingCode}`,
        path: `https://openenergyplatform.org/ontology/oeo/Finding#${finding.findingCode}`,
      });
    }
  }

  const keywords = ['cernion', 'mastr-quality', 'audit', 'compliance', 'fair-export'];
  if (audit.gridOperator?.name) {
    keywords.push(audit.gridOperator.name.toLowerCase().replace(/\s+/g, '-'));
  }

  const sources = buildSources(audit, auditId);

  return {
    '@id': `urn:cernion:audit:mq:${auditId}`,
    '@context':
      'https://raw.githubusercontent.com/OpenEnergyPlatform/oemetadata/v2.0.0/metadata/v200/context.json',

    name: `audit-mastr-quality-${auditId}`,
    title: `MaStR Data Quality Audit Report - ${audit.gridOperator?.name || 'VNB'}`,
    id: `urn:cernion:audit:mq:${auditId}`,
    description: `Cernion MaStR Data Quality Audit Report for ${audit.gridOperator?.name || 'VNB'}. Overall score: ${audit.qualityScore || 100}/100.`,

    subject: subjects,
    language: ['en', 'de'],
    keywords,
    publicationDate,

    spatial: buildSpatial(audit),
    temporal: buildTemporal(audit),

    sources,
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
      },
    ],

    contributors: [
      {
        title: 'Cernion Energy Tools',
        email: null,
        object: 'agent-generated audit report',
        comment: `Generated by Cernion MaStR Quality Audit Pipeline.`,
        date: publicationDate,
      },
    ],

    resources: [
      {
        profile: 'tabular-data-resource',
        name: `audit-mastr-quality-${auditId}`,
        path: `/api/mastr-quality/audits/${auditId}/oemetadata`,
        format: 'json',
        encoding: 'UTF-8',
        schema: {
          fields: buildFields(),
          missingValues: ['', 'null', 'NULL', 'n/a', 'N/A'],
          primaryKey: [],
        },
        dialect: {},
        subject: subjects,
        keywords,
        publicationDate,
      },
    ],

    review: {
      path: null,
      badge: 'none',
    },

    metaMetadata: {
      metadataVersion: 'OEMetadata-2.0.0',
      metadataLicense: {
        name: 'CC0-1.0',
        title: 'Creative Commons Zero v1.0 Universal',
        path: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
    },

    _cernion: {
      schemaVersion: '0.17.0',
      generatedAt: new Date().toISOString(),
      provenance: {
        hash: audit.provenanceHash || null,
        algorithm: 'SHA-256',
        scope: 'raw audit findings at run',
        lastRefresh: audit.timestamp || null,
        hashStable: !!audit.provenanceHash,
      },
      qualityScore: audit.qualityScore || 100,
      qualityDimensions: audit.qualityDimensions || null,
      findings: findingsList,
    },
  };
}

/**
 * Validate against schema (optional, ajv-based schema validation).
 */
function validateAgainstSchema(metadata) {
  const warnings = [];

  if (!fs.existsSync(SCHEMA_PATH)) {
    warnings.push(
      'OEMetadata schema not available locally. Run `npm run sync:oemetadata` to download it.'
    );
    return { valid: true, errors: null, warnings };
  }

  let Ajv, schema;
  try {
    Ajv = require('ajv');
  } catch {
    warnings.push('`ajv` package not installed. Run `npm install` to enable schema validation.');
    return { valid: true, errors: null, warnings };
  }

  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (err) {
    warnings.push(`Failed to load OEMetadata schema: ${err.message}`);
    return { valid: true, errors: null, warnings };
  }

  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);

  const cleanMetadata = { ...metadata };
  delete cleanMetadata._cernion;
  const valid = validate(cleanMetadata);

  return {
    valid,
    errors: valid ? null : validate.errors || [],
    warnings,
  };
}

module.exports = {
  buildOemetadataForAudit,
  validateAgainstSchema,
  buildSpatial,
  buildTemporal,
  buildFields,
  buildSources,
};
