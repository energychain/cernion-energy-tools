'use strict';

/**
 * Expanders of the assetmanagement pack (micro-agent tier, Phase 1): equipment and its
 * re-invest signals, investment plans, CAPEX prioritization, investment maturity gates,
 * ghost-asset scans and legacy-data assessments.
 *
 * Every call is a read action of an existing service (operation-capability-index.json:
 * operationKind data_read, writesTo [], sideEffects []; implementation checked):
 * - investment-planning.listPlans – tenant-filtered plans (allDocs + tenantId filter);
 * - capex-prioritization.list, reinvest-signal.list, ghost-asset-alert.list,
 *   altdaten-assessment.list – tenant-scoped `db.find` over stored analyses;
 * - investment-maturity-off-balance-gate.listGates – tenant-scoped `db.find`;
 * - assets.overrides – tenant namespace query of the object store (object-store.query).
 * Not used: every write (createPlan, analyze, scan, forwardToEdm, assess, evaluate, override,
 * removeOverride), assets.applyOverride (indexed as data_read but writes object-store.put), the
 * `get` actions of capex-prioritization, reinvest-signal, ghost-asset-alert and
 * altdaten-assessment (no tenant check on the document), and the MaStR asset lists
 * (assets.list/all/effective: external live source that needs a grid-operator scope; the
 * netzplanung pack reads MaStR units).
 *
 * No model call: every fact is a stored service value; identifiers are matched literally.
 */

const { sectionReferences, tokens } = require('./detectors');

const CALL_TIMEOUT_MS = 3000;
const MIN_CALL_MS = 200;
// Below the mixin's default budget (4000 ms), so the expander returns what it has in time.
const EXPAND_BUDGET_MS = 3500;
const BUDGET_RESERVE_MS = 300;
const LIST_LIMIT = 50;
const MAX_MATCHES = 5;
const PLAN_PREFIX = 'investment-plan:';
const SECTION_PREFIX = 'reg.section:';

const present = (value) => value !== undefined && value !== null && value !== '';
const unique = (values) => [...new Set(values)];
const lower = (value) => String(value ?? '').toLowerCase();
const eur = (value) => `${Number(value).toLocaleString('de-DE')} €`;

// ─── Read calls ──────────────────────────────────────────────────────────────

// One bounded read; a timeout or error is a result, never a thrown error. The tenant of the
// turn travels in the call meta, so tenant-scoped services filter by it.
async function read(ctx, action, params, context = {}) {
  const left = context.deadline ? context.deadline - Date.now() : CALL_TIMEOUT_MS;
  if (left < MIN_CALL_MS) return { ok: false, error: 'budget_exhausted' };
  const opts = { timeout: Math.min(CALL_TIMEOUT_MS, left) };
  if (context.tenantId && !ctx.meta?.tenantId) opts.meta = { tenantId: context.tenantId };
  try {
    return { ok: true, data: await ctx.call(action, params, opts) };
  } catch (error) {
    return { ok: false, error: error?.message || 'error' };
  }
}

// The stores of the area: one list action each, the rows it returns, a label for the scope.
const STORES = {
  plans: {
    action: 'investment-planning.listPlans',
    params: { limit: LIST_LIMIT },
    rows: (data) => data?.plans,
    label: 'Investitionspläne',
  },
  capex: {
    action: 'capex-prioritization.list',
    params: { limit: LIST_LIMIT },
    rows: (data) => data?.analyses,
    label: 'CAPEX-Priorisierungen',
  },
  gates: {
    action: 'investment-maturity-off-balance-gate.listGates',
    params: { limit: LIST_LIMIT },
    rows: (data) => data?.gates,
    label: 'Reifegrad-Gates (Off-Balance)',
  },
  reinvest: {
    action: 'reinvest-signal.list',
    params: { limit: LIST_LIMIT },
    rows: (data) => data?.analyses,
    label: 'Re-Invest-Signal-Analysen',
  },
  ghost: {
    action: 'ghost-asset-alert.list',
    params: { limit: LIST_LIMIT },
    rows: (data) => data?.scans,
    label: 'Ghost-Asset-Scans',
  },
  altdaten: {
    action: 'altdaten-assessment.list',
    params: { limit: LIST_LIMIT },
    rows: (data) => data?.assessments,
    label: 'Altdatenbewertungen',
  },
};

