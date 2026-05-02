'use strict';

const { Errors } = require('moleculer');
const { evaluateMesskonzept } = require('../src/edm-messkonzept-engine');

const { MoleculerClientError } = Errors;

// Hilfsfunktion: DB-Row → API-Shape (camelCase)
function mapKonzept(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    formula: row.formula,
    inputs: JSON.parse(row.inputs || '[]'),
    outputMeloId: row.output_melo_id,
    outputObis: row.output_obis,
    schedule: row.schedule,
    validSince: row.valid_since,
    createdAt: row.created_at,
  };
}

module.exports = {
  name: 'edm-messkonzept',
  timeout: 60000,
  dependencies: ['edm'],

  started() {
    // Pool vom EDM-Service erben (synchron)
    const edmService = this.broker.getLocalService('edm');
    if (edmService && edmService.pool) {
      this.pool = edmService.pool;
    } else {
      this.logger.warn('EDM service pool not available');
    }
  },

  actions: {
    create: {
      rest: 'POST /messkonzepte',
      params: {
        id: { type: 'string', min: 1 },
        name: { type: 'string', min: 1 },
        type: { type: 'string', enum: ['SUM', 'AVG', 'MIN', 'MAX', 'CALC'] },
        formula: { type: 'string', optional: true },
        inputs: {
          type: 'array',
          items: {
            type: 'object',
            props: {
              ref: { type: 'string' },
              meloId: { type: 'string' },
              obis: { type: 'string', optional: true },
            },
          },
          optional: true,
          default: [],
        },
        outputMeloId: { type: 'string', optional: true },
        outputObis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        schedule: { type: 'string', optional: true },
        validSince: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Create a measurement concept',
        tags: ['EDM Messkonzept'],
        'x-oeo-class': 'oeo:virtual-measurement',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'name', 'type'],
                properties: {
                  id: { type: 'string', example: 'mk-sum-001' },
                  name: { type: 'string', example: 'Total Production' },
                  type: { type: 'string', example: 'SUM' },
                  formula: { type: 'string', example: 'v0 + v1' },
                  inputs: {
                    type: 'array',
                    items: { type: 'object' },
                    example: [{ ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' }],
                  },
                  outputMeloId: { type: 'string', example: 'melo-sum-out' },
                  outputObis: { type: 'string', example: '1-0:1.8.0' },
                  schedule: { type: 'string', example: 'on_input_change' },
                  validSince: { type: 'string', example: '2026-04-01T00:00:00.000Z' },
                },
              },
              examples: {
                default: {
                  value: {
                    id: 'mk-sum-001',
                    name: 'Total Production',
                    type: 'SUM',
                    formula: 'v0 + v1',
                    inputs: [
                      { ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' },
                      { ref: 'v1', meloId: 'melo-wind', obis: '1-0:1.8.0' },
                    ],
                    outputMeloId: 'melo-sum-out',
                    outputObis: '1-0:1.8.0',
                    schedule: 'on_input_change',
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Created' }, 409: { description: 'Exists' } },
      },
      async handler(ctx) {
        const db = this.pool.getRegistry();
        const { id, name, type, formula, inputs, outputMeloId, outputObis, schedule, validSince } =
          ctx.params;

        // 409 wenn ID existiert
        const existing = db.prepare('SELECT id FROM messkonzepte WHERE id = ?').get(id);
        if (existing) {
          throw new MoleculerClientError('Messkonzept already exists', 409, 'MESSKONZEPT_EXISTS');
        }

        // Output-MeLo erstellen falls nicht vorhanden
        try {
          await ctx.call('edm.getMelo', { meloId: outputMeloId });
        } catch (err) {
          if (err.code === 404) {
            await ctx.call('edm.createMelo', {
              meloId: outputMeloId,
              type: 'virtual',
              name: `Messkonzept: ${name}`,
              sourceType: 'calc',
              obisRegisters: [{ obis: outputObis }],
            });
          } else {
            throw err;
          }
        }

        // INSERT (synchron)
        db.prepare(
          'INSERT INTO messkonzepte (id, name, type, formula, inputs, output_melo_id, output_obis, schedule, valid_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          id,
          name,
          type,
          formula,
          JSON.stringify(inputs),
          outputMeloId,
          outputObis,
          schedule,
          validSince || null
        );

        ctx.meta.$statusCode = 201;
        return { success: true, id, outputMeloId };
      },
    },

    list: {
      rest: 'GET /messkonzepte',
      openapi: {
        summary: 'List all measurement concepts',
        tags: ['EDM Messkonzept'],
        'x-oeo-class': 'oeo:virtual-measurement',
        responses: { 200: { description: 'List' } },
      },
      handler() {
        const db = this.pool.getRegistry();
        const rows = db.prepare('SELECT * FROM messkonzepte ORDER BY created_at DESC').all();
        return { success: true, data: rows.map(mapKonzept) };
      },
    },

    get: {
      rest: 'GET /messkonzepte/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get a measurement concept',
        tags: ['EDM Messkonzept'],
        'x-oeo-class': 'oeo:virtual-measurement',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'mk-sum-001' },
          },
        ],
        responses: { 200: { description: 'Found' }, 404: { description: 'Not found' } },
      },
      handler(ctx) {
        const db = this.pool.getRegistry();
        const row = db.prepare('SELECT * FROM messkonzepte WHERE id = ?').get(ctx.params.id);
        if (!row) {
          throw new MoleculerClientError('Messkonzept not found', 404, 'MESSKONZEPT_NOT_FOUND');
        }
        return { success: true, data: mapKonzept(row) };
      },
    },

    delete: {
      rest: 'DELETE /messkonzepte/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Delete a measurement concept',
        tags: ['EDM Messkonzept'],
        'x-oeo-class': 'oeo:virtual-measurement',
        responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
      handler(ctx) {
        const db = this.pool.getRegistry();
        const existing = db.prepare('SELECT id FROM messkonzepte WHERE id = ?').get(ctx.params.id);
        if (!existing) {
          throw new MoleculerClientError('Messkonzept not found', 404, 'MESSKONZEPT_NOT_FOUND');
        }
        db.prepare('DELETE FROM messkonzepte WHERE id = ?').run(ctx.params.id);
        return { success: true, id: ctx.params.id };
      },
    },

    evaluate: {
      rest: 'POST /messkonzepte/:id/evaluate',
      params: {
        id: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        writeOutput: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'Evaluate a measurement concept',
        tags: ['EDM Messkonzept'],
        'x-oeo-class': 'oeo:virtual-measurement',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'from', 'to'],
                properties: {
                  id: { type: 'string', example: 'mk-sum-001' },
                  from: { type: 'string', example: '2026-04-20T00:00:00.000Z' },
                  to: { type: 'string', example: '2026-04-20T12:00:00.000Z' },
                  writeOutput: { type: 'boolean', default: true },
                },
              },
              examples: {
                default: {
                  value: {
                    id: 'mk-sum-001',
                    from: '2026-04-20T00:00:00.000Z',
                    to: '2026-04-20T12:00:00.000Z',
                    writeOutput: true,
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Result' }, 404: { description: 'Not found' } },
      },
      async handler(ctx) {
        const { id, from, to, writeOutput } = ctx.params;
        const db = this.pool.getRegistry();
        const row = db.prepare('SELECT * FROM messkonzepte WHERE id = ?').get(id);
        if (!row) {
          throw new MoleculerClientError('Messkonzept not found', 404, 'MESSKONZEPT_NOT_FOUND');
        }

        const konzept = mapKonzept(row);
        const inputData = {};

        // Lade Input-Zeitreihen via edm.getTimeseries
        for (const input of konzept.inputs) {
          try {
            const ts = await ctx.call('edm.getTimeseries', {
              meloId: input.meloId,
              obis: input.obis,
              from,
              to,
              resolution: '15min',
              format: 'json',
            });
            inputData[input.ref] = (ts.values || [])
              .map((point) => {
                const parsedTs = typeof point.ts === 'number' ? point.ts : Date.parse(point.ts);
                if (!Number.isFinite(parsedTs)) {
                  return null;
                }
                return {
                  ts: parsedTs,
                  value: point.value,
                };
              })
              .filter((point) => point !== null);
          } catch (err) {
            this.logger.warn(`Failed to load input ${input.ref}: ${err.message}`);
            inputData[input.ref] = [];
          }
        }

        // Engine evaluieren
        const results = evaluateMesskonzept(konzept, inputData);

        // Output schreiben via edm.importTimeseries
        if (writeOutput && results.length > 0) {
          await ctx.call('edm.importTimeseries', {
            meloId: konzept.outputMeloId,
            obis: konzept.outputObis,
            format: 'json',
            data: results.map((r) => ({
              ts: typeof r.ts === 'number' ? new Date(r.ts).toISOString() : r.ts,
              value: r.value,
              quality: r.quality || 'virtual',
              source: `messkonzept:${id}`,
            })),
            overwriteExisting: true,
          });
        }

        // Summary
        const numeric = results.map((r) => r.value).filter((v) => v !== null && Number.isFinite(v));

        return {
          success: true,
          id,
          from,
          to,
          inputCount: konzept.inputs.length,
          outputCount: results.length,
          written: writeOutput,
          outputMeloId: konzept.outputMeloId,
          summary: {
            total: numeric.reduce((sum, value) => sum + value, 0),
            min: numeric.length ? Math.min(...numeric) : null,
            max: numeric.length ? Math.max(...numeric) : null,
            avg: numeric.length
              ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length
              : null,
            nullCount: results.filter((r) => r.value === null).length,
          },
        };
      },
    },

    evaluateAll: {
      rest: 'POST /messkonzepte/evaluate-all',
      params: {
        from: { type: 'string' },
        to: { type: 'string' },
        schedule: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Evaluate all measurement concepts',
        tags: ['EDM Messkonzept'],
        'x-oeo-class': 'oeo:virtual-measurement',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['from', 'to'],
                properties: {
                  from: { type: 'string', example: '2026-04-20T00:00:00.000Z' },
                  to: { type: 'string', example: '2026-04-20T12:00:00.000Z' },
                  schedule: { type: 'string', example: 'hourly' },
                },
              },
              examples: {
                default: {
                  value: {
                    from: '2026-04-20T00:00:00.000Z',
                    to: '2026-04-20T12:00:00.000Z',
                    schedule: 'hourly',
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Batch result' } },
      },
      async handler(ctx) {
        const { from, to, schedule } = ctx.params;
        const db = this.pool.getRegistry();

        let rows;
        if (schedule) {
          rows = db
            .prepare('SELECT * FROM messkonzepte WHERE schedule = ? ORDER BY created_at')
            .all(schedule);
        } else {
          rows = db.prepare('SELECT * FROM messkonzepte ORDER BY created_at').all();
        }

        const results = [];
        for (const row of rows) {
          try {
            const result = await ctx.call('edm-messkonzept.evaluate', {
              id: row.id,
              from,
              to,
              writeOutput: true,
            });
            results.push(result);
          } catch (err) {
            this.logger.error(`Failed to evaluate ${row.id}: ${err.message}`);
          }
        }

        return { success: true, evaluated: results.length, results };
      },
    },
  },
};
