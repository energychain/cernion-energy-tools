'use strict';

/**
 * Expanders of the pack "Abrechnung und Netzentgelte" (micro-agent tier, Phase 1).
 *
 * Read-only: every service action called here is listed in READ_ACTIONS. Each one is
 * `operationKind: data_read` with `sideEffects: []` and `writesTo: []` in
 * operation-capability-index.json, and its handler only reads (object store get/query, PouchDB
 * get/find/allDocs, or the in-memory rule registry). Write, draft, process and calculation actions
 * of the same services (calculate*, prepareA96, reconcileA96, registerRuleSet, commitDatapoints,
 * validateDatapoints, requestInput, scenario, assessReadiness, simulatePortfolio, drilldownAsset)
 * are never called.
 *
 * The model is used only to pick candidates from the rule registries passed to it; a pick counts
 * only when its quote occurs verbatim in one field of that candidate.
 */

const { getTenantId } = require('../../tenant-context');
const {
  tokens,
  settlementKeys,
  feeRecordIds,
  registerUnitNumbers,
  sectionReferences,
  rulingNumbers,
} = require('./detectors');

const PHASE = 'micro_agent_abrechnung';
const CALL_TIMEOUT_MS = 1500;
const PICK_TIMEOUT_MS = 1800;
const MAX_IDS = 3;
const MAX_LISTED = 5;
const MAX_PICKS = 4;
const MAX_CANDIDATES = 40;
const MAX_FACTS = 24;

const READ_ACTIONS = Object.freeze({
  eegReport: 'settlement.getEegReport',
  redispatchReport: 'settlement.getRedispatchReport',
  listSettlements: 'settlement.listSettlements',
  gridFeeEvidence: 're4de-variable-grid-fee.getEvidence',
  ruleSet: 'regulatorische-entgeltlogik.get',
  ruleSets: 'regulatorische-entgeltlogik.list',
  eegRuleSets: 'rcs-rule-catalog.listRuleSets',
  revenueCapModel: 'eog-calculator.getModel',
});

const GRID_FEE_PREFIX = 're4de-vgf:';
const NETWORK_USAGE_FEE = 'NETWORK_USAGE_FEE';
const REVENUE_CAP_KEYS = {
  approved_revenue_cap: 'Beschiedene Erlösobergrenze',
  adjusted_revenue_cap: 'Angepasste Erlösobergrenze',
};
const NO_INVOICE_STORE =
  'Netznutzungs-, Liefer- und Messrechnungen (etwa INVOIC) sind nicht lesend angebunden; liegt die Rechnung als Dokument vor?';

// ── helpers ──────────────────────────────────────────────────────────────────

const isNumber = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const str = (value) => (value == null ? '' : String(value));

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('pick_timeout')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

// One bounded read. A missing record and an unreachable service are results, never errors.
async function read(ctx, action, params) {
  try {
    return { data: await ctx.call(action, params, { timeout: CALL_TIMEOUT_MS }) };
  } catch (error) {
    return { error: Number(error?.code) === 404 ? 'not_found' : 'unavailable' };
  }
}

function fact(statement, { value, unit, role = 'other', source, ref, quote, validFrom, validTo }) {
  return {
    statement,
    value: str(value),
    unit: str(unit),
    role,
    basis: 'source',
    validFrom: str(validFrom),
    validTo: str(validTo),
    provenance: { source, ref: str(ref), quote: str(quote) },
  };
}

function objectText(object) {
  return [object?.value, object?.provenance?.quote].filter(Boolean).join(' ');
}

// Period filter of the settlement listing from formats in the text: <yyyy>q<n>, an ISO date,
// a German date (dd.mm.yyyy) or a four-digit year.
function settlementPeriod(text) {
  const parts = tokens(text);
  const quarterOf = (year, month) => `${year}q${Math.floor((Number(month) - 1) / 3) + 1}`;
  for (const token of parts) {
    const lower = token.toLowerCase();
    if (/^\d{4}q[1-4]$/u.test(lower)) return lower;
  }
  for (const token of parts) {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(token)) return quarterOf(token.slice(0, 4), token.slice(5, 7));
    if (/^\d{2}\.\d{2}\.\d{4}$/u.test(token))
      return quarterOf(token.slice(6, 10), token.slice(3, 5));
  }
  for (const token of parts) if (/^20\d{2}$/u.test(token)) return token;
  return '';
}

