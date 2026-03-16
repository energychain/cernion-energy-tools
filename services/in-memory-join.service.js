/**
 * In-Memory Join Service
 *
 * Generic join engine for combining datasets from datasource-cache and other
 * microservice actions. Includes a dedicated metering + spot price cost
 * calculation endpoint for AI research flows.
 */

const { resolveDateAlias } = require('../src/date-utils');
const {
  normalisePeriod: normalizePeriodValue,
  isPeriodColumn,
} = require('../src/period-normaliser');

function toNumber(value, fallback = NaN) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateFlexible(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const deMatch = raw.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/
  );
  if (deMatch) {
    const day = Number(deMatch[1]);
    const month = Number(deMatch[2]);
    const year = Number(deMatch[3]);
    const hour = Number(deMatch[4] || 0);
    const minute = Number(deMatch[5] || 0);
    const second = Number(deMatch[6] || 0);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  const isoLoose = raw.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/
  );
  if (isoLoose) {
    const year = Number(isoLoose[1]);
    const month = Number(isoLoose[2]);
    const day = Number(isoLoose[3]);
    const hour = Number(isoLoose[4] || 0);
    const minute = Number(isoLoose[5] || 0);
    const second = Number(isoLoose[6] || 0);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function getByPath(obj, path) {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current;
}

function extractRows(payload, dataPath) {
  if (dataPath) {
    const value = getByPath(payload, dataPath);
    return Array.isArray(value) ? value : null;
  }

  const candidates = [
    payload,
    payload?.data,
    payload?.rows,
    payload?.data?.rows,
    payload?.data?.data,
    payload?.data?.items,
    payload?.items,
    payload?.prices,
    payload?.data?.prices,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function normalizeJoinKey(rawValue, matchMode) {
  if (rawValue == null) return null;

  if (matchMode === 'exact') {
    return String(rawValue);
  }

  const date = parseDateFlexible(rawValue);
  if (!date) return null;

  if (matchMode === 'daily-date') {
    return toIsoDate(date);
  }

  if (matchMode === 'hourly-time') {
    return `${toIsoDate(date)}T${pad2(date.getUTCHours())}`;
  }

  return String(rawValue);
}

function extractPriceEurMWh(row, preferredField) {
  if (!row || typeof row !== 'object') return null;

  const candidateFields = [
    preferredField,
    'priceEURperMWh',
    'priceEURMWh',
    'priceEurMWh',
    'price',
    'value',
    'spotPriceEURMWh',
  ].filter(Boolean);

  for (const field of candidateFields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      const parsed = toNumber(row[field]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

async function fetchDatasourceRows(ctx, sourceId, options = {}) {
  const pageSize = Math.max(1, Math.min(5000, options.pageSize || 1000));
  const maxRows = Math.max(1, Math.min(200000, options.maxRows || 50000));
  const privacyContext = options.privacyContext || 'internal';

  const allRows = [];
  let offset = 0;
  let totalRows = Number.POSITIVE_INFINITY;

  while (offset < totalRows && allRows.length < maxRows) {
    const response = await ctx.call('datasource-cache.query', {
      sourceId,
      limit: pageSize,
      offset,
      privacyContext,
    });

    const rows = Array.isArray(response?.data) ? response.data : [];
    if (!rows.length) break;

    allRows.push(...rows);

    const total = toNumber(response?.totalRows, NaN);
    totalRows = Number.isFinite(total) ? total : offset + rows.length;
    offset += rows.length;
  }

  return allRows.slice(0, maxRows);
}

function normalizeSingleColumnCsvRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;

  const first = rows[0];
  if (!first || typeof first !== 'object') return rows;

  const keys = Object.keys(first);
  if (keys.length !== 1) return rows;

  const onlyKey = keys[0];
  if (!rows.every((row) => row && typeof row === 'object' && Object.keys(row).length === 1)) {
    return rows;
  }

  const lines = rows
    .map((row) => {
      const raw = row?.[onlyKey];
      return raw == null ? '' : String(raw).trim();
    })
    .filter(Boolean);

  if (lines.length < 2) return rows;

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  if ((delimiter === ';' && semicolonCount === 0) || (delimiter === ',' && commaCount === 0)) {
    return rows;
  }

  const headers = headerLine
    .split(delimiter)
    .map((h) => h.trim())
    .filter(Boolean);

  if (!headers.length || headers.length === 1) return rows;

  return lines
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const values = line.split(delimiter).map((v) => v.trim());
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] ?? null;
      });
      return obj;
    });
}

