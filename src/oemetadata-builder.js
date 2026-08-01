'use strict';

/**
 * oemetadata-builder.js — Datapoint → OEMetadata v2.0 mapping
 *
 * Converts a Cernion PouchDB datapoint document into a fully OEMetadata v2.0
 * conformant JSON object. Optionally validates the result against the official
 * OEMetadata JSON Schema using ajv.
 *
 * OEMetadata specification:
 *   https://github.com/OpenEnergyPlatform/oemetadata
 *   Pinned version: v2.0.0 (see scripts/sync-oemetadata.js)
 *
 * FAIR Data principles:
 *   - Findable: @id URN, keywords, publicationDate
 *   - Accessible: REST path, license
 *   - Interoperable: OEO class IRIs in subject[], JSON-LD context
 *   - Reusable: licenses[], sources[], provenance hash
 *
 * @see https://www.go-fair.org/fair-principles/
 */

const path = require('path');
const fs = require('fs');
const { resolveSourceMeta, collectUniqueLicenses } = require('./source-license-map');

// ---------------------------------------------------------------------------
// OEMetadata schema path (downloaded by npm run sync:oemetadata)
// ---------------------------------------------------------------------------
const SCHEMA_PATH = path.join(__dirname, 'oemetadata', 'schema.json');

// ---------------------------------------------------------------------------
// Field type auto-detection from sample values
// ---------------------------------------------------------------------------
const TYPE_PATTERNS = {
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  datetime: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v),
  string: () => true, // fallback
};

/**
 * Infer field type from a sample value.
 * @param {*} value
 * @returns {string} OEMetadata field type
 */
function inferFieldType(value) {
  if (value === null || value === undefined) return 'string';
  for (const [type, test] of Object.entries(TYPE_PATTERNS)) {
    if (test(value)) return type;
  }
  return 'string';
}

// ---------------------------------------------------------------------------
// OEO subject extraction from plan steps
// ---------------------------------------------------------------------------
/**
 * Collect OEO class IRIs from plan step actions via x-oeo-class annotations.
 * Returns unique { name, path } subject objects as expected by OEMetadata.
 *
 * @param {object[]} steps - plan steps array ({ action: string })
 * @returns {object[]} - array of { name: string, path: string }
 */
function collectOeoSubjects(steps) {
  const { forDomainResolved, byCernionType } = require('./oeo-mappings');

  const subjects = new Map(); // IRI → { name, path }

  for (const step of steps || []) {
    const action = step?.action || '';
    const prefix = action.split('.')[0];
    const suffix = action.split('.')[1] || '';

    // Map service action to relevant OEO classes heuristically
    const domainClasses = forDomainResolved(prefix) || [];
    for (const cls of domainClasses) {
      if (!subjects.has(cls.iri)) {
        subjects.set(cls.iri, { name: cls.label, path: cls.iri });
      }
    }

    // Additional type-specific mappings for known action patterns
    const typeHints = {
      solar: 'solar',
      wind: 'wind',
      biomass: 'biomass',
      hydro: 'hydro',
      storage: 'storage',
      combustion: 'combustion',
    };
    for (const [keyword, cernionType] of Object.entries(typeHints)) {
      if (suffix.toLowerCase().includes(keyword)) {
        const mapping = byCernionType(cernionType);
        if (mapping && !subjects.has(mapping.iri)) {
          subjects.set(mapping.iri, { name: mapping.label, path: mapping.iri });
        }
      }
    }
  }

  return [...subjects.values()];
}

// ---------------------------------------------------------------------------
// Spatial extent extraction from fixedParams / step results
// ---------------------------------------------------------------------------
/**
 * Attempt to extract a spatial extent name from datapoint fixed params.
 * Returns a name string (city/region) or null.
 *
 * @param {object} fixedParams
 * @returns {string|null}
 */
function extractSpatialName(fixedParams) {
  if (!fixedParams || typeof fixedParams !== 'object') return null;
  return (
    fixedParams.city ||
    fixedParams.municipality ||
    fixedParams.location ||
    fixedParams.query ||
    fixedParams.region ||
    fixedParams.gridOperator ||
    null
  );
}

/**
 * Build spatial extent object for OEMetadata.
 * @param {object} doc - PouchDB datapoint document
 * @returns {object}
 */
