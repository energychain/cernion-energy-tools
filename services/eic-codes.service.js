/**
 * EIC Code Management Service
 *
 * Energy Identification Code database with 72,580+ codes from ENTSO-E and AGSI/GIE
 */

const CernionMCPClient = require('../src/mcp-client');
const { applyFormat, FORMAT_PARAM_SCHEMA, FORMAT_RESPONSE_CONTENT } = require('../src/format-response');

module.exports = {
  name: 'eic-codes',

  settings: {
    defaultTimeout: 30000,
  },

  actions: {
    /**
     * Search EIC code database
     * Tool: cernion_eic_search
     */
    search: {
      rest: 'POST /search',
      params: {
        code: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        country: { type: 'string', optional: true, min: 2, max: 2 },
        sector: { type: 'enum', values: ['electricity', 'gas'], optional: true },
        limit: { type: 'number', optional: true, default: 10, min: 1, max: 100 },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Search EIC code database by code or company name',
        tags: ['EIC Code Management'],
        description: `Search 72,580+ EIC codes from ENTSO-E and AGSI/GIE.

**At least one of 'code' or 'name' is required.**

**Parameter Details:**
- **code**: Exact 16-character EIC code (e.g., "21X000000001254A")
- **name**: Company name with fuzzy matching (e.g., "Stadtwerke", "RWE", "Netze BW")
- **country**: ISO 3166-1 alpha-2 code - Common: DE (Germany), FR (France), NL (Netherlands), AT (Austria), CH (Switzerland), PL (Poland), CZ (Czech Republic)
- **sector**: Filter by energy sector - "electricity" or "gas"
- **limit**: Results limit (1-100, default: 10)

**Use Cases:**
- Find valid operator codes for AGSI gas storage queries
- Research market partners and grid operators
- Validate EIC codes before API calls`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    description: 'Exact EIC code (16 characters, starts with 2 digits + X)',
                    example: '21X000000001254A',
                    pattern: '^[0-9]{2}X[A-Z0-9]{13}$',
                  },
                  name: {
                    type: 'string',
                    description:
                      'Company/operator name (fuzzy search, minimum 3 characters recommended)',
                    example: 'Stadtwerke München',
                    minLength: 1,
                  },
                  country: {
                    type: 'string',
                    description: 'ISO 3166-1 alpha-2 country code',
                    example: 'DE',
                    enum: [
                      'AT',
                      'BE',
                      'BG',
                      'CH',
                      'CZ',
                      'DE',
                      'DK',
                      'EE',
                      'ES',
                      'FI',
                      'FR',
                      'GB',
                      'GR',
                      'HR',
                      'HU',
                      'IE',
                      'IT',
                      'LT',
                      'LU',
                      'LV',
                      'NL',
                      'NO',
                      'PL',
                      'PT',
                      'RO',
                      'SE',
                      'SI',
                      'SK',
                    ],
                    minLength: 2,
                    maxLength: 2,
                  },
                  sector: {
                    type: 'string',
                    enum: ['electricity', 'gas'],
                    description: 'Energy sector filter',
                    example: 'electricity',
                  },
                  limit: {
                    type: 'integer',
                    description: 'Maximum number of results',
                    minimum: 1,
                    maximum: 100,
                    default: 10,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                byExactCode: {
                  summary: 'Find by exact EIC code',
                  value: {
                    code: '21X000000001254A',
                  },
                },
                byCompanyName: {
                  summary: 'Find by company name',
                  value: {
                    name: 'Stadtwerke München',
                    country: 'DE',
                    sector: 'electricity',
                    limit: 10,
                  },
                },
                byPartialName: {
                  summary: 'Fuzzy search by partial name',
                  value: {
                    name: 'Netze',
                    country: 'DE',
                    limit: 20,
                  },
                },
                gasOperatorsDE: {
                  summary: 'Find German gas operators',
                  value: {
                    name: 'Gas',
                    country: 'DE',
                    sector: 'gas',
                    limit: 15,
                  },
                },
                csvExport: {
                  summary: 'Export results as CSV',
                  value: {
                    name: 'Netze',
                    country: 'DE',
                    limit: 50,
                    format: 'csv',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Search results with matching EIC codes',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    results: [
                      {
                        code: '21X000000001254A',
                        name: 'Netze BW GmbH',
                        country: 'DE',
                        sector: 'electricity',
                        type: 'Distribution System Operator',
                      },
                    ],
                    count: 1,
                    limit: 10,
                  },
                },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
          400: {
            description: 'Validation error - at least code or name required',
          },
        },
      },
      async handler(ctx) {
        const { format, ...mcpParams } = ctx.params;
        const result = await CernionMCPClient.callWithNewSession(
          'cernion_eic_search',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'eic-codes', 'EICCodes');
      },
    },

    /**
     * Validate EIC code format
     * Tool: cernion_eic_validate
     */
    validate: {
      rest: 'POST /validate',
      params: {
        code: { type: 'string', min: 16, max: 16 },
      },
      openapi: {
        summary: 'Validate EIC code format (IEC 62325 standard)',
        tags: ['EIC Code Management'],
        description:
          'Validates EIC code format according to IEC 62325 standard. Checks: length (16 characters), LIO area (10-70), code type character, check digit algorithm. Use for pre-validation before API calls, form input validation.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: {
                    type: 'string',
                    minLength: 16,
                    maxLength: 16,
                    description: 'EIC code to validate',
                    example: '21X000000001254A',
                  },
                },
              },
              examples: {
                validCode: {
                  summary: 'Valid EIC code',
                  value: {
                    code: '21X000000001254A',
                  },
                },
                invalidCode: {
                  summary: 'Invalid EIC code',
                  value: {
                    code: 'INVALID123456789',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_eic_validate',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * List German gas storage operators
     * Tool: cernion_eic_gas_operators
     */
    gasOperators: {
      rest: 'GET /gas-operators',
      params: {
        country: { type: 'string', optional: true, default: 'DE', min: 2, max: 2 },
        includeMetadata: { type: 'boolean', optional: true, default: false },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'List German gas storage operators with EIC codes',
        tags: ['EIC Code Management'],
        description:
          'Retrieve list of gas storage system operators in Germany with their EIC codes. Use cases: Find valid codes for AGSI operator queries, German gas storage market overview, operator portfolio analysis.',
        parameters: [
          {
            name: 'country',
            in: 'query',
            schema: { type: 'string', default: 'DE' },
            description: 'ISO country code',
            example: 'DE',
          },
          {
            name: 'includeMetadata',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Include additional operator details',
            example: false,
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx', 'xls'], default: 'json' },
            description: 'Output format. "csv" and "xls"/"xlsx" trigger a file download.',
            example: 'json',
          },
        ],
        responses: {
          200: {
            description: 'List of gas storage operators with EIC codes',
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
        const { format, ...mcpParams } = ctx.params;
        const result = await CernionMCPClient.callWithNewSession(
          'cernion_eic_gas_operators',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'gas-operators', 'GasOperators');
      },
    },

    /**
     * List German gas storage facilities
     * Tool: cernion_eic_gas_facilities
     */
    gasFacilities: {
      rest: 'GET /gas-facilities',
      params: {
        operatorCode: { type: 'string', optional: true },
        country: { type: 'string', optional: true, default: 'DE', min: 2, max: 2 },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'List German gas storage facilities (UGS) with EIC codes',
        tags: ['EIC Code Management'],
        description:
          'Retrieve underground gas storage facilities in Germany. Use cases: Find valid codes for AGSI facility queries, operator portfolio breakdown, facility-level monitoring.',
        parameters: [
          {
            name: 'operatorCode',
            in: 'query',
            schema: { type: 'string', example: '21X000000001262B' },
            description: 'Filter by operator EIC code',
            example: '21X000000001262B',
          },
          {
            name: 'country',
            in: 'query',
            schema: { type: 'string', default: 'DE' },
            description: 'ISO country code',
            example: 'DE',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv', 'xlsx', 'xls'], default: 'json' },
            description: 'Output format. "csv" and "xls"/"xlsx" trigger a file download.',
            example: 'json',
          },
        ],
        responses: {
          200: {
            description: 'List of underground gas storage facilities with EIC codes',
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
        const { format, ...mcpParams } = ctx.params;
        const result = await CernionMCPClient.callWithNewSession(
          'cernion_eic_gas_facilities',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'gas-facilities', 'GasFacilities');
      },
    },

    /**
     * EIC database statistics
     * Tool: cernion_eic_statistics
     */
    statistics: {
      rest: 'GET /statistics',
      params: {},
      openapi: {
        summary: 'Statistics about EIC database (total count, breakdown by type/sector/country)',
        tags: ['EIC Code Management'],
        description:
          'Get comprehensive statistics about the EIC code database including 72,580+ total codes with breakdowns by type (party, resource, substation, area, operator, tie-line, location, facility), sector (electricity/gas), and country. Use for database health checks and coverage assessment.',
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_eic_statistics',
          {},
          ctx.meta.cernionToken
        );
      },
    },
  },
};