async function loadStores(ctx, names, context) {
  const loaded = await Promise.all(
    names.map(async (name) => {
      const store = STORES[name];
      const res = await read(ctx, store.action, store.params, context);
      const rows = res.ok && Array.isArray(store.rows(res.data)) ? store.rows(res.data) : [];
      return [name, { ...store, name, ok: res.ok, error: res.error, rows }];
    })
  );
  return Object.fromEntries(loaded);
}

const storeScope = (store) =>
  `${store.action}: ${store.rows.length} gespeicherte ${store.label} des Mandanten (höchstens ${LIST_LIMIT})`;

// The negative of one store: what was searched, where, and whether the source answered.
function storeNegative(store, searched) {
  return store.ok
    ? { searched, scope: storeScope(store), result: 'no_hit' }
    : { searched, scope: store.action, result: 'source_unavailable' };
}

// ─── Matching (literal, no word lists) ───────────────────────────────────────

// An identifier field matches only exactly (ignoring case and surrounding blanks).
const sameId = (a, b) => present(a) && present(b) && lower(a).trim() === lower(b).trim();

// A label matches if it equals the value or holds the value's tokens as one contiguous run.
function labelHolds(label, value) {
  if (!present(label) || !present(value)) return false;
  if (sameId(label, value)) return true;
  const hay = tokens(lower(label));
  const needle = tokens(lower(value));
  if (!needle.length || needle.length > hay.length) return false;
  for (let start = 0; start + needle.length <= hay.length; start++)
    if (needle.every((token, offset) => hay[start + offset] === token)) return true;
  return false;
}

// Tokens of a text that have the shape of an identifier: a digit or a separator inside.
function identifierTokens(text) {
  return unique(
    tokens(text).filter(
      (token) =>
        token.length >= 3 &&
        [...token].some((ch) => (ch >= '0' && ch <= '9') || ch === '-' || ch === ':' || ch === '_')
    )
  );
}

// ─── Facts ───────────────────────────────────────────────────────────────────

function fact(statement, { value, unit, role = 'status', basis = 'source', source, ref, quote }) {
  return {
    statement,
    ...(present(value) ? { value: String(value) } : {}),
    ...(unit ? { unit } : {}),
    role,
    basis,
    provenance: { source, ...(ref ? { ref } : {}), ...(quote ? { quote: String(quote) } : {}) },
  };
}

const dated = (row) => (row?.createdAt ? ` vom ${String(row.createdAt).slice(0, 10)}` : '');

function emptyFinding() {
  return { facts: [], relations: [], negatives: [], openQuestions: [], confidence: 0.3 };
}

// Direct identifier hits are strongest; a store overview alone is weaker.
function findingConfidence(identifierHits, overviewFacts) {
  if (identifierHits) return 0.8;
  if (overviewFacts) return 0.5;
  return 0.3;
}

function merge(target, part) {
  for (const key of ['facts', 'relations', 'negatives', 'openQuestions'])
    target[key].push(...(part[key] || []));
  return target;
}

// Legal bases cited in a stored text become references the regulation pack can expand.
function sectionRelations(from, text) {
  return sectionReferences(String(text ?? '')).map((row) => ({
    from,
    rel: 'refers_to',
    to: `${SECTION_PREFIX}${row.value}`,
  }));
}

// ─── Investment plans (investment-planning.listPlans) ────────────────────────