function periodText(period) {
  if (!period?.from && !period?.to) return '';
  return `${period.from || 'offen'} bis ${period.to || 'offen'}`;
}

// ── settlement reports (billing.invoice) ─────────────────────────────────────

function eegReportFacts(id, report) {
  const source = READ_ACTIONS.eegReport;
  const base = { source, ref: id };
  const rows = [
    fact(`Gespeicherte EEG-Abrechnung ${id} gefunden.`, { ...base, value: id, role: 'identifier' }),
  ];
  if (periodText(report.period))
    rows.push(
      fact(`Zeitraum der EEG-Abrechnung ${id}: ${periodText(report.period)}.`, {
        ...base,
        value: periodText(report.period),
        role: 'period',
        validFrom: report.period.from,
        validTo: report.period.to,
      })
    );
  if (isNumber(report.feedinKwh))
    rows.push(
      fact(`Abgerechnete Einspeisung der EEG-Abrechnung ${id}: ${report.feedinKwh} kWh.`, {
        ...base,
        value: report.feedinKwh,
        unit: 'kWh',
        role: 'quantity',
      })
    );
  const tariff = report.tariffCentPerKwh ?? report.tariff;
  if (isNumber(tariff))
    rows.push(
      fact(`In der EEG-Abrechnung ${id} angewandter Vergütungssatz: ${tariff} ct/kWh.`, {
        ...base,
        value: tariff,
        unit: 'ct/kWh',
        role: 'monetary',
      })
    );
  if (isNumber(report.revenue_eur))
    rows.push(
      fact(`Vergütung laut EEG-Abrechnung ${id}: ${report.revenue_eur} EUR.`, {
        ...base,
        value: report.revenue_eur,
        unit: 'EUR',
        role: 'monetary',
      })
    );
  if (report.mastrNummer)
    rows.push(
      fact(`Die EEG-Abrechnung ${id} gehört zur Einheit ${report.mastrNummer}.`, {
        ...base,
        value: report.mastrNummer,
        role: 'identifier',
      })
    );
  if (report.meloId)
    rows.push(
      fact(`Messlokation der EEG-Abrechnung ${id}: ${report.meloId}.`, {
        ...base,
        value: report.meloId,
        role: 'identifier',
      })
    );
  if (report.createdAt)
    rows.push(
      fact(`Die EEG-Abrechnung ${id} wurde am ${report.createdAt} berechnet.`, {
        ...base,
        value: report.createdAt,
        role: 'date',
      })
    );
  return rows;
}

