/**
 * OSM Geo Layer Service
 *
 * Layer 2 of the Cernion Geo-Architecture: physical grid infrastructure
 * from OpenStreetMap via the Overpass API, complementing the authoritative
 * VNBDigital data (Layer 1).
 *
 * Data source: OpenStreetMap contributors, ODbL 1.0
 * https://opendatacommons.org/licenses/odbl/
 *
 * For high-volume production workloads set OVERPASS_ENDPOINT to a private
 * Overpass instance (see docker/overpass/README.md).
 */

const CernionMCPClient = require('../src/mcp-client');

const DEFAULT_MCP_TIMEOUT_MS = 15000;

function _mcpTimeoutMs() {
  const configured = Number(process.env.OSM_GEO_MCP_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 100 && configured <= 60000) {
    return configured;
  }
  return DEFAULT_MCP_TIMEOUT_MS;
}

/**
 * Maps MCP error codes / exception messages to stable degraded-reason tokens.
 * Consumers (Sidecar) can use these to surface evidence gaps without blocking.
 *
 * Reason codes (per issue #273):
 *   NO_OBJECTS_FOUND     — query succeeded but OSM returned zero usable objects
 *   GEOCODING_FAILED     — named-place or PLZ bbox resolution failed
 *   OVERPASS_TIMEOUT     — Overpass upstream timed out
 *   AREA_TOO_BROAD       — query deliberately refused (area too large)
 *   RESPONSE_SIZE_LIMIT  — result truncated / withheld due to geometry/size limits
 *   SERVICE_ABORT        — generic Cernion service error or unexpected exception
 */
function _classifyDegradedReason(errCodeOrMessage) {
  const s = String(errCodeOrMessage || '').toUpperCase();
  if (
    s.includes('GEOCOD') ||
    s.includes('BBOX') ||
    s.includes('PLACE_NOT_FOUND') ||
    s.includes('NOT_FOUND')
  )
    return 'GEOCODING_FAILED';
  if (s.includes('TIMEOUT') || s.includes('OVERPASS_TIMEOUT')) return 'OVERPASS_TIMEOUT';
  if (s.includes('TOO_LARGE') || s.includes('TOO_BROAD') || s.includes('AREA_TOO'))
    return 'AREA_TOO_BROAD';
  if (s.includes('SIZE_LIMIT') || s.includes('RESPONSE_SIZE') || s.includes('TRUNCATED'))
    return 'RESPONSE_SIZE_LIMIT';
  return 'SERVICE_ABORT';
}

function _degraded(reason, detail) {
  return { success: false, degradedReason: reason, degradedReasonDetail: detail || null };
}

function _wrapMcpResult(result, location) {
  if (result && result.success === false) {
    const code = result.error && (result.error.code || result.error.message);
    const reason = code ? _classifyDegradedReason(code) : 'SERVICE_ABORT';
    return { ...result, degradedReason: reason, queriedLocation: location };
  }
  return result;
}