function planFacts(plan) {
  const source = STORES.plans.action;
  const ref = `Plan ${plan.id}`;
  const facts = [
    fact(`Investitionsplan ${plan.id}${dated(plan)}: Entscheidungsstatus ${plan.decisionStatus}.`, {
      value: plan.decisionStatus,
      source,
      ref,
    }),
  ];
  const pva = plan.planVsActual;
  if (pva && present(pva.sollEur) && present(pva.istEur))
    facts.push(
      fact(
        `Soll-Ist im Plan ${plan.id}: Soll ${eur(pva.sollEur)}, Ist ${eur(pva.istEur)}, Abweichung ${eur(pva.deltaEur)} (${pva.deltaPercent} %).`,
        { value: pva.deltaEur, unit: 'EUR', role: 'monetary', source, ref: `${ref}, planVsActual` }
      )
    );
  const missing = plan.mandateAlignment?.missingRoles || [];
  if (missing.length)
    facts.push(
      fact(`Im Plan ${plan.id} fehlen verantwortliche Rollen: ${missing.join(', ')}.`, {
        value: missing.join(', '),
        source,
        ref: `${ref}, mandateAlignment`,
      })
    );
  const hitl = plan.hitlItemIds || [];
  if (hitl.length)
    facts.push(
      fact(`Zum Plan ${plan.id} sind ${hitl.length} Freigaben (HITL) angelegt.`, {
        value: hitl.length,
        role: 'quantity',
        source,
        ref: `${ref}, hitlItemIds`,
      })
    );
  return facts;
}

function triggeredMeasureFacts(plan, measure) {
  const source = STORES.plans.action;
  const ref = `Plan ${plan.id}, Maßnahme ${measure.measureId}`;
  const facts = [
    fact(
      `Maßnahme ${measure.name || measure.measureId} (${measure.measureId}) im Investitionsplan ${plan.id}: CAPEX ${eur(measure.capexEur)}, vermiedene Kosten ${eur(measure.avoidedCostsEur)}.`,
      { value: measure.capexEur, unit: 'EUR', role: 'monetary', source, ref }
    ),
  ];
  const threshold = present(measure.thresholdEur)
    ? measure.thresholdEur
    : plan.triggerPolicy?.thresholdEur;
  if (present(threshold))
    facts.push(
      fact(
        `Freigabeschwelle der Investitionsplanung: ${eur(threshold)} je Maßnahme; die Maßnahme ${measure.measureId} liegt mit ${eur(measure.triggerAmountEur)} darüber und braucht eine Freigabe.`,
        {
          value: threshold,
          unit: 'EUR',
          role: 'quantity',
          basis: 'rule',
          source,
          ref: `Plan ${plan.id}, triggerPolicy`,
          quote: plan.triggerPolicy?.semantics,
        }
      )
    );
  return facts;
}

function matchPlans(store, value, { exact = false } = {}) {
  const part = emptyFinding();
  let hits = 0;
  for (const plan of store.rows) {
    if (hits >= MAX_MATCHES) break;
    if (sameId(plan.id, value)) {
      hits++;
      part.facts.push(...planFacts(plan));
      continue;
    }
    const measures = (plan.triggeredMeasures || []).filter(
      (measure) =>
        sameId(measure.measureId, value) ||
        sameId(measure.projectId, value) ||
        (!exact && labelHolds(measure.name, value))
    );
    if (!measures.length) continue;
    hits++;
    part.facts.push(planFacts(plan)[0]);
    for (const measure of measures.slice(0, MAX_MATCHES)) {
      part.facts.push(...triggeredMeasureFacts(plan, measure));
      part.relations.push({
        from: measure.measureId,
        rel: 'belongs_to',
        to: `${PLAN_PREFIX}${plan.id}`,
      });
    }
  }
  return { ...part, hits };
}

// ─── CAPEX prioritization (capex-prioritization.list) ────────────────────────

function capexSummaryFact(analysis) {
  const summary = analysis.summary || {};
  return fact(
    `CAPEX-Priorisierung ${analysis._id}${dated(analysis)}: ${summary.totalMeasures} Maßnahmen, davon ${summary.nonNegotiableCount} nicht durch Marktflexibilität ersetzbar, ${summary.regulatoryCount} gesetzlich verpflichtend; Pflichtblock ${eur(summary.totalCapexNonNegotiableEur || 0)} von ${eur(summary.totalCapexEur || 0)}.`,
    {
      value: summary.totalCapexNonNegotiableEur,
      unit: 'EUR',
      role: 'monetary',
      source: STORES.capex.action,
      ref: analysis._id,
    }
  );
}

