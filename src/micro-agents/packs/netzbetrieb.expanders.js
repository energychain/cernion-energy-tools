'use strict';

/**
 * Expanders of the pack "netzbetrieb" (Netzbetrieb, Redispatch und Flexibilität), Phase 1.
 *
 * Every expander reads only. The service actions used here are the data_read operations of the
 * operation capability index (sideEffects [], writesTo []) whose handlers only get, list or find:
 *
 * - redispatch-readiness-gate.getRun / getStatus / listRuns
 * - redispatch-special-case-gate.getRun / listRuns
 * - battery-redispatch-special-gate.getGate / listGates
 * - redispatch-settlement-sandbox.getScenario
 * - redispatch-asset-register.getProjection / listProjections / listRelationships
 * - bess-screening.get
 * - flexibilitaetskosten-raster.get / list
 * - flexibility-conductor-role-model.getModel / listModels
 * - rcs-simulation-run.getRun, rcs-rule-catalog.getRuleSet / listRuleSets
 *
 * The `evaluate`, `create*`, `screen`, `reconcile`, `register*`, `plan*` and `execute*` actions of
 * these services record a decision or change state and are never called. Several `get` actions
 * do not check the tenant themselves; their result is accepted only when its `tenantId` is the
 * tenant of the turn, otherwise it counts as not found.
 */

const { tokens, registerUnitNumbers } = require('./detectors');

const READ_TIMEOUT_MS = 1500;
const LIST_LIMIT = 50;
const MAX_RECORDS = 3;
const MAX_IDS = 3;

const ASSET = 'flex.asset';
const MEASURE = 'grid.measure';
const REGISTER_UNIT = 'plant.register_unit';

// ── Reading ──────────────────────────────────────────────────────────────────

const tenantOf = (ctx, context) => ctx.meta?.tenantId || context?.tenantId || 'default';

// One read action within its own budget: a missing record is a result, a failing or slow
// source is reported as unavailable, never thrown.
async function read(ctx, context, action, params) {
  try {
    const value = await ctx.call(action, params, {
      timeout: READ_TIMEOUT_MS,
      meta: { tenantId: tenantOf(ctx, context) },
    });
    return { ok: true, value };
  } catch (error) {
    if (Number(error?.code) === 404) return { ok: true, value: null };
    return { ok: false };
  }
}

// A record of the turn's tenant, or null. Records without a tenant are not accepted.
const ownRecord = (doc, tenant) => (doc && doc.tenantId === tenant ? doc : null);

function newFinding() {
  return { facts: [], relations: [], negatives: [], openQuestions: [], confidence: 0.5 };
}

function merge(target, part) {
  for (const key of ['facts', 'relations', 'negatives', 'openQuestions'])
    target[key].push(...(part[key] || []));
  return target;
}

function fact(statement, { value, unit, role = 'status', basis = 'source', source, ref, quote }) {
  return {
    statement,
    ...(value !== undefined && value !== null ? { value: String(value) } : {}),
    ...(unit ? { unit } : {}),
    role,
    basis,
    provenance: { source, ...(ref ? { ref } : {}), ...(quote ? { quote: String(quote) } : {}) },
  };
}

const scopeOf = (service, tenant, extra = '') =>
  `${service}, Mandant ${tenant}${extra ? `, ${extra}` : ''}`;

function negative(searched, service, tenant, result = 'no_hit', extra = '') {
  return { searched, scope: scopeOf(service, tenant, extra), result };
}

const period = (from, to) => (from || to ? `${from || '?'} – ${to || '?'}` : '');

// Findings of a gate or register record: blocking ones first, at most three.
function recordFindings(rows, source, ref) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.finding || row?.message);
  const ordered = [
    ...list.filter((row) => row.severity === 'error'),
    ...list.filter((row) => row.severity === 'warning'),
  ].slice(0, MAX_RECORDS);
  return ordered.map((row) =>
    fact(`Befund ${row.finding || ''}: ${row.message || ''}`.trim(), {
      value: row.severity,
      role: 'classification',
      source,
      ref,
      quote: row.message,
    })
  );
}