async function _callMcpWithTimeout(toolName, params, token) {
  let timer;
  const timeoutMs = _mcpTimeoutMs();
  try {
    return await Promise.race([
      CernionMCPClient.callWithNewSession(toolName, params, token),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`OSM_GEO_MCP_TIMEOUT after ${timeoutMs}ms for ${toolName}`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  name: 'osm-geo',

  settings: {
    defaultTimeout: 60000,
  },

  actions: {
    /**
     * Two-layer geographic plausibility check for MaStR VNB assignment.
     * Layer 1 (authoritative): coordinate → VNBDigital → expected grid operator.
     * Layer 2 (physical):      coordinate → Overpass → nearby substations / operator tags.
     * Tool: osm_geo_validate
     */
    validate: {
      rest: 'POST /validate',
      params: {
        mastrNummer: { type: 'string', optional: true },
        latitude: { type: 'number', optional: true },
        longitude: { type: 'number', optional: true },
        registeredGridOperatorName: { type: 'string', optional: true },
        gridOperatorId: { type: 'string', optional: true },
        radiusMeters: { type: 'number', optional: true, default: 500, min: 1, max: 5000 },
        skipOsmLayer: { type: 'boolean', optional: true, default: false },
        includeInfrastructureDetails: { type: 'boolean', optional: true, default: false },
        confidenceThreshold: { type: 'number', optional: true, default: 40, min: 0, max: 100 },
      },
      openapi: {
        summary: 'Geo-plausibility check for MaStR VNB assignment (L1 authoritative + L2 OSM)',
        tags: ['OSM Geo (OpenStreetMap)'],
        description: `Two-layer geographic plausibility check for the grid-operator assignment of a MaStR installation.

**Layer 1 (authoritative):** Coordinate → VNBDigital → expected grid operator for this location.
**Layer 2 (physical):** Coordinate → Overpass API → nearby substations / dominant operator tag.

Detects both **DEFINITIVE_MISASSIGNMENT** (L1 mismatch, authoritative) and **LIKELY_MISASSIGNMENT** (L2 OSM hint only).

**Input:** either \`mastrNummer\` (coordinates resolved automatically) **or** explicit \`latitude\` + \`longitude\`.

**Verdict values:**
- \`CONSISTENT\` — assignment plausible (L1 + L2 agree or no contradiction)
- \`DEFINITIVE_MISASSIGNMENT\` — VNBDigital points to a different operator (authoritative correction required)
- \`LIKELY_MISASSIGNMENT\` — OSM infrastructure tags suggest a different operator
- \`UNCERTAIN\` — contradictory signals, no clear verdict
- \`INSUFFICIENT_DATA\` — too few OSM objects for a reliable verdict

**OSM coverage note:** Typically 40–60 % of MS/NS infrastructure is mapped in OSM for Germany. The \`dataQuality.coverageLabel\` field carries a per-response quality estimate.

**Data:** © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/)`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mastrNummer: {
                    type: 'string',
                    description:
                      'MaStR number (SEE…, SWE…, SBE…). Coordinates and VNB resolved automatically from the local DB.',
                    example: 'SEE900012345678',
                  },
                  latitude: {
                    type: 'number',
                    description: 'Latitude — required when mastrNummer is not provided.',
                    example: 49.481,
                  },
                  longitude: {
                    type: 'number',
                    description: 'Longitude — required when mastrNummer is not provided.',
                    example: 8.432,
                  },
                  registeredGridOperatorName: {
                    type: 'string',
                    description: 'Registered VNB name for the L1 comparison.',
                    example: 'STROMDAO Netze GmbH',
                  },
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR ID of the VNB (SNB…).',
                    example: 'SNB935578300972',
                  },
                  radiusMeters: {
                    type: 'number',
                    description: 'OSM search radius in metres (max 5 000).',
                    default: 500,
                    example: 500,
                  },
                  skipOsmLayer: {
                    type: 'boolean',
                    description: 'Only run L1 (no Overpass call). Faster for batch runs.',
                    default: false,
                    example: false,
                  },
                  includeInfrastructureDetails: {
                    type: 'boolean',
                    description: 'Include the full list of found OSM objects in the response.',
                    default: false,
                    example: false,
                  },
                  confidenceThreshold: {
                    type: 'number',
                    description: 'Minimum score for CONSISTENT verdict.',
                    default: 40,
                    example: 40,
                  },
                },
              },
              examples: {
                byMastrNummer: {
                  summary: 'Minimal call — MaStR number only',
                  value: { mastrNummer: 'SEE900012345678' },
                },
                l1Only: {
                  summary: 'L1-only check (no Overpass, fast for batch)',
                  value: { mastrNummer: 'SEE900012345678', skipOsmLayer: true },
                },
                byCoordinates: {
                  summary: 'Explicit coordinates with infrastructure details',
                  value: {
                    latitude: 49.481,
                    longitude: 8.432,
                    registeredGridOperatorName: 'STROMDAO Netze GmbH',
                    radiusMeters: 800,
                    includeInfrastructureDetails: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Validation result returned successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    mastrNummer: 'SEE900012345678',
                    installation: {
                      location: { lat: 49.481, lon: 8.432 },
                      installationType: 'solar',
                      bruttoleistungKW: 9.9,
                      registeredGridOperator: 'STROMDAO Netze GmbH',
                      registeredGridOperatorId: 'SNB935578300972',
                    },
                    validation: {
                      verdict: 'CONSISTENT',
                      confidenceScore: 72,
                      flags: [],
                      layer1_vnbdigital: {
                        queried: true,
                        status: 'QUERIED_SUCCESS',
                        vnbFound: 'STROMDAO Netze GmbH',
                        match: true,
                        authoritative: true,
                      },
                      layer2_osm: {
                        queried: true,
                        osmObjectsFound: 3,
                        nearestSubstation: {
                          osmId: 'node/123456789',
                          distanceMeters: 184,
                          type: 'distribution',
                          operatorTag: 'STROMDAO',
                        },
                        dominantOperator: 'STROMDAO',
                        dominantOperatorShare: 1.0,
                        radiusMeters: 500,
                      },
                    },
                    dataQuality: {
                      layer1Coverage: 'FULL',
                      layer2Coverage: 'MEDIUM',
                      osmDisclaimer: '© OpenStreetMap contributors (ODbL 1.0)',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { mastrNummer, latitude, longitude } = ctx.params;
        if (!mastrNummer && (latitude === undefined || longitude === undefined)) {
          throw new Error('Either mastrNummer or both latitude and longitude must be provided.');
        }
        try {
          const result = await _callMcpWithTimeout(
            'osm_geo_validate',
            ctx.params,
            ctx.meta.cernionToken
          );
          return _wrapMcpResult(result, mastrNummer || `${latitude},${longitude}`);
        } catch (err) {
          return _degraded(_classifyDegradedReason(err.message), err.message);
        }
      },
    },

    /**
     * Query all energy infrastructure within a given radius around a location.
     * Results are sorted by distance and include voltage level, operator tag, and
     * connection suitability assessment.
     * Tool: osm_infrastructure_nearby
     */
    infrastructureNearby: {
      rest: 'POST /infrastructure-nearby',
      params: {
        location: { type: 'string', optional: true },
        latitude: { type: 'number', optional: true },
        longitude: { type: 'number', optional: true },
        mastrNummer: { type: 'string', optional: true },
        radiusMeters: { type: 'number', optional: true, default: 1000, min: 1, max: 10000 },
        infraTypes: { type: 'array', items: { type: 'string' }, optional: true },
        voltageLevel: {
          type: 'enum',
          values: ['NS', 'MS', 'HS', 'EHS'],
          optional: true,
        },
        maxResults: { type: 'number', optional: true, default: 20, min: 1, max: 200 },
        constrainToBbox: { type: 'object', optional: true },
        include_geometry: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Energy infrastructure near a location (sorted by distance)',
        tags: ['OSM Geo (OpenStreetMap)'],
        description: `Returns all energy infrastructure (substations, transformers, lines, cables) within a defined radius, sorted by distance from the query centre.

Each object carries voltage level, operator tag, and a **\`connectionSuitability\`** assessment:
- \`SUITABLE_NS\` — low-voltage connection suitable (≤ 400 V)
- \`SUITABLE_MS\` — medium-voltage connection suitable (1–20 kV)
- \`SUITABLE_HS\` — high-voltage connection (> 20 kV)
- \`LINE_ONLY\` — line/cable only, no node
- \`UNKNOWN\` — voltage level not determinable

**Input:** one of \`location\` (lat,lon string), \`latitude\`+\`longitude\`, or \`mastrNummer\`.

Use \`constrainToBbox\` (directly from a \`vnbdigital_lookup\` bbox field) to restrict results to the relevant grid territory.

**Data:** © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/)`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'Coordinates as "lat,lon" string (e.g. "49.481,8.432").',
                    example: '49.481,8.432',
                  },
                  latitude: {
                    type: 'number',
                    description: 'Latitude of the query centre.',
                    example: 49.481,
                  },
                  longitude: {
                    type: 'number',
                    description: 'Longitude of the query centre.',
                    example: 8.432,
                  },
                  mastrNummer: {
                    type: 'string',
                    description: 'MaStR number — coordinates resolved from local DB.',
                    example: 'SEE900012345678',
                  },
                  radiusMeters: {
                    type: 'number',
                    description: 'Search radius in metres (max 10 000).',
                    default: 1000,
                    example: 1000,
                  },
                  infraTypes: {
                    type: 'array',
                    description:
                      'Filter by infrastructure type. Allowed: substation, transformer, line, cable.',
                    items: { type: 'string' },
                    example: ['substation', 'transformer'],
                  },
                  voltageLevel: {
                    type: 'string',
                    description: 'Filter by voltage level: NS, MS, HS, EHS.',
                    example: 'NS',
                  },
                  maxResults: {
                    type: 'number',
                    description: 'Maximum number of results.',
                    default: 20,
                    example: 20,
                  },
                  constrainToBbox: {
                    type: 'object',
                    description:
                      'VNBDigital bounding box — objects outside are filtered out. Compatible with the bbox field from vnbdigital_lookup.',
                    example: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
                    properties: {
                      north: { type: 'number' },
                      south: { type: 'number' },
                      east: { type: 'number' },
                      west: { type: 'number' },
                    },
                  },
                  include_geometry: {
                    type: 'boolean',
                    description: 'Include GeoJSON geometry for lines/cables.',
                    default: false,
                    example: false,
                  },
                },
              },
              examples: {
                nearestNS: {
                  summary: 'Nearest NS infrastructure for a PV plant',
                  value: {
                    latitude: 49.481,
                    longitude: 8.432,
                    radiusMeters: 500,
                    infraTypes: ['substation', 'transformer'],
                    voltageLevel: 'NS',
                  },
                },
                withBbox: {
                  summary: 'Infrastructure constrained to VNB territory',
                  value: {
                    location: '49.481,8.432',
                    radiusMeters: 2000,
                    constrainToBbox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
                  },
                },
                cablesByMastrNummer: {
                  summary: 'Lines/cables within 3 km via MaStR number',
                  value: {
                    mastrNummer: 'SEE900012345678',
                    radiusMeters: 3000,
                    infraTypes: ['line', 'cable'],
                    include_geometry: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Nearby infrastructure retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    queryCenter: { lat: 49.481, lon: 8.432 },
                    radiusMeters: 1000,
                    bboxConstrained: false,
                    totalFound: 7,
                    summary: {
                      nearestSubstationMeters: 184,
                      nearestNSConnectionMeters: 184,
                      nearestMSConnectionMeters: 430,
                      dominantOperator: 'STROMDAO',
                      substationsFound: 4,
                      osmCoverageQuality: 'MEDIUM',
                    },
                    infrastructure: [
                      {
                        osmId: 'node/123456789',
                        type: 'substation',
                        subtype: 'distribution',
                        distanceMeters: 184,
                        location: { lat: 49.4826, lon: 8.4298 },
                        voltageLevel: 'NS',
                        voltageIn: '20000',
                        voltageOut: '400',
                        operator: 'STROMDAO',
                        name: 'UW Innenstadt',
                        connectionSuitability: 'SUITABLE_NS',
                      },
                    ],
                    dataQuality: {
                      coverageLabel: 'MEDIUM',
                      disclaimer: '© OpenStreetMap contributors (ODbL 1.0)',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { location, latitude, longitude, mastrNummer } = ctx.params;
        if (!location && !mastrNummer && (latitude === undefined || longitude === undefined)) {
          throw new Error(
            'At least one coordinate source must be provided: location, mastrNummer, or latitude + longitude.'
          );
        }
        const queriedLocation = location || mastrNummer || `${latitude},${longitude}`;
        try {
          const result = await _callMcpWithTimeout(
            'osm_infrastructure_nearby',
            ctx.params,
            ctx.meta.cernionToken
          );
          return _wrapMcpResult(result, queriedLocation);
        } catch (err) {
          return _degraded(_classifyDegradedReason(err.message), err.message);
        }
      },
    },

    /**
     * Inventory of substations and transformers within a defined area.
     * Returns both the detail list and aggregated statistics (count by voltage
     * level, operator split, area density).
     * Tool: osm_substation_finder
     */
    substationFinder: {
      rest: 'POST /substation-finder',
      params: {
        location: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true },
        boundingBox: { type: 'object', optional: true },
        gridOperator: { type: 'string', optional: true },
        gridOperatorId: { type: 'string', optional: true },
        voltageLevel: {
          type: 'enum',
          values: ['NS', 'MS', 'HS', 'EHS'],
          optional: true,
        },
        substationType: {
          type: 'enum',
          values: ['distribution', 'transmission', 'ALL'],
          optional: true,
          default: 'ALL',
        },
        maxResults: { type: 'number', optional: true, default: 200, min: 1, max: 1000 },
        include_geometry: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Substation inventory for a grid territory or area',
        tags: ['OSM Geo (OpenStreetMap)'],
        description: `Inventories substations and transformers within a defined area using OpenStreetMap data.

Returns both a detail list and **aggregated statistics**:
- Total count by voltage level (NS/MS/HS/EHS)
- Operator split with dominant operator share
- Area density assessment: \`SPARSE\` < 0.5/km², \`RURAL\` 0.5–2, \`SUBURBAN\` 2–5, \`URBAN\` > 5 substations/km²

**Scope input:** at least one of \`location\` (place name), \`boundingBox\` (from vnbdigital_lookup), or \`gridOperator\` name.

**Data:** © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/)`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'Area name (Gemeinde, Stadt, Landkreis) for OSM area query.',
                    example: 'Ludwigshafen am Rhein',
                  },
                  postalCode: {
                    type: 'string',
                    description:
                      'German PLZ (postal code). Combined with location when both are provided (e.g. "74909 Meckesheim"). Can be used alone for PLZ-scoped queries.',
                    example: '74909',
                  },
                  boundingBox: {
                    type: 'object',
                    description:
                      'Geographic bounding box — directly compatible with the bbox field from vnbdigital_lookup.',
                    example: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
                    properties: {
                      north: { type: 'number' },
                      south: { type: 'number' },
                      east: { type: 'number' },
                      west: { type: 'number' },
                    },
                  },
                  gridOperator: {
                    type: 'string',
                    description: 'VNB name — used as OSM area name fallback.',
                    example: 'STROMDAO Netze GmbH',
                  },
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR VNB ID (SNB…).',
                    example: 'SNB935578300972',
                  },
                  voltageLevel: {
                    type: 'string',
                    description: 'Filter by voltage level: NS, MS, HS, EHS.',
                    example: 'MS',
                  },
                  substationType: {
                    type: 'string',
                    description: 'Filter by substation type: distribution, transmission, ALL.',
                    default: 'ALL',
                    example: 'ALL',
                  },
                  maxResults: {
                    type: 'number',
                    description: 'Maximum number of objects in the detail list.',
                    default: 200,
                    example: 200,
                  },
                  include_geometry: {
                    type: 'boolean',
                    description: 'Include polygon geometry for way/relation substations.',
                    default: false,
                    example: false,
                  },
                },
              },
              examples: {
                byBbox: {
                  summary: 'All substations in a VNB territory (via bbox)',
                  value: {
                    boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
                    gridOperator: 'STROMDAO Netze GmbH',
                  },
                },
                hsMunich: {
                  summary: 'HS substations in Munich only',
                  value: {
                    location: 'München',
                    voltageLevel: 'HS',
                    substationType: 'transmission',
                  },
                },
                countyWithGeometry: {
                  summary: 'Full county inventory with polygon geometry',
                  value: {
                    location: 'Rhein-Pfalz-Kreis',
                    include_geometry: true,
                    maxResults: 500,
                  },
                },
                narrowLocality: {
                  summary: 'Narrow locality query with PLZ (Meckesheim)',
                  value: {
                    location: 'Meckesheim',
                    postalCode: '74909',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Substation inventory retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    query: {
                      scopeSource: 'boundingBox',
                      gridOperator: 'STROMDAO Netze GmbH',
                      bbox: [8.298, 49.427, 8.477, 49.548],
                      voltageLevel: 'ALL',
                      substationType: 'ALL',
                    },
                    summary: {
                      totalSubstations: 312,
                      returnedSubstations: 200,
                      byVoltageLevel: { NS_MS: 289, MS_HS: 21, HS_EHS: 2, UNKNOWN: 0 },
                      byOperator: [
                        { operator: 'STROMDAO', count: 287, share: 0.92 },
                        { operator: 'Stadtwerke Ludwigshafen', count: 14, share: 0.04 },
                      ],
                      dominantOperator: 'STROMDAO',
                      dominantOperatorShare: 0.92,
                      areaKm2: 85.4,
                      densityAssessment: { substationsPerKm2: 3.65, label: 'URBAN' },
                    },
                    substations: [
                      {
                        osmId: 'way/987654321',
                        type: 'substation',
                        subtype: 'distribution',
                        location: { lat: 49.487, lon: 8.451 },
                        voltageLevel: 'NS',
                        operator: 'STROMDAO',
                        name: 'TUS Oggersheim',
                      },
                    ],
                    dataQuality: {
                      coverageLabel: 'MEDIUM',
                      disclaimer: '© OpenStreetMap contributors (ODbL 1.0)',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { location, postalCode, boundingBox, gridOperator } = ctx.params;
        if (!location && !postalCode && !boundingBox && !gridOperator) {
          throw new Error(
            'At least one scope parameter must be provided: location, postalCode, boundingBox, or gridOperator.'
          );
        }
        const params = { ...ctx.params };
        if (postalCode && location) {
          params.location = `${postalCode} ${location}`;
        } else if (postalCode && !location) {
          params.location = postalCode;
        }
        const queriedLocation = params.location || gridOperator || 'bbox';
        try {
          const result = await _callMcpWithTimeout(
            'osm_substation_finder',
            params,
            ctx.meta.cernionToken
          );
          return _wrapMcpResult(result, queriedLocation);
        } catch (err) {
          return _degraded(_classifyDegradedReason(err.message), err.message);
        }
      },
    },

    /**
     * Analyse visible grid topology within an area by extracting nodes
     * (substations, transformers) and edges (lines, cables) from OSM and
     * computing graph metrics.
     * Tool: osm_grid_topology
     */
    gridTopology: {
      rest: 'POST /grid-topology',
      params: {
        location: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true },
        boundingBox: { type: 'object', optional: true },
        gridOperator: { type: 'string', optional: true },
        voltageLevel: {
          type: 'enum',
          values: ['NS', 'MS', 'HS', 'EHS'],
          optional: true,
        },
        fromOsmId: { type: 'string', optional: true },
        toOsmId: { type: 'string', optional: true },
        includePathAnalysis: { type: 'boolean', optional: true, default: false },
        includeGraphData: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Grid topology analysis (nodes, edges, graph metrics, optional path analysis)',
        tags: ['OSM Geo (OpenStreetMap)'],
        description: `Analyses the visible grid topology within an area by extracting nodes (substations, transformers) and edges (lines, cables) from OpenStreetMap.

**Graph metrics returned:**
- Node and edge counts, average node degree
- Topology type: \`RADIAL\` (indicator < 0.5), \`MIXED\` (0.5–0.7), \`RING\` (> 0.7 — higher redundancy)
- Voltage-level breakdown

**Optional path analysis** (\`includePathAnalysis: true\`): shortest path between \`fromOsmId\` → \`toOsmId\` with hop count, total length, and confidence rating.

**Optional raw graph data** (\`includeGraphData: true\`): full node/edge list for downstream processing.

**Scope input:** at least one of \`location\` (place name), \`boundingBox\`, or \`gridOperator\` name.

**Coverage note:** Line coverage in OSM is ~40–60 % for German distribution networks. Topology metrics are therefore lower bounds.

**Data:** © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/)`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'Area name (Gemeinde, Stadt, Landkreis).',
                    example: 'Ludwigshafen am Rhein',
                  },
                  postalCode: {
                    type: 'string',
                    description:
                      'German PLZ (postal code). Combined with location when both are provided (e.g. "74909 Meckesheim"). Can be used alone for PLZ-scoped queries.',
                    example: '74909',
                  },
                  boundingBox: {
                    type: 'object',
                    description:
                      'Explicit geographic bounding box — directly compatible with vnbdigital_lookup bbox.',
                    example: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
                    properties: {
                      north: { type: 'number' },
                      south: { type: 'number' },
                      east: { type: 'number' },
                      west: { type: 'number' },
                    },
                  },
                  gridOperator: {
                    type: 'string',
                    description: 'VNB name — used as OSM area name.',
                    example: 'STROMDAO Netze GmbH',
                  },
                  voltageLevel: {
                    type: 'string',
                    description: 'Restrict analysis to one voltage level: NS, MS, HS, EHS.',
                    example: 'MS',
                  },
                  fromOsmId: {
                    type: 'string',
                    description: 'Start-node OSM ID for path analysis (e.g. "node/1234567").',
                    example: 'node/123456789',
                  },
                  toOsmId: {
                    type: 'string',
                    description: 'Target-node OSM ID for path analysis.',
                    example: 'node/987654321',
                  },
                  includePathAnalysis: {
                    type: 'boolean',
                    description: 'Compute shortest path between fromOsmId → toOsmId.',
                    default: false,
                    example: false,
                  },
                  includeGraphData: {
                    type: 'boolean',
                    description: 'Include raw node/edge list for downstream processing.',
                    default: false,
                    example: false,
                  },
                },
              },
              examples: {
                ludwigshafenMS: {
                  summary: 'MS topology for Ludwigshafen',
                  value: { location: 'Ludwigshafen am Rhein', voltageLevel: 'MS' },
                },
                pathAnalysis: {
                  summary: 'Path analysis between two OSM nodes',
                  value: {
                    location: 'Ludwigshafen am Rhein',
                    voltageLevel: 'MS',
                    fromOsmId: 'node/123456789',
                    toOsmId: 'node/987654321',
                    includePathAnalysis: true,
                  },
                },
                byBboxWithGraphData: {
                  summary: 'Topology with raw graph data via bounding box',
                  value: {
                    boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
                    voltageLevel: 'MS',
                    includeGraphData: true,
                  },
                },
                narrowLocality: {
                  summary: 'Narrow locality topology (Meckesheim / 74909)',
                  value: {
                    location: 'Meckesheim',
                    postalCode: '74909',
                    includePathAnalysis: false,
                    includeGraphData: false,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Topology analysis returned successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    area: 'Ludwigshafen am Rhein',
                    scopeSource: 'location_name',
                    voltageFilter: null,
                    topologyMetrics: {
                      nodes: 847,
                      edges: 1203,
                      avgNodeDegree: 2.84,
                      topologyType: 'RING',
                      topologyIndicator: 0.84,
                      voltageBreakdown: {
                        NS: { nodes: 721, edges: 987 },
                        MS: { nodes: 124, edges: 214 },
                        HS: { nodes: 2, edges: 2 },
                        UNKNOWN: { nodes: 0, edges: 0 },
                      },
                    },
                    pathAnalysis: { requested: false },
                    dataQuality: {
                      source: '© OpenStreetMap contributors (ODbL 1.0)',
                      osmEdgeCoverageEstimate: 0.47,
                      coverageLabel: 'MEDIUM',
                      warning:
                        'Leitungsnetz ca. 47% in OSM erfasst. Topologiemetriken sind Untergrenzen.',
                      disclaimer: '© OpenStreetMap contributors (ODbL 1.0)',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { location, postalCode, boundingBox, gridOperator } = ctx.params;
        if (!location && !postalCode && !boundingBox && !gridOperator) {
          throw new Error(
            'At least one scope parameter must be provided: location, postalCode, boundingBox, or gridOperator.'
          );
        }
        const params = { ...ctx.params };
        if (postalCode && location) {
          params.location = `${postalCode} ${location}`;
        } else if (postalCode && !location) {
          params.location = postalCode;
        }
        const queriedLocation = params.location || gridOperator || 'bbox';
        try {
          const result = await _callMcpWithTimeout(
            'osm_grid_topology',
            params,
            ctx.meta.cernionToken
          );
          return _wrapMcpResult(result, queriedLocation);
        } catch (err) {
          return _degraded(_classifyDegradedReason(err.message), err.message);
        }
      },
    },
  },
};
