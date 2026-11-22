'use strict';

/**
 * Expanders of the pack "beschaffung" (Energiebeschaffung und Portfolio), micro-agent tier
 * Phase 1. Every expander wraps READ actions of existing services (checked in
 * operation-capability-index.json as data_read with no side effects and no writes, and in the
 * action's implementation):
 *
 * - entsoe.dayAheadPrices, entsoe.loadForecast, entsoe.windSolarForecast (ENTSO-E via MCP)
 * - energy-market.prices with market "futures" (MCP)
 * - gas-storage.countryStorage (GIE AGSI+ via MCP)
 * - residual-load.netResidualLoad (MCP, only with a grid operator MaStR number)
 * - forecast-sandbox.portfolioRunStatus (tenant-rooted run directory, file reads only)
 * - fnav-commercial-hedging.listContracts / listScenarios (tenant-scoped PouchDB find)
 *
 * Inputs come from format parsing only (dates, product codes of the forward market, register
 * numbers, run identifiers); meaning is never inferred from words. A source that fails or has
 * nothing yields a negative result with its scope, never an invented value.
 */

const { extractRows } = require('../../format-response');
const { tokens, registerUnitNumbers } = require('./detectors');

const SOURCE_TIMEOUT_MS = 5000;
const PACK_TIMEOUT_MS = 6000;
const MAX_PERIOD_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
// ENTSO-E bidding zone DE-LU; the service resolves the country name to the EIC code.
const PRICE_REGION = 'Germany';
const PRICE_REGION_LABEL = 'Gebotszone DE-LU';
const FUTURES_REGION = 'Deutschland';
const GAS_COUNTRY = 'DE';
const AREA_SERVICES =
  'energy-market, entsoe, forecast, forecast-engine, forecast-sandbox, residual-load, fnav-commercial-hedging, gas-storage';

// ── Format parsing ──────────────────────────────────────────────────────────────

const isDigit = (ch) => ch >= '0' && ch <= '9';
const allDigits = (value) => value.length > 0 && [...value].every(isDigit);
const isHex = (ch) => isDigit(ch) || (ch >= 'a' && ch <= 'f');
const pad = (n) => String(n).padStart(2, '0');

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const fullYear = (value) =>
  value.length === 4 ? Number(value) : value.length === 2 ? 2000 + Number(value) : NaN;

// One token (or a token and the next) as a delivery period: ISO date, German date, ISO month,
// quarter product (Q1-27, Q1/2027, Q1 2027) or calendar product (Cal-27, Cal 2027).
function periodOf(token, next = '') {
  if (token.length === 10 && token[4] === '-' && token[7] === '-') {
    const day = isoDate(+token.slice(0, 4), +token.slice(5, 7), +token.slice(8, 10));
    if (day && allDigits(token.replaceAll('-', ''))) return { start: day, end: day, quote: token };
  }
  const dotted = token.split('.');
  if (dotted.length === 3 && dotted[2].length === 4 && dotted.every(allDigits)) {
    const day = isoDate(+dotted[2], +dotted[1], +dotted[0]);
    if (day && dotted[0].length <= 2 && dotted[1].length <= 2)
      return { start: day, end: day, quote: token };
  }
  if (token.length === 7 && token[4] === '-' && allDigits(token.slice(0, 4) + token.slice(5))) {
    const year = +token.slice(0, 4);
    const month = +token.slice(5);
    if (month >= 1 && month <= 12)
      return {
        start: isoDate(year, month, 1),
        end: isoDate(year, month, lastDay(year, month)),
        quote: token,
      };
  }
  const upper = token.toUpperCase();
  if (upper.length >= 2 && upper[0] === 'Q' && '1234'.includes(upper[1])) {
    const rest = upper.slice(2);
    const joined = rest.length > 1 && '-/'.includes(rest[0]) ? rest.slice(1) : '';
    const yearText = rest ? joined : allDigits(next) ? next : '';
    const year = fullYear(yearText);
    if (Number.isFinite(year) && allDigits(yearText)) {
      const first = (Number(upper[1]) - 1) * 3 + 1;
      return {
        start: isoDate(year, first, 1),
        end: isoDate(year, first + 2, lastDay(year, first + 2)),
        quote: rest ? token : `${token} ${next}`,
      };
    }
  }
  if (upper.startsWith('CAL')) {
    const rest = upper.slice(3);
    const yearText = rest ? (rest[0] === '-' ? rest.slice(1) : rest) : allDigits(next) ? next : '';
    const year = fullYear(yearText);
    if (Number.isFinite(year) && allDigits(yearText))
      return {
        start: isoDate(year, 1, 1),
        end: isoDate(year, 12, 31),
        quote: rest ? token : `${token} ${next}`,
      };
  }
  return null;
}

