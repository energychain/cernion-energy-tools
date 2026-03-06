/**
 * Grid Operations Service
 *
 * Network data, redispatch, capacity analysis
 * Maps to Cernion MCP grid operations category
 */

const CernionMCPClient = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');
const { applyFormat, convertToCSV, FORMAT_PARAM_SCHEMA, FORMAT_RESPONSE_CONTENT } = require('../src/format-response');

// ─── Helpers for redispatch text-narrative responses ──────────────────────────

/**
 * Extract the human-readable narrative text from a redispatch job result.
 * Handles the three shapes the MCP layer can produce:
 *  1. result.data.content[0].text  (most common — async job completion)
 *  2. result.data  as a plain string
 *  3. result  as a plain string
 */
function extractRedispatchText(result) {
  if (!result) return '';
  if (result.data && typeof result.data === 'object') {
    const content = result.data.content;
    if (Array.isArray(content) && content[0] && content[0].text) return content[0].text;
  }
  if (typeof result.data === 'string') return result.data;
  if (typeof result === 'string') return result;
  return '';
}

/**
 * Parse the narrative text returned by cernion_redispatch_export.
 * Extracts:
 *  - metadata: gridOperatorName, totalInstallations, totalCapacityKW
 *  - rows: from the Markdown preview table (first 5 installations)
 */
function parseRedispatchExportText(text) {
  const metadata = {};

  const nameMatch = text.match(/Name:\s*(.+?)(?:\r?\n|$)/);
  if (nameMatch) metadata.gridOperatorName = nameMatch[1].trim();

  // Extract the first SNB… MaStR ID from "MaStR Number(s): SNB..."
  const mastrMatch = text.match(/MaStR Number\(s\):\s*(SNB\w+)/);
  if (mastrMatch) metadata.mastrId = mastrMatch[1].trim();

  const totalMatch = text.match(/Total Installations:\s*(\d+)/);
  if (totalMatch) metadata.totalInstallations = parseInt(totalMatch[1], 10);

  const capMatch = text.match(/Total Capacity:\s*([\d.]+)\s*kW/);
  if (capMatch) metadata.totalCapacityKW = parseFloat(capMatch[1]);

  // Parse Markdown preview table — skip header ("Type") and separator ("---") rows
  const rows = [];
  const tableRowRegex = /^\|(.+?)\|(.+?)\|(.+?)\|(.+?)\|$/gm;
  let m;
  while ((m = tableRowRegex.exec(text)) !== null) {
    const cells = [m[1], m[2], m[3], m[4]].map((c) => c.trim());
    if (cells[0].toLowerCase() === 'type') continue; // header
    if (cells.every((c) => /^-*$/.test(c))) continue; // separator
    rows.push({ type: cells[0], capacity_kW: cells[1], city: cells[2], status: cells[3] });
  }

  return { metadata, rows };
}