// ── Records → facts ──────────────────────────────────────────────────────────

function readinessFacts(run, source) {
  const id = run._id || run.runId;
  const status = run.status || run.overallStatus;
  const facts = [
    fact(`Redispatch-Readiness-Bewertung ${id} (Prozess ${run.processId}): Status ${status}.`, {
      value: status,
      source,
      ref: id,
    }),
  ];
  if (run.testCallStatus)
    facts.push(
      fact(`Testabruf laut Readiness-Bewertung ${id}: ${run.testCallStatus}.`, {
        value: run.testCallStatus,
        source,
        ref: id,
      })
    );
  if (run.productionProofConfirmed !== undefined)
    facts.push(
      fact(
        `Produktivnachweis laut Readiness-Bewertung ${id}: ${run.productionProofConfirmed ? 'bestätigt' : 'nicht bestätigt'}.`,
        { value: String(Boolean(run.productionProofConfirmed)), source, ref: id }
      )
    );
  if (run.acceptanceDeadline)
    facts.push(
      fact(`Abnahmefrist laut Readiness-Bewertung ${id}.`, {
        value: run.acceptanceDeadline,
        role: 'deadline',
        source,
        ref: id,
      })
    );
  if (run.openQuestionsCount)
    facts.push(
      fact(`Offene Fragen in Readiness-Bewertung ${id}.`, {
        value: run.openQuestionsCount,
        role: 'quantity',
        source,
        ref: id,
      })
    );
  return { facts: [...facts, ...recordFindings(run.findings, source, id)] };
}

function specialCaseFacts(run, source, objectId) {
  const id = run._id;
  const facts = [
    fact(`Sonderfallprüfung ${id} für Einheit ${run.mastrId}: Status ${run.status}.`, {
      value: run.status,
      source,
      ref: id,
    }),
  ];
  const span = period(run.periodStart, run.periodEnd);
  if (span)
    facts.push(
      fact(`Prüfzeitraum der Sonderfallprüfung ${id}.`, {
        value: span,
        role: 'period',
        source,
        ref: id,
      })
    );
  return {
    facts: [...facts, ...recordFindings(run.findings, source, id)],
    relations: run.mastrId
      ? [{ from: objectId, rel: 'refers_to', to: `${ASSET}:${run.mastrId}` }]
      : [],
  };
}

function batteryFacts(gate, source, objectId) {
  const id = gate._id || gate.gateId;
  const facts = [
    fact(`Batteriespeicher-Sondergate ${id} für Anlage ${gate.assetId}: ${gate.evidenceStatus}.`, {
      value: gate.evidenceStatus,
      source,
      ref: id,
    }),
  ];
  if (Array.isArray(gate.missingDataPoints) && gate.missingDataPoints.length)
    facts.push(
      fact(`Fehlende Datenpunkte im Sondergate ${id}.`, {
        value: gate.missingDataPoints.join(', '),
        role: 'explanation',
        source,
        ref: id,
      })
    );
  if (gate.recommendedNextDecision)
    facts.push(
      fact(`Empfohlene nächste Entscheidung laut Sondergate ${id}.`, {
        value: gate.recommendedNextDecision,
        role: 'explanation',
        source,
        ref: id,
        quote: gate.recommendedNextDecision,
      })
    );
  const relations = [];
  if (gate.bessScreeningId)
    relations.push({ from: objectId, rel: 'refers_to', to: `${ASSET}:${gate.bessScreeningId}` });
  return {
    facts: [...facts, ...recordFindings(gate.blockingFindings, source, id)],
    relations,
  };
}

function scenarioFacts(scenario, source) {
  const id = scenario._id;
  const facts = [
    fact(
      `Abrechnungsszenario ${id} (Netzbetreiber ${scenario.gridOperatorId}, Methode ${scenario.settlementMethod}): Status ${scenario.status}.`,
      { value: scenario.status, source, ref: id }
    ),
  ];
  const span = period(scenario.periodStart, scenario.periodEnd);
  if (span)
    facts.push(
      fact(`Zeitraum des Abrechnungsszenarios ${id}.`, {
        value: span,
        role: 'period',
        source,
        ref: id,
      })
    );
  if (scenario.policyVersion)
    facts.push(
      fact(`Policy-Version des Abrechnungsszenarios ${id}.`, {
        value: scenario.policyVersion,
        role: 'reference',
        source,
        ref: id,
      })
    );
  return { facts: [...facts, ...recordFindings(scenario.findings, source, id)] };
}