function redispatchReportFacts(id, report) {
  const source = READ_ACTIONS.redispatchReport;
  const base = { source, ref: id };
  const summary = report.summary || {};
  const rows = [
    fact(`Gespeicherte Redispatch-Abrechnung ${id} gefunden.`, {
      ...base,
      value: id,
      role: 'identifier',
    }),
  ];
  if (periodText(report.period))
    rows.push(
      fact(`Zeitraum der Redispatch-Abrechnung ${id}: ${periodText(report.period)}.`, {
        ...base,
        value: periodText(report.period),
        role: 'period',
        validFrom: report.period.from,
        validTo: report.period.to,
      })
    );
  if (isNumber(summary.totalEvents))
    rows.push(
      fact(`Die Redispatch-Abrechnung ${id} umfasst ${summary.totalEvents} Maßnahmen.`, {
        ...base,
        value: summary.totalEvents,
        role: 'quantity',
      })
    );
  if (isNumber(summary.totalLostKwh))
    rows.push(
      fact(`Ausfallarbeit laut Redispatch-Abrechnung ${id}: ${summary.totalLostKwh} kWh.`, {
        ...base,
        value: summary.totalLostKwh,
        unit: 'kWh',
        role: 'quantity',
      })
    );
  if (isNumber(summary.totalCompensation_eur))
    rows.push(
      fact(
        `Entschädigung laut Redispatch-Abrechnung ${id}: ${summary.totalCompensation_eur} EUR.`,
        { ...base, value: summary.totalCompensation_eur, unit: 'EUR', role: 'monetary' }
      )
    );
  if (isNumber(summary.avgMarketPrice_eur_mwh))
    rows.push(
      fact(
        `Mittlerer Marktpreis der Redispatch-Abrechnung ${id}: ${summary.avgMarketPrice_eur_mwh} EUR/MWh.`,
        { ...base, value: summary.avgMarketPrice_eur_mwh, unit: 'EUR/MWh', role: 'monetary' }
      )
    );
  const units = [
    ...new Set(
      (Array.isArray(report.events) ? report.events : [])
        .map((event) => event?.installationMastrNummer)
        .filter(Boolean)
    ),
  ].slice(0, MAX_IDS);
  for (const unit of units)
    rows.push(
      fact(`Die Redispatch-Abrechnung ${id} enthält Maßnahmen der Einheit ${unit}.`, {
        ...base,
        value: unit,
        role: 'identifier',
      })
    );
  return rows;
}

async function settlementReport(ctx, id) {
  const eeg = id.startsWith('eeg_');
  const action = eeg ? READ_ACTIONS.eegReport : READ_ACTIONS.redispatchReport;
  const result = await read(ctx, action, { settlementId: id });
  if (result.error || !result.data)
    return {
      facts: [],
      negatives: [
        {
          searched: id,
          scope: `Gespeicherte ${eeg ? 'EEG' : 'Redispatch'}-Abrechnungen des Mandanten (${action})`,
          result: result.error || 'not_found',
        },
      ],
    };
  return {
    facts: eeg ? eegReportFacts(id, result.data) : redispatchReportFacts(id, result.data),
    negatives: [],
  };
}

async function listedSettlements(ctx, period) {
  const result = await read(ctx, READ_ACTIONS.listSettlements, { type: 'all', period });
  const scope = `Gespeicherte EEG- und Redispatch-Abrechnungen des Mandanten, Zeitraum ${period} (${READ_ACTIONS.listSettlements})`;
  const rows = Array.isArray(result.data?.data) ? result.data.data : [];
  if (result.error || !rows.length)
    return {
      facts: [],
      negatives: [
        {
          searched: `Abrechnungen zum Zeitraum ${period}`,
          scope,
          result: result.error || 'no_hit',
        },
      ],
    };
  const facts = [];
  if (rows.length > MAX_LISTED)
    facts.push(
      fact(`Zum Zeitraum ${period} sind ${rows.length} Abrechnungen gespeichert.`, {
        value: rows.length,
        role: 'quantity',
        source: READ_ACTIONS.listSettlements,
        ref: period,
      })
    );
  for (const row of rows.slice(0, MAX_LISTED)) {
    const total = row.summary?.totalCompensation_eur;
    facts.push(
      fact(
        `Gespeicherte Abrechnung ${row.key} (Typ ${row.type || 'unbekannt'}${periodText(row.period) ? `, Zeitraum ${periodText(row.period)}` : ''})${isNumber(total) ? `, Summe ${total} EUR` : ''}.`,
        {
          value: row.key,
          role: 'identifier',
          source: READ_ACTIONS.listSettlements,
          ref: row.key,
          validFrom: row.period?.from,
          validTo: row.period?.to,
        }
      )
    );
  }
  return { facts, negatives: [] };
}