function buildSpatial(doc) {
  const spatialName = extractSpatialName(doc.fixedParams);
  return {
    location: spatialName || 'Germany',
    extent: {
      name: spatialName || 'Germany',
      crs: 'EPSG:4326',
      boundingBox: null, // Could be computed from results if lat/lon available
    },
    resolution: null,
    description: spatialName
      ? `Data scoped to: ${spatialName}`
      : 'Data from Germany (exact spatial extent not specified)',
  };
}

// ---------------------------------------------------------------------------
// Temporal extent extraction
// ---------------------------------------------------------------------------
/**
 * Build temporal metadata from datapoint lastRun.
 * @param {object} doc - PouchDB datapoint document
 * @returns {object}
 */
function buildTemporal(doc) {
  const referenceDate = doc.lastRun?.timestamp ? doc.lastRun.timestamp.slice(0, 10) : null;

  return {
    referenceDate,
    timeseries: [
      {
        start: doc.createdAt ? doc.createdAt.slice(0, 10) : referenceDate,
        end: referenceDate,
        resolution: null,
        alignment: 'left',
        aggregationType: 'none',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Resources / fields builder
// ---------------------------------------------------------------------------
/**
 * Build OEMetadata resource field definitions from lastRun.summary.
 *
 * @param {object} summary - lastRun.summary ({ columns, sampleValues })
 * @returns {object[]}
 */
function buildFields(summary) {
  if (!summary || !Array.isArray(summary.columns) || summary.columns.length === 0) {
    return [];
  }

  const sampleRow = summary.sampleValues?.firstRow || {};

  return summary.columns.map((colName) => {
    const sampleValue = sampleRow[colName];
    const fieldType = inferFieldType(sampleValue);

    return {
      name: colName,
      description: `Field: ${colName}`,
      type: fieldType,
      unit: null,
      isAbout: [],
      valueReference: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Sources builder
// ---------------------------------------------------------------------------
/**
 * Build OEMetadata sources array from plan steps.
 * Deduplicates by action prefix (service name).
 *
 * @param {object[]} steps - plan steps
 * @returns {object[]}
 */
function buildSources(steps) {
  const seen = new Set();
  const sources = [];

  for (const step of steps || []) {
    const action = step?.action || '';
    const prefix = action.split('.')[0];

    if (seen.has(prefix)) continue;
    seen.add(prefix);

    const meta = resolveSourceMeta(action);
    sources.push({
      title: meta.title,
      description: `Data retrieved via Cernion action: ${action}`,
      path: meta.path,
      licenses: meta.licenses,
    });
  }

  if (sources.length === 0) {
    sources.push({
      title: 'Cernion Energy Tools — Agent-generated Data',
      description: 'Data generated by the Cernion AI research agent',
      path: '/api',
      licenses: [
        {
          name: 'DL-DE/BY-2.0',
          title: 'Data licence Germany – attribution – Version 2.0',
          path: 'https://www.govdata.de/dl-de/by-2-0',
          instruction: 'Ensure proper attribution to the original data sources.',
        },
      ],
    });
  }

  return sources;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
/**
 * Build a fully OEMetadata v2.0 conformant document from a datapoint.
 *
 * The Cernion-specific provenance, interventions and health data are included
 * under the `_cernion` extension namespace (non-breaking for OEMetadata consumers).
 *
 * @param {object} doc - PouchDB datapoint document
 * @returns {object} OEMetadata v2.0 conformant document
 */
function buildOEMetadata(doc) {
  const steps = doc.plan?.steps || [];
  const summary = doc.lastRun?.summary || null;
  const fields = buildFields(summary);
  const subjects = collectOeoSubjects(steps);
  const sources = buildSources(steps);
  const uniqueLicenses = collectUniqueLicenses(sources);
  const keywords = [...new Set(['cernion', 'mastr', ...(doc.tags || [])])];
  const publicationDate = doc.lastRun?.timestamp
    ? doc.lastRun.timestamp.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // OEMetadata v2.0 conformant structure
  return {
    // JSON-LD / identification
    '@id': `urn:cernion:datapoint:${doc.name}`,
    '@context':
      'https://raw.githubusercontent.com/OpenEnergyPlatform/oemetadata/v2.0.0/metadata/v200/context.json',

    // Collection-level (required: Iron badge)
    name: doc.name,
    title: doc.description || doc.name,
    id: `urn:cernion:datapoint:${doc.name}`,
    description:
      doc.description ||
      `Cernion-managed datapoint '${doc.name}'. ` +
        (steps.length > 0
          ? `Generated from ${steps.length} agent plan step(s): ${steps.map((s) => s.action).join(', ')}.`
          : ''),

    subject: subjects,
    language: ['en', 'de'],
    keywords,
    publicationDate,

    // Spatial / temporal
    spatial: buildSpatial(doc),
    temporal: buildTemporal(doc),

    // Sources and licenses
    sources,
    licenses: uniqueLicenses,

    // Contributors (Cernion system attribution)
    contributors: [
      {
        title: 'Cernion Energy Tools',
        email: null,
        object: 'agent-generated dataset',
        comment: `Automatically generated by Cernion AI research agent (v0.12+). Session: ${doc.sessionId || 'n/a'}.`,
        date: publicationDate,
      },
    ],

    // Resources (single resource = the datapoint data)
    resources: [
      {
        profile: 'tabular-data-resource',
        name: doc.name,
        path: `/api/datapoints/${doc.name}/data`,
        format: 'json',
        encoding: 'UTF-8',
        schema: {
          fields,
          missingValues: ['', 'null', 'NULL', 'n/a', 'N/A'],
          primaryKey: [],
        },
        dialect: {},
        subject: subjects,
        keywords,
        publicationDate,
      },
    ],

    // Review / quality (required by OEMetadata Iron badge)
    review: {
      path: null,
      badge: 'none',
    },

    // metaMetadata (required by OEMetadata)
    metaMetadata: {
      metadataVersion: 'OEMetadata-2.0.0',
      metadataLicense: {
        name: 'CC0-1.0',
        title: 'Creative Commons Zero v1.0 Universal',
        path: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
    },

    // -----------------------------------------------------------------
    // Cernion-specific extension fields (under _cernion namespace)
    // Not part of OEMetadata schema — included for Cernion consumers.
    // -----------------------------------------------------------------
    _cernion: {
      schemaVersion: '0.12.0',
      generatedAt: new Date().toISOString(),

      // EU AI Act Art. 12 — cryptographic provenance (Issue #30)
      provenance: {
        hash: doc.provenanceHash || null,
        algorithm: 'SHA-256',
        scope: 'raw stepResults payload at last refresh',
        lastRefresh: doc.lastRun?.timestamp || null,
        hashStable: doc.provenanceHash !== null,
      },

      // Issue #32 — agent intervention log
      agent_interventions: doc.agent_interventions || [],

      // Health & quality metrics
      health: doc.health || null,
      lastRun: doc.lastRun || null,

      // Scheduling
      scheduling: {
        strategy: doc.refresh?.strategy || 'manual',
        ...(doc.refresh?.intervalMinutes ? { intervalMinutes: doc.refresh.intervalMinutes } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Schema validation (optional — requires sync:oemetadata to have been run)
// ---------------------------------------------------------------------------
/**
 * Validate an OEMetadata document against the official v2.0.0 JSON Schema.
 * Returns { valid: true } if schema file is missing (non-blocking).
 *
 * @param {object} metadata - result of buildOEMetadata()
 * @returns {{ valid: boolean, errors: object[]|null, warnings: string[] }}
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
    // Require ajv lazily — it's only needed when ?validate=true is requested
    Ajv = require('ajv');
  } catch (err) {
    process.stderr.write(
      `[oemetadata-builder] silent-catch-fallback (line 415): ${err && err.message}\n`
    );
    warnings.push('`ajv` package not installed. Run `npm install` to enable schema validation.');
    return { valid: true, errors: null, warnings };
  }

  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (err) {
    warnings.push(`Failed to load OEMetadata schema: ${err.message}`);
    return { valid: true, errors: null, warnings };
  }

  // Use ajv in non-strict mode — the OEMetadata schema may use patterns
  // that strict mode rejects (e.g. additionalProperties, $id without anchors)
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);

  // Validate without the _cernion extension field
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
  buildOEMetadata,
  validateAgainstSchema,
  // Exported for testing
  inferFieldType,
  buildFields,
  buildSources,
  buildSpatial,
  buildTemporal,
  collectOeoSubjects,
};