module.exports = {
  name: 'grid-operations',

  settings: {
    defaultTimeout: 15 * 60 * 1000, // 15 minutes for long-running MCP tools
  },

  actions: {
    /**
     * Grid operation data (load, frequency, flows, redispatch)
     * Tool: cernion_grid_data
     */
    gridData: {
      rest: 'POST /grid-data',
      params: {
        dataType: { type: 'enum', values: ['load', 'frequency', 'flows', 'redispatch'] },
        region: { type: 'string', min: 1 },
        date: { type: 'string' },
        gridOperator: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Grid operation data (load, frequency, flows, redispatch)',
        tags: ['Grid Operations'],
        description: `Query real-time and historical grid operation data for network planning, congestion analysis, and frequency stability studies.

**Data Types**:
- **load**: Grid load profiles (consumption patterns, peak loads, valley periods)
  - Use cases: Demand forecasting, procurement planning, capacity adequacy assessment
  - Resolution: 15-minute intervals (96 data points/day)

- **frequency**: Grid frequency measurements (50 Hz nominal, ±0.2 Hz operational range)
  - Use cases: Frequency stability analysis, ROCOF studies, balancing energy optimization
  - Critical: <49.8 Hz or >50.2 Hz indicates grid stress

- **flows**: Power flows between grid areas (import/export, cross-border, internal)
  - Use cases: Grid congestion analysis, redispatch forecasting, interconnector utilization
  - Identifies: Bottlenecks, structural congestion, trading opportunities

- **redispatch**: Redispatch measures and curtailment events
  - Use cases: Cost monitoring (€300M+/year in Germany), investment justification, risk assessment for new installations
  - Critical for: Redispatch 2.0 compliance (installations ≥100 kW), NEST project justification (§11 EnWG)

**Key Applications**:
- Grid congestion analysis and forecasting
- Redispatch cost monitoring and optimization
- Frequency stability studies (TSO coordination)
- Cross-border capacity utilization
- Investment planning (grid expansion vs. smart grid solutions)`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dataType', 'region', 'date'],
                properties: {
                  dataType: {
                    type: 'string',
                    enum: ['load', 'frequency', 'flows', 'redispatch'],
                    description: 'Type of grid data to retrieve',
                    example: 'load',
                  },
                  region: {
                    type: 'string',
                    description: 'Region/grid operator name',
                    example: 'Stadtwerke München',
                  },
                  date: {
                    type: 'string',
                    description: 'Date (YYYY-MM-DD)',
                    example: '2026-02-01',
                  },
                  gridOperator: {
                    type: 'string',
                    description: 'Optional: Specific grid operator',
                    example: 'Netze BW',
                  },
                },
              },
              examples: {
                loadData: {
                  summary: 'Grid load data',
                  value: {
                    dataType: 'load',
                    region: 'Bayern',
                    date: '2026-02-01',
                    gridOperator: 'Stadtwerke München',
                  },
                },
                frequencyData: {
                  summary: 'Frequency data',
                  value: {
                    dataType: 'frequency',
                    region: 'Germany',
                    date: '2026-02-01',
                  },
                },
                redispatchData: {
                  summary: 'Redispatch measures',
                  value: {
                    dataType: 'redispatch',
                    region: 'Baden-Württemberg',
                    date: '2026-02-01',
                    gridOperator: 'Netze BW',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        // Use auto-polling for async jobs (some grid data queries can take up to 10 minutes)
        return await callWithAutoPoll(
          'cernion_grid_data',
          ctx.params,
          {
            maxWaitTime: 12 * 60 * 1000, // 12 minutes max
            pollInterval: 3000, // Poll every 3 seconds
          },
          ctx.meta.cernionToken // Optional Bearer token from request, falls back to env
        );
      },
    },

    /**
     * Search VNBdigital for an address, location, or VNB name
     * Tool: vnbdigital_search
     */
    vnbdigitalSearch: {
      rest: 'POST /vnbdigital-search',
      params: {
        searchTerm: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Search VNBdigital for address, location, or VNB name',
        tags: ['Grid Operations'],
        description: `Search VNBdigital to resolve addresses, locations, or VNB names into IDs for follow-up lookups.

**Use Cases:**
- Identify addresses and locations for VNB lookup
- Find postcode/community IDs for detailed VNB results
- VNB search by name`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['searchTerm'],
                properties: {
                  searchTerm: {
                    type: 'string',
                    description: 'Address, place, or VNB name',
                    example: 'Gerhard-Weiser-Ring 29, 69256 Mauer',
                  },
                },
              },
              examples: {
                addressSearch: {
                  summary: 'Address search',
                  value: {
                    searchTerm: 'Gerhard-Weiser-Ring 29, 69256 Mauer',
                  },
                },
                vnbNameSearch: {
                  summary: 'VNB name search',
                  value: {
                    searchTerm: 'Netze BW',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'vnbdigital_search',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Lookup VNBs and planning regions by coordinates, postcode ID, or community ID
     * Tool: vnbdigital_lookup
     */
    vnbdigitalLookup: {
      rest: 'POST /vnbdigital-lookup',
      params: {
        searchType: { type: 'enum', values: ['coordinates', 'postcode', 'community'] },
        coordinates: { type: 'string', optional: true },
        postcodeId: { type: 'string', optional: true },
        communityId: { type: 'string', optional: true },
        filter: {
          type: 'object',
          optional: true,
          props: {
            onlyNap: { type: 'boolean', optional: true },
            voltageTypes: { type: 'array', items: 'string', optional: true },
            withRegions: { type: 'boolean', optional: true },
          },
        },
      },
      openapi: {
        summary: 'Lookup VNBs and planning regions by coordinates/postcode/community',
        tags: ['Grid Operations'],
        description: `Lookup VNBs and planning regions using VNBdigital. Provide one of:
- **coordinates** for geolocation lookup
- **postcodeId** from vnbdigital_search
- **communityId** from vnbdigital_search`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['searchType'],
                properties: {
                  searchType: {
                    type: 'string',
                    enum: ['coordinates', 'postcode', 'community'],
                    description: 'Lookup type',
                    example: 'coordinates',
                  },
                  coordinates: {
                    type: 'string',
                    description: 'Latitude,Longitude (required for coordinates search)',
                    example: '49.34206,8.80022',
                  },
                  postcodeId: {
                    type: 'string',
                    description:
                      'Postcode ID from vnbdigital_search (required for postcode search)',
                    example: 'DEBWhk01000gMZ1V',
                  },
                  communityId: {
                    type: 'string',
                    description:
                      'Community ID from vnbdigital_search (required for community search)',
                    example: 'DEBWhk01000gMZ2A',
                  },
                  filter: {
                    type: 'object',
                    description: 'Optional filter settings',
                    properties: {
                      onlyNap: {
                        type: 'boolean',
                        description: 'Only NAP entries',
                        default: false,
                      },
                      voltageTypes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter by voltage types',
                        example: ['Niederspannung', 'Mittelspannung'],
                      },
                      withRegions: {
                        type: 'boolean',
                        description: 'Include planning regions',
                        default: true,
                      },
                    },
                    example: { onlyNap: false, voltageTypes: ['Niederspannung'], withRegions: true },
                  },
                },
              },
              examples: {
                coordinateLookup: {
                  summary: 'Coordinates lookup',
                  value: {
                    searchType: 'coordinates',
                    coordinates: '49.34206,8.80022',
                    filter: {
                      onlyNap: false,
                      voltageTypes: ['Niederspannung', 'Mittelspannung'],
                      withRegions: true,
                    },
                  },
                },
                postcodeLookup: {
                  summary: 'Postcode lookup',
                  value: {
                    searchType: 'postcode',
                    postcodeId: 'DEBWhk01000gMZ1V',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { searchType, coordinates, postcodeId, communityId } = ctx.params;

        if (searchType === 'coordinates' && !coordinates) {
          throw new Error('coordinates is required when searchType is "coordinates"');
        }

        if (searchType === 'postcode' && !postcodeId) {
          throw new Error('postcodeId is required when searchType is "postcode"');
        }

        if (searchType === 'community' && !communityId) {
          throw new Error('communityId is required when searchType is "community"');
        }

        return await CernionMCPClient.callWithNewSession(
          'vnbdigital_lookup',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Lookup MaStR ID for a VNB (grid operator) using BDEW code
     * Tool: cernion_vnb_lookup
     */
    vnbLookup: {
      rest: 'POST /vnb-lookup',
      params: {
        bdew: { type: 'string', min: 1 },
        limit: { type: 'number', optional: true, default: 5, min: 1, max: 50, convert: true },
        city: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Lookup MaStR ID for a VNB (grid operator) using BDEW code',
        tags: ['Grid Operations'],
        description: `Resolve BDEW codes to MaStR Netzbetreiber IDs (SNB/GNB) for downstream grid-operator queries. If the primary lookup fails, an optional city param triggers a fallback that extracts the SNB from a sample installation in that city.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bdew'],
                properties: {
                  bdew: {
                    type: 'string',
                    description: 'BDEW code',
                    example: '9900992720003',
                  },
                  limit: {
                    type: 'integer',
                    description: 'Max market partner matches to consider',
                    default: 5,
                    minimum: 1,
                    maximum: 50,
                  },
                  city: {
                    type: 'string',
                    description: 'Optional operator city (e.g. from marketPartners contacts). Used as fallback when cernion_vnb_lookup returns no result — extracts SNB from a sample installation in that city.',
                    example: 'Hannover',
                  },
                },
              },
              examples: {
                defaultLookup: {
                  summary: 'BDEW lookup',
                  value: {
                    bdew: '9900992720003',
                    limit: 5,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { bdew, limit, city } = ctx.params;

        // Primary lookup via cernion_vnb_lookup
        const primary = await CernionMCPClient.callWithNewSession(
          'cernion_vnb_lookup',
          { bdew, limit },
          ctx.meta.cernionToken
        );

        // Return immediately if mastrId was found
        if (primary?.data?.mastrId) return primary;

        // Fallback: extract SNB from a sample installation in the operator's city
        if (city) {
          this.logger.info(
            `[vnbLookup] cernion_vnb_lookup returned null for BDEW ${bdew}, trying city fallback: ${city}`
          );
          try {
            const fallback = await callWithAutoPoll(
              'cernion_installations_local',
              { type: 'solar', gemeinde: city, limit: 1, includeStats: false, format: 'detailed', includeNapData: true },
              { maxWaitTime: 30 * 1000, pollInterval: 1000 },
              ctx.meta.cernionToken
            );

            const installations =
              fallback?.installations ||
              fallback?.data?.installations ||
              [];
            const snb =
              installations[0]?.napData?.netzbetreiberMastrNummer ||
              installations[0]?.nap?.netzbetreiberMaStRNummer;

            if (snb) {
              this.logger.info(`[vnbLookup] SNB extracted via city fallback: ${snb}`);
              return {
                success: true,
                data: {
                  bdew,
                  mastrId: snb,
                  mastrIds: [snb],
                  companyName: city,
                  source: 'city-nap-fallback',
                  cached: false,
                  message: `SNB resolved via sample installation in ${city}`,
                },
                metadata: primary?.metadata,
              };
            }
          } catch (err) {
            this.logger.warn(`[vnbLookup] City fallback failed: ${err.message}`);
          }
        }

        return primary;
      },
    },

    /**
     * Comprehensive grid operator analysis
     * Tool: cernion_grid_operator_analysis
     */
    operatorAnalysis: {
      rest: 'POST /operator-analysis',
      params: {
        gridOperator: { type: 'string', optional: true, min: 1 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        gridOperatorBdewCode: { type: 'string', optional: true, min: 1 },
        date: { type: 'string', optional: true },
        includeRedispatch: { type: 'boolean', optional: true, default: true },
        includeFeedInPatterns: { type: 'boolean', optional: true, default: true },
        includeCapacityMap: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Comprehensive grid operator analysis (installations, feed-in, redispatch)',
        tags: ['Grid Operations'],
        description: `Deep-dive analysis of grid operator network including all connected installations, redispatch potential, feed-in patterns, and grid stress points. **Essential for DSO/TSO network planning and investment prioritization.**

**Analysis Components**:

1. **Connected Installations** (from MaStR registry):
   - Total count by technology type (PV, wind, storage, biomass, CHP)
   - Installed capacity breakdown (MW by voltage level: NS/MS/HS)
   - Geographic distribution (identify concentration hotspots)
   - Commissioning trends (year-over-year growth)

2. **Redispatch Potential** (Redispatch 2.0 eligible installations ≥100 kW):
   - Eligible installations count and capacity
   - By technology (wind=highest curtailment risk, solar=seasonal)
   - By location (identify congestion-prone areas)
   - Cost exposure estimation (€/MWh curtailment * at-risk capacity)

3. **Feed-in Patterns** (hourly/seasonal analysis):
   - Peak feed-in times (solar: 11-14h, wind: variable)
   - Simultaneity factors (critical for grid dimensioning)
   - Voltage rise risk assessment (high PV density areas)
   - Reverse power flow analysis (substation overload risk)

4. **Capacity Distribution Map**:
   - Hotspot identification (streets/transformers with high concentration)
   - Grid stress visualization (utilization >85% = investment priority)
   - White spot analysis (areas with expansion potential)
   - Transformer capacity vs. connected load

**Use Cases**:
- **Network Planning**: Identify investment needs (transformers, lines, substations)
- **Risk Assessment**: Redispatch cost exposure, voltage stability, overload risk
- **Investment Prioritization**: ROI-driven CAPEX allocation, NEST project justification
- **Regulatory Compliance**: Redispatch 2.0, §14a EnWG controllable devices
- **Strategic Planning**: Expansion areas, smart grid solutions, §11 EnWG grid optimization

**Critical Success Factors**:
- Update monthly (MaStR registry changes frequently)
- Focus on MS/NS boundary (highest stress points)
- Prioritize prosumer-dense areas (highest grid impact per km²)
- Combine with dynamic tariffs (§14a EnWG) for CAPEX reduction`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperator: {
                    type: 'string',
                    description: 'Grid operator name (fuzzy matching)',
                    example: 'Stadtwerke München',
                  },
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR Netzbetreiber-ID (SNB/GNB...)',
                    example: 'SNB935578300972',
                  },
                  gridOperatorBdewCode: {
                    type: 'string',
                    description: 'BDEW code (resolved to MaStR Netzbetreiber)',
                    example: '9900992720003',
                  },
                  date: {
                    type: 'string',
                    description: 'Optional: Specific date for analysis',
                    example: '2026-02-01',
                  },
                  includeRedispatch: {
                    type: 'boolean',
                    description: 'Include redispatch potential analysis',
                    default: true,
                  },
                  includeFeedInPatterns: {
                    type: 'boolean',
                    description: 'Include feed-in pattern analysis',
                    default: true,
                  },
                  includeCapacityMap: {
                    type: 'boolean',
                    description: 'Include capacity distribution map',
                    default: true,
                  },
                },
              },
              examples: {
                fullAnalysis: {
                  summary: 'Full grid operator analysis',
                  value: {
                    gridOperator: 'Stadtwerke München',
                    includeRedispatch: true,
                    includeFeedInPatterns: true,
                    includeCapacityMap: true,
                  },
                },
                byMastrId: {
                  summary: 'Analysis by MaStR ID',
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    includeRedispatch: true,
                  },
                },
                byBdewCode: {
                  summary: 'Analysis by BDEW code',
                  value: {
                    gridOperatorBdewCode: '9900992720003',
                    includeCapacityMap: true,
                  },
                },
                redispatchFocus: {
                  summary: 'Redispatch-focused analysis',
                  value: {
                    gridOperator: 'Netze BW',
                    date: '2026-02-01',
                    includeRedispatch: true,
                    includeFeedInPatterns: false,
                    includeCapacityMap: false,
                  },
                },
                capacityMapping: {
                  summary: 'Capacity distribution mapping',
                  value: {
                    gridOperator: 'TWL Netze',
                    includeCapacityMap: true,
                    includeFeedInPatterns: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { gridOperator, gridOperatorId, gridOperatorBdewCode } = ctx.params;

        if (!gridOperator && !gridOperatorId && !gridOperatorBdewCode) {
          throw new Error(
            'One of gridOperator, gridOperatorId, or gridOperatorBdewCode is required'
          );
        }

        // Use auto-polling for async jobs (operator analysis can be slow for large grids)
        return await callWithAutoPoll(
          'cernion_grid_operator_analysis',
          ctx.params,
          {
            maxWaitTime: 10 * 60 * 1000, // 10 minutes max
            pollInterval: 3000, // Poll every 3 seconds
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Network capacity utilization analysis
     * Tool: cernion_capacity_utilization
     */
    capacityUtilization: {
      rest: 'POST /capacity-utilization',
      params: {
        gridOperator: { type: 'string', min: 1 },
        date: { type: 'string', optional: true },
        startDate: { type: 'string', optional: true },
        endDate: { type: 'string', optional: true },
        voltageLevel: {
          type: 'enum',
          values: ['NS', 'MS', 'HS', 'HöS', 'all'],
          optional: true,
          default: 'all',
        },
        includeHeatmap: { type: 'boolean', optional: true, default: true },
        includeSimultaneityFactors: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Network capacity utilization analysis (transformers, lines, heatmaps)',
        tags: ['Grid Operations'],
        description:
          'Calculate equipment loading, temporal heatmaps, and investment prioritization',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['gridOperator'],
                properties: {
                  gridOperator: {
                    type: 'string',
                    description: 'Grid operator name',
                    example: 'Stadtwerke München',
                  },
                  date: {
                    type: 'string',
                    description: 'Specific date for analysis',
                    example: '2026-02-01',
                  },
                  startDate: {
                    type: 'string',
                    description: 'Start date for time range analysis',
                    example: '2026-01-01',
                  },
                  endDate: {
                    type: 'string',
                    description: 'End date for time range analysis',
                    example: '2026-01-31',
                  },
                  voltageLevel: {
                    type: 'string',
                    enum: ['NS', 'MS', 'HS', 'HöS', 'all'],
                    description: 'Voltage level filter (NS=low, MS=medium, HS/HöS=high)',
                    default: 'all',
                  },
                  includeHeatmap: {
                    type: 'boolean',
                    description: 'Include temporal utilization heatmap',
                    default: true,
                  },
                  includeSimultaneityFactors: {
                    type: 'boolean',
                    description: 'Include simultaneity factor analysis',
                    default: true,
                  },
                },
              },
              examples: {
                singleDayAnalysis: {
                  summary: 'Single day capacity analysis',
                  value: {
                    gridOperator: 'Stadtwerke München',
                    date: '2026-02-01',
                    voltageLevel: 'all',
                    includeHeatmap: true,
                    includeSimultaneityFactors: true,
                  },
                },
                monthlyTrend: {
                  summary: 'Monthly capacity trend',
                  value: {
                    gridOperator: 'Netze BW',
                    startDate: '2026-01-01',
                    endDate: '2026-01-31',
                    voltageLevel: 'MS',
                    includeHeatmap: true,
                  },
                },
                lowVoltageOnly: {
                  summary: 'Low voltage network analysis',
                  value: {
                    gridOperator: 'TWL Netze',
                    startDate: '2026-02-01',
                    endDate: '2026-02-07',
                    voltageLevel: 'NS',
                    includeSimultaneityFactors: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        // Use auto-polling for async jobs (capacity analysis can be slow)
        return await callWithAutoPoll(
          'cernion_capacity_utilization',
          ctx.params,
          {
            maxWaitTime: 10 * 60 * 1000, // 10 minutes max
            pollInterval: 3000, // Poll every 3 seconds
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Export redispatch 2.0 installations
     * Tool: cernion_redispatch_export
     */
    redispatchExport: {
      rest: 'POST /redispatch-export',
      params: {
        gridOperator: { type: 'string', optional: true, min: 1 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        gridOperatorBdewCode: { type: 'string', optional: true, min: 1 },
        minCapacity: { type: 'number', optional: true, default: 100, min: 0, convert: true },
        types: [
          { type: 'array', items: 'string', optional: true },
          { type: 'string', optional: true },
        ],
        autoConfirm: { type: 'boolean', optional: true, default: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Export redispatch 2.0 installations (≥100 kW) per grid operator',
        tags: ['Grid Operations'],
        description: 'Returns installations that participate in redispatch (async job)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperator: {
                    type: 'string',
                    description: 'Grid operator name (fuzzy matching)',
                    example: 'Stadtwerke München',
                  },
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR Netzbetreiber-ID (SNB/GNB...)',
                    example: 'SNB935578300972',
                  },
                  gridOperatorBdewCode: {
                    type: 'string',
                    description: 'BDEW code (resolved to MaStR Netzbetreiber)',
                    example: '9900992720003',
                  },
                  minCapacity: {
                    type: 'number',
                    description: 'Minimum capacity in kW',
                    minimum: 0,
                    default: 100,
                    example: 100,
                  },
                  types: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['solar', 'wind', 'storage', 'combustion', 'biomass'],
                    },
                    description: 'Optional: Filter by installation types',
                    example: ['solar', 'wind'],
                  },
                  autoConfirm: {
                    type: 'boolean',
                    description: 'Skip confirmation prompt',
                    default: true,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                allTypes: {
                  summary: 'All redispatch installations',
                  value: {
                    gridOperator: 'Stadtwerke München',
                    minCapacity: 100,
                    autoConfirm: true,
                  },
                },
                solarWindOnly: {
                  summary: 'Solar and wind only',
                  value: {
                    gridOperator: 'Netze BW',
                    minCapacity: 100,
                    types: ['solar', 'wind'],
                    autoConfirm: true,
                  },
                },
                byMastrId: {
                  summary: 'Export by MaStR ID',
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    minCapacity: 100,
                    autoConfirm: true,
                  },
                },
                byMastrIdCsv: {
                  summary: 'Export by MaStR ID — CSV download',
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    minCapacity: 100,
                    autoConfirm: true,
                    format: 'csv',
                  },
                },
                byBdewCode: {
                  summary: 'Export by BDEW code',
                  value: {
                    gridOperatorBdewCode: '9900992720003',
                    minCapacity: 100,
                    autoConfirm: true,
                  },
                },
                largeInstallations: {
                  summary: 'Large installations (>500kW)',
                  value: {
                    gridOperator: 'TWL Netze',
                    minCapacity: 500,
                    autoConfirm: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Redispatch installations exported successfully',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        const { gridOperator, gridOperatorId, gridOperatorBdewCode, format, minCapacity = 100 } =
          ctx.params;

        if (!gridOperator && !gridOperatorId && !gridOperatorBdewCode) {
          throw new Error(
            'One of gridOperator, gridOperatorId, or gridOperatorBdewCode is required'
          );
        }

        // Normalize types: accept comma-separated string (e.g. "solar,wind,storage") or array
        const mcpParams = { ...ctx.params };
        delete mcpParams.format; // strip before forwarding to MCP tool
        if (typeof mcpParams.types === 'string') {
          mcpParams.types = mcpParams.types.split(',').map((t) => t.trim()).filter(Boolean);
        }

        // Use auto-polling for async jobs (redispatch export typically returns job ID)
        const result = await callWithAutoPoll(
          'cernion_redispatch_export',
          mcpParams,
          {
            maxWaitTime: 10 * 60 * 1000, // 10 minutes max
            pollInterval: 2000, // Poll every 2 seconds
          },
          ctx.meta.cernionToken
        );

        if (format === 'csv' || format === 'xlsx' || format === 'xls') {
          const text = extractRedispatchText(result);

          // Guard: MCP-level error flag (isError: true) — e.g. failed async job
          if (result.data?.isError) {
            throw new Error(
              text.replace(/^[❌\s*⚡]+/, '').trim().substring(0, 300) ||
                'Redispatch export error'
            );
          }

          const { metadata, rows: previewRows } = parseRedispatchExportText(text);
          const operatorLabel =
            metadata.gridOperatorName ||
            gridOperatorId ||
            gridOperator ||
            gridOperatorBdewCode ||
            '';

          // ── Full data via cernion_installations_local ────────────────
          // The async export tool returns only a 5-row preview table in its
          // narrative. For a complete export we query the local MaStR database
          // directly using the resolved operator MaStR ID.
          const resolvedMastrId = gridOperatorId || metadata.mastrId;
          let exportRows;
          let isPreviewFallback = false;

          if (resolvedMastrId) {
            try {
              const localResult = await CernionMCPClient.callWithNewSession(
                'cernion_installations_local',
                {
                  gridOperatorMastrId: resolvedMastrId,
                  minCapacity,
                  type: 'all',
                  format: 'detailed',
                  limit: 10000,
                },
                ctx.meta.cernionToken
              );
              // Support both response shapes:
              //   - callTool JSON-spread: localResult.installations (direct)
              //   - wrapped:             localResult.data.installations
              const installations =
                localResult?.installations ||
                localResult?.data?.installations ||
                [];
              // Filter by types when specified (map 'combustion' → any non-standard type)
              const typeSet =
                Array.isArray(mcpParams.types) && mcpParams.types.length > 0
                  ? new Set(mcpParams.types)
                  : null;
              const filtered = typeSet
                ? installations.filter(
                    (inst) =>
                      typeSet.has(inst.type) ||
                      (typeSet.has('combustion') &&
                        !['solar', 'wind', 'storage', 'biomass'].includes(inst.type))
                  )
                : installations;
              exportRows = filtered.map((inst) => ({
                mastrNummer: inst.mastrNummer,
                type: inst.type || 'unknown',
                capacityKW: inst.bruttoleistung || 0,
                city: inst.ort || inst.gemeinde || '',
                postalCode: inst.postleitzahl || '',
                commissioningDate: inst.inbetriebnahmedatum || '',
                status:
                  inst.einheitBetriebsstatus === '35'
                    ? 'In Betrieb'
                    : (inst.einheitBetriebsstatus || ''),
                einsatzverantwortlicher: inst.einsatzverantwortlicher || '',
              }));
            } catch (_) {
              // Local lookup failed — fall back to 5-row narrative preview
              exportRows = previewRows;
              isPreviewFallback = true;
            }
          } else {
            exportRows = previewRows;
            isPreviewFallback = true;
          }

          const totalStr = `${exportRows.length} installations`;
          const preambleLines = [
            '# Redispatch 2.0 Export',
            `# Grid Operator: ${operatorLabel}`,
            `# Min Capacity: ${minCapacity} kW`,
            `# Total: ${totalStr}`,
            `# Generated: ${new Date().toISOString()}`,
          ];
          if (isPreviewFallback && metadata.totalInstallations > previewRows.length) {
            preambleLines.push(
              `# Note: Preview only \u2014 ${previewRows.length} of ${metadata.totalInstallations} installations shown`
            );
          }
          const preamble = preambleLines.join('\n');

          if (format === 'csv') {
            ctx.meta.$responseHeaders = {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="redispatch-export-${Date.now()}.csv"`,
            };
            return `${preamble}\n${convertToCSV(exportRows)}`;
          }
          // xlsx / xls
          return applyFormat(
            ctx,
            result,
            format,
            'redispatch-export',
            'Redispatch Export',
            exportRows
          );
        }

        return result;
      },
    },

    /**
     * Grid connection feasibility check
     * Tool: cernion_connection_capacity_check
     */
    connectionCapacityCheck: {
      rest: 'POST /connection-capacity-check',
      params: {
        gridOperator: { type: 'string', min: 1 },
        location: { type: 'string', min: 1 },
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'storage', 'wallbox', 'heat-pump', 'other'],
        },
        capacityKW: { type: 'number', min: 0, convert: true },
        voltageLevel: { type: 'enum', values: ['NS', 'MS', 'HS'], optional: true },
        simultaneityFactor: { type: 'number', optional: true, min: 0, max: 1, convert: true },
      },
      openapi: {
        summary: 'Automated grid connection feasibility check (customer self-service)',
        tags: ['Grid Operations'],
        description:
          '6-step analysis: inventory, capacity, simultaneity, decision, alternatives, cost estimates',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['gridOperator', 'location', 'installationType', 'capacityKW'],
                properties: {
                  gridOperator: {
                    type: 'string',
                    description: 'Grid operator name',
                    example: 'Stadtwerke München',
                  },
                  location: {
                    type: 'string',
                    description: 'Address or postal code',
                    example: '80331',
                  },
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'wind', 'storage', 'wallbox', 'heat-pump', 'other'],
                    description: 'Type of installation to connect',
                    example: 'solar',
                  },
                  capacityKW: {
                    type: 'number',
                    description: 'Installation capacity in kW',
                    minimum: 0,
                    example: 10,
                  },
                  voltageLevel: {
                    type: 'string',
                    enum: ['NS', 'MS', 'HS'],
                    description: 'Optional: Preferred voltage level (auto-calculated if omitted)',
                    example: 'NS',
                  },
                  simultaneityFactor: {
                    type: 'number',
                    description: 'Optional: Simultaneity factor (0-1)',
                    minimum: 0,
                    maximum: 1,
                    example: 0.7,
                  },
                },
              },
              examples: {
                rooftopSolar: {
                  summary: 'Rooftop solar system (10kW)',
                  value: {
                    gridOperator: 'Stadtwerke München',
                    location: '80331',
                    installationType: 'solar',
                    capacityKW: 10,
                  },
                },
                wallboxCluster: {
                  summary: 'Wallbox cluster (22kW)',
                  value: {
                    gridOperator: 'Netze BW',
                    location: 'Hauptstraße 1, 70173 Stuttgart',
                    installationType: 'wallbox',
                    capacityKW: 22,
                    simultaneityFactor: 0.3,
                  },
                },
                heatPump: {
                  summary: 'Heat pump (15kW)',
                  value: {
                    gridOperator: 'TWL Netze',
                    location: '67059',
                    installationType: 'heat-pump',
                    capacityKW: 15,
                    voltageLevel: 'NS',
                  },
                },
                commercialSolar: {
                  summary: 'Commercial solar (100kW)',
                  value: {
                    gridOperator: 'Stadtwerke Heidelberg',
                    location: '69115',
                    installationType: 'solar',
                    capacityKW: 100,
                    voltageLevel: 'MS',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        // Use auto-polling for async jobs
        return await callWithAutoPoll(
          'cernion_connection_capacity_check',
          ctx.params,
          {
            maxWaitTime: 8 * 60 * 1000, // 8 minutes max
            pollInterval: 2000, // Poll every 2 seconds
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Market Partner Search (BDEW code resolution)
     * Tool: cernion_market_partners
     */
    marketPartners: {
      rest: 'GET /market-partners',
      params: {
        query: { type: 'string', min: 1 },
        limit: { type: 'number', optional: true, default: 10, min: 1, max: 20, convert: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Search German energy market partners by BDEW code, company name, or city',
        tags: ['Grid Operations'],
        description: `Search for German energy market participants including grid operators, suppliers, and balancing responsible parties.

**Search Types**:
- **BDEW Code**: 13-digit code (e.g., "9900992720003")
- **Company Name**: Full or partial name (e.g., "TWL", "Stadtwerke Heidelberg")
- **City**: Location-based search (e.g., "Heidelberg", "München")

**Use Cases**:
- Resolve VNB names to BDEW codes for installations queries
- Find grid operator contact details
- Identify market partner roles (VNB, ÜNB, supplier, BKV)
- Data integration and mapping

**Response Fields**:
- BDEW code (13 digits)
- Company name and address
- Market partner roles
- Software systems in use
- Contact information
- MaStR IDs (SNB, GNB, etc.)

**Example Queries**:
- "TWL Netze" → TWL Netz GmbH with BDEW code
- "9900992720003" → Specific market partner details
- "Heidelberg" → All market partners in Heidelberg`,
        parameters: [
          {
            name: 'query',
            in: 'query',
            required: true,
            schema: {
              type: 'string',
              description: 'Search term: BDEW code, company name, or city',
              example: 'TWL Netze',
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: {
              type: 'number',
              description: 'Maximum number of results (1-20, default: 10)',
              default: 10,
              minimum: 1,
              maximum: 20,
            },
          },
          {
            name: 'format',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['json', 'csv', 'xlsx', 'xls'],
              default: 'json',
              description: 'Output format. "csv" and "xls"/"xlsx" trigger a file download.',
            },
          },
        ],
        responses: {
          200: {
            description: 'List of matching market partners',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          bdew: { type: 'string', description: 'BDEW code (13 digits)' },
                          name: { type: 'string', description: 'Company name' },
                          address: { type: 'string', description: 'Full address' },
                          city: { type: 'string' },
                          postalCode: { type: 'string' },
                          roles: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Market roles (VNB, ÜNB, supplier, etc.)',
                          },
                          mastrIds: {
                            type: 'object',
                            description: 'MaStR operator IDs',
                          },
                        },
                      },
                    },
                    count: { type: 'number', description: 'Number of results returned' },
                  },
                },
                examples: {
                  twlNetze: {
                    summary: 'Search for TWL Netze',
                    value: {
                      results: [
                        {
                          bdew: '9900992720003',
                          name: 'TWL Netz GmbH',
                          address: 'Industriestraße 7, 67063 Ludwigshafen',
                          city: 'Ludwigshafen',
                          postalCode: '67063',
                          roles: ['VNB', 'Messstellenbetreiber'],
                          mastrIds: {
                            SNB: 'SNB123456789',
                          },
                        },
                      ],
                      count: 1,
                    },
                  },
                },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        const { format, ...mcpParams } = ctx.params;
        const result = await CernionMCPClient.callWithNewSession(
          'cernion_market_partners',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'market-partners', 'MarketPartners');
      },
    },
  },
};