async function expandInvoice(ctx, object) {
  const text = objectText(object);
  const ids = settlementKeys(text)
    .map((hit) => hit.value)
    .slice(0, MAX_IDS);
  const openQuestions = [];
  let parts;
  if (ids.length) {
    parts = await Promise.all(ids.map((id) => settlementReport(ctx, id)));
  } else {
    const period = settlementPeriod(text);
    if (period) parts = [await listedSettlements(ctx, period)];
    else {
      parts = [];
      openQuestions.push({
        question: 'Welche Abrechnung ist gemeint (Abrechnungskennung oder Zeitraum)?',
        resolves: 'Abruf der gespeicherten Abrechnung',
      });
    }
  }
  const facts = parts.flatMap((part) => part.facts).slice(0, MAX_FACTS);
  const negatives = parts.flatMap((part) => part.negatives);
  if (!facts.length)
    openQuestions.push({ question: NO_INVOICE_STORE, resolves: 'Prüfung der Rechnung' });
  return {
    facts,
    negatives,
    openQuestions,
    relations: ids
      .filter((id) => facts.some((row) => row.provenance.ref === id))
      .map((id) => ({ from: object.objectId, rel: 'refers_to', to: id })),
    confidence: facts.length ? 0.9 : 0.3,
  };
}

// ── fee records and rule registries (billing.fee, concern) ───────────────────

function ruleSetFields(doc) {
  return [doc.label, doc.ruleType, doc.gridOperatorId, doc.legalBasis, doc.changeJustification]
    .map(str)
    .filter(Boolean);
}

function ruleSetFacts(doc, source, quote) {
  const id = doc._id || doc.ruleSetId;
  const base = { source, ref: id };
  const until = doc.effectiveTo ? ` bis ${doc.effectiveTo}` : ' (unbefristet)';
  const rows = [
    fact(
      `Entgelt-Regelwerk ${doc.label || id} (${doc.ruleType}) für Netzbetreiber ${doc.gridOperatorId}, gültig ab ${doc.effectiveFrom}${until}.`,
      {
        ...base,
        value: id,
        role: 'classification',
        quote: quote || doc.label,
        validFrom: doc.effectiveFrom,
        validTo: doc.effectiveTo,
      }
    ),
  ];
  if (doc.legalBasis)
    rows.push(
      fact(`Rechtsgrundlage des Regelwerks ${id}: ${doc.legalBasis}.`, {
        ...base,
        value: doc.legalBasis,
        role: 'reference',
        quote: doc.legalBasis,
      })
    );
  const formula = doc.formulaDefinition || {};
  if (formula.formula) {
    const terms = [
      isNumber(formula.baseRate) ? `baseRate ${formula.baseRate}` : '',
      isNumber(formula.fixedCharge) ? `fixedCharge ${formula.fixedCharge}` : '',
      Array.isArray(formula.tiers) ? `${formula.tiers.length} Stufen` : '',
    ].filter(Boolean);
    rows.push(
      fact(
        `Formel des Regelwerks ${id}: ${formula.formula}${terms.length ? ` (${terms.join(', ')}; Einheiten im Regelwerk nicht angegeben)` : ''}.`,
        { ...base, value: formula.formula, role: 'explanation' }
      )
    );
  }
  if (isNumber(doc.testResults?.total))
    rows.push(
      fact(
        `Testfälle des Regelwerks ${id}: ${doc.testResults.passed} von ${doc.testResults.total} bestanden.`,
        { ...base, value: `${doc.testResults.passed}/${doc.testResults.total}`, role: 'status' }
      )
    );
  return rows;
}

function eegRuleFields(item) {
  return [
    item.id,
    item.calculationMode,
    item.legalStatus,
    item.sourceReference,
    ...(item.notes || []),
  ]
    .map(str)
    .filter(Boolean);
}