function projectionFacts(projection, source, objectId) {
  const id = projection._id;
  const facts = [
    fact(
      `Redispatch-Assetprojektion ${id} für Einheit ${projection.mastrId}: ${projection.hasConflict ? 'mit Identifikatorkonflikt' : 'ohne Identifikatorkonflikt'}.`,
      { value: projection.hasConflict ? 'conflict' : 'no_conflict', source, ref: id }
    ),
  ];
  const identifiers = [
    ['technicalResourceId', 'Technische Ressource'],
    ['controllableResourceId', 'Steuerbare Ressource'],
    ['maloId', 'Marktlokation'],
    ['meloId', 'Messlokation'],
  ];
  for (const [field, label] of identifiers)
    if (projection[field])
      facts.push(
        fact(`${label} der Assetprojektion ${id}.`, {
          value: projection[field],
          role: 'identifier',
          source,
          ref: id,
        })
      );
  if (projection.capacityKw !== null && projection.capacityKw !== undefined)
    facts.push(
      fact(`Leistung laut Assetprojektion ${id}.`, {
        value: projection.capacityKw,
        unit: 'kW',
        role: 'quantity',
        source,
        ref: id,
      })
    );
  return {
    facts: [...facts, ...recordFindings(projection.findings, source, id)],
    relations: projection.mastrId
      ? [{ from: objectId, rel: 'refers_to', to: `${REGISTER_UNIT}:${projection.mastrId}` }]
      : [],
  };
}

function relationshipFacts(rows, source, objectId, own) {
  const facts = [];
  const relations = [];
  for (const row of rows.slice(0, MAX_RECORDS)) {
    facts.push(
      fact(`Beziehung ${row.relationshipType} zwischen ${row.assetIdA} und ${row.assetIdB}.`, {
        value: row.relationshipType,
        role: 'reference',
        source,
        ref: row._id,
      })
    );
    const other = own.has(row.assetIdA) ? row.assetIdB : row.assetIdA;
    if (other && !own.has(other))
      relations.push({ from: objectId, rel: 'refers_to', to: `${ASSET}:${other}` });
  }
  return { facts, relations };
}

function bessFacts(screening, source) {
  const id = screening._id;
  const facts = [
    fact(`BESS-Screening ${id}: Evidenzlage ${screening.evidenceReadiness}.`, {
      value: screening.evidenceReadiness,
      source,
      ref: id,
    }),
  ];
  if (screening.request?.powerKw)
    facts.push(
      fact(`Beantragte Leistung im BESS-Screening ${id}.`, {
        value: screening.request.powerKw,
        unit: 'kW',
        role: 'quantity',
        source,
        ref: id,
      })
    );
  if (screening.request?.energyKwh)
    facts.push(
      fact(`Energieinhalt im BESS-Screening ${id}.`, {
        value: screening.request.energyKwh,
        unit: 'kWh',
        role: 'quantity',
        source,
        ref: id,
      })
    );
  for (const proof of (screening.openProofs || []).slice(0, MAX_RECORDS))
    facts.push(
      fact(`Offener Nachweis im BESS-Screening ${id}: ${proof.label || proof.field}.`, {
        value: proof.nextStep,
        role: 'explanation',
        source,
        ref: id,
        quote: proof.nextStep,
      })
    );
  return { facts };
}