function parsePeriod(text) {
  const parts = tokens(text);
  const found = [];
  for (let index = 0; index < parts.length; index++) {
    const hit = periodOf(parts[index], parts[index + 1]);
    if (hit && String(text).includes(hit.quote)) found.push(hit);
  }
  if (!found.length) return null;
  const start = found.map((row) => row.start).sort()[0];
  const end = found
    .map((row) => row.end)
    .sort()
    .at(-1);
  return { start, end, quotes: [...new Set(found.map((row) => row.quote))], parsed: true };
}

const berlinDay = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(date);
const addDays = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const spanDays = (period) =>
  Math.round(
    (Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / DAY_MS
  ) + 1;

function periodOrToday(text, now = new Date()) {
  const parsed = parsePeriod(text);
  if (parsed) return parsed;
  const today = berlinDay(now);
  return { start: today, end: today, quotes: [], parsed: false };
}

// The first MAX_PERIOD_DAYS of a period; the scope of a result says when it was capped.
function capped(period) {
  if (spanDays(period) <= MAX_PERIOD_DAYS) return { ...period, capped: false };
  return { ...period, end: addDays(period.start, MAX_PERIOD_DAYS - 1), capped: true };
}

const periodLabel = (period) =>
  period.start === period.end ? period.start : `${period.start} bis ${period.end}`;

// Grid operator numbers of the market master data register: SNB and twelve digits.
const gridOperatorNumbers = (text) =>
  tokens(text).filter(
    (token) => token.length === 15 && token.startsWith('SNB') && allDigits(token.slice(3))
  );

// Run and model identifiers of the forecast sandbox: 64 lower-case hex characters.
const runIdentifiers = (text) =>
  tokens(text).filter((token) => token.length === 64 && [...token].every(isHex));

const objectText = (object) => [object?.value, object?.provenance?.quote].filter(Boolean).join(' ');

// ── Source access ───────────────────────────────────────────────────────────────

function sourceTimeout(ctx) {
  const budget = Number(ctx?.params?.budget?.timeoutMs) || PACK_TIMEOUT_MS;
  return Math.max(200, Math.min(SOURCE_TIMEOUT_MS, budget - 1000));
}

function failureOf(result) {
  if (result?.success === false || result?.error) {
    const error = result.error;
    return String(
      (typeof error === 'string' ? error : error?.code || error?.message) || 'unsuccessful'
    );
  }
  return '';
}

// A read action with its own time limit; failures come back as a reason, never as an error.
async function read(ctx, action, params) {
  try {
    const result = await ctx.call(action, params, { timeout: sourceTimeout(ctx) });
    const failure = failureOf(result);
    return failure ? { action, ok: false, reason: failure } : { action, ok: true, result };
  } catch (error) {
    return { action, ok: false, reason: String(error?.code || error?.message || 'error') };
  }
}

const unavailable = (searched, scope) => ({ searched, scope, result: 'source_unavailable' });
const noHit = (searched, scope) => ({ searched, scope, result: 'no_hit' });
// The source answered, but its answer holds no value this pack can read.
const noValues = (searched, scope) => ({ searched, scope, result: 'no_values_in_answer' });

const finite = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const round = (value) => String(Math.round(Number(value) * 100) / 100);

function pick(row, keys) {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) if (finite(row[key])) return { key, value: Number(row[key]) };
  return null;
}