function eegRuleFacts(item, quote) {
  const source = READ_ACTIONS.eegRuleSets;
  const until = item.effectiveTo ? ` bis ${item.effectiveTo}` : '';
  const rows = [
    fact(
      `EEG-Regelsatz ${item.id} (Version ${item.version}, Status ${item.status}, Rechtsstand ${item.legalStatus || 'nicht angegeben'}, Rechenart ${item.calculationMode}), gültig ab ${item.effectiveFrom}${until}.`,
      {
        source,
        ref: item.sourceUrl || item.id,
        value: item.id,
        role: 'classification',
        quote: quote || item.sourceReference,
        validFrom: item.effectiveFrom,
        validTo: item.effectiveTo,
      }
    ),
  ];
  if (item.sourceReference)
    rows.push(
      fact(`Quelle des EEG-Regelsatzes ${item.id}: ${item.sourceReference}.`, {
        source,
        ref: item.sourceUrl || item.id,
        value: item.sourceReference,
        role: 'reference',
        quote: item.sourceReference,
      })
    );
  return rows;
}

async function revenueCapFacts(ctx, gridOperatorId) {
  const tenantId = getTenantId(ctx);
  const result = await read(ctx, READ_ACTIONS.revenueCapModel, {
    tenantId,
    vnbId: gridOperatorId,
  });
  const scope = `EOG-Datenpunkte des Mandanten unter Netzbetreiberkennung ${gridOperatorId} (${READ_ACTIONS.revenueCapModel})`;
  const datapoints = (Array.isArray(result.data?.datapoints) ? result.data.datapoints : [])
    .map((row) => ({ ...row, key: str(row.key).replace(/^eog\./u, '') }))
    .filter((row) => REVENUE_CAP_KEYS[row.key] && isNumber(row.value))
    .slice(0, 4);
  if (result.error || !datapoints.length)
    return {
      facts: [],
      negatives: [
        {
          searched: 'Erlösobergrenze (approved_revenue_cap, adjusted_revenue_cap)',
          scope,
          result: result.error || 'no_hit',
        },
      ],
    };
  return {
    facts: datapoints.map((row) =>
      fact(
        `${REVENUE_CAP_KEYS[row.key]} für Netzbetreiber ${gridOperatorId}${row.periodYear ? ` (${row.periodYear})` : ''}: ${row.value}${row.unit ? ` ${row.unit}` : ''} (Herkunft des Datenpunkts: ${row.source || 'nicht angegeben'}, Vertrauen: ${row.confidence || 'nicht angegeben'}).`,
        {
          value: row.value,
          unit: row.unit,
          role: 'monetary',
          source: READ_ACTIONS.revenueCapModel,
          ref: row.id,
          validFrom: row.periodYear,
        }
      )
    ),
    negatives: [],
  };
}

// A network usage fee derives from the operator's revenue cap: its EOG datapoints are read once
// per operator and expansion (`seen`).
async function ruleSetFindings(ctx, doc, source, quote, seen = new Set()) {
  const facts = ruleSetFacts(doc, source, quote);
  if (doc.ruleType !== NETWORK_USAGE_FEE || !doc.gridOperatorId || seen.has(doc.gridOperatorId))
    return { facts, negatives: [] };
  seen.add(doc.gridOperatorId);
  const cap = await revenueCapFacts(ctx, doc.gridOperatorId);
  return { facts: [...facts, ...cap.facts], negatives: cap.negatives };
}

