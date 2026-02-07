/**
 * Grid Operations Service
 *
 * Network data, redispatch, capacity analysis
 * Maps to Cernion MCP grid operations category
 */

const CernionMCPClient = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');

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
     * Comprehensive grid operator analysis
     * Tool: cernion_grid_operator_analysis
     */
    operatorAnalysis: {
      rest: 'POST /operator-analysis',
      params: {
        gridOperator: { type: 'string', min: 1 },
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
                required: ['gridOperator'],
                properties: {
                  gridOperator: {
                    type: 'string',
                    description: 'Grid operator name (fuzzy matching)',
                    example: 'Stadtwerke München',
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
        gridOperator: { type: 'string', min: 1 },
        minCapacity: { type: 'number', optional: true, default: 100, min: 0 },
        types: { type: 'array', items: 'string', optional: true },
        autoConfirm: { type: 'boolean', optional: true, default: true },
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
                required: ['gridOperator'],
                properties: {
                  gridOperator: {
                    type: 'string',
                    description: 'Grid operator name (fuzzy matching)',
                    example: 'Stadtwerke München',
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
                  },
                  autoConfirm: {
                    type: 'boolean',
                    description: 'Skip confirmation prompt',
                    default: true,
                  },
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
      },
      async handler(ctx) {
        // Use auto-polling for async jobs (redispatch export typically returns job ID)
        return await callWithAutoPoll(
          'cernion_redispatch_export',
          ctx.params,
          {
            maxWaitTime: 10 * 60 * 1000, // 10 minutes max
            pollInterval: 2000, // Poll every 2 seconds
          },
          ctx.meta.cernionToken
        );
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
        capacityKW: { type: 'number', min: 0 },
        voltageLevel: { type: 'enum', values: ['NS', 'MS', 'HS'], optional: true },
        simultaneityFactor: { type: 'number', optional: true, min: 0, max: 1 },
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
  },
};