function rasterFacts(grid, source) {
  const id = grid._id;
  const summary = grid.summary || {};
  const facts = [
    fact(
      `Flexibilitätskosten-Raster ${id} für ${grid.assetReference}: Zusagereife ${grid.overallCommitmentReadiness}.`,
      { value: grid.overallCommitmentReadiness, source, ref: id }
    ),
  ];
  if (summary.totalOpenEvidence !== undefined)
    facts.push(
      fact(`Offene Nachweise im Flexibilitätskosten-Raster ${id}.`, {
        value: summary.totalOpenEvidence,
        role: 'quantity',
        source,
        ref: id,
      })
    );
  if (summary.minCostEurPerMwh !== null && summary.minCostEurPerMwh !== undefined)
    facts.push(
      fact(`Spanne der Flexibilitätskosten im Raster ${id}.`, {
        value: `${summary.minCostEurPerMwh} – ${summary.maxCostEurPerMwh}`,
        unit: 'EUR/MWh',
        role: 'monetary',
        source,
        ref: id,
      })
    );
  return { facts };
}

function roleModelFacts(model, source) {
  const id = model._id;
  const facts = [
    fact(
      `Flexibilitäts-Rollenmodell ${id} (Prozess ${model.processId}): ${model.evidenceStatus}.`,
      {
        value: model.evidenceStatus,
        source,
        ref: id,
      }
    ),
  ];
  if (Array.isArray(model.missingDataPoints) && model.missingDataPoints.length)
    facts.push(
      fact(`Fehlende Angaben im Rollenmodell ${id}.`, {
        value: model.missingDataPoints.join(', '),
        role: 'explanation',
        source,
        ref: id,
      })
    );
  return { facts: [...facts, ...recordFindings(model.blockingFindings, source, id)] };
}

function ruleSetFact(rule, source) {
  return fact(
    `RCS-Regelsatz ${rule.id} (Version ${rule.version}, Status ${rule.status}, Rechtsstand ${rule.legalStatus}).`,
    {
      value: period(rule.effectiveFrom, rule.effectiveTo || ''),
      role: 'classification',
      basis: 'rule',
      source,
      ref: rule.id,
      quote: rule.sourceReference,
    }
  );
}

async function rcsRunFacts(ctx, context, run, source) {
  const facts = [
    fact(
      `RCS-Simulationslauf ${run.runId}${run.demo ? ' (Demo)' : ''} für ${run.assetName || run.assetId}: Status ${run.status}.`,
      { value: run.status, source, ref: run.runId }
    ),
  ];
  if (run.deletedAt)
    facts.push(
      fact(`RCS-Simulationslauf ${run.runId} ist gelöscht.`, {
        value: run.deletedAt,
        role: 'date',
        source,
        ref: run.runId,
      })
    );
  if (run.ruleSetId) {
    const rule = await read(ctx, context, 'rcs-rule-catalog.getRuleSet', {
      ruleSetId: run.ruleSetId,
    });
    if (rule.ok && rule.value) facts.push(ruleSetFact(rule.value, 'rcs-rule-catalog.getRuleSet'));
  }
  return { facts };
}

// ── Identifiers in an object value ───────────────────────────────────────────

const isHexUuid = (value) =>
  value.length === 36 && [...value].every((ch) => '0123456789abcdef-'.includes(ch));

// Record identifiers as the services generate them: a fixed prefix and a UUID.
const RECORDS = [
  {
    prefix: 'rrg:',
    service: 'redispatch-readiness-gate',
    action: 'redispatch-readiness-gate.getRun',
    params: (id) => ({ id }),
    checksTenant: true,
    facts: (doc, source) => readinessFacts(doc, source),
  },
  {
    prefix: 'rscg:',
    service: 'redispatch-special-case-gate',
    action: 'redispatch-special-case-gate.getRun',
    params: (id) => ({ id }),
    facts: specialCaseFacts,
  },
  {
    prefix: 'brs:',
    service: 'battery-redispatch-special-gate',
    action: 'battery-redispatch-special-gate.getGate',
    params: (gateId) => ({ gateId }),
    checksTenant: true,
    facts: batteryFacts,
  },
  {
    prefix: 'rdss:',
    service: 'redispatch-settlement-sandbox',
    action: 'redispatch-settlement-sandbox.getScenario',
    params: (id) => ({ id }),
    facts: (doc, source) => scenarioFacts(doc, source),
  },
  {
    prefix: 'rdar-proj:',
    service: 'redispatch-asset-register',
    action: 'redispatch-asset-register.getProjection',
    params: (id) => ({ id }),
    facts: projectionFacts,
  },
  {
    prefix: 'bess:',
    service: 'bess-screening',
    action: 'bess-screening.get',
    params: (id) => ({ id }),
    facts: (doc, source) => bessFacts(doc, source),
  },
  {
    prefix: 'fkr:',
    service: 'flexibilitaetskosten-raster',
    action: 'flexibilitaetskosten-raster.get',
    params: (id) => ({ id }),
    facts: (doc, source) => rasterFacts(doc, source),
  },
  {
    prefix: 'fcrm:',
    service: 'flexibility-conductor-role-model',
    action: 'flexibility-conductor-role-model.getModel',
    params: (roleModelId) => ({ roleModelId }),
    checksTenant: true,
    facts: (doc, source) => roleModelFacts(doc, source),
  },
];