function gridFeeFacts(id, evidence) {
  const source = READ_ACTIONS.gridFeeEvidence;
  const base = { source, ref: evidence.evidenceId || id };
  const rows = [
    fact(
      `Variable Netzentgelt-Berechnung ${id} nach Preisblatt ${evidence.tariffSheetId || 'ohne Kennung'}${evidence.tariffSheetVersion ? ` (Version ${evidence.tariffSheetVersion})` : ''}${evidence.gridAreaId ? `, Netzgebiet ${evidence.gridAreaId}` : ''}.`,
      { ...base, value: id, role: 'identifier' }
    ),
  ];
  if (periodText(evidence.period))
    rows.push(
      fact(`Zeitraum der Netzentgelt-Berechnung ${id}: ${periodText(evidence.period)}.`, {
        ...base,
        value: periodText(evidence.period),
        role: 'period',
        validFrom: evidence.period.from,
        validTo: evidence.period.to,
      })
    );
  const amounts = [
    ['totalKwh', 'Abgerechnete Menge', 'kWh', 'quantity'],
    ['variableFeeEur', 'Variables Netzentgelt', 'EUR', 'monetary'],
    ['basePriceEur', 'Anteiliger Grundpreis', 'EUR', 'monetary'],
    ['totalEur', 'Netzentgelt gesamt', 'EUR', 'monetary'],
  ];
  for (const [key, label, unit, role] of amounts)
    if (isNumber(evidence[key]))
      rows.push(
        fact(`${label} der Berechnung ${id}: ${evidence[key]} ${unit}.`, {
          ...base,
          value: evidence[key],
          unit,
          role,
        })
      );
  rows.push(
    fact(
      `Reduzierung nach § 14a EnWG in der Berechnung ${id} ${evidence.section14aApplied ? 'angewandt' : 'nicht angewandt'}.`,
      { ...base, value: String(Boolean(evidence.section14aApplied)), role: 'status' }
    )
  );
  const errors = (evidence.validationFindings || []).filter((row) => row?.severity === 'error');
  if (errors.length)
    rows.push(
      fact(
        `Die Berechnung ${id} hat ${errors.length} Prüffehler: ${errors
          .slice(0, 3)
          .map((row) => row.finding)
          .join(', ')}.`,
        { ...base, value: errors.length, role: 'status' }
      )
    );
  return rows;
}

async function feeRecord(ctx, id) {
  if (id.startsWith(GRID_FEE_PREFIX)) {
    const result = await read(ctx, READ_ACTIONS.gridFeeEvidence, { calculationId: id });
    if (result.error || !result.data?.found)
      return {
        facts: [],
        negatives: [
          {
            searched: id,
            scope: `Variable Netzentgelt-Berechnungen des Mandanten (${READ_ACTIONS.gridFeeEvidence})`,
            result: result.error || 'not_found',
          },
        ],
      };
    return { facts: gridFeeFacts(id, result.data), negatives: [] };
  }
  const result = await read(ctx, READ_ACTIONS.ruleSet, { id });
  // The registry returns a rule set by id without a tenant check; another tenant's rule set is
  // treated as not found.
  if (result.error || !result.data || result.data.tenantId !== getTenantId(ctx))
    return {
      facts: [],
      negatives: [
        {
          searched: id,
          scope: `Entgelt-Regelwerke des Mandanten (${READ_ACTIONS.ruleSet})`,
          result: result.error === 'unavailable' ? 'unavailable' : 'not_found',
        },
      ],
    };
  return ruleSetFindings(ctx, result.data, READ_ACTIONS.ruleSet);
}

async function candidatePool(ctx) {
  const [tariffs, eegRules] = await Promise.all([
    read(ctx, READ_ACTIONS.ruleSets, { limit: MAX_CANDIDATES }),
    read(ctx, READ_ACTIONS.eegRuleSets, {}),
  ]);
  const ruleSets = Array.isArray(tariffs.data?.ruleSets) ? tariffs.data.ruleSets : [];
  const eegItems = Array.isArray(eegRules.data?.items) ? eegRules.data.items : [];
  const candidates = [
    ...ruleSets.map((doc) => ({ id: doc._id, type: 'tariff', fields: ruleSetFields(doc), doc })),
    ...eegItems.map((item) => ({
      id: item.id,
      type: 'eeg',
      fields: eegRuleFields(item),
      doc: item,
    })),
  ]
    .filter((row) => row.id)
    .slice(0, MAX_CANDIDATES);
  const describe = (result, count, label, action) =>
    result.error ? `${action} (nicht erreichbar)` : `${action} (${count} ${label})`;
  return {
    candidates,
    scope: [
      describe(tariffs, ruleSets.length, 'Entgelt-Regelwerke des Mandanten', READ_ACTIONS.ruleSets),
      describe(eegRules, eegItems.length, 'EEG-Regelsätze', READ_ACTIONS.eegRuleSets),
    ].join('; '),
    unavailable: Boolean(tariffs.error && eegRules.error),
  };
}