function capexMeasureFacts(analysis, measure) {
  const source = STORES.capex.action;
  const ref = `${analysis._id}, Maßnahme ${measure.measureId}`;
  const description = measure.description ? ` (${measure.description})` : '';
  const facts = [
    fact(
      `Maßnahme ${measure.measureId}${description}: Klasse ${measure.classification}, Dringlichkeit ${measure.urgency}, Priorität ${measure.priorityScore}; durch Flexibilität ersetzbar: ${measure.canBeReplacedByFlex ? 'ja' : 'nein'}.`,
      { value: measure.classification, role: 'classification', source, ref }
    ),
  ];
  if (present(measure.capexEur))
    facts.push(
      fact(`CAPEX der Maßnahme ${measure.measureId}: ${eur(measure.capexEur)}.`, {
        value: measure.capexEur,
        unit: 'EUR',
        role: 'monetary',
        source,
        ref,
      })
    );
  if (present(measure.physicalMeasurePlannedDate))
    facts.push(
      fact(
        `Geplanter Termin der physischen Maßnahme ${measure.measureId}: ${measure.physicalMeasurePlannedDate}.`,
        { value: measure.physicalMeasurePlannedDate, role: 'date', source, ref }
      )
    );
  for (const row of (measure.findings || []).slice(0, 2))
    if (row?.message)
      facts.push(
        fact(`Befund zu ${measure.measureId}: ${row.message}`, {
          value: row.code,
          role: 'explanation',
          source,
          ref,
          quote: row.message,
        })
      );
  return facts;
}

function matchCapex(store, value, { exact = false } = {}) {
  const part = emptyFinding();
  let hits = 0;
  for (const analysis of store.rows) {
    if (hits >= MAX_MATCHES) break;
    if (sameId(analysis._id, value)) {
      hits++;
      part.facts.push(capexSummaryFact(analysis));
      continue;
    }
    const measures = (analysis.classifiedMeasures || []).filter(
      (measure) =>
        sameId(measure.measureId, value) || (!exact && labelHolds(measure.description, value))
    );
    if (!measures.length) continue;
    hits++;
    for (const measure of measures.slice(0, MAX_MATCHES)) {
      part.facts.push(...capexMeasureFacts(analysis, measure));
      part.relations.push(...sectionRelations(measure.measureId, measure.regulatoryBasis));
    }
  }
  return { ...part, hits };
}

// ─── Investment maturity gates (investment-maturity-off-balance-gate.listGates) ──

function gateFacts(gate) {
  const source = STORES.gates.action;
  const ref = gate._id;
  const maturity = gate.maturityLevel ? `, Reifegrad ${gate.maturityLevel}` : '';
  const facts = [
    fact(
      `Reifegrad-Gate ${gate._id} für Investitionsfall ${gate.investmentCaseId}${dated(gate)}: Status ${gate.evidenceStatus}${maturity}.`,
      { value: gate.evidenceStatus, source, ref }
    ),
  ];
  if (present(gate.additionalFinancingCostEur))
    facts.push(
      fact(
        `Zusätzliche Finanzierungskosten der Off-Balance-Struktur: ${eur(gate.additionalFinancingCostEur)}.`,
        {
          value: gate.additionalFinancingCostEur,
          unit: 'EUR',
          role: 'monetary',
          source,
          ref,
        }
      )
    );
  const missing = gate.missingDataPoints || [];
  if (missing.length)
    facts.push(
      fact(`Im Gate ${gate._id} fehlen Nachweise: ${missing.join(', ')}.`, {
        value: missing.join(', '),
        source,
        ref: `${ref}, missingDataPoints`,
      })
    );
  return facts;
}