// Run identifiers of the RCS simulation: run-<milliseconds>-<eight hex digits>.
function isRcsRunId(token) {
  const parts = token.split('-');
  return (
    parts.length === 3 &&
    parts[0] === 'run' &&
    parts[1].length >= 10 &&
    [...parts[1]].every((ch) => ch >= '0' && ch <= '9') &&
    parts[2].length === 8 &&
    [...parts[2]].every((ch) => '0123456789abcdef'.includes(ch))
  );
}

function identifiers(value) {
  const records = [];
  const rcsRuns = [];
  for (const token of tokens(value)) {
    const record = RECORDS.find(
      (row) => token.startsWith(row.prefix) && isHexUuid(token.slice(row.prefix.length))
    );
    if (record && !records.some((row) => row.id === token)) records.push({ record, id: token });
    else if (isRcsRunId(token) && !rcsRuns.includes(token)) rcsRuns.push(token);
  }
  const units = registerUnitNumbers(value).map((row) => row.value);
  return {
    records: records.slice(0, MAX_IDS),
    rcsRuns: rcsRuns.slice(0, MAX_IDS),
    units: units.slice(0, MAX_IDS),
  };
}

async function resolveRecord(ctx, context, { record, id }, objectId) {
  const tenant = tenantOf(ctx, context);
  const result = await read(ctx, context, record.action, record.params(id));
  if (!result.ok)
    return { negatives: [negative(id, record.service, tenant, 'source_unavailable')] };
  const doc = record.checksTenant ? result.value : ownRecord(result.value, tenant);
  if (!doc) return { negatives: [negative(id, record.service, tenant)] };
  return record.facts(doc, record.action, objectId);
}

async function resolveRcsRun(ctx, context, runId) {
  const tenant = tenantOf(ctx, context);
  const result = await read(ctx, context, 'rcs-simulation-run.getRun', { runId });
  if (!result.ok)
    return { negatives: [negative(runId, 'rcs-simulation-run', tenant, 'source_unavailable')] };
  const run = ownRecord(result.value, tenant);
  if (!run) return { negatives: [negative(runId, 'rcs-simulation-run', tenant)] };
  return rcsRunFacts(ctx, context, run, 'rcs-simulation-run.getRun');
}

function unitFact(unit) {
  return fact(`${unit} hat das Format einer MaStR-Einheitennummer.`, {
    value: unit,
    role: 'identifier',
    basis: 'parsed',
    source: 'format:registerUnitNumbers',
    quote: unit,
  });
}

// A list read with a fact builder per record; no record is a negative with its scope.
async function listed(ctx, context, { action, service, params, pick, searched, extra, build }) {
  const tenant = tenantOf(ctx, context);
  const result = await read(ctx, context, action, params);
  if (!result.ok) return { negatives: [negative(searched, service, tenant, 'source_unavailable')] };
  const rows = pick(result.value || {}).filter((row) => ownRecord(row, tenant));
  if (!rows.length) return { negatives: [negative(searched, service, tenant, 'no_hit', extra)] };
  return rows
    .slice(0, MAX_RECORDS)
    .reduce((finding, row) => merge(finding, build(row, action)), newFinding());
}

const listExtra = `höchstens ${LIST_LIMIT} Einträge`;