const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    picks: {
      type: 'array',
      maxItems: MAX_PICKS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', maxLength: 120 },
          quote: { type: 'string', maxLength: 300 },
        },
        required: ['id', 'quote'],
      },
    },
  },
  required: ['picks'],
};

const PICK_INSTRUCTION =
  'Wähle aus den Kandidaten höchstens vier, die das Anliegen unmittelbar betreffen. Gib je Treffer die id des Kandidaten und als quote einen wörtlichen Ausschnitt aus genau einem Feld dieses Kandidaten an, der den Bezug zeigt. Passt keiner, gib eine leere Liste zurück. Erfinde nichts.';

// Exact identifiers in the text (a rule-set id or a grid operator id) pick without the model.
function exactPicks(text, candidates) {
  const found = new Set(tokens(text));
  const byId = candidates.filter((row) => found.has(row.id));
  const picked = byId.length
    ? byId.map((row) => ({ candidate: row, quote: '' }))
    : candidates
        .filter((row) => row.doc.gridOperatorId && found.has(row.doc.gridOperatorId))
        .map((row) => ({ candidate: row, quote: row.doc.gridOperatorId }));
  return picked.slice(0, MAX_PICKS);
}

async function modelPicks(ctx, question, candidates) {
  const llm = require('../../llm-client');
  const raw = await withTimeout(
    llm.generateStructured(
      PICK_SCHEMA,
      JSON.stringify({
        instruction: PICK_INSTRUCTION,
        question: String(question).slice(0, 2000),
        candidates: candidates.map((row) => ({ id: row.id, fields: row.fields })),
      }),
      { phase: PHASE, tenantId: getTenantId(ctx) }
    ),
    PICK_TIMEOUT_MS
  );
  const picks = (raw?.data || raw)?.picks;
  const byId = new Map(candidates.map((row) => [row.id, row]));
  const accepted = [];
  for (const pick of Array.isArray(picks) ? picks : []) {
    const candidate = byId.get(String(pick?.id || ''));
    const quote = String(pick?.quote || '').trim();
    // A pick counts only with a verbatim quote from one field of that candidate.
    if (!candidate || quote.length < 3 || !candidate.fields.some((field) => field.includes(quote)))
      continue;
    if (accepted.some((row) => row.candidate.id === candidate.id)) continue;
    accepted.push({ candidate, quote });
  }
  return accepted.slice(0, MAX_PICKS);
}

// Picks rule sets of both registries for a question and expands them. Returns `picked: false`
// with an open question when the model could not be asked, so no negative claims a search that
// did not happen.
async function registryFindings(ctx, question, searched) {
  const pool = await candidatePool(ctx);
  if (!pool.candidates.length)
    return {
      facts: [],
      negatives: [
        { searched, scope: pool.scope, result: pool.unavailable ? 'unavailable' : 'no_hit' },
      ],
      picks: [],
    };
  let picks = exactPicks(question, pool.candidates);
  if (!picks.length) {
    try {
      picks = await modelPicks(ctx, question, pool.candidates);
    } catch (_error) {
      return {
        facts: [],
        negatives: [],
        openQuestions: [
          {
            question: `Welches der ${pool.candidates.length} registrierten Regelwerke ist gemeint?`,
            resolves: 'Zuordnung des gültigen Entgelt- oder EEG-Regelwerks',
          },
        ],
        picks: [],
      };
    }
  }
  if (!picks.length)
    return { facts: [], negatives: [{ searched, scope: pool.scope, result: 'no_match' }], picks };
  const seen = new Set();
  const parts = await Promise.all(
    picks.map(({ candidate, quote }) =>
      candidate.type === 'tariff'
        ? ruleSetFindings(ctx, candidate.doc, READ_ACTIONS.ruleSets, quote, seen)
        : { facts: eegRuleFacts(candidate.doc, quote), negatives: [] }
    )
  );
  return {
    facts: parts.flatMap((part) => part.facts),
    negatives: parts.flatMap((part) => part.negatives),
    picks,
  };
}