function matchGates(store, value) {
  const part = emptyFinding();
  let hits = 0;
  for (const gate of store.rows) {
    if (hits >= MAX_MATCHES) break;
    if (![gate._id, gate.investmentCaseId, gate.investmentPlanId].some((id) => sameId(id, value)))
      continue;
    hits++;
    part.facts.push(...gateFacts(gate));
    if (gate.investmentPlanId)
      part.relations.push({
        from: gate.investmentCaseId || gate._id,
        rel: 'refers_to',
        to: `${PLAN_PREFIX}${gate.investmentPlanId}`,
      });
    for (const point of (gate.missingDataPoints || []).slice(0, 2))
      part.openQuestions.push({
        question: `Welcher Nachweis liegt für ${point} im Investitionsfall ${gate.investmentCaseId} vor?`,
        resolves: `Gate ${gate._id}: ${point}`,
      });
  }
  return { ...part, hits };
}

// ─── Re-invest signals (reinvest-signal.list) ────────────────────────────────

function signalFacts(analysis, signal) {
  const source = STORES.reinvest.action;
  const ref = `${analysis._id}, Anlage ${signal.assetId}`;
  const label = signal.assetLabel || signal.assetId;
  const facts = [
    fact(
      `Re-Invest-Signal für ${label} (${signal.assetId}): Kategorie ${signal.category}, ARegV-Relevanz ${signal.aregRelevance}, Score ${signal.reinvestScore}.`,
      { value: signal.category, role: 'classification', source, ref }
    ),
  ];
  if (present(signal.eventDate))
    facts.push(
      fact(`Auslösendes Ereignis an ${label}: ${signal.eventType} am ${signal.eventDate}.`, {
        value: signal.eventDate,
        role: 'date',
        source,
        ref,
      })
    );
  if (present(signal.estimatedCapexEur))
    facts.push(
      fact(`Geschätzter Investitionsbedarf für ${label}: ${eur(signal.estimatedCapexEur)}.`, {
        value: signal.estimatedCapexEur,
        unit: 'EUR',
        role: 'monetary',
        source,
        ref,
      })
    );
  if (present(analysis.fotojahr))
    facts.push(
      fact(
        `${label} ist ${signal.qualifiesForFotojahr ? '' : 'nicht '}für das Fotojahr ${analysis.fotojahr} qualifiziert.`,
        { value: String(Boolean(signal.qualifiesForFotojahr)), source, ref }
      )
    );
  if (signal.actionRequired)
    facts.push(
      fact(`Folge laut Klassifikation: ${signal.actionRequired}.`, {
        role: 'explanation',
        source,
        ref,
        quote: signal.actionRequired,
      })
    );
  return facts;
}

function matchReinvest(store, value, { exact = false } = {}) {
  const part = emptyFinding();
  let hits = 0;
  for (const analysis of store.rows) {
    for (const signal of analysis.signals || []) {
      if (hits >= MAX_MATCHES) return { ...part, hits };
      if (!sameId(signal.assetId, value) && (exact || !labelHolds(signal.assetLabel, value)))
        continue;
      hits++;
      part.facts.push(...signalFacts(analysis, signal));
      part.relations.push({
        from: signal.assetId,
        rel: 'refers_to',
        to: `reinvest-signal:${analysis._id}`,
      });
    }
  }
  return { ...part, hits };
}

// ─── Ghost-asset scans (ghost-asset-alert.list) ──────────────────────────────

function matchGhost(store, value) {
  const part = emptyFinding();
  let hits = 0;
  for (const scan of store.rows) {
    for (const row of scan.findings || []) {
      if (hits >= MAX_MATCHES) return { ...part, hits };
      if (!sameId(row.mastrNummer, value)) continue;
      hits++;
      const ref = `${scan._id}, Anlage ${row.mastrNummer}`;
      part.facts.push(
        fact(
          `Geo-Abgleich ${scan._id}${dated(scan)}: Anlage ${row.mastrNummer} ${row.findingCode} (${row.status}), Schwere ${row.severity}, nächste Netzgebietsgrenze ${row.distanceKm} km.`,
          { value: row.findingCode, source: STORES.ghost.action, ref }
        )
      );
      if (present(scan.params?.distanceThresholdKm))
        part.facts.push(
          fact(`Abstandsschwelle dieses Scans: ${scan.params.distanceThresholdKm} km.`, {
            value: scan.params.distanceThresholdKm,
            unit: 'km',
            role: 'quantity',
            source: STORES.ghost.action,
            ref: `${scan._id}, params`,
          })
        );
      if (row.actionRequired)
        part.facts.push(
          fact(`Empfohlene Prüfung für ${row.mastrNummer}: ${row.actionRequired}.`, {
            role: 'explanation',
            source: STORES.ghost.action,
            ref,
            quote: row.actionRequired,
          })
        );
    }
  }
  return { ...part, hits };
}