function specialCaseRuns(ctx, context, mastrId, objectId) {
  return listed(ctx, context, {
    action: 'redispatch-special-case-gate.listRuns',
    service: 'redispatch-special-case-gate',
    params: { mastrId, limit: LIST_LIMIT },
    pick: (value) => value.runs || [],
    searched: `Sonderfallprüfungen zu ${mastrId}`,
    extra: listExtra,
    build: (row, source) => specialCaseFacts(row, source, objectId),
  });
}

function batteryGates(ctx, context, assetId, objectId) {
  return listed(ctx, context, {
    action: 'battery-redispatch-special-gate.listGates',
    service: 'battery-redispatch-special-gate',
    params: { assetId, limit: LIST_LIMIT },
    pick: (value) => value.gates || [],
    searched: `Batteriespeicher-Sondergates zu ${assetId}`,
    extra: listExtra,
    build: (row, source) => batteryFacts(row, source, objectId),
  });
}

function costGrids(ctx, context, assetReference) {
  return listed(ctx, context, {
    action: 'flexibilitaetskosten-raster.list',
    service: 'flexibilitaetskosten-raster',
    params: { limit: LIST_LIMIT },
    pick: (value) => (value.grids || []).filter((row) => row.assetReference === assetReference),
    searched: `Flexibilitätskosten-Raster zu ${assetReference}`,
    extra: `neueste ${LIST_LIMIT} Raster`,
    build: (row, source) => rasterFacts(row, source),
  });
}

async function relationships(ctx, context, assetIds, objectId) {
  const tenant = tenantOf(ctx, context);
  const own = new Set(assetIds);
  const action = 'redispatch-asset-register.listRelationships';
  const results = await Promise.all(
    assetIds.map((assetId) => read(ctx, context, action, { assetId, limit: LIST_LIMIT }))
  );
  if (results.every((result) => !result.ok))
    return {
      negatives: [
        negative(
          `Beziehungen zu ${assetIds.join(', ')}`,
          'redispatch-asset-register',
          tenant,
          'source_unavailable'
        ),
      ],
    };
  const seen = new Set();
  const rows = results
    .flatMap((result) => (result.ok ? result.value?.relationships || [] : []))
    .filter((row) => ownRecord(row, tenant) && !seen.has(row._id) && seen.add(row._id));
  if (!rows.length)
    return {
      negatives: [
        negative(
          `Beziehungen zu ${assetIds.join(', ')}`,
          'redispatch-asset-register',
          tenant,
          'no_hit',
          listExtra
        ),
      ],
    };
  return relationshipFacts(rows, action, objectId, own);
}

async function assetByUnit(ctx, context, unit, objectId) {
  const finding = merge(newFinding(), { facts: [unitFact(unit)] });
  const projections = await listed(ctx, context, {
    action: 'redispatch-asset-register.listProjections',
    service: 'redispatch-asset-register',
    params: { mastrId: unit, limit: LIST_LIMIT },
    pick: (value) => value.projections || [],
    searched: `Assetprojektionen zu ${unit}`,
    extra: listExtra,
    build: (row, source) => projectionFacts(row, source, objectId),
  });
  merge(finding, projections);
  const projectionIds = (projections.facts || [])
    .filter((row) => row.provenance.source === 'redispatch-asset-register.listProjections')
    .map((row) => row.provenance.ref)
    .filter((ref, index, all) => ref && all.indexOf(ref) === index);
  const parts = await Promise.all([
    relationships(ctx, context, [unit, ...projectionIds], objectId),
    specialCaseRuns(ctx, context, unit, objectId),
    batteryGates(ctx, context, unit, objectId),
    costGrids(ctx, context, unit),
  ]);
  for (const part of parts) merge(finding, part);
  return finding;
}

async function byIdentifiers(ctx, context, object) {
  const found = identifiers(object.value);
  const finding = newFinding();
  const parts = await Promise.all([
    ...found.records.map((row) => resolveRecord(ctx, context, row, object.objectId)),
    ...found.rcsRuns.map((runId) => resolveRcsRun(ctx, context, runId)),
  ]);
  for (const part of parts) merge(finding, part);
  return { finding, found };
}

