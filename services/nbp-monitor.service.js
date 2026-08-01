/**
 * NBP Monitor Service
 *
 * Netzbetreiberprüfungs-Monitor: aggregates MaStR installations in status 2955
 * (NetzbetreiberPrüfung ausstehend) into three strategic KPIs:
 *
 *  KPI 1 – Volume Indicator   : kWp by age class & unit type
 *  KPI 2 – Risk Indicator     : estimated billing uncertainty in €
 *  KPI 3 – Process Indicator  : VNB-seitig / In Bearbeitung / Altlast split
 *
 * All data is derived from the public MaStR via the existing assets service.
 * KPI calculations are performed in-memory — no additional broker calls.
 *
 * v0.9.7
 */

'use strict';

const { getTenantId, tenantNamespace } = require('../src/tenant-context');

const NBP_SCHEMA_VERSION = '1.0';
const PARAMETERS_NAMESPACE = 'nbp_monitor';
const PARAMETERS_KEY = 'parameters';

const DEFAULT_PARAMETERS = {
  PV: { volllaststunden: 950, einspeiseverguetung_ctKWh: 8.2 },
  Wind: { volllaststunden: 1800, einspeiseverguetung_ctKWh: 6.5 },
  Speicher: { volllaststunden: 500, einspeiseverguetung_ctKWh: 8.2 },
  Sonstige: { volllaststunden: 800, einspeiseverguetung_ctKWh: 8.0 },
};

/** KPI 2: age class midpoints in years for the risk formula */
const AGE_CLASS_MIDPOINTS = { A: 0.5, B: 2.0, C: 4.0, D: 6.5 };

/** KPI 1 alert thresholds (in kWp; 50 MW / 150 MW for total; 10 MW / 50 MW for C+D) */
const ALERT_THRESHOLDS = {
  totalKWp: { green: 50_000, yellow: 150_000 },
  classCDKWp: { green: 10_000, yellow: 50_000 },
};

// ── Field normalisation ────────────────────────────────────────────────────

/**
 * Maps a MaStR installation row to a canonical unit type string.
 * Accepts both Einheittyp (MaStR) and Anlagentyp (assets service).
 */
function normalizeUnitType(inst) {
  const raw = String(inst.Einheittyp || inst.Anlagentyp || '').toLowerCase();
  if (raw.includes('pv') || raw.includes('solar')) return 'PV';
  if (raw.includes('wind')) return 'Wind';
  if (raw.includes('speicher') || raw.includes('storage')) return 'Speicher';
  return 'Sonstige';
}

/**
 * Returns capacity in kWp.
 * Nettonennleistung from MaStR is in kW; 'Leistung MW' from the assets service is in MW.
 */
function getCapacityKWp(inst) {
  if (inst.Nettonennleistung != null) return Number(inst.Nettonennleistung);
  if (inst['Leistung MW'] != null) return Number(inst['Leistung MW']) * 1000;
  return 0;
}

const DATE_FIELD_CANDIDATES = [
  'DatumLetzteAktualisierung',
  'Datum letzte Aktualisierung',
  'Datum Letzte Aktualisierung',
  'datumLetzteAktualisierung',
  'datumletzteaktualisierung',
  'Datum Netzzugang',
  'DatumNetzzugang',
  'Registrierungsdatum',
  'Genehmigungsdatum',
  'Inbetriebnahmedatum',
  'commissioningDate',
];

