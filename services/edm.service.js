'use strict';

const fs = require('fs');
const path = require('path');
const { MoleculerClientError } = require('moleculer').Errors;
const EdmSqlitePool = require('../src/edm-sqlite-pool');
const { parseCsvTimeseries } = require('../src/edm-csv-importer');

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function mapMelo(row) {
  return {
    meloId: row.melo_id,
    type: row.type,
    name: row.name,
    napMastrNummer: row.nap_mastr_nummer,
    installationMastrNummer: row.installation_mastr_nummer,
    gridOperatorMastrId: row.grid_operator_mastr_id,
    spannungsebene: row.spannungsebene,
    messkonzeptId: row.messkonzept_id,
    obisRegisters: parseJson(row.obis_registers, []),
    sourceType: row.source_type,
    sourceConfig: parseJson(row.source_config, {}),
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inferInstallationType(installation) {
  const value = String(
    installation?.installationType || installation?.type || installation?.Einheittyp || ''
  ).toLowerCase();

  if (value.includes('storage') || value.includes('speicher')) {
    return 'storage';
  }
  if (value.includes('wind')) return 'wind';
  if (value.includes('biomass') || value.includes('biomasse')) return 'biomass';
  return 'solar';
}

function inferObisRegisters(installation) {
  const type = inferInstallationType(installation);

  if (type === 'storage') {
    return [
      { obis: '1-0:1.8.0', direction: 'consumption' },
      { obis: '1-0:2.8.0', direction: 'feedin' },
    ];
  }

  return [{ obis: '1-0:2.8.0', label: 'Einspeisung', direction: 'feedin' }];
}

function extractInstallations(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data?.results)) return result.data.results;
  if (Array.isArray(result?.data?.installations)) return result.data.installations;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.installations)) return result.installations;
  return [];
}

function ensureMeloExists(db, meloId) {
  const exists = db.prepare('SELECT melo_id FROM melos WHERE melo_id = ?').get(meloId);
  if (!exists) {
    throw new MoleculerClientError('MeLo not found', 404, 'MELO_NOT_FOUND');
  }
}

function parseJsonTimeseriesRows(input) {
  if (!Array.isArray(input)) {
    throw new MoleculerClientError(
      'JSON data must be an array of timeseries rows',
      400,
      'INVALID_DATA'
    );
  }

  return {
    rows: input.map((row) => ({
      ts: row?.ts,
      value: row?.value ?? null,
      quality: row?.quality || (row?.value === null ? 'missing' : 'measured'),
      source: row?.source || 'import',
    })),
    errors: [],
    stats: {
      total: input.length,
      parsed: input.length,
      skipped: 0,
      invalid: 0,
    },
  };
}

function validateTimeseriesRows(rows) {
  const validRows = [];
  let invalid = 0;

  for (const row of rows) {
    if (!row || !row.ts) {
      invalid += 1;
      continue;
    }

    const ts = new Date(row.ts);
    if (Number.isNaN(ts.getTime())) {
      invalid += 1;
      continue;
    }

    if (row.value !== null && !Number.isFinite(Number(row.value))) {
      invalid += 1;
      continue;
    }

    validRows.push({
      ts: ts.toISOString(),
      value: row.value === null ? null : Number(row.value),
      quality: row.quality || (row.value === null ? 'missing' : 'measured'),
      source: row.source || 'import',
    });
  }

  return { validRows, invalid };
}