// ─── Legacy-data assessments (altdaten-assessment.list) ──────────────────────

function altdatenFact(assessment) {
  const roadmap = assessment.roadmap || {};
  return fact(
    `Altdatenbewertung ${assessment._id} (Migrationsprojekt ${assessment.migrationProjectId})${dated(assessment)}: Migrationsreife ${roadmap.migrationReadinessPct} %, Status ${roadmap.readinessStatus}, ${roadmap.blockerCount} Blocker, ${roadmap.cleansingCount} Bereinigungsbedarfe.`,
    {
      value: roadmap.readinessStatus,
      source: STORES.altdaten.action,
      ref: assessment._id,
    }
  );
}

function matchAltdaten(store, value) {
  const part = emptyFinding();
  let hits = 0;
  for (const assessment of store.rows) {
    if (hits >= MAX_MATCHES) break;
    if (!sameId(assessment._id, value) && !sameId(assessment.migrationProjectId, value)) continue;
    hits++;
    part.facts.push(altdatenFact(assessment));
    for (const row of (assessment.classifiedDeviations || []).slice(0, 3))
      part.relations.push(...sectionRelations(assessment._id, row.regulatoryBasis));
  }
  return { ...part, hits };
}

// ─── Asset overrides (assets.overrides) ──────────────────────────────────────

function overrideFact(row) {
  const previous = present(row.previousValue)
    ? ` (vorher ${JSON.stringify(row.previousValue)})`
    : '';
  const recorded = row.createdAt ? `, erfasst ${String(row.createdAt).slice(0, 10)}` : '';
  return fact(
    `Korrektur am Anlagenstammsatz ${row.assetId}: Feld ${row.field} = ${JSON.stringify(row.value)}${previous}, Freigabestatus ${row.approvalStatus}${recorded}.`,
    { value: row.approvalStatus, source: 'assets.overrides', ref: row.id }
  );
}

function overrideFacts(data) {
  return (data?.overrides || []).slice(-MAX_MATCHES).map((row) => overrideFact(row));
}

// ─── Expanders ───────────────────────────────────────────────────────────────

// The expander's own deadline: inside the mixin's budget, so partial results arrive in time.
function withDeadline(ctx, context) {
  const budget = Number(ctx.params?.budget?.timeoutMs) || Infinity;
  const ms = Math.min(EXPAND_BUDGET_MS, budget - BUDGET_RESERVE_MS);
  return { ...context, deadline: Date.now() + Math.max(ms, 0) };
}

function noValue(object) {
  const finding = emptyFinding();
  finding.openQuestions.push({
    question: 'Um welche Anlage oder Maßnahme geht es genau?',
    resolves: `Bezeichnung des Objekts ${object.kind}`,
  });
  return finding;
}