async function expandFee(ctx, object) {
  const text = objectText(object);
  const ids = feeRecordIds(text)
    .map((hit) => hit.value)
    .slice(0, MAX_IDS);
  if (ids.length) {
    const parts = await Promise.all(ids.map((id) => feeRecord(ctx, id)));
    const facts = parts.flatMap((part) => part.facts).slice(0, MAX_FACTS);
    return {
      facts,
      negatives: parts.flatMap((part) => part.negatives),
      relations: ids
        .filter((id) => facts.some((row) => row.value === id))
        .map((id) => ({ from: object.objectId, rel: 'refers_to', to: id })),
      confidence: facts.length ? 0.9 : 0.3,
    };
  }
  const result = await registryFindings(
    ctx,
    [object.label, text].filter(Boolean).join(': '),
    `Regelwerk zu „${str(object.value).slice(0, 200)}“`
  );
  return {
    facts: result.facts.slice(0, MAX_FACTS),
    negatives: result.negatives,
    openQuestions: result.openQuestions || [],
    relations: result.picks.map(({ candidate }) => ({
      from: object.objectId,
      rel: 'refers_to',
      to: candidate.id,
    })),
    confidence: result.facts.length ? 0.6 : 0.3,
  };
}

async function expandConcern(ctx, object, context = {}) {
  const consequence = str(context.consequenceOf).slice(0, 300);
  const question = consequence
    ? `${str(object.value)}\nFolge aus einem anderen Bereich: ${consequence}`
    : str(object.value);
  const result = await registryFindings(
    ctx,
    question,
    consequence
      ? `Abrechnungs- und Entgeltregeln, die von „${consequence}“ berührt werden`
      : 'Abrechnungs- und Entgeltregeln zum Anliegen'
  );
  return {
    facts: result.facts.slice(0, MAX_FACTS),
    negatives: result.negatives,
    openQuestions: result.openQuestions || [],
    relations: result.picks.map(({ candidate }) =>
      consequence
        ? { from: candidate.id, rel: 'affects', to: consequence }
        : { from: candidate.id, rel: 'answers', to: object.objectId }
    ),
    confidence: result.facts.length ? 0.6 : 0.3,
  };
}

// ── playbooks ────────────────────────────────────────────────────────────────

// Metering location id: "DE" and 31 digits or capitals (33 characters); market location id:
// 11 digits.
function isLocationId(value) {
  const text = str(value);
  const capitalOrDigit = (ch) => (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z');
  if (text.length === 33 && text.startsWith('DE')) return [...text].every(capitalOrDigit);
  return text.length === 11 && [...text].every((ch) => ch >= '0' && ch <= '9');
}

// Fixed dependencies: a settlement belongs to its unit and metering location; a rule set rests on
// its legal basis. Follow-ups come only from identifiers the services returned.
function followUps(finding) {
  const next = [];
  const add = (kind, value) => {
    if (!next.some((row) => row.kind === kind && row.value === value)) next.push({ kind, value });
  };
  for (const row of finding?.facts || []) {
    const value = str(row.value);
    if (row.role === 'identifier') {
      for (const hit of registerUnitNumbers(value)) add('plant.register_unit', hit.value);
      if (isLocationId(value)) add('mako.location_id', value);
    }
    if (row.role === 'reference') {
      for (const hit of sectionReferences(value)) add('reg.section', hit.value);
      for (const hit of rulingNumbers(value)) add('reg.ruling', hit.value);
    }
  }
  return next;
}

module.exports = {
  expanders: {
    'billing.invoice': expandInvoice,
    'billing.fee': expandFee,
    concern: expandConcern,
  },
  playbooks: [
    { from: 'billing.invoice', next: followUps },
    { from: 'billing.fee', next: followUps },
    { from: 'concern', next: followUps },
  ],
  READ_ACTIONS,
};