const askIdentifier = (what, resolves) => ({
  question: `Unter welcher Kennung ist ${what} geführt (MaStR-Einheitennummer oder Vorgangskennung)?`,
  resolves,
});

// ── Expanders ────────────────────────────────────────────────────────────────

async function expandAsset(ctx, object, context) {
  const { finding, found } = await byIdentifiers(ctx, context, object);
  const units = await Promise.all(
    found.units.map((unit) => assetByUnit(ctx, context, unit, object.objectId))
  );
  for (const part of units) merge(finding, part);
  if (!found.records.length && !found.rcsRuns.length && !found.units.length && object.value) {
    // No identifier: the value itself as the asset reference of the gates and cost grids.
    const parts = await Promise.all([
      batteryGates(ctx, context, object.value, object.objectId),
      costGrids(ctx, context, object.value),
      relationships(ctx, context, [object.value], object.objectId),
    ]);
    for (const part of parts) merge(finding, part);
  }
  if (!finding.facts.some((row) => row.basis !== 'parsed'))
    finding.openQuestions.push(askIdentifier('die Anlage', ASSET));
  finding.confidence = finding.facts.length ? 0.8 : 0.3;
  return finding;
}

async function expandMeasure(ctx, object, context) {
  const { finding, found } = await byIdentifiers(ctx, context, object);
  for (const unit of found.units) {
    merge(finding, { facts: [unitFact(unit)] });
    // The unit the measure names is the asset of the measure.
    finding.relations.push({ from: object.objectId, rel: 'refers_to', to: `${ASSET}:${unit}` });
  }
  const runs = await Promise.all(
    found.units.map((unit) => specialCaseRuns(ctx, context, unit, object.objectId))
  );
  for (const part of runs) merge(finding, part);
  if (!found.records.length && !found.rcsRuns.length && !found.units.length && object.value) {
    // No identifier: the value as the process of a readiness evaluation.
    merge(
      finding,
      await listed(ctx, context, {
        action: 'redispatch-readiness-gate.listRuns',
        service: 'redispatch-readiness-gate',
        params: { processId: object.value, limit: LIST_LIMIT },
        pick: (value) => value.runs || [],
        searched: `Readiness-Bewertungen zum Prozess ${object.value}`,
        extra: listExtra,
        build: (row, source) => readinessFacts(row, source),
      })
    );
  }
  if (!finding.facts.some((row) => row.basis !== 'parsed'))
    finding.openQuestions.push(askIdentifier('die Maßnahme', MEASURE));
  finding.confidence = finding.facts.length ? 0.8 : 0.3;
  return finding;
}

