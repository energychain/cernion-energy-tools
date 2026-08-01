'use strict';

const { MoleculerClientError } = require('moleculer').Errors;
const { VALIDATION_RULES, findGaps, calculateRMSE } = require('../src/edm-validation-rules');
const { generateReplacementValues } = require('../src/edm-replacement-values');
const { getObisDirection, getObisUnit } = require('../src/obis-codes');

function ruleMap() {
  return new Map(VALIDATION_RULES.map((rule) => [rule.id, rule]));
}

function toIso(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseCapacityKw(paramsCapacity, melo) {
  const direct = Number(paramsCapacity);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const metadata = melo?.metadata || {};
  const candidates = [
    metadata.capacityKw,
    metadata.capacity_kw,
    metadata.nettonennleistung,
    metadata.nettoNennleistung,
    metadata.installedPowerKw,
    melo?.capacityKw,
  ];

  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return null;
}

function mapTimeseriesRows(response) {
  return (response?.values || [])
    .map((row) => ({
      ts: toIso(row.ts),
      value: row.value,
      quality: row.quality || 'measured',
      source: row.source || null,
    }))
    .filter((row) => row.ts !== null)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

function addFinding(findings, payload) {
  findings.push({
    ruleId: payload.ruleId,
    severity: payload.severity,
    timestamp: payload.timestamp || null,
    value: payload.value !== undefined ? payload.value : null,
    message: payload.message,
    details: payload.details || null,
  });
}

function computeSummary(rows, findings, autoFixed) {
  const totalValues = rows.length;
  const errors = findings.filter((item) => item.severity === 'error').length;
  const warnings = findings.filter((item) => item.severity === 'warning').length;
  const infos = findings.filter((item) => item.severity === 'info').length;

  const problematicTimestamps = new Set(
    findings
      .filter(
        (item) => (item.severity === 'error' || item.severity === 'warning') && item.timestamp
      )
      .map((item) => item.timestamp)
  );

  const cleanValues = Math.max(0, totalValues - problematicTimestamps.size);
  const dataQuality = totalValues > 0 ? cleanValues / totalValues : 1;

  return {
    totalValues,
    findings: findings.length,
    errors,
    warnings,
    infos,
    autoFixed,
    dataQuality: Number(dataQuality.toFixed(6)),
  };
}

function collectRecommendations(findings) {
  const hasGaps = findings.some((item) => item.ruleId === 'GAP_DETECTION');
  const hasBandwidth = findings.some((item) => item.ruleId === 'BANDWIDTH_CHECK');
  const hasNegative = findings.some((item) => item.ruleId === 'NEGATIVE_VALUE_CHECK');
  const hasMonotony = findings.some((item) => item.ruleId === 'MONOTONY_CHECK');
  const hasSlp = findings.some((item) => item.ruleId === 'SLP_PLAUSIBILITY');

  const recommendations = [];

  if (hasGaps) {
    recommendations.push(
      'Lücken erkannt: Gap-Filling mit Interpolation oder Vortagswerten ausführen.'
    );
  }
  if (hasBandwidth) {
    recommendations.push('Ausreißer erkannt: Messkonfiguration und Anlagenkapazität prüfen.');
  }
  if (hasNegative) {
    recommendations.push(
      'Negative Energiewerte erkannt: Zählerzuordnung und Vorzeichenlogik prüfen.'
    );
  }
  if (hasMonotony) {
    recommendations.push('Monotonie verletzt: Zählerstand/Reset oder Mappingfehler untersuchen.');
  }
  if (hasSlp) {
    recommendations.push('SLP-Abweichung hoch: Lastprofilzuordnung oder Messdatenqualität prüfen.');
  }
  if (!recommendations.length) {
    recommendations.push('Keine kritischen Auffälligkeiten erkannt.');
  }

  return recommendations;
}

module.exports = {
  name: 'edm-validation',
  timeout: 60000,
  dependencies: ['edm', 'slp'],

  settings: {
    defaultRules: [
      'BANDWIDTH_CHECK',
      'GAP_DETECTION',
      'MONOTONY_CHECK',
      'DUPLICATE_CHECK',
      'NEGATIVE_VALUE_CHECK',
    ],
    maxGapFillHours: 4,
    slpPlausibilityThreshold: 0.3,
  },

  actions: {
    validate: {
      rest: 'POST /validate',
      params: {
        meloId: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        from: { type: 'string', min: 1 },
        to: { type: 'string', min: 1 },
        rules: { type: 'array', items: 'string', optional: true },
        capacityKw: { type: 'number', optional: true, convert: true },
        autoFix: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Validate timeseries data and optionally auto-fix gaps',
        tags: ['EDM (Energiedatenmanagement)'],
        description:
          'Runs validation rules against a timeseries range. Returns findings per rule with severity. If autoFix=true, generates replacement values for gaps and writes them to EDM.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId', 'from', 'to'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  obis: { type: 'string', default: '1-0:1.8.0' },
                  from: { type: 'string', example: '2026-04-01T00:00:00.000Z' },
                  to: { type: 'string', example: '2026-04-01T23:59:59.000Z' },
                  rules: { type: 'array', items: { type: 'string' }, example: ['GAP_DETECTION'] },
                  capacityKw: { type: 'number', example: 10 },
                  autoFix: { type: 'boolean', default: false },
                },
              },
              examples: {
                default: {
                  value: {
                    meloId: 'DE0012345678901234567890123456789',
                    obis: '1-0:2.8.0',
                    from: '2026-04-01T00:00:00.000Z',
                    to: '2026-04-01T23:59:59.000Z',
                    rules: ['BANDWIDTH_CHECK', 'GAP_DETECTION'],
                    capacityKw: 10,
                    autoFix: false,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { meloId, obis, from, to, autoFix } = ctx.params;
        const selectedRuleIds = ctx.params.rules?.length
          ? ctx.params.rules
          : this.settings.defaultRules;

        const rules = selectedRuleIds.map((id) => this.ruleIndex.get(id)).filter(Boolean);

        if (!rules.length) {
          throw new MoleculerClientError('No valid rules selected', 400, 'NO_VALID_RULES');
        }

        const [seriesResponse, meloResponse] = await Promise.all([
          ctx.call('edm.getTimeseries', {
            meloId,
            obis,
            from,
            to,
            resolution: '15min',
            format: 'json',
          }),
          ctx.call('edm.getMelo', { meloId }),
        ]);

        const rows = mapTimeseriesRows(seriesResponse);
        const melo = meloResponse?.data || null;
        const capacityKw = parseCapacityKw(ctx.params.capacityKw, melo);
        const direction = getObisDirection(obis);
        const unit = getObisUnit(obis);

        const findings = [];
        const gapRule = this.ruleIndex.get('GAP_DETECTION');
        let detectedGaps = [];

        for (const rule of rules) {
          if (rule.id === 'BANDWIDTH_CHECK') {
            for (const row of rows) {
              const ok = rule.check(row.value, { capacityKw, obis, direction, unit });
              if (!ok) {
                addFinding(findings, {
                  ruleId: rule.id,
                  severity: rule.severity,
                  timestamp: row.ts,
                  value: row.value,
                  message: `Wert ${row.value} liegt außerhalb plausibler Bandbreite`,
                });
              }
            }
            continue;
          }

          if (rule.id === 'NEGATIVE_VALUE_CHECK') {
            for (const row of rows) {
              const ok = rule.check(row.value, { obis, direction, unit });
              if (!ok) {
                addFinding(findings, {
                  ruleId: rule.id,
                  severity: rule.severity,
                  timestamp: row.ts,
                  value: row.value,
                  message: `Negativwert ${row.value} ist für ${obis} unzulässig`,
                });
              }
            }
            continue;
          }

          if (rule.id === 'MONOTONY_CHECK') {
            for (let i = 1; i < rows.length; i += 1) {
              const current = rows[i];
              const previous = rows[i - 1];
              const ok = rule.check(current.value, {
                obis,
                previousValue: previous.value,
              });
              if (!ok) {
                addFinding(findings, {
                  ruleId: rule.id,
                  severity: rule.severity,
                  timestamp: current.ts,
                  value: current.value,
                  message: `Monotonie verletzt: ${previous.value} -> ${current.value}`,
                });
              }
            }
            continue;
          }

          if (rule.id === 'DUPLICATE_CHECK') {
            const seen = new Map();
            for (const row of rows) {
              const key = `${meloId}|${obis}|${row.ts}`;
              const isDuplicate = seen.has(key);
              const ok = rule.check(row.value, { isDuplicate });
              if (!ok) {
                addFinding(findings, {
                  ruleId: rule.id,
                  severity: rule.severity,
                  timestamp: row.ts,
                  value: row.value,
                  message: 'Duplikat erkannt; keep_latest empfohlen',
                });
              }
              seen.set(key, row);
            }
            continue;
          }

          if (rule.id === 'GAP_DETECTION') {
            const timestamps = rows.map((row) => row.ts);
            detectedGaps = findGaps(timestamps, 900);
            for (const gapTs of detectedGaps) {
              addFinding(findings, {
                ruleId: rule.id,
                severity: rule.severity,
                timestamp: gapTs,
                message: `Fehlender Viertelstundenwert bei ${gapTs}`,
              });
            }
            continue;
          }

          if (rule.id === 'SLP_PLAUSIBILITY') {
            const numericRows = rows.filter((row) => Number.isFinite(Number(row.value)));
            if (!numericRows.length) continue;

            const date = numericRows[0].ts.slice(0, 10);
            const annualConsumptionKwh = Number(melo?.metadata?.annualConsumptionKwh) || 3500;
            const profileId = melo?.metadata?.slpProfileId || 'H0';

            let slpValues = null;
            try {
              const slp = await ctx.call('slp.generateTimeseries', {
                profileId,
                date,
                annualConsumptionKwh,
              });
              slpValues = slp?.values || null;
            } catch (_err) {
              this.logger?.warn(
                `[edm-validation.service] silent-catch-fallback (line 332): ${_err && _err.message}`
              );
              slpValues = null;
            }

            if (!Array.isArray(slpValues) || slpValues.length !== 96) continue;

            const actual = [];
            const expected = [];
            for (const row of numericRows) {
              const dateObj = new Date(row.ts);
              const slot = dateObj.getUTCHours() * 4 + Math.floor(dateObj.getUTCMinutes() / 15);
              const exp = Number(slpValues[slot]);
              const val = Number(row.value);
              if (!Number.isFinite(exp) || !Number.isFinite(val)) continue;
              actual.push(val);
              expected.push(exp);
            }

            if (!actual.length) continue;

            const rmse = calculateRMSE(actual, expected);
            const avg = actual.reduce((sum, val) => sum + val, 0) / actual.length;
            const threshold = Math.abs(avg) * this.settings.slpPlausibilityThreshold;
            const ok = rule.check(null, {
              actualValues: actual,
              expectedValues: expected,
              threshold: this.settings.slpPlausibilityThreshold,
            });

            if (!ok) {
              addFinding(findings, {
                ruleId: rule.id,
                severity: rule.severity,
                message: `SLP-RMSE ${rmse.toFixed(4)} überschreitet Schwellwert ${threshold.toFixed(4)}`,
                details: {
                  rmse: Number(rmse.toFixed(8)),
                  threshold: Number(threshold.toFixed(8)),
                  profileId,
                },
              });
            }
            continue;
          }
        }

        const replacements = [];
        let autoFixed = 0;

        if (autoFix && rules.some((rule) => rule.id === 'GAP_DETECTION')) {
          if (!detectedGaps.length && gapRule) {
            detectedGaps = findGaps(
              rows.map((row) => row.ts),
              900
            );
          }

          const maxAutoFill = this.settings.maxGapFillHours * 4;
          if (detectedGaps.length > 0 && detectedGaps.length <= maxAutoFill) {
            const fromDate = new Date(from);
            const toDate = new Date(to);
            const prevFrom = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
            const prevTo = new Date(toDate.getTime() - 24 * 60 * 60 * 1000).toISOString();

            let previousDayRows = [];
            try {
              const prevSeries = await ctx.call('edm.getTimeseries', {
                meloId,
                obis,
                from: prevFrom,
                to: prevTo,
                resolution: '15min',
                format: 'json',
              });
              previousDayRows = mapTimeseriesRows(prevSeries);
            } catch (_err) {
              this.logger?.warn(
                `[edm-validation.service] silent-catch-fallback (line 406): ${_err && _err.message}`
              );
              previousDayRows = [];
            }

            let slpValues = null;
            try {
              const profileId = melo?.metadata?.slpProfileId || 'H0';
              const date = new Date(from).toISOString().slice(0, 10);
              const annualConsumptionKwh = Number(melo?.metadata?.annualConsumptionKwh) || 3500;
              const slp = await ctx.call('slp.generateTimeseries', {
                profileId,
                date,
                annualConsumptionKwh,
              });
              slpValues = slp?.values || null;
            } catch (_err) {
              this.logger?.warn(
                `[edm-validation.service] silent-catch-fallback (line 421): ${_err && _err.message}`
              );
              slpValues = null;
            }

            replacements.push(
              ...generateReplacementValues(
                detectedGaps.map((ts) => ({ ts })),
                {
                  meloId,
                  obis,
                  availableData: rows,
                  previousDayData: previousDayRows,
                  slpProfile: slpValues,
                  preferredMethod: 'auto',
                  slpMethodId: `slp_${String(melo?.metadata?.slpProfileId || 'H0').toLowerCase()}`,
                }
              )
            );

            if (replacements.length) {
              const importResult = await ctx.call('edm.importTimeseries', {
                meloId,
                obis,
                format: 'json',
                data: replacements,
                overwriteExisting: false,
              });

              autoFixed = Number(importResult?.imported) || replacements.length;
            }
          }
        }

        return {
          success: true,
          meloId,
          obis,
          from,
          to,
          summary: computeSummary(rows, findings, autoFixed),
          findings,
          replacements,
        };
      },
    },

    getReport: {
      rest: 'GET /validate/:meloId/report',
      params: {
        meloId: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true },
        from: { type: 'string', min: 1 },
        to: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get validation report for a timeseries range',
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
            schema: { type: 'string', example: '2026-04-01T23:59:59.000Z' },
          },
        ],
      },
      async handler(ctx) {
        const validation = await ctx.call('edm-validation.validate', {
          meloId: ctx.params.meloId,
          obis: ctx.params.obis || '1-0:1.8.0',
          from: ctx.params.from,
          to: ctx.params.to,
          autoFix: false,
        });

        return {
          success: true,
          meloId: validation.meloId,
          obis: validation.obis,
          from: validation.from,
          to: validation.to,
          summary: validation.summary,
          findings: validation.findings,
          recommendations: collectRecommendations(validation.findings),
        };
      },
    },

    fillGaps: {
      rest: 'POST /validate/:meloId/fill-gaps',
      params: {
        meloId: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        from: { type: 'string', min: 1 },
        to: { type: 'string', min: 1 },
        method: {
          type: 'enum',
          values: ['interpolate', 'previous_day', 'slp', 'auto'],
          optional: true,
          default: 'auto',
        },
        slpProfileId: { type: 'string', optional: true, default: 'H0' },
        annualConsumptionKwh: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        summary: 'Fill gaps in timeseries with replacement values',
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
                  obis: { type: 'string', default: '1-0:1.8.0' },
                  from: { type: 'string', example: '2026-04-01T00:00:00.000Z' },
                  to: { type: 'string', example: '2026-04-01T23:59:59.000Z' },
                  method: {
                    type: 'string',
                    enum: ['interpolate', 'previous_day', 'slp', 'auto'],
                    default: 'auto',
                  },
                  slpProfileId: { type: 'string', default: 'H0' },
                  annualConsumptionKwh: { type: 'number', example: 3500 },
                },
              },
              examples: {
                default: {
                  value: {
                    meloId: 'DE0012345678901234567890123456789',
                    obis: '1-0:2.8.0',
                    from: '2026-04-01T00:00:00.000Z',
                    to: '2026-04-01T23:59:59.000Z',
                    method: 'auto',
                    slpProfileId: 'H0',
                    annualConsumptionKwh: 3500,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { meloId, obis, from, to, method, slpProfileId, annualConsumptionKwh } = ctx.params;

        const [seriesResponse, meloResponse] = await Promise.all([
          ctx.call('edm.getTimeseries', {
            meloId,
            obis,
            from,
            to,
            resolution: '15min',
            format: 'json',
          }),
          ctx.call('edm.getMelo', { meloId }),
        ]);

        const rows = mapTimeseriesRows(seriesResponse);
        const gaps = findGaps(
          rows.map((row) => row.ts),
          900
        );

        if (!gaps.length) {
          return {
            success: true,
            meloId,
            obis,
            method,
            filled: 0,
            replacements: [],
          };
        }

        const fromDate = new Date(from);
        const toDate = new Date(to);
        const prevFrom = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const prevTo = new Date(toDate.getTime() - 24 * 60 * 60 * 1000).toISOString();

        let previousDayRows = [];
        try {
          const prevSeries = await ctx.call('edm.getTimeseries', {
            meloId,
            obis,
            from: prevFrom,
            to: prevTo,
            resolution: '15min',
            format: 'json',
          });
          previousDayRows = mapTimeseriesRows(prevSeries);
        } catch (_err) {
          process.stderr.write(
            `[edm-validation.service] silent-catch-fallback (line 632): ${_err && _err.message}\n`
          );
          previousDayRows = [];
        }

        let slpValues = null;
        try {
          const slp = await ctx.call('slp.generateTimeseries', {
            profileId: slpProfileId,
            date: new Date(from).toISOString().slice(0, 10),
            annualConsumptionKwh:
              Number(annualConsumptionKwh) ||
              Number(meloResponse?.data?.metadata?.annualConsumptionKwh) ||
              3500,
          });
          slpValues = slp?.values || null;
        } catch (_err) {
          process.stderr.write(
            `[edm-validation.service] silent-catch-fallback (line 647): ${_err && _err.message}\n`
          );
          slpValues = null;
        }

        const preferredMethod = method === 'previous_day' ? 'previous_day' : method;
        const replacements = generateReplacementValues(
          gaps.map((ts) => ({ ts })),
          {
            meloId,
            obis,
            availableData: rows,
            previousDayData: previousDayRows,
            slpProfile: slpValues,
            preferredMethod,
            slpMethodId: `slp_${String(slpProfileId || 'H0').toLowerCase()}`,
          }
        );

        let filled = 0;
        if (replacements.length) {
          const importResult = await ctx.call('edm.importTimeseries', {
            meloId,
            obis,
            format: 'json',
            data: replacements,
            overwriteExisting: false,
          });
          filled = Number(importResult?.imported) || replacements.length;
        }

        return {
          success: true,
          meloId,
          obis,
          method,
          filled,
          replacements,
        };
      },
    },

    listRules: {
      rest: 'GET /validate/rules',
      openapi: {
        summary: 'List available EDM validation rules',
        tags: ['EDM (Energiedatenmanagement)'],
      },
      handler() {
        return {
          success: true,
          rules: VALIDATION_RULES.map((rule) => ({
            id: rule.id,
            name: rule.name,
            description: rule.description,
            severity: rule.severity,
            autoFix: rule.autoFix,
          })),
        };
      },
    },
  },

  created() {
    this.ruleIndex = ruleMap();
  },
};