function aggregateByResolution(rows, resolution) {
  if (resolution === '15min') {
    return rows;
  }

  const groups = new Map();

  for (const row of rows) {
    const key =
      resolution === 'hourly'
        ? `${row.ts.slice(0, 13)}:00:00.000Z`
        : `${row.ts.slice(0, 10)}T00:00:00.000Z`;
    const current = groups.get(key) || {
      ts: key,
      value: 0,
      quality: 'aggregated',
      count: 0,
    };

    const numericValue = Number(row.value);
    if (Number.isFinite(numericValue)) {
      current.value += numericValue;
      current.count += 1;
      groups.set(key, current);
    }
  }

  return [...groups.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

function computeTimeseriesSummary(rows) {
  const numeric = rows.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));

  const total = numeric.reduce((sum, value) => sum + value, 0);
  const min = numeric.length ? Math.min(...numeric) : 0;
  const max = numeric.length ? Math.max(...numeric) : 0;
  const avg = numeric.length ? total / numeric.length : 0;

  return {
    count: rows.length,
    measured: rows.filter((row) => row.quality === 'measured').length,
    interpolated: rows.filter((row) => row.quality === 'interpolated').length,
    missing: rows.filter((row) => row.quality === 'missing').length,
    total_kwh: Number(total.toFixed(6)),
    min_kw: Number((min * 4).toFixed(6)),
    max_kw: Number((max * 4).toFixed(6)),
    avg_kw: Number((avg * 4).toFixed(6)),
  };
}