async function expandEquipment(ctx, object, context) {
  const value = String(object.value || '').trim();
  if (!value) return noValue(object);
  const bounded = withDeadline(ctx, context);
  const singleToken = tokens(value).length === 1;
  const [stores, overrides] = await Promise.all([
    loadStores(ctx, ['reinvest', 'ghost'], bounded),
    singleToken ? read(ctx, 'assets.overrides', { assetId: value }, bounded) : null,
  ]);
  const finding = emptyFinding();
  const reinvest = matchReinvest(stores.reinvest, value);
  const ghost = matchGhost(stores.ghost, value);
  merge(finding, reinvest);
  merge(finding, ghost);
  if (!reinvest.hits) finding.negatives.push(storeNegative(stores.reinvest, value));
  if (!ghost.hits) finding.negatives.push(storeNegative(stores.ghost, value));
  if (overrides) {
    const rows = overrideFacts(overrides.data);
    finding.facts.push(...rows);
    if (!overrides.ok)
      finding.negatives.push({
        searched: value,
        scope: 'assets.overrides',
        result: 'source_unavailable',
      });
    else if (!rows.length)
      finding.negatives.push({
        searched: value,
        scope: 'assets.overrides: Stammdatenkorrekturen des Mandanten zu dieser Anlagen-ID',
        result: 'no_hit',
      });
  }
  // No service holds the master data of grid equipment (transformers, lines, switchgear).
  finding.negatives.push({
    searched: value,
    scope: 'Betriebsmittelstammdaten, Zustand und Alter: kein lesender Dienst im Bestand',
    result: 'no_source',
  });
  if (!finding.facts.length)
    finding.openQuestions.push({
      question: `Unter welcher Anlagen-ID ist ${value} in den Instandhaltungs- oder SCADA-Daten geführt?`,
      resolves: 'Abgleich mit den Re-Invest-Signalen und Ghost-Asset-Scans',
    });
  finding.confidence = finding.facts.length ? 0.8 : 0.3;
  return finding;
}

async function expandInvestment(ctx, object, context) {
  const value = String(object.value || '').trim();
  if (!value) return noValue(object);
  const stores = await loadStores(ctx, ['plans', 'capex', 'gates'], withDeadline(ctx, context));
  const finding = emptyFinding();
  const parts = {
    plans: matchPlans(stores.plans, value),
    capex: matchCapex(stores.capex, value),
    gates: matchGates(stores.gates, value),
  };
  for (const [name, part] of Object.entries(parts)) {
    merge(finding, part);
    if (!part.hits) finding.negatives.push(storeNegative(stores[name], value));
  }
  if (!finding.facts.length)
    finding.openQuestions.push({
      question: `Unter welcher Maßnahmen- oder Projektnummer ist ${value} geplant?`,
      resolves: 'Abgleich mit Investitionsplänen, CAPEX-Priorisierung und Reifegrad-Gates',
    });
  finding.confidence = finding.facts.length ? 0.8 : 0.3;
  return finding;
}

// The latest state of each store of the area, from the stored records.
function overview(stores) {
  const facts = [];
  const negatives = [];
  const latest = (rows) =>
    [...rows].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  for (const store of Object.values(stores)) {
    if (!store.ok || !store.rows.length) {
      negatives.push(storeNegative(store, store.label));
      continue;
    }
    const row = latest(store.rows);
    if (store.name === 'plans') {
      const blocked = store.rows.filter((plan) => plan.decisionStatus === 'blocked').length;
      facts.push(
        fact(
          `${store.rows.length} Investitionspläne gespeichert, davon ${blocked} mit Entscheidungsstatus blocked.`,
          { value: blocked, role: 'quantity', source: store.action }
        ),
        planFacts(row)[0]
      );
    } else if (store.name === 'capex') facts.push(capexSummaryFact(row));
    else if (store.name === 'gates') {
      const counts = {};
      for (const gate of store.rows)
        counts[gate.evidenceStatus] = (counts[gate.evidenceStatus] || 0) + 1;
      facts.push(
        fact(
          `${store.rows.length} Reifegrad-Gates gespeichert: ${Object.entries(counts)
            .map(([status, count]) => `${count} ${status}`)
            .join(', ')}.`,
          { value: store.rows.length, role: 'quantity', source: store.action }
        )
      );
    } else if (store.name === 'reinvest') {
      const summary = row.summary || {};
      facts.push(
        fact(
          `Re-Invest-Analyse ${row._id}${dated(row)}: ${summary.signalCount} Signale, ${summary.fotojahrQualifiedCount} für das Fotojahr ${row.fotojahr} qualifiziert, ${summary.highAregRelevanceCount} mit hoher ARegV-Relevanz; Fotojahr-CAPEX ${eur(summary.fotojahrCapexEur || 0)}.`,
          {
            value: summary.fotojahrCapexEur,
            unit: 'EUR',
            role: 'monetary',
            source: store.action,
            ref: row._id,
          }
        )
      );
    } else if (store.name === 'ghost') {
      const summary = row.summary || {};
      facts.push(
        fact(
          `Ghost-Asset-Scan ${row._id}${dated(row)}: ${summary.ghostCount} von ${summary.totalInstallations} Anlagen vermutlich außerhalb des Netzgebiets, ${summary.boundaryCount} grenznah, ${summary.noCoordinatesCount} ohne Koordinaten.`,
          { value: summary.ghostCount, role: 'quantity', source: store.action, ref: row._id }
        )
      );
    } else if (store.name === 'altdaten') facts.push(altdatenFact(row));
  }
  return { facts, negatives };
}

