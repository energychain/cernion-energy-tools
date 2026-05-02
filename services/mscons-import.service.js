'use strict';

const { Errors } = require('moleculer');
const { parseMscons } = require('../src/edm-mscons-parser');

const { MoleculerClientError } = Errors;

function countTotalValues(parsed) {
  return (parsed.locations || []).reduce((accLocation, location) => {
    const locationValues = (location.timeseries || []).reduce(
      (accSeries, series) => accSeries + (series.values || []).length,
      0
    );
    return accLocation + locationValues;
  }, 0);
}

function inferObisRegisters(location) {
  const unique = new Set();
  for (const series of location.timeseries || []) {
    if (series.obisEquivalent) {
      unique.add(series.obisEquivalent);
    }
  }

  return [...unique].map((obis) => ({
    obis,
    direction: obis === '1-0:2.8.0' || obis === '1-0:2.29.0' ? 'feedin' : 'consumption',
  }));
}

module.exports = {
  name: 'mscons-import',
  timeout: 120000,
  dependencies: ['edm'],

  settings: {
    williMakoEnabled: false,
  },

  actions: {
    parse: {
      rest: 'POST /parse',
      params: {
        data: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Parse MSCONS EDIFACT message (no import, read-only)',
        tags: ['EDM (Energiedatenmanagement)'],
        description:
          'Parses a MSCONS EDIFACT message and returns structured data without importing into EDM. Use for preview/validation.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'string', example: "UNH+1+MSCONS:D:04B:UN:2.3e'..." },
                },
              },
              examples: {
                default: {
                  value: {
                    data: "UNH+1+MSCONS:D:04B:UN:2.3e'BGM+7+DOC1+9'...",
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Parsed MSCONS result' } },
      },
      handler(ctx) {
        const parsed = parseMscons(ctx.params.data);

        return {
          success: true,
          messageRef: parsed.messageRef,
          locations: parsed.locations.length,
          totalValues: countTotalValues(parsed),
          parsed,
        };
      },
    },

    import: {
      rest: 'POST /import',
      params: {
        data: { type: 'string', min: 1 },
        autoCreateMelo: { type: 'boolean', optional: true, default: true, convert: true },
        overwriteExisting: { type: 'boolean', optional: true, default: false, convert: true },
        validateOnImport: { type: 'boolean', optional: true, default: true, convert: true },
        gridOperatorMastrId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Import MSCONS EDIFACT message into EDM',
        tags: ['EDM (Energiedatenmanagement)'],
        description:
          'Parses MSCONS, creates MeLos if needed, imports timeseries into EDM SQLite. Fully offline — no external dependencies (KRITIS-compliant).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data'],
                properties: {
                  data: { type: 'string', example: "UNH+1+MSCONS:D:04B:UN:2.3e'..." },
                  autoCreateMelo: { type: 'boolean', default: true },
                  overwriteExisting: { type: 'boolean', default: false },
                  validateOnImport: { type: 'boolean', default: true },
                  gridOperatorMastrId: { type: 'string', example: 'SNB961471621746' },
                },
              },
              examples: {
                default: {
                  value: {
                    data: "UNH+1+MSCONS:D:04B:UN:2.3e'BGM+7+DOC1+9'...",
                    autoCreateMelo: true,
                    overwriteExisting: false,
                    validateOnImport: true,
                    gridOperatorMastrId: 'SNB961471621746',
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'MSCONS import result' } },
      },
      async handler(ctx) {
        const { data, autoCreateMelo, overwriteExisting, validateOnImport, gridOperatorMastrId } =
          ctx.params;

        const parsed = parseMscons(data);

        let melosCreated = 0;
        let melosExisting = 0;
        let timeseriesImported = 0;
        let totalValues = 0;
        let validationFindings = 0;

        for (const location of parsed.locations || []) {
          const meloId = location.meloId;
          if (!meloId) {
            this.logger.warn('Skipping location without MeLo ID');
            continue;
          }

          let meloData = null;

          try {
            const existing = await ctx.call('edm.getMelo', { meloId });
            meloData = existing.data;
            melosExisting += 1;
          } catch (err) {
            if (err.code !== 404) throw err;

            if (!autoCreateMelo) {
              throw new MoleculerClientError(
                `MeLo not found and autoCreateMelo=false: ${meloId}`,
                404,
                'MELO_NOT_FOUND'
              );
            }

            await ctx.call('edm.createMelo', {
              meloId,
              type: 'physical',
              name: `MSCONS Import: ${meloId}`,
              sourceType: 'mscons',
              gridOperatorMastrId: gridOperatorMastrId || null,
              obisRegisters: inferObisRegisters(location),
              metadata: {
                importedFrom: 'mscons',
                sender: parsed.sender?.id || null,
                documentNumber: parsed.documentNumber || null,
              },
            });

            const created = await ctx.call('edm.getMelo', { meloId });
            meloData = created.data;
            melosCreated += 1;
          }

          for (const timeseries of location.timeseries || []) {
            const obis = timeseries.obisEquivalent;
            if (!obis) {
              this.logger.warn(`Skipping MSCONS series without OBIS mapping for ${meloId}`);
              continue;
            }

            const mappedValues = (timeseries.values || [])
              .filter((value) => Number.isFinite(value.value) && value.from)
              .map((value) => ({
                ts: value.from,
                value: value.value,
                quality: value.quality || 'unknown',
                source: 'mscons',
              }));

            if (!mappedValues.length) {
              continue;
            }

            totalValues += mappedValues.length;

            await ctx.call('edm.importTimeseries', {
              meloId,
              obis,
              format: 'json',
              data: mappedValues,
              overwriteExisting,
            });

            timeseriesImported += 1;

            if (validateOnImport) {
              try {
                const validation = await ctx.call('edm-validation.validate', {
                  meloId,
                  obis,
                  from: location.periodFrom || mappedValues[0].ts,
                  to: location.periodTo || mappedValues[mappedValues.length - 1].ts,
                  autoFix: false,
                });

                if (Array.isArray(validation?.findings)) {
                  validationFindings += validation.findings.length;
                } else if (validation?.summary?.findings !== undefined) {
                  validationFindings += Number(validation.summary.findings) || 0;
                }
              } catch (err) {
                this.logger.warn(
                  `Validation failed for ${meloId}/${obis} after import: ${err.message}`
                );
              }
            }
          }

          if ((location.networkUsage || []).length > 0) {
            const nextMetadata = {
              ...(meloData?.metadata || {}),
              networkUsage: location.networkUsage,
            };

            const updateResult = await ctx.call('edm.updateMelo', {
              meloId,
              metadata: nextMetadata,
            });

            meloData = updateResult?.data || meloData;
          }
        }

        return {
          success: true,
          messageRef: parsed.messageRef,
          documentNumber: parsed.documentNumber,
          locationsProcessed: parsed.locations.length,
          melosCreated,
          melosExisting,
          timeseriesImported,
          totalValues,
          validationFindings,
          parseWarnings: parsed.parseWarnings,
        };
      },
    },

    listImports: {
      rest: 'GET /imports',
      openapi: {
        summary: 'List imported MSCONS MeLos',
        tags: ['EDM (Energiedatenmanagement)'],
        responses: { 200: { description: 'List of imported MeLos' } },
      },
      async handler(ctx) {
        return ctx.call('edm.listMelos', { sourceType: 'mscons' });
      },
    },
  },
};