function isoWeekKey(ts) {
  const date = new Date(ts);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getGroupKey(ts, groupBy) {
  if (groupBy === 'year') return ts.slice(0, 4);
  if (groupBy === 'month') return ts.slice(0, 7);
  if (groupBy === 'week') return isoWeekKey(ts);
  return ts.slice(0, 10);
}

module.exports = {
  name: 'edm',
  timeout: 120000,

  settings: {
    dbPath: process.env.EDM_DB_PATH || 'data/edm',
    retentionDays: parseInt(process.env.EDM_RETENTION_DAYS || '1095', 10),
    retentionPolicy: process.env.EDM_RETENTION_POLICY || 'delete',
    defaultResolution: '15min',
    defaultObis: '1-0:1.8.0',
  },

  started() {
    this.pool = new EdmSqlitePool(this.settings.dbPath);
    this.logger.info(
      `EDM started, db: ${this.settings.dbPath}, retention: ${this.settings.retentionDays}d`
    );
  },

  stopped() {
    if (this.pool) {
      this.pool.closeAll();
    }
  },

  actions: {
    createMelo: {
      rest: 'POST /melos',
      params: {
        meloId: { type: 'string', min: 1, max: 64 },
        type: { type: 'enum', values: ['physical', 'virtual', 'dummy'] },
        name: { type: 'string', optional: true },
        napMastrNummer: { type: 'string', optional: true },
        installationMastrNummer: { type: 'string', optional: true },
        gridOperatorMastrId: { type: 'string', optional: true },
        spannungsebene: { type: 'string', optional: true },
        obisRegisters: { type: 'array', optional: true, items: { type: 'object' } },
        sourceType: {
          type: 'enum',
          values: ['manual', 'mscons', 'rest_poll', 'forecast', 'calc'],
          optional: true,
          default: 'manual',
        },
        sourceConfig: { type: 'object', optional: true },
        metadata: { type: 'object', optional: true },
      },
      openapi: {
        summary: 'Create a MeLo in EDM registry',
        tags: ['EDM (Energiedatenmanagement)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId', 'type'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  type: {
                    type: 'string',
                    enum: ['physical', 'virtual', 'dummy'],
                    example: 'physical',
                  },
                  name: { type: 'string', example: 'Messlokation Musterstraße 1' },
                  napMastrNummer: { type: 'string', example: 'SAN123456789012' },
                  installationMastrNummer: { type: 'string', example: 'SEE123456789012' },
                  gridOperatorMastrId: { type: 'string', example: 'SNB935578300972' },
                  spannungsebene: { type: 'string', example: 'Niederspannung' },
                  obisRegisters: {
                    type: 'array',
                    items: { type: 'object' },
                    example: [{ obis: '1-0:2.8.0', direction: 'feedin' }],
                  },
                  sourceType: {
                    type: 'string',
                    enum: ['manual', 'mscons', 'rest_poll', 'forecast', 'calc'],
                    default: 'manual',
                  },
                  sourceConfig: { type: 'object', example: {} },
                  metadata: { type: 'object', example: { source: 'manual' } },
                },
              },
              examples: {
                default: {
                  value: {
                    meloId: 'DE0012345678901234567890123456789',
                    type: 'physical',
                    gridOperatorMastrId: 'SNB935578300972',
                    obisRegisters: [{ obis: '1-0:2.8.0', direction: 'feedin' }],
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Created' } },
      },
      handler(ctx) {
        const db = this.pool.getRegistry();
        const {
          meloId,
          type,
          name,
          napMastrNummer,
          installationMastrNummer,
          gridOperatorMastrId,
          spannungsebene,
          obisRegisters,
          sourceType,
          sourceConfig,
          metadata,
        } = ctx.params;

        const exists = db.prepare('SELECT melo_id FROM melos WHERE melo_id = ?').get(meloId);
        if (exists) {
          throw new MoleculerClientError('MeLo already exists', 409, 'MELO_EXISTS');
        }

        db.prepare(
          `
          INSERT INTO melos (
            melo_id, type, name, nap_mastr_nummer,
            installation_mastr_nummer, grid_operator_mastr_id, spannungsebene,
            obis_registers, source_type, source_config, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          meloId,
          type,
          name || null,
          napMastrNummer || null,
          installationMastrNummer || null,
          gridOperatorMastrId || null,
          spannungsebene || null,
          JSON.stringify(obisRegisters || []),
          sourceType || 'manual',
          JSON.stringify(sourceConfig || {}),
          JSON.stringify(metadata || {})
        );

        return { success: true, meloId, type, createdAt: new Date().toISOString() };
      },
    },

    listMelos: {
      rest: 'GET /melos',
      params: {
        type: { type: 'string', optional: true },
        gridOperatorMastrId: { type: 'string', optional: true },
        sourceType: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 100, convert: true },
        offset: { type: 'number', optional: true, default: 0, convert: true },
      },
      openapi: {
        summary: 'List MeLos',
        tags: ['EDM (Energiedatenmanagement)'],
        parameters: [
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'virtual' },
          },
          {
            name: 'gridOperatorMastrId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'SNB935578300972' },
          },
          {
            name: 'sourceType',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'mscons' },
          },
          { name: 'limit', in: 'query', required: false, schema: { type: 'number', default: 100 } },
          { name: 'offset', in: 'query', required: false, schema: { type: 'number', default: 0 } },
        ],
        responses: { 200: { description: 'List' } },
      },
      handler(ctx) {
        const db = this.pool.getRegistry();
        const { type, gridOperatorMastrId, sourceType, limit, offset } = ctx.params;

        const where = [];
        const params = [];

        if (type) {
          where.push('type = ?');
          params.push(type);
        }
        if (gridOperatorMastrId) {
          where.push('grid_operator_mastr_id = ?');
          params.push(gridOperatorMastrId);
        }
        if (sourceType) {
          where.push('source_type = ?');
          params.push(sourceType);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = db
          .prepare(`SELECT * FROM melos ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
          .all(...params, limit, offset);

        return {
          success: true,
          data: rows.map(mapMelo),
          count: rows.length,
          limit,
          offset,
        };
      },
    },

    getMelo: {
      rest: 'GET /melos/:meloId',
      params: { meloId: { type: 'string', min: 1 } },
      openapi: {
        summary: 'Get one MeLo',
        tags: ['EDM (Energiedatenmanagement)'],
        parameters: [
          {
            name: 'meloId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'DE0012345678901234567890123456789' },
          },
        ],
        responses: { 200: { description: 'Found' }, 404: { description: 'Not found' } },
      },
      handler(ctx) {
        const db = this.pool.getRegistry();
        const row = db.prepare('SELECT * FROM melos WHERE melo_id = ?').get(ctx.params.meloId);

        if (!row) {
          throw new MoleculerClientError('MeLo not found', 404, 'MELO_NOT_FOUND');
        }

        return { success: true, data: mapMelo(row) };
      },
    },

    updateMelo: {
      rest: 'PUT /melos/:meloId',
      params: {
        meloId: { type: 'string', min: 1 },
        name: { type: 'string', optional: true },
        napMastrNummer: { type: 'string', optional: true },
        installationMastrNummer: { type: 'string', optional: true },
        gridOperatorMastrId: { type: 'string', optional: true },
        spannungsebene: { type: 'string', optional: true },
        obisRegisters: { type: 'array', optional: true, items: { type: 'object' } },
        sourceType: {
          type: 'enum',
          values: ['manual', 'mscons', 'rest_poll', 'forecast', 'calc'],
          optional: true,
        },
        sourceConfig: { type: 'object', optional: true },
        metadata: { type: 'object', optional: true },
      },
      openapi: {
        summary: 'Update one MeLo',
        tags: ['EDM (Energiedatenmanagement)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  name: { type: 'string', example: 'Neue Bezeichnung' },
                  napMastrNummer: { type: 'string', example: 'SAN123456789012' },
                  installationMastrNummer: { type: 'string', example: 'SEE123456789012' },
                  gridOperatorMastrId: { type: 'string', example: 'SNB935578300972' },
                  spannungsebene: { type: 'string', example: 'Niederspannung' },
                  obisRegisters: {
                    type: 'array',
                    items: { type: 'object' },
                    example: [{ obis: '1-0:1.8.0', direction: 'consumption' }],
                  },
                  sourceType: {
                    type: 'string',
                    enum: ['manual', 'mscons', 'rest_poll', 'forecast', 'calc'],
                    example: 'manual',
                  },
                  sourceConfig: { type: 'object', example: {} },
                  metadata: { type: 'object', example: { tag: 'updated' } },
                },
              },
              examples: {
                default: {
                  value: {
                    meloId: 'DE0012345678901234567890123456789',
                    name: 'Neue Bezeichnung',
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Updated' }, 404: { description: 'Not found' } },
      },
      handler(ctx) {
        const db = this.pool.getRegistry();
        const { meloId } = ctx.params;

        const existing = db.prepare('SELECT * FROM melos WHERE melo_id = ?').get(meloId);
        if (!existing) {
          throw new MoleculerClientError('MeLo not found', 404, 'MELO_NOT_FOUND');
        }

        const data = {
          name: ctx.params.name,
          nap_mastr_nummer: ctx.params.napMastrNummer,
          installation_mastr_nummer: ctx.params.installationMastrNummer,
          grid_operator_mastr_id: ctx.params.gridOperatorMastrId,
          spannungsebene: ctx.params.spannungsebene,
          obis_registers:
            ctx.params.obisRegisters !== undefined
              ? JSON.stringify(ctx.params.obisRegisters)
              : undefined,
          source_type: ctx.params.sourceType,
          source_config:
            ctx.params.sourceConfig !== undefined
              ? JSON.stringify(ctx.params.sourceConfig)
              : undefined,
          metadata:
            ctx.params.metadata !== undefined ? JSON.stringify(ctx.params.metadata) : undefined,
        };

        const set = [];
        const values = [];

        for (const [column, value] of Object.entries(data)) {
          if (value === undefined) continue;
          set.push(`${column} = ?`);
          values.push(value);
        }

        if (set.length === 0) {
          return { success: true, updated: false, data: mapMelo(existing) };
        }

        set.push(`updated_at = datetime('now')`);
        values.push(meloId);

        db.prepare(`UPDATE melos SET ${set.join(', ')} WHERE melo_id = ?`).run(...values);

        const row = db.prepare('SELECT * FROM melos WHERE melo_id = ?').get(meloId);
        return { success: true, updated: true, data: mapMelo(row) };
      },
    },

    deleteMelo: {
      rest: 'DELETE /melos/:meloId',
      params: {
        meloId: { type: 'string', min: 1 },
        cascade: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Delete one MeLo',
        tags: ['EDM (Energiedatenmanagement)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  cascade: { type: 'boolean', default: false },
                },
              },
              examples: {
                default: { value: { meloId: 'DE0012345678901234567890123456789', cascade: false } },
              },
            },
          },
        },
        responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
      handler(ctx) {
        const db = this.pool.getRegistry();
        const { meloId, cascade } = ctx.params;

        const existing = db.prepare('SELECT melo_id FROM melos WHERE melo_id = ?').get(meloId);
        if (!existing) {
          throw new MoleculerClientError('MeLo not found', 404, 'MELO_NOT_FOUND');
        }

        let deletedTimeseriesRows = 0;
        if (cascade) {
          deletedTimeseriesRows = this.deleteAllTimeseriesForMelo(meloId);
        }

        db.prepare('DELETE FROM melos WHERE melo_id = ?').run(meloId);

        return {
          success: true,
          meloId,
          cascade,
          deletedTimeseriesRows,
        };
      },
    },

    createFromMastr: {
      rest: 'POST /melos/from-mastr',
      params: {
        gridOperatorMastrId: { type: 'string', optional: true },
        postleitzahl: { type: 'string', optional: true },
        type: { type: 'string', optional: true, default: 'all' },
        limit: { type: 'number', optional: true, default: 100, convert: true },
      },
      openapi: {
        summary: 'Create MeLos from MaStR installation lookup',
        tags: ['EDM (Energiedatenmanagement)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperatorMastrId: { type: 'string', example: 'SNB935578300972' },
                  postleitzahl: { type: 'string', example: '66989' },
                  type: { type: 'string', default: 'all' },
                  limit: { type: 'number', default: 100 },
                },
              },
              examples: {
                default: {
                  value: {
                    gridOperatorMastrId: 'SNB935578300972',
                    type: 'all',
                    limit: 100,
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Import result' } },
      },
      async handler(ctx) {
        const { gridOperatorMastrId, postleitzahl, type, limit } = ctx.params;

        const response = await ctx.call(
          'energy-market.installations',
          {
            ...(gridOperatorMastrId ? { gridOperatorMastrId } : {}),
            ...(postleitzahl ? { postleitzahl } : {}),
            type: type || 'all',
            format: 'detailed',
            limit,
            includeNapData: true,
          },
          { meta: { cernionToken: ctx.meta.cernionToken } }
        );

        const db = this.pool.getRegistry();
        const installations = extractInstallations(response);

        let created = 0;
        let skipped = 0;
        const melos = [];

        for (const installation of installations) {
          const meloId = installation?.napData?.messlokation;
          if (!meloId) {
            skipped += 1;
            continue;
          }

          const existing = db.prepare('SELECT melo_id FROM melos WHERE melo_id = ?').get(meloId);
          if (existing) {
            skipped += 1;
            continue;
          }

          const obisRegisters = inferObisRegisters(installation);

          db.prepare(
            `
            INSERT INTO melos (
              melo_id, type, name, nap_mastr_nummer,
              installation_mastr_nummer, grid_operator_mastr_id, spannungsebene,
              obis_registers, source_type, source_config, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          ).run(
            meloId,
            'physical',
            installation?.name || installation?.EinheitName || null,
            installation?.napData?.napMastrNummer || installation?.napData?.MastrNummer || null,
            installation?.mastrNummer ||
              installation?.mastrNumber ||
              installation?.EinheitMastrNummer ||
              null,
            installation?.napData?.netzbetreiberMastrNummer || gridOperatorMastrId || null,
            installation?.napData?.spannungsebeneLabel ||
              installation?.napData?.spannungsebene ||
              null,
            JSON.stringify(obisRegisters),
            'manual',
            JSON.stringify({ importedFrom: 'energy-market.installations' }),
            JSON.stringify({ sourceType: inferInstallationType(installation) })
          );

          created += 1;
          melos.push({ meloId, type: 'physical', obisRegisters });
        }

        return {
          success: true,
          created,
          skipped,
          melos,
        };
      },
    },
    importTimeseries: {
      rest: 'POST /timeseries/import',
      params: {
        meloId: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        format: { type: 'enum', values: ['csv', 'json'], optional: true, default: 'json' },
        config: { type: 'object', optional: true },
        data: { type: 'any' },
        overwriteExisting: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Import timeseries data for a MeLo',
        tags: ['EDM (Energiedatenmanagement)'],
        description:
          'Imports measurement data from CSV or JSON format into the SQLite timeseries store. CSV config supports German formats (semicolon delimiter, comma decimal, DD.MM.YYYY timestamps).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId', 'data'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  obis: { type: 'string', default: '1-0:1.8.0', example: '1-0:2.8.0' },
                  format: { type: 'string', enum: ['csv', 'json'], default: 'json' },
                  config: {
                    type: 'object',
                    example: { delimiter: ';', timestampColumn: 'ts', valueColumn: 'val' },
                  },
                  data: {
                    oneOf: [{ type: 'string' }, { type: 'array' }],
                    example: [{ ts: '2026-04-01T00:00:00.000Z', value: 12.4 }],
                  },
                  overwriteExisting: { type: 'boolean', default: false },
                },
              },
              examples: {
                json: {
                  value: {
                    meloId: 'DE0012345678901234567890123456789',
                    obis: '1-0:2.8.0',
                    format: 'json',
                    data: [{ ts: '2026-04-01T00:00:00.000Z', value: 12.4 }],
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Import result' } },
      },
      handler(ctx) {
        const { meloId, obis, format, config, data, overwriteExisting } = ctx.params;

        const registryDb = this.pool.getRegistry();
        ensureMeloExists(registryDb, meloId);

        const parsed =
          format === 'csv' ? parseCsvTimeseries(data, config || {}) : parseJsonTimeseriesRows(data);

        const validated = validateTimeseriesRows(parsed.rows || []);
        const partitionKey = this.pool.resolvePartition(meloId);

        const rowsByQuarter = new Map();
        for (const row of validated.validRows) {
          const quarter = this.pool.resolveQuarter(row.ts);
          const quarterRows = rowsByQuarter.get(quarter) || [];
          quarterRows.push(row);
          rowsByQuarter.set(quarter, quarterRows);
        }

        let totalInserted = 0;
        let totalSkipped = (parsed.rows || []).length - validated.validRows.length;

        const affectedQuarters = [...rowsByQuarter.keys()].sort();
        for (const quarter of affectedQuarters) {
          const db = this.pool.getTimeseries(partitionKey, quarter);
          const statement = overwriteExisting
            ? db.prepare(
                'INSERT OR REPLACE INTO timeseries (melo_id, obis, ts, value, quality, source) VALUES (?, ?, ?, ?, ?, ?)'
              )
            : db.prepare(
                'INSERT OR IGNORE INTO timeseries (melo_id, obis, ts, value, quality, source) VALUES (?, ?, ?, ?, ?, ?)'
              );

          const insertMany = db.transaction((rows) => {
            let inserted = 0;
            for (const row of rows) {
              const result = statement.run(
                meloId,
                obis,
                row.ts,
                row.value,
                row.quality || 'measured',
                row.source || 'import'
              );
              inserted += result.changes || 0;
            }
            return inserted;
          });

          const quarterRows = rowsByQuarter.get(quarter) || [];
          const inserted = insertMany(quarterRows);
          totalInserted += inserted;
          totalSkipped += quarterRows.length - inserted;
        }

        const orderedTs = validated.validRows.map((row) => row.ts).sort();
        return {
          success: true,
          meloId,
          obis,
          imported: totalInserted,
          skipped: totalSkipped,
          period: {
            from: orderedTs[0] || null,
            to: orderedTs[orderedTs.length - 1] || null,
          },
          partitions: affectedQuarters,
          parse: {
            errors: parsed.errors || [],
            stats: parsed.stats || null,
          },
        };
      },
    },
    getTimeseries: {
      rest: 'GET /timeseries/:meloId',
      params: {
        meloId: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        from: { type: 'string' },
        to: { type: 'string' },
        resolution: {
          type: 'enum',
          values: ['15min', 'hourly', 'daily'],
          optional: true,
          default: '15min',
        },
        format: { type: 'enum', values: ['json', 'csv'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Query timeseries data for a MeLo',
        tags: ['EDM (Energiedatenmanagement)'],
        description:
          'Retrieves timeseries data with optional resolution aggregation. Supports cross-quarter queries transparently.',
        parameters: [
          {
            name: 'meloId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'DE0012345678901234567890123456789' },
          },
          {
            name: 'obis',
            in: 'query',
            required: false,
            schema: { type: 'string', default: '1-0:1.8.0' },
          },
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-04-01T00:00:00.000Z' },
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-04-02T00:00:00.000Z' },
          },
          {
            name: 'resolution',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['15min', 'hourly', 'daily'], default: '15min' },
          },
          {
            name: 'format',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
          },
        ],
        responses: { 200: { description: 'Timeseries result' } },
      },
      handler(ctx) {
        const { meloId, obis, from, to, resolution, format } = ctx.params;

        const registryDb = this.pool.getRegistry();
        ensureMeloExists(registryDb, meloId);

        const partitions = this.pool.getTimeseriesForRange(meloId, from, to);
        const allRows = [];

        for (const { db } of partitions) {
          const rows = db
            .prepare(
              'SELECT ts, value, quality, source FROM timeseries WHERE melo_id = ? AND obis = ? AND ts >= ? AND ts < ? ORDER BY ts'
            )
            .all(meloId, obis, from, to);
          allRows.push(...rows);
        }

        allRows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        const aggregatedRows = aggregateByResolution(allRows, resolution);
        const summary = computeTimeseriesSummary(aggregatedRows);

        if (format === 'csv') {
          const lines = ['ts;value;quality'];
          for (const row of aggregatedRows) {
            lines.push(`${row.ts};${row.value};${row.quality || 'measured'}`);
          }
          return lines.join('\n');
        }

        return {
          success: true,
          meloId,
          obis,
          from,
          to,
          resolution,
          values: aggregatedRows,
          summary,
        };
      },
    },
    getTimeseriesSummary: {
      rest: 'GET /timeseries/:meloId/summary',
      params: {
        meloId: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        from: { type: 'string' },
        to: { type: 'string' },
        groupBy: {
          type: 'enum',
          values: ['day', 'week', 'month', 'year'],
          optional: true,
          default: 'day',
        },
      },
      openapi: {
        summary: 'Get aggregated timeseries summary',
        tags: ['EDM (Energiedatenmanagement)'],
        parameters: [
          {
            name: 'meloId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'DE0012345678901234567890123456789' },
          },
          {
            name: 'obis',
            in: 'query',
            required: false,
            schema: { type: 'string', default: '1-0:1.8.0' },
          },
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-04-01T00:00:00.000Z' },
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-04-30T23:59:59.000Z' },
          },
          {
            name: 'groupBy',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['day', 'week', 'month', 'year'], default: 'day' },
          },
        ],
        responses: { 200: { description: 'Grouped summary' } },
      },
      handler(ctx) {
        const { meloId, obis, from, to, groupBy } = ctx.params;

        const registryDb = this.pool.getRegistry();
        ensureMeloExists(registryDb, meloId);

        const partitions = this.pool.getTimeseriesForRange(meloId, from, to);
        const allRows = [];

        for (const { db } of partitions) {
          const rows = db
            .prepare(
              'SELECT ts, value, quality FROM timeseries WHERE melo_id = ? AND obis = ? AND ts >= ? AND ts < ? ORDER BY ts'
            )
            .all(meloId, obis, from, to);
          allRows.push(...rows);
        }

        const grouped = new Map();
        for (const row of allRows) {
          const value = Number(row.value);
          if (!Number.isFinite(value)) continue;

          const key = getGroupKey(row.ts, groupBy);
          const current = grouped.get(key) || {
            period: key,
            total_kwh: 0,
            count: 0,
            measured: 0,
            minVal: null,
            maxVal: null,
          };

          current.total_kwh += value;
          current.count += 1;
          current.measured += row.quality === 'measured' ? 1 : 0;
          current.minVal = current.minVal === null ? value : Math.min(current.minVal, value);
          current.maxVal = current.maxVal === null ? value : Math.max(current.maxVal, value);

          grouped.set(key, current);
        }

        const groups = [...grouped.values()]
          .sort((a, b) => a.period.localeCompare(b.period))
          .map((group) => ({
            period: group.period,
            total_kwh: Number(group.total_kwh.toFixed(6)),
            count: group.count,
            measured: group.measured,
            min_kw: Number(((group.minVal || 0) * 4).toFixed(6)),
            max_kw: Number(((group.maxVal || 0) * 4).toFixed(6)),
            avg_kw: Number(((group.count ? group.total_kwh / group.count : 0) * 4).toFixed(6)),
            dataQuality: group.count ? Number((group.measured / group.count).toFixed(6)) : 0,
          }));

        return {
          success: true,
          meloId,
          obis,
          from,
          to,
          groupBy,
          groups,
        };
      },
    },
    deleteTimeseries: {
      rest: 'DELETE /timeseries/:meloId',
      params: {
        meloId: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true },
        from: { type: 'string' },
        to: { type: 'string' },
      },
      openapi: {
        summary: 'Delete timeseries data for a MeLo',
        tags: ['EDM (Energiedatenmanagement)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId', 'from', 'to'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  obis: { type: 'string', example: '1-0:2.8.0' },
                  from: { type: 'string', example: '2026-04-01T00:00:00.000Z' },
                  to: { type: 'string', example: '2026-04-02T00:00:00.000Z' },
                },
              },
              examples: {
                default: {
                  value: {
                    meloId: 'DE0012345678901234567890123456789',
                    from: '2026-04-01T00:00:00.000Z',
                    to: '2026-04-02T00:00:00.000Z',
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Delete result' } },
      },
      handler(ctx) {
        const { meloId, obis, from, to } = ctx.params;

        const registryDb = this.pool.getRegistry();
        ensureMeloExists(registryDb, meloId);

        const partitions = this.pool.getTimeseriesForRange(meloId, from, to);
        let totalDeletedRows = 0;

        for (const { db } of partitions) {
          const result = obis
            ? db
                .prepare(
                  'DELETE FROM timeseries WHERE melo_id = ? AND obis = ? AND ts >= ? AND ts < ?'
                )
                .run(meloId, obis, from, to)
            : db
                .prepare('DELETE FROM timeseries WHERE melo_id = ? AND ts >= ? AND ts < ?')
                .run(meloId, from, to);

          totalDeletedRows += result.changes || 0;
        }

        return {
          success: true,
          meloId,
          deleted: totalDeletedRows,
        };
      },
    },
  },

  methods: {
    deleteAllTimeseriesForMelo(meloId) {
      const basePath = this.settings.dbPath;
      if (!fs.existsSync(basePath)) {
        return 0;
      }

      let deletedRows = 0;
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('ts_')) continue;

        const partitionKey = entry.name.slice(3);
        const tsDir = path.join(basePath, entry.name);
        const files = fs.readdirSync(tsDir).filter((name) => name.endsWith('.sqlite'));

        for (const fileName of files) {
          const quarter = fileName.replace(/\.sqlite$/, '');
          const db = this.pool.getTimeseries(partitionKey, quarter);
          const result = db.prepare('DELETE FROM timeseries WHERE melo_id = ?').run(meloId);
          deletedRows += result.changes || 0;
        }
      }

      return deletedRows;
    },
  },
};