// Identifiers in a text that name a stored record of the area (exact match only).
function lookupIdentifiers(stores, text) {
  const part = emptyFinding();
  const found = [];
  for (const id of identifierTokens(text).slice(0, 20)) {
    const hits = [
      matchPlans(stores.plans, id, { exact: true }),
      matchCapex(stores.capex, id, { exact: true }),
      matchGates(stores.gates, id),
      matchReinvest(stores.reinvest, id, { exact: true }),
      matchGhost(stores.ghost, id),
      matchAltdaten(stores.altdaten, id),
    ].filter((row) => row.hits);
    if (!hits.length) continue;
    found.push(id);
    for (const row of hits) merge(part, row);
  }
  return { ...part, found };
}

async function expandConcern(ctx, object, context) {
  const stores = await loadStores(ctx, Object.keys(STORES), withDeadline(ctx, context));
  const finding = emptyFinding();
  const reason = String(context.consequenceOf || '');
  const ids = lookupIdentifiers(stores, reason ? `${reason}\n${object.value}` : object.value);
  merge(finding, ids);
  if (reason) {
    for (const id of ids.found) finding.relations.push({ from: id, rel: 'affects', to: reason });
    if (!ids.found.length)
      finding.openQuestions.push({
        question:
          'Welche Maßnahme, Anlage oder welcher Investitionsfall ist von diesem Befund betroffen?',
        resolves: reason,
      });
  }
  const state = overview(stores);
  finding.facts.push(...state.facts);
  finding.negatives.push(...state.negatives);
  finding.confidence = findingConfidence(ids.found.length, state.facts.length);
  return finding;
}

const expanders = {
  'asset.equipment': expandEquipment,
  'asset.investment': expandInvestment,
  concern: expandConcern,
};

// Fixed dependencies of the area, from stored references only:
// - a maturity gate names the investment plan it evaluates → expand that plan;
// - a stored measure or deviation cites a legal section → the regulation pack expands it.
const referenced = (finding, prefix) =>
  unique(
    (finding?.relations || [])
      .filter((row) => row.rel === 'refers_to' && String(row.to).startsWith(prefix))
      .map((row) => String(row.to).slice(prefix.length))
  );

const planFollowUp = (finding, object) =>
  referenced(finding, PLAN_PREFIX)
    .filter((id) => !sameId(id, object?.value))
    .map((value) => ({ kind: 'asset.investment', value, label: 'Investitionsplan des Gates' }));

const sectionFollowUp = (finding) =>
  referenced(finding, SECTION_PREFIX).map((value) => ({
    kind: 'reg.section',
    value,
    label: 'Rechtsgrundlage einer Maßnahme',
  }));

const playbooks = [
  { from: 'asset.investment', next: planFollowUp },
  { from: 'asset.investment', next: sectionFollowUp },
  { from: 'concern', next: planFollowUp },
  { from: 'concern', next: sectionFollowUp },
];

module.exports = {
  expanders,
  playbooks,
  // Exposed for tests of the literal matching.
  matching: { labelHolds, identifierTokens },
};