// The person's question: the state of the area for the tenant. As a consequence check only what
// blocks (gates and evaluations that a finding of another area could hit).
async function expandConcern(ctx, object, context) {
  const tenant = tenantOf(ctx, context);
  const consequence = Boolean(context.consequenceOf);
  const finding = newFinding();
  const [readiness, gates, special, models, rules] = await Promise.all([
    read(ctx, context, 'redispatch-readiness-gate.getStatus', {}),
    read(ctx, context, 'battery-redispatch-special-gate.listGates', { limit: LIST_LIMIT }),
    read(ctx, context, 'redispatch-special-case-gate.listRuns', {
      status: 'blocked',
      limit: LIST_LIMIT,
    }),
    consequence
      ? null
      : read(ctx, context, 'flexibility-conductor-role-model.listModels', { limit: LIST_LIMIT }),
    consequence ? null : read(ctx, context, 'rcs-rule-catalog.listRuleSets', {}),
  ]);

  const status = readiness.ok ? readiness.value : null;
  if (!readiness.ok)
    finding.negatives.push(
      negative(
        'Redispatch-Readiness-Bewertung',
        'redispatch-readiness-gate',
        tenant,
        'source_unavailable'
      )
    );
  else if (!status?.found)
    finding.negatives.push(
      negative('Redispatch-Readiness-Bewertung', 'redispatch-readiness-gate', tenant)
    );
  else if (!consequence || status.overallStatus !== 'ready')
    merge(finding, readinessFacts(status, 'redispatch-readiness-gate.getStatus'));

  const gateRows = gates.ok
    ? (gates.value?.gates || []).filter((row) => ownRecord(row, tenant))
    : [];
  const blockedGates = gateRows.filter((row) => row.evidenceStatus === 'blocked');
  if (!gates.ok)
    finding.negatives.push(
      negative(
        'Batteriespeicher-Sondergates',
        'battery-redispatch-special-gate',
        tenant,
        'source_unavailable'
      )
    );
  else if (gateRows.length && !consequence)
    finding.facts.push(
      fact(`Blockierte Batteriespeicher-Sondergates (von ${gateRows.length}).`, {
        value: blockedGates.length,
        role: 'quantity',
        source: 'battery-redispatch-special-gate.listGates',
      })
    );
  for (const gate of blockedGates.slice(0, MAX_RECORDS))
    merge(
      finding,
      batteryFacts(gate, 'battery-redispatch-special-gate.listGates', object.objectId)
    );

  const blockedRuns = special.ok
    ? (special.value?.runs || []).filter((row) => ownRecord(row, tenant))
    : [];
  if (!special.ok)
    finding.negatives.push(
      negative(
        'Blockierte Sonderfallprüfungen',
        'redispatch-special-case-gate',
        tenant,
        'source_unavailable'
      )
    );
  for (const run of blockedRuns.slice(0, MAX_RECORDS))
    merge(finding, specialCaseFacts(run, 'redispatch-special-case-gate.listRuns', object.objectId));

  if (consequence) {
    if (!finding.facts.length) {
      finding.negatives.push(
        negative(
          'Blockierende Redispatch- und Flexibilitätsvorgänge',
          'redispatch-readiness-gate, battery-redispatch-special-gate, redispatch-special-case-gate',
          tenant
        )
      );
      finding.openQuestions.push(askIdentifier('die betroffene Maßnahme oder Anlage', MEASURE));
    }
  } else {
    if (special.ok && !blockedRuns.length)
      finding.negatives.push(
        negative(
          'Blockierte Sonderfallprüfungen',
          'redispatch-special-case-gate',
          tenant,
          'no_hit',
          listExtra
        )
      );
    const latestModel = models?.ok
      ? (models.value?.models || []).find((row) => ownRecord(row, tenant))
      : null;
    if (latestModel)
      merge(finding, roleModelFacts(latestModel, 'flexibility-conductor-role-model.listModels'));
    const ruleSets = rules?.ok ? rules.value?.items || [] : [];
    const latestRule = ruleSets.find((row) => row.id === rules.value?.latestRuleSetId);
    if (latestRule) finding.facts.push(ruleSetFact(latestRule, 'rcs-rule-catalog.listRuleSets'));
  }
  finding.confidence = finding.facts.length ? 0.7 : 0.3;
  return finding;
}

// ── Playbooks ────────────────────────────────────────────────────────────────

// Follow-up objects a finding references through its relations, never the object itself.
function referenced(finding, object, kinds) {
  const seen = new Set([`${object?.kind}:${object?.value}`]);
  const next = [];
  for (const relation of finding?.relations || []) {
    const kind = kinds.find((row) => String(relation.to).startsWith(`${row}:`));
    if (!kind || seen.has(relation.to)) continue;
    seen.add(relation.to);
    next.push({ kind, value: relation.to.slice(kind.length + 1) });
  }
  return next;
}

module.exports = {
  expanders: {
    [ASSET]: expandAsset,
    [MEASURE]: expandMeasure,
    concern: expandConcern,
  },
  playbooks: [
    // A measure names its asset (special-case run, MaStR unit) → the asset.
    { from: MEASURE, next: (finding, object) => referenced(finding, object, [ASSET]) },
    // An asset references its MaStR unit (projection), its screening (battery gate) or a
    // related asset (co-location, shared grid connection point) → those objects.
    {
      from: ASSET,
      next: (finding, object) => referenced(finding, object, [REGISTER_UNIT, ASSET]),
    },
  ],
};