const statisticsOf = (result) =>
  [result?.statistics, result?.data?.statistics, result?.summary, result?.data?.summary].find(
    (value) => value && typeof value === 'object' && !Array.isArray(value)
  ) || null;

const rowsOf = (result, extra = []) => {
  for (const key of extra) {
    if (Array.isArray(result?.[key])) return result[key];
    if (Array.isArray(result?.data?.[key])) return result.data[key];
  }
  return extractRows(result);
};

/**
 * Average, minimum and maximum of a series as source facts: the statistics the source states,
 * or, when it states none, computed from its points with the number of points named. A
 * statistics object with unknown keys is reported key by key, verbatim.
 */
function seriesFacts(result, { label, unit, known, valueKeys, rowKeys = [], provenance, period }) {
  const stats = statisticsOf(result);
  const base = {
    unit,
    basis: 'source',
    validFrom: period.start,
    validTo: period.end,
    provenance,
  };
  const names = { avg: 'Durchschnitt', min: 'Minimum', max: 'Maximum' };
  const facts = [];
  for (const which of ['avg', 'min', 'max']) {
    const hit = pick(stats, known[which] || []);
    if (hit)
      facts.push({
        ...base,
        statement: `${label} ${periodLabel(period)}, ${names[which]}: ${round(hit.value)} ${unit}`,
        value: round(hit.value),
        role: unit.startsWith('EUR') ? 'monetary' : 'quantity',
      });
  }
  if (facts.length) return facts;
  if (stats) {
    const entries = Object.entries(stats).filter(([, value]) => finite(value));
    if (entries.length)
      return entries.slice(0, 4).map(([key, value]) => ({
        ...base,
        unit: '',
        statement: `${label} ${periodLabel(period)}, Kennzahl ${key} laut Quelle: ${round(value)}`,
        value: round(value),
        role: 'quantity',
      }));
  }
  const values = rowsOf(result, rowKeys)
    .map((row) => pick(row, valueKeys))
    .filter(Boolean)
    .map((hit) => hit.value);
  if (!values.length) return [];
  const sum = values.reduce((total, value) => total + value, 0);
  const derived = {
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
  return ['avg', 'min', 'max'].map((which) => ({
    ...base,
    statement: `${label} ${periodLabel(period)}, ${names[which]}: ${round(derived[which])} ${unit} (ermittelt aus ${values.length} Werten der Quelle)`,
    value: round(derived[which]),
    role: unit.startsWith('EUR') ? 'monetary' : 'quantity',
  }));
}

function sourceRef(result, parts) {
  const meta = result?.metadata || result?.data?.metadata || {};
  return [meta.source, meta.documentType, ...parts].filter(Boolean).join('; ');
}

// ── Market prices ───────────────────────────────────────────────────────────────

async function dayAheadPrices(ctx, period) {
  const scopePeriod = capped(period);
  const params = {
    region: PRICE_REGION,
    dateFrom: scopePeriod.start,
    dateTo: scopePeriod.end,
    includeStatistics: true,
  };
  const scope = `entsoe.dayAheadPrices, ${PRICE_REGION_LABEL}, ${periodLabel(scopePeriod)}${scopePeriod.capped ? ` (erste ${MAX_PERIOD_DAYS} Tage von ${periodLabel(period)})` : ''}`;
  const searched = 'Day-Ahead-Preise';
  const response = await read(ctx, 'entsoe.dayAheadPrices', params);
  if (!response.ok) return { facts: [], negatives: [unavailable(searched, scope)] };
  const result = response.result;
  const facts = seriesFacts(result, {
    label: `Day-Ahead-Preis ${PRICE_REGION_LABEL}`,
    unit: `${result?.currency || 'EUR'}/${result?.unit || 'MWh'}`,
    known: {
      avg: ['avgPrice', 'averagePrice', 'avgPriceEURperMWh', 'averagePriceEURperMWh', 'mean'],
      min: ['minPrice', 'minPriceEURperMWh', 'min'],
      max: ['maxPrice', 'maxPriceEURperMWh', 'max'],
    },
    valueKeys: ['price', 'priceEURMWh', 'priceEURperMWh', 'value'],
    rowKeys: ['prices'],
    period: scopePeriod,
    provenance: {
      source: 'entsoe.dayAheadPrices',
      ref: sourceRef(result, [
        result?.eicCode || result?.region || PRICE_REGION,
        result?.resolution,
        periodLabel(scopePeriod),
      ]),
    },
  });
  return { facts, negatives: facts.length ? [] : [noValues(searched, scope)] };
}

const FUTURES_LABEL_KEYS = ['product', 'contract', 'name', 'symbol', 'deliveryPeriod', 'period'];
const FUTURES_PRICE_KEYS = [
  'settlementPrice',
  'settlement',
  'price',
  'priceEURMWh',
  'priceEURperMWh',
  'lastPrice',
  'close',
];

async function futuresPrices(ctx, period) {
  const params = {
    market: 'futures',
    region: FUTURES_REGION,
    startDate: period.start,
    endDate: period.end,
  };
  const scope = `energy-market.prices (market futures), ${FUTURES_REGION}, Lieferzeitraum ${periodLabel(period)}`;
  const searched = 'Terminmarktpreise';
  const response = await read(ctx, 'energy-market.prices', params);
  if (!response.ok) return { facts: [], negatives: [unavailable(searched, scope)] };
  const result = response.result;
  const facts = rowsOf(result, ['prices', 'futures', 'products'])
    .map((row) => {
      const price = pick(row, FUTURES_PRICE_KEYS);
      const product = FUTURES_LABEL_KEYS.map((key) => row?.[key]).find(
        (value) => typeof value === 'string' && value.trim()
      );
      if (!price || !product) return null;
      return {
        statement: `Terminmarktpreis ${product}: ${round(price.value)} EUR/MWh`,
        value: round(price.value),
        unit: 'EUR/MWh',
        role: 'monetary',
        basis: 'source',
        validFrom: period.start,
        validTo: period.end,
        provenance: {
          source: 'energy-market.prices',
          ref: sourceRef(result, ['futures', FUTURES_REGION, product]),
        },
      };
    })
    .filter(Boolean)
    .slice(0, 6);
  return { facts, negatives: facts.length ? [] : [noValues(searched, scope)] };
}

// A period from tomorrow on is not yet in the day-ahead auction: the forward market prices it.
function priceFindings(ctx, period, now = new Date()) {
  const tomorrow = addDays(berlinDay(now), 1);
  return period.start > tomorrow ? futuresPrices(ctx, period) : dayAheadPrices(ctx, period);
}

function periodFact(period, object) {
  if (!period.parsed) return [];
  return [
    {
      statement: `Genannter Zeitraum: ${periodLabel(period)}`,
      value: `${period.start} – ${period.end}`,
      role: 'period',
      basis: 'parsed',
      validFrom: period.start,
      validTo: period.end,
      provenance: {
        source: object?.provenance?.origin || 'message',
        ref: object?.objectId || '',
        quote: period.quotes.join(', '),
      },
    },
  ];
}

// ── Gas storage ─────────────────────────────────────────────────────────────────

async function gasStorage(ctx) {
  const searched = 'Füllstand der Gasspeicher';
  const scope = `gas-storage.countryStorage, country ${GAS_COUNTRY}, aktueller Gastag`;
  const response = await read(ctx, 'gas-storage.countryStorage', { country: GAS_COUNTRY });
  if (!response.ok) return { facts: [], negatives: [unavailable(searched, scope)] };
  const result = response.result;
  const data = result?.data?.storage || result?.storage || result?.data || result || {};
  const gasDay = [data.gasDayStart, data.gasDay, data.date].find(
    (value) => typeof value === 'string' && value
  );
  const provenance = {
    source: 'gas-storage.countryStorage',
    ref: sourceRef(result, [`country ${GAS_COUNTRY}`, gasDay ? `Gastag ${gasDay}` : '']),
  };
  const dated = gasDay ? { validFrom: gasDay, validTo: gasDay } : {};
  const facts = [];
  const share = pick(data, [
    'fillPercentage',
    'gasInStoragePercentage',
    'full',
    'fillLevelPct',
    'percentFull',
  ]);
  if (share)
    facts.push({
      statement: `Füllstand der Gasspeicher in Deutschland${gasDay ? ` am ${gasDay}` : ''}: ${round(share.value)} %`,
      value: round(share.value),
      unit: '%',
      role: 'quantity',
      basis: 'source',
      ...dated,
      provenance,
    });
  const volume = pick(data, ['gasInStorage', 'fillLevel']);
  if (volume)
    facts.push({
      statement: `Gasmenge in den Speichern in Deutschland${gasDay ? ` am ${gasDay}` : ''}: ${round(volume.value)} TWh`,
      value: round(volume.value),
      unit: 'TWh',
      role: 'quantity',
      basis: 'source',
      ...dated,
      provenance,
    });
  return { facts, negatives: facts.length ? [] : [noValues(searched, scope)] };
}

// ── Forecasts ───────────────────────────────────────────────────────────────────

async function entsoeForecast(ctx, action, period, { label, searched, params = {}, known }) {
  const scopePeriod = capped(period);
  const scope = `${action}, ${PRICE_REGION_LABEL}, ${periodLabel(scopePeriod)}${scopePeriod.capped ? ` (erste ${MAX_PERIOD_DAYS} Tage von ${periodLabel(period)})` : ''}`;
  const response = await read(ctx, action, {
    region: PRICE_REGION,
    dateFrom: scopePeriod.start,
    dateTo: scopePeriod.end,
    includeStatistics: true,
    ...params,
  });
  if (!response.ok) return { facts: [], negatives: [unavailable(searched, scope)] };
  const facts = seriesFacts(response.result, {
    label,
    unit: 'MW',
    known,
    valueKeys: ['loadMW', 'load', 'forecastMW', 'quantity', 'value'],
    period: scopePeriod,
    provenance: {
      source: action,
      ref: sourceRef(response.result, [PRICE_REGION_LABEL, periodLabel(scopePeriod)]),
    },
  });
  return { facts, negatives: facts.length ? [] : [noValues(searched, scope)] };
}

async function residualLoad(ctx, operator, period) {
  const searched = `Residuallast im Netzgebiet ${operator}`;
  const scope = `residual-load.netResidualLoad, gridOperatorMastrId ${operator}, ab ${period.start}`;
  const response = await read(ctx, 'residual-load.netResidualLoad', {
    gridOperatorMastrId: operator,
    startDate: period.start,
    forecastDays: Math.min(14, spanDays(period)),
  });
  if (!response.ok) return { facts: [], negatives: [unavailable(searched, scope)] };
  const result = response.result;
  const provenance = {
    source: 'residual-load.netResidualLoad',
    ref: sourceRef(result, [result?.region, operator, `ab ${period.start}`]),
  };
  const facts = seriesFacts(result, {
    label: `Residuallast Netzgebiet ${operator}`,
    unit: 'MW',
    known: {
      avg: ['avgResidualLoadMW', 'averageResidualLoadMW', 'avgResidualMW'],
      min: ['minResidualLoadMW', 'minResidualMW'],
      max: ['maxResidualLoadMW', 'peakResidualLoadMW', 'maxResidualMW'],
    },
    valueKeys: ['residualLoadMW', 'residualMW'],
    rowKeys: ['forecast'],
    period,
    provenance,
  });
  if (facts.length && typeof result?.loadFallbackNote === 'string')
    facts.push({
      statement: 'Hinweis der Quelle zur Lastbasis der Residuallast',
      role: 'explanation',
      basis: 'source',
      provenance: { ...provenance, quote: result.loadFallbackNote },
    });
  return { facts, negatives: facts.length ? [] : [noValues(searched, scope)] };
}

async function forecastRun(ctx, runId) {
  const searched = `Prognoselauf ${runId}`;
  const scope = 'forecast-sandbox.portfolioRunStatus, Prognoseläufe des Mandanten';
  const response = await read(ctx, 'forecast-sandbox.portfolioRunStatus', { run_id: runId });
  if (!response.ok)
    return {
      facts: [],
      negatives: [
        response.reason === 'portfolio_invalid'
          ? noHit(searched, scope)
          : unavailable(searched, scope),
      ],
    };
  const result = response.result;
  const provenance = { source: 'forecast-sandbox.portfolioRunStatus', ref: `run_id ${runId}` };
  const facts = [
    {
      statement: `Status des Prognoselaufs ${runId}: ${result?.status}`,
      value: String(result?.status || ''),
      role: 'status',
      basis: 'source',
      provenance,
    },
  ];
  if (finite(result?.completed_blocks))
    facts.push({
      statement: `Abgeschlossene Rechenblöcke des Prognoselaufs: ${result.completed_blocks}`,
      value: String(result.completed_blocks),
      role: 'quantity',
      basis: 'source',
      provenance,
    });
  const manifest = result?.result?.result_manifest;
  if (Array.isArray(manifest))
    facts.push({
      statement: `Ergebnisreihen des Prognoselaufs: ${manifest.length}`,
      value: String(manifest.length),
      role: 'quantity',
      basis: 'source',
      provenance,
    });
  return { facts, negatives: [] };
}

// ── fNAV commercial positions ───────────────────────────────────────────────────

const FNAV_SCOPE = 'fnav-commercial-hedging, gespeicherte Einträge des Mandanten (bis 100)';

async function fnavPositions(ctx, unitNumbers) {
  const [contracts, scenarios] = await Promise.all([
    read(ctx, 'fnav-commercial-hedging.listContracts', { limit: 100 }),
    read(ctx, 'fnav-commercial-hedging.listScenarios', { limit: 100 }),
  ]);
  const facts = [];
  const negatives = [];
  const searched = unitNumbers.length
    ? `fNAV-Verträge (flexible Netzanschlussvereinbarungen) für ${unitNumbers.join(', ')}`
    : 'fNAV-Verträge (flexible Netzanschlussvereinbarungen)';
  if (!contracts.ok) negatives.push(unavailable(searched, FNAV_SCOPE));
  else {
    const all = Array.isArray(contracts.result?.contracts) ? contracts.result.contracts : [];
    const rows = unitNumbers.length
      ? all.filter((doc) => unitNumbers.includes(doc?.mastrNummer))
      : all;
    if (!rows.length) negatives.push(noHit(searched, FNAV_SCOPE));
    if (unitNumbers.length)
      for (const doc of rows.slice(0, 6))
        facts.push({
          statement: `fNAV-Vertrag für ${doc.mastrNummer}: Status ${doc.status}, installierte Leistung ${doc.installedCapacityKw} kW, garantierte Mindestleistung ${doc.minimumGuaranteedPowerKw} kW, Entschädigungssatz ${doc.compensationRateEurPerMwh} EUR/MWh`,
          value: String(doc.installedCapacityKw ?? ''),
          unit: 'kW',
          role: 'quantity',
          basis: 'source',
          validFrom: doc.contractStartDate || '',
          validTo: doc.contractEndDate || '',
          provenance: { source: 'fnav-commercial-hedging.listContracts', ref: doc._id },
        });
    else if (rows.length) {
      const active = rows.filter((doc) => doc?.status === 'ACTIVE');
      const capacity = active.reduce(
        (total, doc) => total + (finite(doc.installedCapacityKw) ? +doc.installedCapacityKw : 0),
        0
      );
      facts.push({
        statement: `Gespeicherte fNAV-Verträge des Mandanten: ${rows.length}, davon aktiv ${active.length} mit zusammen ${round(capacity)} kW installierter Leistung`,
        value: String(active.length),
        role: 'quantity',
        basis: 'source',
        provenance: { source: 'fnav-commercial-hedging.listContracts', ref: FNAV_SCOPE },
      });
    }
  }
  if (!scenarios.ok)
    negatives.push(unavailable('fNAV-Engpass-Szenarien (Entschädigungsrisiko)', FNAV_SCOPE));
  else {
    const list = Array.isArray(scenarios.result?.scenarios) ? scenarios.result.scenarios : [];
    const rows = (
      unitNumbers.length ? list.filter((doc) => unitNumbers.includes(doc?.mastrNummer)) : list
    )
      .filter((doc) => finite(doc?.commercialRisk?.compensationLiabilityEur))
      .sort(
        (a, b) =>
          b.commercialRisk.compensationLiabilityEur - a.commercialRisk.compensationLiabilityEur
      );
    for (const doc of rows.slice(0, 3))
      facts.push({
        statement: `fNAV-Szenario "${doc.scenarioName}" (${doc.mastrNummer}): erwartete Entschädigungsverpflichtung ${doc.commercialRisk.compensationLiabilityEur} EUR pro Jahr, Risikostufe ${doc.commercialRisk.riskLevel}, angenommener Marktpreis ${doc.scenarioParams?.electricityMarketPriceEurPerMwh} EUR/MWh`,
        value: String(doc.commercialRisk.compensationLiabilityEur),
        unit: 'EUR',
        role: 'monetary',
        basis: 'source',
        provenance: { source: 'fnav-commercial-hedging.listScenarios', ref: doc._id },
      });
  }
  return { facts, negatives };
}

// ── Expanders ───────────────────────────────────────────────────────────────────

const merge = (...parts) => ({
  facts: parts.flatMap((part) => part.facts || []),
  negatives: parts.flatMap((part) => part.negatives || []),
});

const POSITION_GAP = {
  searched: 'Beschaffungs- und Absatzpositionen (Mengen, Hedges, offene Position)',
  scope: `Lese-Aktionen der Dienste ${AREA_SERVICES}: keine führt Beschaffungspositionen`,
  result: 'no_read_service',
};

const expanders = {
  async 'market.price'(ctx, object) {
    const period = periodOrToday(objectText(object));
    const prices = await priceFindings(ctx, period);
    const found = merge({ facts: periodFact(period, object) }, prices);
    return {
      ...found,
      openQuestions: period.parsed
        ? []
        : [
            {
              question: 'Für welchen Liefertag oder welches Terminprodukt ist der Preis gemeint?',
              resolves: `Preisabfrage; ohne Angabe wurde der Day-Ahead-Preis vom ${period.start} gelesen`,
            },
          ],
      confidence: prices.facts.length ? 0.8 : 0.3,
    };
  },

  async 'portfolio.position'(ctx, object) {
    const text = objectText(object);
    const period = parsePeriod(text);
    const units = registerUnitNumbers(text).map((hit) => hit.value);
    const fnav = await fnavPositions(ctx, units);
    const found = merge({ facts: period ? periodFact(period, object) : [] }, fnav, {
      negatives: [POSITION_GAP],
    });
    return {
      ...found,
      openQuestions: [
        {
          question:
            'Welche Menge, welcher Lieferzeitraum und welcher bereits beschaffte Anteil gehören zu der Position?',
          resolves: 'Bewertung der offenen Position gegen den Marktpreis des Lieferzeitraums',
        },
      ],
      confidence: fnav.facts.length ? 0.6 : 0.3,
    };
  },

  async 'forecast.series'(ctx, object) {
    const text = objectText(object);
    const period = periodOrToday(text);
    const jobs = [
      entsoeForecast(ctx, 'entsoe.loadForecast', period, {
        label: `Lastprognose ${PRICE_REGION_LABEL}`,
        searched: 'Day-Ahead-Lastprognose',
        params: { resolution: 'hourly' },
        known: {
          avg: ['avgLoadMW', 'averageLoadMW', 'avgForecastMW', 'average', 'avg', 'mean'],
          min: ['minLoadMW', 'minForecastMW', 'min'],
          max: ['maxLoadMW', 'peakLoadMW', 'maxForecastMW', 'max'],
        },
      }),
      entsoeForecast(ctx, 'entsoe.windSolarForecast', period, {
        label: `Wind- und Solarprognose ${PRICE_REGION_LABEL}`,
        searched: 'Day-Ahead-Prognose Wind und Solar',
        params: { forecastType: 'both' },
        known: {
          avg: ['avgForecastMW', 'averageMW', 'avgMW'],
          min: ['minForecastMW', 'minMW'],
          max: ['maxForecastMW', 'maxMW', 'peakMW'],
        },
      }),
      ...gridOperatorNumbers(text)
        .slice(0, 1)
        .map((operator) => residualLoad(ctx, operator, period)),
      ...runIdentifiers(text)
        .slice(0, 2)
        .map((runId) => forecastRun(ctx, runId)),
    ];
    const found = merge({ facts: periodFact(period, object) }, ...(await Promise.all(jobs)));
    return {
      ...found,
      openQuestions: period.parsed
        ? []
        : [
            {
              question: 'Für welchen Zeitraum ist die Prognose gemeint?',
              resolves: `Prognoseabfrage; ohne Angabe wurde der ${period.start} gelesen`,
            },
          ],
      confidence: found.facts.length ? 0.7 : 0.3,
    };
  },

  // The question itself: the market situation of the period it names (today otherwise). During
  // the consequence check the period comes from the other area's finding first.
  async concern(ctx, object, context = {}) {
    const consequence = String(context.consequenceOf || '');
    const period = (consequence && parsePeriod(consequence)) || periodOrToday(objectText(object));
    const [prices, gas] = await Promise.all([priceFindings(ctx, period), gasStorage(ctx)]);
    const found = merge(prices, gas);
    return {
      ...found,
      openQuestions: consequence
        ? [
            {
              question: `Welche Beschaffungsposition (Menge, Lieferzeitraum) ist von diesem Befund betroffen: ${consequence}`,
              resolves: 'Bewertung der Folge für die offene Position zum Marktpreis',
            },
          ]
        : [],
      negatives: consequence ? [...found.negatives, POSITION_GAP] : found.negatives,
      confidence: found.facts.length ? 0.6 : 0.2,
    };
  },
};

/**
 * Fixed dependency of the area: a position is valued at the market price of its delivery
 * period, so a position with a parsed delivery period is followed by that period's price.
 */
const playbooks = [
  {
    from: 'portfolio.position',
    next: (finding) =>
      (finding?.facts || [])
        .filter((fact) => fact.role === 'period' && fact.basis === 'parsed' && fact.value)
        .slice(0, 1)
        .map((fact) => ({
          kind: 'market.price',
          value: fact.value,
          label: 'Marktpreis des Lieferzeitraums',
        })),
  },
];

module.exports = {
  expanders,
  playbooks,
  timeoutMs: PACK_TIMEOUT_MS,
  _internal: { parsePeriod, periodOrToday, capped, seriesFacts },
};