function parseDateValue(raw) {
  if (raw == null) return null;

  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const millis = raw < 10_000_000_000 ? raw * 1000 : raw;
    const d = new Date(millis);
    return isNaN(d.getTime()) ? null : d;
  }

  const text = String(raw).trim();
  if (!text) return null;

  // ISO-like / RFC date-time
  const nativeParsed = new Date(text);
  if (!isNaN(nativeParsed.getTime())) return nativeParsed;

  // YYYY-MM-DD
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const d = new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }

  // DD.MM.YYYY [HH:mm[:ss]]
  const dmy = text.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const hour = dmy[4] || '00';
    const min = dmy[5] || '00';
    const sec = dmy[6] || '00';
    const d = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T${hour}:${min}:${sec}Z`);
    return isNaN(d.getTime()) ? null : d;
  }

  // YYYYMMDD
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const d = new Date(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function extractDateCandidate(inst) {
  for (const key of DATE_FIELD_CANDIDATES) {
    if (!Object.prototype.hasOwnProperty.call(inst, key)) continue;
    const value = inst[key];
    if (value == null || String(value).trim() === '') continue;
    return { key, value };
  }
  return null;
}

function getInstallationDate(inst) {
  const candidate = extractDateCandidate(inst);
  if (!candidate) return null;
  return parseDateValue(candidate.value);
}

/**
 * Derives age class (A–D) and age in days from DatumLetzteAktualisierung.
 * Falls back to class 'A' when the date is absent or unparseable.
 */
function getAgeClass(inst) {
  const d = getInstallationDate(inst);
  if (!d) return { ageClass: 'A', ageDays: 0 };
  const ageDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const ageYears = ageDays / 365;
  let ageClass;
  if (ageYears < 1) ageClass = 'A';
  else if (ageYears < 3) ageClass = 'B';
  else if (ageYears < 5) ageClass = 'C';
  else ageClass = 'D';
  return { ageClass, ageDays };
}

function resolveAlertLevel(value, { green, yellow }) {
  if (value > yellow) return 'red';
  if (value > green) return 'yellow';
  return 'green';
}

// ── KPI computations ───────────────────────────────────────────────────────

/**
 * KPI 1 – Volume Indicator
 * Aggregates kWp by age class and unit type.
 */
function computeKpi1(installations) {
  const byClass = {
    A: {
      label: 'Aktuell (< 1 J.)',
      kWp: 0,
      count: 0,
      byType: { PV: 0, Wind: 0, Speicher: 0, Sonstige: 0 },
    },
    B: {
      label: '1–3 Jahre',
      kWp: 0,
      count: 0,
      byType: { PV: 0, Wind: 0, Speicher: 0, Sonstige: 0 },
    },
    C: {
      label: '3–5 Jahre',
      kWp: 0,
      count: 0,
      byType: { PV: 0, Wind: 0, Speicher: 0, Sonstige: 0 },
    },
    D: {
      label: 'Altlast > 5 J.',
      kWp: 0,
      count: 0,
      byType: { PV: 0, Wind: 0, Speicher: 0, Sonstige: 0 },
    },
  };

  for (const inst of installations) {
    const type = normalizeUnitType(inst);
    const kWp = getCapacityKWp(inst);
    const { ageClass } = getAgeClass(inst);
    byClass[ageClass].kWp += kWp;
    byClass[ageClass].count += 1;
    byClass[ageClass].byType[type] += kWp;
  }

  const totalKWp = Object.values(byClass).reduce((s, c) => s + c.kWp, 0);
  const classCDKWp = byClass.C.kWp + byClass.D.kWp;

  const byAgeClass = ['A', 'B', 'C', 'D'].map((cls) => ({
    class: cls,
    label: byClass[cls].label,
    kWp: Math.round(byClass[cls].kWp),
    count: byClass[cls].count,
    byType: {
      PV: Math.round(byClass[cls].byType.PV),
      Wind: Math.round(byClass[cls].byType.Wind),
      Speicher: Math.round(byClass[cls].byType.Speicher),
      Sonstige: Math.round(byClass[cls].byType.Sonstige),
    },
  }));

  return {
    byAgeClass,
    totalKWp: Math.round(totalKWp),
    alertLevel: resolveAlertLevel(totalKWp, ALERT_THRESHOLDS.totalKWp),
    classCD_kWp: Math.round(classCDKWp),
    classCD_alertLevel: resolveAlertLevel(classCDKWp, ALERT_THRESHOLDS.classCDKWp),
  };
}

/**
 * KPI 2 – Risk Indicator
 * Formula: riskEur = kWp × volllaststunden × einspeiseverguetung_ctKWh × midpointYears / 1000
 * Serves as a management control metric (Steuerungsgröße), not a legal obligation.
 */
function computeKpi2(installations, parameters) {
  let totalRiskEur = 0;
  const byClass = { A: 0, B: 0, C: 0, D: 0 };

  for (const inst of installations) {
    const type = normalizeUnitType(inst);
    const kWp = getCapacityKWp(inst);
    const { ageClass } = getAgeClass(inst);
    const params = parameters[type] || parameters.Sonstige;
    const midpoint = AGE_CLASS_MIDPOINTS[ageClass];
    const riskEur =
      (kWp * params.volllaststunden * params.einspeiseverguetung_ctKWh * midpoint) / 1000;
    totalRiskEur += riskEur;
    byClass[ageClass] += riskEur;
  }

  return {
    totalRiskEur: Math.round(totalRiskEur),
    byAgeClass: ['A', 'B', 'C', 'D'].map((cls) => ({
      class: cls,
      riskEur: Math.round(byClass[cls]),
    })),
    parametersUsed: { ...parameters },
    disclaimer:
      'Näherungswert — keine Rechtsgrundlage, keine Bilanzierungspflicht. Dient als Steuerungsgröße.',
  };
}

/**
 * KPI 3 – Process Indicator
 * Heuristic classification based on DatumLetzteAktualisierung:
 *   > altlastWeeks   → Altlast (likely external blockage)
 *   > vnbSeitigWeeks → VNB-seitig (§118 EnWG deadline risk)
 *   otherwise        → In Bearbeitung
 */
function computeKpi3(installations, vnbSeitigWeeks, altlastWeeks) {
  const vnbSeitigMs = vnbSeitigWeeks * 7 * 86_400_000;
  const altlastMs = altlastWeeks * 7 * 86_400_000;
  const now = Date.now();

  let vnbSeitig = 0;
  let inBearbeitung = 0;
  let altlast = 0;

  for (const inst of installations) {
    const d = getInstallationDate(inst);
    if (!d) {
      inBearbeitung++;
      continue;
    }
    const ageMs = now - d.getTime();
    if (ageMs > altlastMs) altlast++;
    else if (ageMs > vnbSeitigMs) vnbSeitig++;
    else inBearbeitung++;
  }

  const total = vnbSeitig + inBearbeitung + altlast;
  return {
    totalOpen: total,
    vnbSeitig,
    inBearbeitung,
    altlast,
    vnbSeitigPercent: total > 0 ? Math.round((vnbSeitig / total) * 1000) / 10 : 0,
    inBearbeitungPercent: total > 0 ? Math.round((inBearbeitung / total) * 1000) / 10 : 0,
    altlastPercent: total > 0 ? Math.round((altlast / total) * 1000) / 10 : 0,
    disclaimer: 'Heuristik basierend auf MaStR-Zeitstempeln — nicht rechtssicher.',
  };
}

/** Aggregates count and kWp by normalised unit type */
function buildByType(installations) {
  const acc = {
    PV: { count: 0, kWp: 0 },
    Wind: { count: 0, kWp: 0 },
    Speicher: { count: 0, kWp: 0 },
    Sonstige: { count: 0, kWp: 0 },
  };
  for (const inst of installations) {
    const type = normalizeUnitType(inst);
    acc[type].count += 1;
    acc[type].kWp += getCapacityKWp(inst);
  }
  return Object.fromEntries(
    Object.entries(acc).map(([k, v]) => [k, { count: v.count, kWp: Math.round(v.kWp) }])
  );
}

/** Groups installations by Postleitzahl, sorted by kWp descending (top 100) */
function buildByPlz(installations) {
  const map = {};
  for (const inst of installations) {
    const plz = String(inst.Postleitzahl || inst.PLZ || '').trim();
    if (!plz) continue;
    if (!map[plz]) map[plz] = { plz, count: 0, kWp: 0 };
    map[plz].count += 1;
    map[plz].kWp += getCapacityKWp(inst);
  }
  return Object.values(map)
    .sort((a, b) => b.kWp - a.kWp)
    .slice(0, 100)
    .map((e) => ({ ...e, kWp: Math.round(e.kWp) }));
}

/** Derives top-level summary counters from the installation list and kpi1 */
function buildSummary(installations, kpi1) {
  if (!installations.length) {
    return { totalOpenCount: 0, totalOpenKWp: 0, oldestTicketDays: 0, newestTicketDays: 0 };
  }
  const ages = installations
    .map((inst) => {
      const d = getInstallationDate(inst);
      if (!d) return 0;
      return isNaN(d.getTime()) ? 0 : Math.floor((Date.now() - d.getTime()) / 86_400_000);
    })
    .filter((d) => d >= 0);
  return {
    totalOpenCount: installations.length,
    totalOpenKWp: kpi1.totalKWp,
    oldestTicketDays: ages.length ? Math.max(...ages) : 0,
    newestTicketDays: ages.length ? Math.min(...ages) : 0,
  };
}

// ── Service definition ─────────────────────────────────────────────────────

module.exports = {
  name: 'nbp-monitor',

  settings: {
    cacheTtlSeconds: parseInt(process.env.NBP_CACHE_TTL_SECONDS || '86400', 10),
    defaultParameters: DEFAULT_PARAMETERS,
    vnbSeitigThresholdWeeks: 6,
    altlastThresholdWeeks: 52,
  },

  created() {
    this.cache = new Map();
  },

  actions: {
    /**
     * GET /api/nbp-monitor/:bdewCode
     * (also reachable via alias GET /api/vnb-monitor/:bdewCode/nbp-monitor)
     * Returns the full NBP Monitor snapshot.
     */
    snapshot: {
      rest: 'GET /:bdewCode',
      params: {
        bdewCode: { type: 'string', required: true },
        refresh: { type: 'boolean', optional: true, default: false, convert: true },
        lang: { type: 'enum', values: ['de', 'en'], optional: true, default: 'de' },
      },
      openapi: {
        summary: 'Get Netzbetreiberprüfungs-Monitor snapshot for a VNB',
        tags: ['VNBMonitor', 'NBPMonitor'],
        description:
          'Aggregates MaStR installations in status 2955 (NetzbetreiberPrüfung) into three ' +
          'KPIs: Volume (kWp by age class), Risk (€ billing uncertainty), Process (VNB vs. external).',
        parameters: [
          {
            name: 'bdewCode',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '10002954' },
            description: 'BDEW registration number of the grid operator',
          },
          {
            name: 'refresh',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Force cache bypass and re-fetch from MaStR',
          },
          {
            name: 'lang',
            in: 'query',
            schema: { type: 'string', enum: ['de', 'en'], default: 'de' },
            description: 'Language for labels and disclaimers',
          },
        ],
        responses: {
          200: {
            description: 'NBP Monitor snapshot with KPI 1/2/3',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      async handler(ctx) {
        const { bdewCode, refresh } = ctx.params;
        const tenantId = getTenantId(ctx);
        const cacheKey = this.getCacheKey(bdewCode, tenantId);

        if (!refresh && this.cache.has(cacheKey)) {
          const cached = this.cache.get(cacheKey);
          if (Date.now() < cached.expiresAt) return cached.data;
        }

        const { parameters } = await this.loadParameters(ctx);
        const { vnbSeitigThresholdWeeks, altlastThresholdWeeks } = this.settings;

        let resolvedGridOperatorId = null;

        try {
          const vnbSnapshot = await ctx.call('vnb-monitor.snapshot', {
            bdewCode,
            refresh: false,
            alerts: false,
            lang: 'de',
          });
          resolvedGridOperatorId = vnbSnapshot?.identity?.mastrId || null;
        } catch (_) {
          this.logger?.warn(
            `[nbp-monitor.service] silent-catch-fallback (line 447): ${_ && _.message}`
          );
          resolvedGridOperatorId = null;
        }

        if (!resolvedGridOperatorId) {
          try {
            const lookup = await ctx.call('grid-operations.vnbLookup', {
              bdew: bdewCode,
              limit: 1,
            });
            resolvedGridOperatorId = lookup?.data?.mastrId || null;
          } catch (_) {
            this.logger?.warn(
              `[nbp-monitor.service] silent-catch-fallback (line 458): ${_ && _.message}`
            );
            resolvedGridOperatorId = null;
          }
        }

        let installations = [];
        try {
          const rows = await ctx.call('assets.all', {
            bdewCode,
            gridOperatorId: resolvedGridOperatorId || undefined,
            netzbetreiberPruefungStatus: '2955',
            limit: 1000,
          });
          installations = Array.isArray(rows) ? rows : [];

          this.logger.info(
            `NBP Monitor filter for ${bdewCode}: gridOperatorId=${resolvedGridOperatorId || 'n/a'}`
          );

          const dateSamples = installations.slice(0, 3).map((inst, index) => {
            const candidate = extractDateCandidate(inst);
            const parsed = candidate ? parseDateValue(candidate.value) : null;
            return {
              index: index + 1,
              seeNummer: inst['SEE Nummer'] || inst.mastrNummer || null,
              dateField: candidate?.key || null,
              rawDateValue: candidate?.value || null,
              parsedDate: parsed ? parsed.toISOString() : null,
            };
          });
          this.logger.info(
            `NBP Monitor date samples for ${bdewCode}: ${JSON.stringify(dateSamples)}`
          );
        } catch (err) {
          this.logger.warn(`NBP Monitor: assets.all failed for ${bdewCode}: ${err.message}`);
        }

        const kpi1 = computeKpi1(installations);
        const kpi2 = computeKpi2(installations, parameters);
        const kpi3 = computeKpi3(installations, vnbSeitigThresholdWeeks, altlastThresholdWeeks);

        const snapshot = {
          schemaVersion: NBP_SCHEMA_VERSION,
          bdewCode,
          timestamp: new Date().toISOString(),
          cachedAt: new Date().toISOString(),
          ttlSeconds: this.settings.cacheTtlSeconds,
          summary: buildSummary(installations, kpi1),
          kpi1_volume: kpi1,
          kpi2_risk: kpi2,
          kpi3_process: kpi3,
          byType: buildByType(installations),
          byPLZ: buildByPlz(installations),
          filters: {
            ageClasses: ['A', 'B', 'C', 'D'],
            types: ['PV', 'Wind', 'Speicher', 'Sonstige'],
            powerClasses: ['<10kWp', '10-100kWp', '>100kWp'],
            voltageLevels: ['NS', 'MS', 'HS'],
          },
        };

        const expiresAt = Date.now() + this.settings.cacheTtlSeconds * 1000;
        this.cache.set(cacheKey, { data: snapshot, expiresAt });
        return snapshot;
      },
    },

    /**
     * GET /api/nbp-monitor/parameters
     * Returns current KPI 2 parameters (defaults or persisted custom).
     */
    getParameters: {
      rest: 'GET /parameters',
      openapi: {
        summary: 'Get current NBP Monitor KPI 2 risk parameters',
        tags: ['NBPMonitor'],
        description:
          'Returns the active KPI 2 parameters (Volllaststunden and Einspeisevergütung per technology). ' +
          'Returns defaults when no custom parameters have been saved.',
        responses: {
          200: {
            description: 'Current KPI 2 parameters',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      async handler(ctx) {
        return this.loadParameters(ctx);
      },
    },

    /**
     * PUT /api/nbp-monitor/parameters
     * Saves custom KPI 2 parameters and invalidates the snapshot cache.
     */
    setParameters: {
      rest: 'PUT /parameters',
      params: {
        parameters: { type: 'object', required: true },
      },
      openapi: {
        summary: 'Save custom KPI 2 parameters for NBP Monitor (full replace)',
        tags: ['NBPMonitor'],
        description:
          'Persists custom Volllaststunden and Einspeisevergütung values for all four unit types. ' +
          'Clears all NBP Monitor cache entries so the next poll uses updated parameters.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['parameters'],
                properties: {
                  parameters: {
                    type: 'object',
                    example: DEFAULT_PARAMETERS,
                    description: 'KPI 2 parameters keyed by unit type (PV/Wind/Speicher/Sonstige)',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Parameters saved',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      async handler(ctx) {
        const validated = this.validateParameters(ctx.params.parameters);
        const tenantId = getTenantId(ctx);
        await ctx.call('object-store.put', {
          namespace: this.getParametersNamespace(ctx),
          key: PARAMETERS_KEY,
          payload: validated,
        });
        this.clearTenantCache(tenantId);
        return {
          success: true,
          message: 'Parameters saved and NBP Monitor cache invalidated.',
          parameters: validated,
        };
      },
    },

    /**
     * DELETE /api/nbp-monitor/parameters
     * Resets KPI 2 parameters to built-in defaults and invalidates the cache.
     */
    resetParameters: {
      rest: 'DELETE /parameters',
      openapi: {
        summary: 'Reset NBP Monitor KPI 2 parameters to defaults',
        tags: ['NBPMonitor'],
        description:
          'Removes the persisted parameters file and reverts to built-in defaults. ' +
          'Clears all NBP Monitor cache entries.',
        responses: {
          200: {
            description: 'Parameters reset to defaults',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          await ctx.call('object-store.delete', {
            namespace: this.getParametersNamespace(ctx),
            key: PARAMETERS_KEY,
          });
        } catch (_) {
          /* ignore — key may not exist */
        }
        this.clearTenantCache(tenantId);
        return {
          success: true,
          message: 'NBP Monitor parameters reset to defaults and cache invalidated.',
          parameters: DEFAULT_PARAMETERS,
        };
      },
    },
  },

  methods: {
    getParametersNamespace(ctx) {
      return tenantNamespace(PARAMETERS_NAMESPACE, getTenantId(ctx));
    },

    getCacheKey(bdewCode, tenantId) {
      return `nbp-monitor:${tenantId}:${bdewCode}`;
    },

    clearTenantCache(tenantId) {
      const prefix = `nbp-monitor:${tenantId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
    },

    async loadParameters(ctx) {
      try {
        const stored = await ctx.call('object-store.get', {
          namespace: this.getParametersNamespace(ctx),
          key: PARAMETERS_KEY,
        });
        return {
          source: 'store',
          parameters: stored.payload,
        };
      } catch (_) {
        this.logger?.warn(
          `[nbp-monitor.service] silent-catch-fallback (line 673): ${_ && _.message}`
        );
        return {
          source: 'defaults',
          parameters: { ...DEFAULT_PARAMETERS },
        };
      }
    },

    /**
     * Validates a parameters object against the required schema.
     * Returns a clean, normalised copy or throws on validation failure.
     */
    validateParameters(params) {
      if (!params || typeof params !== 'object') {
        throw new Error('parameters must be an object.');
      }
      const validated = {};
      for (const type of ['PV', 'Wind', 'Speicher', 'Sonstige']) {
        const entry = params[type];
        if (!entry || typeof entry !== 'object') {
          throw new Error(`Missing parameters for type: ${type}`);
        }
        const vl = Number(entry.volllaststunden);
        const ev = Number(entry.einspeiseverguetung_ctKWh);
        if (!Number.isFinite(vl) || vl <= 0) {
          throw new Error(`volllaststunden must be a positive number for type ${type}`);
        }
        if (!Number.isFinite(ev) || ev <= 0) {
          throw new Error(`einspeiseverguetung_ctKWh must be a positive number for type ${type}`);
        }
        validated[type] = { volllaststunden: vl, einspeiseverguetung_ctKWh: ev };
      }
      return validated;
    },
  },
};