function mergeRows(leftRow, rightRow, options) {
  if (!rightRow) return { ...leftRow };

  const strategy = options.collisionStrategy || 'prefix-collisions';
  const rightPrefix = options.rightPrefix || 'right_';

  if (strategy === 'overwrite') {
    return { ...leftRow, ...rightRow };
  }

  const merged = { ...leftRow };
  for (const [key, value] of Object.entries(rightRow)) {
    if (strategy === 'prefix-all') {
      merged[`${rightPrefix}${key}`] = value;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[`${rightPrefix}${key}`] = value;
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function filterRowsByDate(rows, timeField, startDate, endDate) {
  if (!startDate && !endDate) return rows;

  const startTs = startDate ? startDate.getTime() : Number.NEGATIVE_INFINITY;
  const endTs = endDate ? endDate.getTime() : Number.POSITIVE_INFINITY;

  return rows.filter((row) => {
    const ts = parseDateFlexible(row?.[timeField]);
    if (!ts) return false;
    const ms = ts.getTime();
    return ms >= startTs && ms <= endTs;
  });
}

function parseDateBoundary(input, mode) {
  if (!input) return null;
  const resolved = resolveDateAlias(String(input));
  const raw = String(resolved).trim();

  const onlyDateIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (onlyDateIso) {
    const year = Number(onlyDateIso[1]);
    const month = Number(onlyDateIso[2]);
    const day = Number(onlyDateIso[3]);
    if (mode === 'end') return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const onlyDateDe = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (onlyDateDe) {
    const day = Number(onlyDateDe[1]);
    const month = Number(onlyDateDe[2]);
    const year = Number(onlyDateDe[3]);
    if (mode === 'end') return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  const parsed = parseDateFlexible(raw);
  if (!parsed) return null;
  return parsed;
}

function inferIdFromRows(rows, regexes) {
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    for (const value of Object.values(row)) {
      const text = String(value || '').trim();
      if (!text) continue;
      if (regexes.some((re) => re.test(text))) return text;
    }
  }
  return null;
}

function toActualMW(value, unit) {
  const n = toNumber(value, NaN);
  if (!Number.isFinite(n)) return NaN;
  if (unit === 'MW') return n;
  if (unit === 'kW') return n / 1000;
  return n / 1000000;
}

function extractBenchmarkSummary(benchmarkData) {
  const root = benchmarkData?.data || benchmarkData || {};
  const digital = root?.digitalisierungsindex || {};
  const benchmark = root?.benchmark || root?.statistics || {};

  const vnbValue = toNumber(
    digital?.gesamtscore_pct ?? digital?.gesamtscore ?? benchmark?.vnbValue ?? root?.vnbValue,
    NaN
  );
  const medianValue = toNumber(
    benchmark?.medianValue ?? benchmark?.median ?? digital?.median_pct ?? root?.medianValue,
    NaN
  );

  return {
    vnbValue: Number.isFinite(vnbValue) ? vnbValue : null,
    medianValue: Number.isFinite(medianValue) ? medianValue : null,
    source: root?.source || benchmark?.source || 'ewk-monitoring',
  };
}

module.exports = {
  name: 'in-memory-join',

  actions: {
    join: {
      rest: 'POST /join',
      params: {
        left: {
          type: 'object',
          props: {
            kind: { type: 'enum', values: ['datasource', 'action'] },
            sourceId: { type: 'string', optional: true },
            action: { type: 'string', optional: true },
            params: { type: 'object', optional: true },
            dataPath: { type: 'string', optional: true },
            maxRows: { type: 'number', integer: true, optional: true, min: 1, convert: true },
            privacyContext: {
              type: 'enum',
              values: ['internal', 'ai-agent', 'public'],
              optional: true,
            },
          },
        },
        right: {
          type: 'object',
          props: {
            kind: { type: 'enum', values: ['datasource', 'action'] },
            sourceId: { type: 'string', optional: true },
            action: { type: 'string', optional: true },
            params: { type: 'object', optional: true },
            dataPath: { type: 'string', optional: true },
            maxRows: { type: 'number', integer: true, optional: true, min: 1, convert: true },
            privacyContext: {
              type: 'enum',
              values: ['internal', 'ai-agent', 'public'],
              optional: true,
            },
          },
        },
        join: {
          type: 'object',
          props: {
            leftField: { type: 'string', min: 1 },
            rightField: { type: 'string', min: 1 },
            matchMode: {
              type: 'enum',
              values: ['exact', 'hourly-time', 'daily-date'],
              optional: true,
              default: 'exact',
            },
            joinType: {
              type: 'enum',
              values: ['left', 'inner'],
              optional: true,
              default: 'left',
            },
            multipleMatches: {
              type: 'enum',
              values: ['first', 'last', 'explode'],
              optional: true,
              default: 'first',
            },
            collisionStrategy: {
              type: 'enum',
              values: ['overwrite', 'prefix-collisions', 'prefix-all'],
              optional: true,
              default: 'prefix-collisions',
            },
            rightPrefix: { type: 'string', optional: true, default: 'right_' },
          },
        },
      },
      openapi: {
        summary: 'Generic in-memory join across datasource and action outputs',
        tags: ['DataSources', 'Analytics'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['left', 'right', 'join'],
                properties: {
                  left: {
                    type: 'object',
                    example: {
                      kind: 'datasource',
                      sourceId: 'fe55ec97-ada3-4272-9e2e-3f494a74f33a',
                    },
                  },
                  right: {
                    type: 'object',
                    example: {
                      kind: 'action',
                      action: 'energy-market.prices',
                    },
                  },
                  join: {
                    type: 'object',
                    example: {
                      leftField: 'Zeit',
                      rightField: 'timestamp',
                      matchMode: 'hourly-time',
                    },
                  },
                },
              },
              examples: {
                basicJoin: {
                  summary: 'Join datasource rows with day-ahead market prices by hour',
                  value: {
                    left: {
                      kind: 'datasource',
                      sourceId: 'fe55ec97-ada3-4272-9e2e-3f494a74f33a',
                      privacyContext: 'internal',
                    },
                    right: {
                      kind: 'action',
                      action: 'energy-market.prices',
                      params: {
                        market: 'day-ahead',
                        region: 'Deutschland',
                        startDate: '2026-03-10',
                        endDate: '2026-03-10',
                      },
                      dataPath: 'data.prices',
                    },
                    join: {
                      leftField: 'Zeit',
                      rightField: 'timestamp',
                      matchMode: 'hourly-time',
                      joinType: 'left',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { left, right, join } = ctx.params;

        const fetchRows = async (spec, sideName) => {
          if (spec.kind === 'datasource') {
            if (!spec.sourceId) {
              throw new Error(`${sideName}.sourceId is required for datasource joins`);
            }
            return fetchDatasourceRows(ctx, spec.sourceId, {
              maxRows: spec.maxRows,
              privacyContext: spec.privacyContext || 'internal',
            });
          }

          if (!spec.action) throw new Error(`${sideName}.action is required for action joins`);
          const payload = await ctx.call(spec.action, spec.params || {}, { meta: ctx.meta });
          const rows = extractRows(payload, spec.dataPath);
          if (!Array.isArray(rows)) {
            throw new Error(
              `${sideName} action "${spec.action}" did not return an array (set ${sideName}.dataPath)`
            );
          }
          return rows;
        };

        const leftRows = await fetchRows(left, 'left');
        const rightRows = await fetchRows(right, 'right');

        const rightIndex = new Map();
        for (const row of rightRows) {
          const key = normalizeJoinKey(row?.[join.rightField], join.matchMode || 'exact');
          if (key == null) continue;
          if (!rightIndex.has(key)) rightIndex.set(key, []);
          rightIndex.get(key).push(row);
        }

        const output = [];

        for (const leftRow of leftRows) {
          const key = normalizeJoinKey(leftRow?.[join.leftField], join.matchMode || 'exact');
          const matches = key == null ? [] : rightIndex.get(key) || [];

          if (!matches.length) {
            if ((join.joinType || 'left') === 'left') output.push({ ...leftRow });
            continue;
          }

          const mode = join.multipleMatches || 'first';
          if (mode === 'explode') {
            for (const match of matches) {
              output.push(mergeRows(leftRow, match, join));
            }
          } else if (mode === 'last') {
            output.push(mergeRows(leftRow, matches[matches.length - 1], join));
          } else {
            output.push(mergeRows(leftRow, matches[0], join));
          }
        }

        return {
          success: true,
          leftCount: leftRows.length,
          rightCount: rightRows.length,
          joinedCount: output.length,
          data: output,
        };
      },
    },

    meteringSpotCost: {
      rest: 'POST /metering-spot-cost',
      params: {
        sourceId: { type: 'string', min: 1 },
        date: { type: 'string', optional: true },
        startDate: { type: 'string', optional: true },
        endDate: { type: 'string', optional: true },
        region: { type: 'string', optional: true, default: 'Deutschland' },
        market: {
          type: 'enum',
          values: ['day-ahead', 'intraday', 'futures'],
          optional: true,
          default: 'day-ahead',
        },
        leftTimeField: { type: 'string', optional: true, default: 'Zeit' },
        consumptionPowerField: {
          type: 'string',
          optional: true,
          default: 'Leistung Bezug (W)',
        },
        feedInPowerField: {
          type: 'string',
          optional: true,
          default: 'Leistung Einspeisung (W)',
        },
        intervalMinutes: {
          type: 'number',
          integer: true,
          min: 1,
          optional: true,
          default: 15,
          convert: true,
        },
        priceField: { type: 'string', optional: true, default: 'priceEURMWh' },
        aggregateBy: {
          type: 'enum',
          values: ['interval', 'hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        includeIntervals: { type: 'boolean', optional: true, default: false, convert: true },
        privacyContext: {
          type: 'enum',
          values: ['internal', 'ai-agent', 'public'],
          optional: true,
          default: 'internal',
        },
        normalisePeriod: { type: 'boolean', optional: true, default: false, convert: true },
        maxRows: {
          type: 'number',
          integer: true,
          min: 1,
          optional: true,
          default: 50000,
          convert: true,
        },
      },
      openapi: {
        summary: 'Join metering datasource with market spot prices and calculate costs',
        tags: ['DataSources', 'Analytics'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sourceId'],
                properties: {
                  sourceId: { type: 'string', example: 'fe55ec97-ada3-4272-9e2e-3f494a74f33a' },
                  date: { type: 'string', format: 'date', example: '2026-03-10' },
                  startDate: { type: 'string', format: 'date', example: '2026-03-10' },
                  endDate: { type: 'string', format: 'date', example: '2026-03-10' },
                  aggregateBy: {
                    type: 'string',
                    enum: ['interval', 'hourly', 'daily'],
                    default: 'hourly',
                    example: 'hourly',
                  },
                },
              },
              examples: {
                hourlyCost: {
                  summary: 'Calculate hourly electricity cost from metering profile',
                  value: {
                    sourceId: 'fe55ec97-ada3-4272-9e2e-3f494a74f33a',
                    date: '2026-03-10',
                    market: 'day-ahead',
                    region: 'Deutschland',
                    aggregateBy: 'hourly',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          sourceId,
          date,
          startDate,
          endDate,
          region,
          market,
          leftTimeField,
          consumptionPowerField,
          feedInPowerField,
          intervalMinutes,
          priceField,
          aggregateBy,
          includeIntervals,
          privacyContext,
          normalisePeriod,
          maxRows,
        } = ctx.params;

        const rawRows = await fetchDatasourceRows(ctx, sourceId, {
          maxRows,
          privacyContext,
        });
        const rows = normalizeSingleColumnCsvRows(rawRows);

        if (!rows.length) {
          return {
            success: true,
            sourceId,
            rowCount: 0,
            data: [],
            totals: { totalEnergyKWh: 0, totalCostEur: 0 },
          };
        }

        const startBoundary = parseDateBoundary(startDate || date, 'start');
        const endBoundary = parseDateBoundary(endDate || date, 'end');

        const shouldNormalisePeriod =
          normalisePeriod === true || isPeriodColumn(rows, leftTimeField);

        const workingRows =
          shouldNormalisePeriod && leftTimeField
            ? rows.map((row) => {
                const normalized = normalizePeriodValue(row?.[leftTimeField]);
                return normalized
                  ? {
                      ...row,
                      [leftTimeField]: normalized,
                    }
                  : row;
              })
            : rows;

        let filteredRows = workingRows;
        if (startBoundary || endBoundary) {
          filteredRows = filterRowsByDate(workingRows, leftTimeField, startBoundary, endBoundary);
        }

        const parsedTimes = filteredRows
          .map((row) => parseDateFlexible(row?.[leftTimeField]))
          .filter(Boolean)
          .sort((a, b) => a.getTime() - b.getTime());

        if (!parsedTimes.length) {
          return {
            success: true,
            sourceId,
            rowCount: 0,
            data: [],
            warning: `No parseable timestamps found in field "${leftTimeField}"`,
          };
        }

        const rangeStart = startBoundary || parsedTimes[0];
        const rangeEnd = endBoundary || parsedTimes[parsedTimes.length - 1];

        const pricesResult = await ctx.call(
          'energy-market.prices',
          {
            market,
            region,
            startDate: toIsoDate(rangeStart),
            endDate: toIsoDate(rangeEnd),
          },
          { meta: ctx.meta }
        );

        let priceRows = extractRows(pricesResult, 'data.prices') || extractRows(pricesResult);

        if (!Array.isArray(priceRows) || !priceRows.length) {
          try {
            const fallback = await ctx.call(
              'german-grid.spotprices',
              {
                dateFrom: toIsoDate(rangeStart),
                dateTo: toIsoDate(rangeEnd),
                includeStatistics: false,
              },
              { meta: ctx.meta }
            );

            priceRows =
              extractRows(fallback, 'dataPoints') ||
              extractRows(fallback, 'data.dataPoints') ||
              extractRows(fallback, 'data.prices') ||
              extractRows(fallback);
          } catch {
            // Preserve original error message below.
          }
        }

        if (!Array.isArray(priceRows) || !priceRows.length) {
          throw new Error('No market price rows returned from energy-market.prices');
        }

        const priceByHour = new Map();
        for (const priceRow of priceRows) {
          const hourKey = normalizeJoinKey(priceRow?.timestamp || priceRow?.time, 'hourly-time');
          if (!hourKey) continue;
          const eurMWh = extractPriceEurMWh(priceRow, priceField);
          if (!Number.isFinite(eurMWh)) continue;
          priceByHour.set(hourKey, eurMWh);
        }

        const intervals = [];
        let missingPriceIntervals = 0;

        for (const row of filteredRows) {
          const timestamp = parseDateFlexible(row?.[leftTimeField]);
          if (!timestamp) continue;

          const hourKey = normalizeJoinKey(timestamp, 'hourly-time');
          const spotPriceEurMWh = priceByHour.has(hourKey) ? priceByHour.get(hourKey) : null;

          const consumptionW = toNumber(row?.[consumptionPowerField], 0);
          const feedInW = toNumber(row?.[feedInPowerField], 0);
          const netPowerW = Math.max(0, consumptionW - feedInW);
          const intervalEnergyKWh = (netPowerW / 1000) * (intervalMinutes / 60);
          const intervalCostEur =
            spotPriceEurMWh == null ? null : (intervalEnergyKWh * spotPriceEurMWh) / 1000;

          if (spotPriceEurMWh == null) missingPriceIntervals += 1;

          intervals.push({
            ...row,
            hourKey,
            netPowerW,
            intervalEnergyKWh,
            spotPriceEurMWh,
            spotPriceCentPerKWh:
              spotPriceEurMWh == null ? null : Number((spotPriceEurMWh / 10).toFixed(6)),
            intervalCostEur,
          });
        }

        const aggregate = new Map();
        for (const interval of intervals) {
          const timestamp = parseDateFlexible(interval?.[leftTimeField]);
          if (!timestamp) continue;

          const key =
            aggregateBy === 'daily'
              ? toIsoDate(timestamp)
              : `${toIsoDate(timestamp)}T${pad2(timestamp.getUTCHours())}:00:00Z`;

          if (!aggregate.has(key)) {
            aggregate.set(key, {
              period: key,
              intervalCount: 0,
              totalEnergyKWh: 0,
              totalCostEur: 0,
              avgSpotPriceEurMWh: null,
              minSpotPriceEurMWh: null,
              maxSpotPriceEurMWh: null,
              pricedIntervals: 0,
            });
          }

          const target = aggregate.get(key);
          target.intervalCount += 1;
          target.totalEnergyKWh += interval.intervalEnergyKWh;

          if (Number.isFinite(interval.spotPriceEurMWh)) {
            target.pricedIntervals += 1;
            target.totalCostEur += interval.intervalCostEur;
            target.avgSpotPriceEurMWh =
              target.avgSpotPriceEurMWh == null
                ? interval.spotPriceEurMWh
                : target.avgSpotPriceEurMWh + interval.spotPriceEurMWh;
            target.minSpotPriceEurMWh =
              target.minSpotPriceEurMWh == null
                ? interval.spotPriceEurMWh
                : Math.min(target.minSpotPriceEurMWh, interval.spotPriceEurMWh);
            target.maxSpotPriceEurMWh =
              target.maxSpotPriceEurMWh == null
                ? interval.spotPriceEurMWh
                : Math.max(target.maxSpotPriceEurMWh, interval.spotPriceEurMWh);
          }
        }

        const grouped = Array.from(aggregate.values())
          .map((item) => ({
            ...item,
            avgSpotPriceEurMWh:
              item.pricedIntervals > 0 ? item.avgSpotPriceEurMWh / item.pricedIntervals : null,
          }))
          .sort((a, b) => String(a.period).localeCompare(String(b.period)));

        const totalEnergyKWh = intervals.reduce((sum, row) => sum + row.intervalEnergyKWh, 0);
        const totalCostEur = intervals.reduce(
          (sum, row) => (Number.isFinite(row.intervalCostEur) ? sum + row.intervalCostEur : sum),
          0
        );

        return {
          success: true,
          sourceId,
          dateRange: {
            startDate: toIsoDate(rangeStart),
            endDate: toIsoDate(rangeEnd),
          },
          rowCount: intervals.length,
          missingPriceIntervals,
          periodNormalised: shouldNormalisePeriod,
          totals: {
            totalEnergyKWh,
            totalCostEur,
          },
          data: aggregateBy === 'interval' ? intervals : grouped,
          intervals: includeIntervals ? intervals : undefined,
        };
      },
    },

    benchmarkCompare: {
      rest: 'POST /benchmark-compare',
      params: {
        inhouseRows: { type: 'array', items: 'object' },
        benchmarkData: { type: 'object' },
        domain: { type: 'string' },
        aggregationField: { type: 'string' },
      },
      openapi: {
        summary: 'Compare inhouse aggregate with external benchmark values',
        tags: ['DataSources', 'Analytics'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['inhouseRows', 'benchmarkData', 'domain', 'aggregationField'],
                properties: {
                  inhouseRows: {
                    type: 'array',
                    items: { type: 'object' },
                    example: [{ value: 12 }, { value: 18 }, { value: 15 }],
                  },
                  benchmarkData: {
                    type: 'object',
                    example: {
                      data: [{ value: '{"vnb":"Netzbetreiber A","score":14,"median":11}' }],
                    },
                  },
                  domain: { type: 'string', example: 'ewk_connection_time' },
                  aggregationField: { type: 'string', example: 'value' },
                },
              },
              examples: {
                compareBenchmark: {
                  summary: 'Compare inhouse values against benchmark median',
                  value: {
                    inhouseRows: [{ value: 12 }, { value: 18 }, { value: 15 }],
                    benchmarkData: {
                      data: [
                        {
                          value: '{"vnb":"Netzbetreiber A","score":14,"median":11}',
                        },
                      ],
                    },
                    domain: 'ewk_connection_time',
                    aggregationField: 'value',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { inhouseRows, benchmarkData, domain, aggregationField } = ctx.params;

        const values = (inhouseRows || [])
          .map((row) => toNumber(row?.[aggregationField], NaN))
          .filter((value) => Number.isFinite(value));

        const count = values.length;
        const total = values.reduce((sum, value) => sum + value, 0);
        const average = count > 0 ? total / count : 0;

        const benchmarkSummary = extractBenchmarkSummary(benchmarkData);
        const delta =
          Number.isFinite(benchmarkSummary.vnbValue) &&
          Number.isFinite(benchmarkSummary.medianValue)
            ? benchmarkSummary.vnbValue - benchmarkSummary.medianValue
            : null;
        const deltaPercent =
          delta != null && Math.abs(benchmarkSummary.medianValue) > 1e-12
            ? (delta / benchmarkSummary.medianValue) * 100
            : null;

        const ranking = delta == null ? 'unknown' : delta >= 0 ? 'above median' : 'below median';

        const unit = /kwh/i.test(aggregationField)
          ? 'kWh'
          : /kwp|kw/i.test(aggregationField)
            ? 'kW'
            : 'value';

        const narrative =
          delta == null
            ? `Inhouse ${domain} totals are ${Number(total.toFixed(2))} (${count} rows); benchmark median is not available.`
            : `Inhouse ${domain} totals are ${Number(total.toFixed(2))} (${count} rows), while the benchmark is ${ranking} by ${Number(delta.toFixed(2))}.`;

        return {
          success: true,
          inhouseSummary: {
            total,
            count,
            average,
            unit,
          },
          benchmarkSummary: {
            ...benchmarkSummary,
            ranking,
          },
          delta,
          deltaPercent,
          narrative,
        };
      },
    },

    compareForecastActual: {
      rest: 'POST /compare-forecast-actual',
      params: {
        sourceId: { type: 'string', min: 1 },
        date: { type: 'string', optional: true },
        startDate: { type: 'string', optional: true },
        endDate: { type: 'string', optional: true },
        leftTimeField: { type: 'string', optional: true, default: 'Zeit' },
        leftActualField: { type: 'string', optional: true, default: 'Leistung Einspeisung (W)' },
        actualUnit: {
          type: 'enum',
          values: ['W', 'kW', 'MW'],
          optional: true,
          default: 'W',
        },
        rightTimeField: { type: 'string', optional: true, default: 'timestamp' },
        rightForecastField: { type: 'string', optional: true, default: 'generationMW' },
        matchMode: {
          type: 'enum',
          values: ['hourly-time', 'daily-date', 'exact'],
          optional: true,
          default: 'hourly-time',
        },
        aggregateBy: {
          type: 'enum',
          values: ['interval', 'hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        installationMastrNummer: { type: 'string', optional: true },
        messlokationId: { type: 'string', optional: true },
        gridOperatorMastrId: { type: 'string', optional: true },
        bundesland: { type: 'string', optional: true },
        landkreis: { type: 'string', optional: true },
        gemeinde: { type: 'string', optional: true },
        postleitzahl: { type: 'string', optional: true },
        forecastDays: {
          type: 'number',
          integer: true,
          min: 1,
          max: 14,
          optional: true,
          convert: true,
        },
        resolution: {
          type: 'enum',
          values: ['15min', 'hour', 'hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        includeIntervals: { type: 'boolean', optional: true, default: false, convert: true },
        privacyContext: {
          type: 'enum',
          values: ['internal', 'ai-agent', 'public'],
          optional: true,
          default: 'internal',
        },
        maxRows: {
          type: 'number',
          integer: true,
          min: 1,
          optional: true,
          default: 50000,
          convert: true,
        },
      },
      openapi: {
        summary: 'Compare inhouse actual generation with forecasted generation',
        tags: ['DataSources', 'Analytics'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sourceId'],
                properties: {
                  sourceId: { type: 'string', example: 'fe55ec97-ada3-4272-9e2e-3f494a74f33a' },
                  date: { type: 'string', format: 'date', example: '2026-03-10' },
                  startDate: { type: 'string', format: 'date', example: '2026-03-10' },
                  endDate: { type: 'string', format: 'date', example: '2026-03-10' },
                  aggregateBy: {
                    type: 'string',
                    enum: ['interval', 'hourly', 'daily'],
                    default: 'hourly',
                    example: 'hourly',
                  },
                },
              },
              examples: {
                compareHourly: {
                  summary: 'Compare actual inhouse generation with forecast on hourly basis',
                  value: {
                    sourceId: 'fe55ec97-ada3-4272-9e2e-3f494a74f33a',
                    date: '2026-03-10',
                    installationMastrNummer: 'SEE900000123456',
                    aggregateBy: 'hourly',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          sourceId,
          date,
          startDate,
          endDate,
          leftTimeField,
          leftActualField,
          actualUnit,
          rightTimeField,
          rightForecastField,
          matchMode,
          aggregateBy,
          installationMastrNummer,
          messlokationId,
          gridOperatorMastrId,
          bundesland,
          landkreis,
          gemeinde,
          postleitzahl,
          forecastDays,
          resolution,
          includeIntervals,
          privacyContext,
          maxRows,
        } = ctx.params;

        const rawRows = await fetchDatasourceRows(ctx, sourceId, {
          maxRows,
          privacyContext,
        });
        const rows = normalizeSingleColumnCsvRows(rawRows);

        if (!rows.length) {
          return {
            success: true,
            sourceId,
            rowCount: 0,
            data: [],
          };
        }

        const startBoundary = parseDateBoundary(startDate || date, 'start');
        const endBoundary = parseDateBoundary(endDate || date, 'end');
        const filteredRows =
          startBoundary || endBoundary
            ? filterRowsByDate(rows, leftTimeField, startBoundary, endBoundary)
            : rows;

        const parsedTimes = filteredRows
          .map((row) => parseDateFlexible(row?.[leftTimeField]))
          .filter(Boolean)
          .sort((a, b) => a.getTime() - b.getTime());

        if (!parsedTimes.length) {
          return {
            success: true,
            sourceId,
            rowCount: 0,
            data: [],
            warning: `No parseable timestamps found in field "${leftTimeField}"`,
          };
        }

        const rangeStart = startBoundary || parsedTimes[0];
        const rangeEnd = endBoundary || parsedTimes[parsedTimes.length - 1];

        let resolvedInstallationMastrNummer = installationMastrNummer;
        let resolvedMesslokationId = messlokationId;
        if (!resolvedInstallationMastrNummer) {
          resolvedInstallationMastrNummer = inferIdFromRows(filteredRows, [
            /^S(?:EE|WE|AN)[A-Z0-9]+$/i,
          ]);
        }
        if (!resolvedMesslokationId) {
          resolvedMesslokationId = inferIdFromRows(filteredRows, [/^DE\d{20,}$/i]);
        }

        const hasForecastSelector =
          !!resolvedInstallationMastrNummer ||
          !!resolvedMesslokationId ||
          !!gridOperatorMastrId ||
          !!bundesland ||
          !!landkreis ||
          !!gemeinde ||
          !!postleitzahl;

        if (!hasForecastSelector) {
          throw new Error(
            'No forecast selector provided. Set one of installationMastrNummer, messlokationId, gridOperatorMastrId, bundesland, landkreis, gemeinde, or postleitzahl.'
          );
        }

        const diffMs = Math.max(0, rangeEnd.getTime() - rangeStart.getTime());
        const computedForecastDays = Math.min(14, Math.max(1, Math.ceil(diffMs / 86400000) + 1));

        const forecastResult = await ctx.call(
          'forecast.generationForecast',
          {
            installationMastrNummer: resolvedInstallationMastrNummer,
            messlokationId: resolvedMesslokationId,
            gridOperatorMastrId,
            bundesland,
            landkreis,
            gemeinde,
            postleitzahl,
            startDate: toIsoDate(rangeStart),
            forecastDays: forecastDays || computedForecastDays,
            resolution: resolution || (matchMode === 'daily-date' ? 'daily' : 'hourly'),
          },
          { meta: ctx.meta }
        );

        const forecastRows =
          extractRows(forecastResult, 'forecasts') ||
          extractRows(forecastResult, 'data.forecasts') ||
          extractRows(forecastResult);

        if (!Array.isArray(forecastRows) || !forecastRows.length) {
          throw new Error('No forecast rows returned from forecast.generationForecast');
        }

        const rightIndex = new Map();
        for (const forecastRow of forecastRows) {
          const key = normalizeJoinKey(forecastRow?.[rightTimeField], matchMode || 'hourly-time');
          if (key == null) continue;
          if (!rightIndex.has(key)) rightIndex.set(key, []);
          rightIndex.get(key).push(forecastRow);
        }

        const intervals = [];
        let missingForecastIntervals = 0;

        for (const row of filteredRows) {
          const key = normalizeJoinKey(row?.[leftTimeField], matchMode || 'hourly-time');
          const match = key == null ? null : (rightIndex.get(key) || [])[0] || null;

          const actualMW = toActualMW(row?.[leftActualField], actualUnit);
          const forecastMW = match ? toNumber(match?.[rightForecastField], NaN) : NaN;

          const deltaMW =
            Number.isFinite(actualMW) && Number.isFinite(forecastMW) ? actualMW - forecastMW : null;
          const deltaPct =
            deltaMW != null && Number.isFinite(forecastMW) && Math.abs(forecastMW) > 1e-12
              ? (deltaMW / forecastMW) * 100
              : null;

          if (!match) missingForecastIntervals += 1;

          intervals.push({
            ...row,
            forecastTimestamp: match?.[rightTimeField] || null,
            forecastMW: Number.isFinite(forecastMW) ? forecastMW : null,
            actualMW: Number.isFinite(actualMW) ? actualMW : null,
            deltaMW,
            deltaPct,
          });
        }

        const aggregate = new Map();
        if (aggregateBy !== 'interval') {
          for (const row of intervals) {
            const ts = parseDateFlexible(row?.[leftTimeField]);
            if (!ts) continue;
            const period =
              aggregateBy === 'daily'
                ? toIsoDate(ts)
                : `${toIsoDate(ts)}T${pad2(ts.getUTCHours())}:00:00Z`;

            if (!aggregate.has(period)) {
              aggregate.set(period, {
                period,
                sampleCount: 0,
                actualSumMW: 0,
                forecastSumMW: 0,
                comparedCount: 0,
              });
            }

            const bucket = aggregate.get(period);
            bucket.sampleCount += 1;
            if (Number.isFinite(row.actualMW)) bucket.actualSumMW += row.actualMW;
            if (Number.isFinite(row.forecastMW)) bucket.forecastSumMW += row.forecastMW;
            if (row.deltaMW != null) bucket.comparedCount += 1;
          }
        }

        const grouped = Array.from(aggregate.values())
          .map((item) => {
            const deltaMW = item.actualSumMW - item.forecastSumMW;
            const deltaPct =
              Math.abs(item.forecastSumMW) > 1e-12 ? (deltaMW / item.forecastSumMW) * 100 : null;
            return {
              ...item,
              deltaMW,
              deltaPct,
            };
          })
          .sort((a, b) => String(a.period).localeCompare(String(b.period)));

        const compared = intervals.filter((r) => r.deltaMW != null);
        const totalActualMW = compared.reduce((sum, r) => sum + r.actualMW, 0);
        const totalForecastMW = compared.reduce((sum, r) => sum + r.forecastMW, 0);
        const totalDeltaMW = totalActualMW - totalForecastMW;
        const totalDeltaPct =
          Math.abs(totalForecastMW) > 1e-12 ? (totalDeltaMW / totalForecastMW) * 100 : null;

        return {
          success: true,
          sourceId,
          dateRange: {
            startDate: toIsoDate(rangeStart),
            endDate: toIsoDate(rangeEnd),
          },
          rowCount: intervals.length,
          missingForecastIntervals,
          totals: {
            comparedCount: compared.length,
            totalActualMW,
            totalForecastMW,
            totalDeltaMW,
            totalDeltaPct,
          },
          data: aggregateBy === 'interval' ? intervals : grouped,
          intervals: includeIntervals ? intervals : undefined,
        };
      },
    },
  },
};
