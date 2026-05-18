'use strict';

/**
 * Presentation Service (#CETview Step 1)
 *
 * Translates domain results into structured, management-grade human views.
 * Deterministic: no LLM calls, no invented facts or roles.
 *
 * Supported renderer types (Step 1):
 *   - kpi_fact           — single value / count with source and timestamp
 *   - debug_summary      — fallback structured dump (no large JSON blobs)
 *
 * Stubs (routing works, renderer returns not-implemented warning):
 *   - vdmi_matrix_table
 *   - comparison_table
 *   - decision_brief
 *   - risk_table
 *   - evidence_gap_table
 *
 * REST: POST /api/presentation/render
 */

const OPENAPI_TAG = 'Presentation';

const VALID_FORMATS = new Set([
  'auto',
  'kpi_fact',
  'comparison_table',
  'vdmi_matrix_table',
  'decision_brief',
  'risk_table',
  'evidence_gap_table',
  'debug_summary',
]);

// ---------------------------------------------------------------------------
// Format selection
// ---------------------------------------------------------------------------

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasAny(obj, keys) {
  return keys.some((key) => obj[key] !== undefined && obj[key] !== null && obj[key] !== '');
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return undefined;
}

function hasVdmiRoleFields(task) {
  if (!task || typeof task !== 'object') return false;
  return (
    Array.isArray(task.verantwortlich)
    || Array.isArray(task.durchfuehrend)
    || Array.isArray(task.mitwirkend)
    || Array.isArray(task.information)
  );
}

function hasDecisionSignals(domainResult) {
  const dr = domainResult || {};
  if (isNonEmptyArray(dr.forbiddenAssumptions)) return true;
  if (dr.decisionStatus !== undefined && dr.decisionStatus !== null && String(dr.decisionStatus).trim() !== '') {
    return true;
  }
  if (dr.expectedStatus !== undefined && dr.expectedStatus !== null && String(dr.expectedStatus).trim() !== '') {
    return true;
  }
  if (dr.status !== undefined && dr.status !== null) {
    const normalized = String(dr.status).toLowerCase();
    if (normalized.includes('blocked') || normalized.includes('decision')) {
      return true;
    }
  }
  return false;
}

function hasComparisonSignals(domainResult) {
  const dr = domainResult || {};
  return (
    (Array.isArray(dr.items) && dr.items.length > 1)
    || (Array.isArray(dr.rows) && dr.rows.length > 1)
    || (Array.isArray(dr.peers) && dr.peers.length > 1)
    || (Array.isArray(dr.variants) && dr.variants.length > 1)
  );
}

function hasKpiSignals(domainResult) {
  const dr = domainResult || {};
  const hasMetricCore = hasAny(dr, ['count', 'value', 'metric', 'answer']);
  const hasSupport = hasAny(dr, ['unit', 'source', 'sources', 'asOf', 'stand', 'timestamp']);
  return hasMetricCore && hasSupport;
}

/**
 * Deterministic renderer selection.
 *
 * @param {object} input
 * @param {string} [input.preferredFormat]
 * @param {string} [input.intent]
 * @param {object} input.domainResult
 * @returns {{ type: string, warnings: string[] }}
 */
function selectRenderer({ preferredFormat, intent, domainResult }) {
  const warnings = [];
  const dr = domainResult || {};

  if (preferredFormat && preferredFormat !== 'auto') {
    if (VALID_FORMATS.has(preferredFormat)) {
      return { type: preferredFormat, warnings };
    }
    warnings.push('unknown_preferred_format');
    return { type: 'debug_summary', warnings };
  }

  // 1) VDMI matrix
  const matrixTasks = dr.matrix && Array.isArray(dr.matrix.tasks) ? dr.matrix.tasks : null;
  if (Array.isArray(matrixTasks)) {
    return { type: 'vdmi_matrix_table', warnings };
  }

  const tasks = Array.isArray(dr.tasks) ? dr.tasks : null;
  if (isNonEmptyArray(tasks) && tasks.some(hasVdmiRoleFields)) {
    return { type: 'vdmi_matrix_table', warnings };
  }

  // 2) decision brief
  if (hasDecisionSignals(dr)) {
    return { type: 'decision_brief', warnings };
  }

  // 3) evidence gaps
  if (isNonEmptyArray(dr.evidenceGaps)) {
    return { type: 'evidence_gap_table', warnings };
  }

  // 4) risk table
  if (isNonEmptyArray(dr.assetRisks) || isNonEmptyArray(dr.risks)) {
    return { type: 'risk_table', warnings };
  }

  // 5) comparison
  if (hasComparisonSignals(dr)) {
    return { type: 'comparison_table', warnings };
  }

  // 6) kpi_fact
  if (hasKpiSignals(dr)) {
    return { type: 'kpi_fact', warnings };
  }

  return { type: 'debug_summary', warnings };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Build a simple Markdown table from rows of { field, value }.
 */
function markdownTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${row.map((cell) => String(cell ?? '—')).join(' | ')} |`)
    .join('\n');
  return [header, separator, body].join('\n');
}

/**
 * kpi_fact renderer
 *
 * Input fields used (all optional except at least one of value/count):
 *   domainResult.label     — metric label
 *   domainResult.value     — numeric or string result
 *   domainResult.count     — numeric count (alternative to value)
 *   domainResult.unit      — unit string
 *   domainResult.area      — geographic area or scope
 *   domainResult.source    — data source identifier
 *   domainResult.asOf      — ISO timestamp or date string
 *   domainResult.note      — optional short note
 */
function renderKpiFact(domainResult, context, locale) {
  const dr = domainResult || {};
  const warnings = [];

  const metricValue = firstDefined(dr, ['value', 'count', 'metric', 'answer']);
  const displayValue = metricValue !== undefined
    ? `${metricValue}${dr.unit ? ' ' + dr.unit : ''}`
    : null;

  if (displayValue === null) {
    warnings.push('kpi_fact_missing_value: domainResult.value and domainResult.count are both absent');
  }

  const label = dr.label || context?.label || 'Ergebnis';
  const title = label;

  const tableRows = [];
  if (displayValue !== null) tableRows.push(['Antwort', displayValue]);
  if (dr.area) tableRows.push(['Gebiet', dr.area]);
  if (dr.source) tableRows.push(['Quelle', dr.source]);
  if (dr.asOf) tableRows.push(['Stand', dr.asOf]);
  if (dr.note) tableRows.push(['Hinweis', dr.note]);

  if (!dr.source && !isNonEmptyArray(dr.sources)) {
    warnings.push('missing_source');
  }
  if (!dr.asOf && !dr.stand && !dr.timestamp) {
    warnings.push('missing_as_of');
  }

  if (tableRows.length === 0) {
    warnings.push('insufficient_structured_data');
  }

  const kpis = displayValue !== null
    ? [{ label, value: metricValue, unit: dr.unit || null, displayValue }]
    : [];

  const tableMarkdown = tableRows.length > 0
    ? markdownTable(['Feld', 'Wert'], tableRows)
    : '';

  const summaryParts = [];
  if (displayValue !== null) summaryParts.push(`**${label}:** ${displayValue}`);
  if (dr.area) summaryParts.push(`Gebiet: ${dr.area}`);
  const summary = summaryParts.join(' · ') || 'Keine auswertbaren Felder im Ergebnis.';

  const markdownParts = [`## ${title}`, '', summary];
  if (tableMarkdown) {
    markdownParts.push('', tableMarkdown);
  }
  if (dr.source) {
    markdownParts.push('', `*Quelle: ${dr.source}*`);
  }
  const markdown = markdownParts.join('\n');

  return {
    success: true,
    presentation: {
      type: 'kpi_fact',
      title,
      summary,
      kpis,
      tables: tableRows.length > 0 ? [{ id: 'kpi_main', rows: tableRows, headers: ['Feld', 'Wert'] }] : [],
      sections: [],
      warnings,
      sources: dr.source ? [dr.source] : (isNonEmptyArray(dr.sources) ? dr.sources : []),
      nextActions: [],
    },
    markdown,
  };
}

/**
 * debug_summary renderer
 *
 * Produces a short, scannable summary without dumping large JSON blobs.
 */
function renderDebugSummary(domainResult, context) {
  const dr = domainResult || {};
  const warnings = ['debug_summary_fallback: no specific renderer matched the domainResult shape'];

  // Surface top-level non-object keys only (avoid large blobs)
  const scalarFields = Object.entries(dr).filter(
    ([, v]) => v === null || typeof v !== 'object' || (typeof v === 'string')
  );
  const objectKeys = Object.keys(dr).filter((k) => {
    const v = dr[k];
    return v !== null && typeof v === 'object';
  });

  const summary = scalarFields.length > 0
    ? `Domain-Ergebnis (Felder: ${scalarFields.map(([k]) => k).join(', ')})`
    : 'Domain-Ergebnis ohne skalare Felder.';

  const sections = [];
  if (scalarFields.length > 0) {
    const rows = scalarFields.map(([k, v]) => [k, String(v)]);
    sections.push({
      id: 'scalar_fields',
      title: 'Skalare Felder',
      content: markdownTable(['Feld', 'Wert'], rows),
    });
  }
  if (objectKeys.length > 0) {
    sections.push({
      id: 'object_keys',
      title: 'Weitere Felder (Objekte/Arrays)',
      content: objectKeys.map((k) => `- \`${k}\``).join('\n'),
    });
  }

  const markdownParts = ['## Debug-Zusammenfassung', '', summary];
  for (const sec of sections) {
    markdownParts.push('', `### ${sec.title}`, '', sec.content);
  }
  if (objectKeys.length > 0) {
    markdownParts.push('', '> Hinweis: Objekt-/Array-Felder sind nicht ausgeschrieben, um die Ausgabe lesbar zu halten.');
  }
  const markdown = markdownParts.join('\n');

  return {
    success: true,
    presentation: {
      type: 'debug_summary',
      title: 'Debug-Zusammenfassung',
      summary,
      kpis: [],
      tables: [],
      sections,
      warnings,
      sources: [],
      nextActions: [],
    },
    markdown,
  };
}

function formatActorValue(actor) {
  if (actor === null || actor === undefined) return '—';
  if (typeof actor === 'string') {
    const trimmed = actor.trim();
    return trimmed || '—';
  }
  if (typeof actor === 'object') {
    return firstDefined(actor, ['displayName', 'name', 'actorId', 'id']) || '—';
  }
  return String(actor);
}

function formatActorList(value) {
  if (!Array.isArray(value) || value.length === 0) return '—';
  const mapped = value.map((actor) => formatActorValue(actor)).filter((entry) => entry && entry !== '');
  return mapped.length > 0 ? mapped.join(', ') : '—';
}

function getStepDescription(task, warnings) {
  const description = firstDefined(task || {}, ['taskName', 'description', 'taskId']);
  if (description) return String(description);
  warnings.push('missing_step_description');
  return 'Unbenannter Schritt';
}

function toSafeActionLabel(action) {
  if (typeof action === 'string') {
    const trimmed = action.trim();
    return trimmed || 'Unbenannte Aktion';
  }
  if (action && typeof action === 'object') {
    const preferred = firstDefined(action, ['label', 'title', 'description', 'id']);
    if (preferred) return String(preferred);
    const keys = Object.keys(action);
    if (keys.length > 0 && keys.length <= 4) {
      const compact = {};
      for (const key of keys) {
        const value = action[key];
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
          compact[key] = value;
        }
      }
      const compactKeys = Object.keys(compact);
      if (compactKeys.length > 0) {
        const serialized = JSON.stringify(compact);
        if (serialized.length <= 120) {
          return serialized;
        }
      }
    }
  }
  return 'Unbenannte Aktion';
}

function normalizeCompareText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function signatureFromObject(obj, preferredKeys = []) {
  const first = firstDefined(obj || {}, preferredKeys);
  if (first !== undefined && first !== null && String(first).trim() !== '') {
    return normalizeCompareText(first);
  }
  return normalizeCompareText(stableStringify(obj));
}

function dedupeBySignature(entries, keyFn) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = keyFn(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Deterministic VDMI matrix renderer.
 */
function renderVdmiMatrix(domainResult) {
  const dr = domainResult || {};
  const matrix = dr.matrix && typeof dr.matrix === 'object' ? dr.matrix : null;
  const tasks = matrix && Array.isArray(matrix.tasks)
    ? matrix.tasks
    : (Array.isArray(dr.tasks) ? dr.tasks : []);
  const warnings = [];
  const title = 'VDMI-Prozessübersicht';

  if (tasks.length === 0) {
    warnings.push('missing_vdmi_tasks');
    return {
      success: true,
      presentation: {
        type: 'vdmi_matrix_table',
        title,
        summary: 'Keine VDMI-Schritte vorhanden.',
        kpis: [],
        tables: [],
        sections: [],
        warnings,
        sources: [],
        nextActions: [],
      },
      markdown: [
        `## ${title}`,
        '',
        'Keine VDMI-Schritte vorhanden.',
      ].join('\n'),
    };
  }

  const roleHeaders = [
    'Beschreibung des Schrittes',
    'Verantwortlich',
    'Durchführend',
    'Mitwirkend',
    'Informiert',
  ];

  const roleRows = tasks.map((task) => {
    const step = getStepDescription(task, warnings);
    if (!Array.isArray(task?.verantwortlich)) warnings.push('missing_role_field_verantwortlich');
    if (!Array.isArray(task?.durchfuehrend)) warnings.push('missing_role_field_durchfuehrend');
    if (!Array.isArray(task?.mitwirkend)) warnings.push('missing_role_field_mitwirkend');
    if (!Array.isArray(task?.information)) warnings.push('missing_role_field_information');
    return [
      step,
      formatActorList(task?.verantwortlich),
      formatActorList(task?.durchfuehrend),
      formatActorList(task?.mitwirkend),
      formatActorList(task?.information),
    ];
  });

  const sections = [];
  const tables = [{
    id: 'vdmi_roles',
    headers: roleHeaders,
    rows: roleRows,
  }];

  const topExpectedStatus = firstDefined(dr, ['expectedStatus']);
  const topStatus = firstDefined(dr, ['status']);
  const matrixStatus = firstDefined(matrix || {}, ['status']);
  const summaryStatus = firstDefined(
    {
      matrixStatus,
      topExpectedStatus,
      topStatus,
    },
    ['matrixStatus', 'topExpectedStatus', 'topStatus']
  );

  const evidenceEntries = [];
  const pushEvidence = (scope, item) => {
    if (item === null || item === undefined) return;
    if (item && typeof item === 'object') {
      const label = firstDefined(item, ['label', 'name', 'description', 'text', 'code', 'id']) || '—';
      const reason = firstDefined(item, ['reason', 'detail', 'message', 'description', 'text']) || '—';
      const entitySig = signatureFromObject(item, ['label', 'name', 'description', 'text', 'code', 'id']);
      const reasonSig = normalizeCompareText(reason);
      evidenceEntries.push({
        scope,
        label: String(label),
        reason: String(reason),
        signature: `${entitySig}::${reasonSig}`,
      });
      return;
    }
    const text = String(item);
    evidenceEntries.push({
      scope,
      label: text,
      reason: '—',
      signature: `${normalizeCompareText(text)}::`,
    });
  };

  for (const task of tasks) {
    const scope = getStepDescription(task, warnings);
    const taskRequirements = isNonEmptyArray(task?.evidenceRequirements) ? task.evidenceRequirements : [];
    const taskGaps = isNonEmptyArray(task?.evidenceGaps) ? task.evidenceGaps : [];
    for (const req of taskRequirements) pushEvidence(scope, req);
    for (const gap of taskGaps) pushEvidence(scope, gap);
  }
  if (isNonEmptyArray(dr.evidenceRequirements)) {
    for (const req of dr.evidenceRequirements) pushEvidence('Prozess', req);
  }
  if (isNonEmptyArray(dr.evidenceGaps)) {
    for (const gap of dr.evidenceGaps) pushEvidence('Prozess', gap);
  }

  const dedupedEvidence = dedupeBySignature(evidenceEntries, (entry) => entry.signature);
  if (dedupedEvidence.length > 0) {
    const hasMixedScopes = new Set(dedupedEvidence.map((entry) => entry.scope)).size > 1;
    const evidenceHeaders = hasMixedScopes
      ? ['Bezug', 'Evidenz / Lücke', 'Grund']
      : ['Evidenz / Lücke', 'Grund'];
    const evidenceRows = dedupedEvidence.map((entry) => (
      hasMixedScopes
        ? [entry.scope, entry.label, entry.reason]
        : [entry.label, entry.reason]
    ));
    tables.push({ id: 'vdmi_evidence', headers: evidenceHeaders, rows: evidenceRows });
    sections.push({
      id: 'evidence_gaps',
      title: 'Evidenzlücken',
      content: markdownTable(evidenceHeaders, evidenceRows),
    });
  }

  const assumptionEntries = [];
  const pushAssumption = (scope, assumption) => {
    if (assumption === null || assumption === undefined) return;
    const text = String(assumption).trim();
    if (!text) return;
    assumptionEntries.push({
      scope,
      text,
      signature: normalizeCompareText(text),
    });
  };
  for (const task of tasks) {
    const scope = getStepDescription(task, warnings);
    const assumptions = isNonEmptyArray(task?.forbiddenAssumptions) ? task.forbiddenAssumptions : [];
    for (const assumption of assumptions) pushAssumption(scope, assumption);
  }
  if (isNonEmptyArray(dr.forbiddenAssumptions)) {
    for (const assumption of dr.forbiddenAssumptions) pushAssumption('Prozess', assumption);
  }
  const dedupedAssumptions = dedupeBySignature(assumptionEntries, (entry) => entry.signature);
  if (dedupedAssumptions.length > 0) {
    const hasMixedScopes = new Set(dedupedAssumptions.map((entry) => entry.scope)).size > 1;
    const assumptionHeaders = hasMixedScopes ? ['Bezug', 'Verbotene Annahme'] : ['Verbotene Annahme'];
    const assumptionRows = dedupedAssumptions.map((entry) => (
      hasMixedScopes
        ? [entry.scope, entry.text]
        : [entry.text]
    ));
    tables.push({ id: 'vdmi_forbidden_assumptions', headers: assumptionHeaders, rows: assumptionRows });
    sections.push({
      id: 'forbidden_assumptions',
      title: 'Verbotene Annahmen',
      content: markdownTable(assumptionHeaders, assumptionRows),
    });
  }

  const nextActionEntries = [];
  const pushNextAction = (scope, action) => {
    if (action === null || action === undefined) return;
    const label = toSafeActionLabel(action);
    const type = action && typeof action === 'object' ? (firstDefined(action, ['type']) || '—') : '—';
    const actionSig = action && typeof action === 'object'
      ? signatureFromObject(action, ['label', 'title', 'description', 'action', 'text', 'code', 'id'])
      : normalizeCompareText(label);
    nextActionEntries.push({
      scope,
      label,
      type: String(type),
      signature: `${actionSig}::${normalizeCompareText(label)}`,
    });
  };
  for (const task of tasks) {
    const scope = getStepDescription(task, warnings);
    const taskActions = isNonEmptyArray(task?.nextActions) ? task.nextActions : [];
    for (const action of taskActions) pushNextAction(scope, action);
  }
  if (isNonEmptyArray(dr.nextActions)) {
    for (const action of dr.nextActions) pushNextAction('Prozess', action);
  }
  const dedupedNextActions = dedupeBySignature(nextActionEntries, (entry) => entry.signature);
  if (dedupedNextActions.length > 0) {
    const hasMixedScopes = new Set(dedupedNextActions.map((entry) => entry.scope)).size > 1;
    const hasType = dedupedNextActions.some((entry) => entry.type && entry.type !== '—');
    const nextActionHeaders = hasMixedScopes
      ? (hasType ? ['Bezug', 'Nächster Schritt', 'Typ'] : ['Bezug', 'Nächster Schritt'])
      : (hasType ? ['Nächster Schritt', 'Typ'] : ['Nächster Schritt']);

    const nextActionRows = dedupedNextActions.map((entry) => {
      if (hasMixedScopes && hasType) return [entry.scope, entry.label, entry.type];
      if (hasMixedScopes) return [entry.scope, entry.label];
      if (hasType) return [entry.label, entry.type];
      return [entry.label];
    });

    tables.push({ id: 'vdmi_next_actions', headers: nextActionHeaders, rows: nextActionRows });
    sections.push({
      id: 'next_actions',
      title: 'Nächste Schritte',
      content: markdownTable(nextActionHeaders, nextActionRows),
    });
  }

  const riskEntries = [];
  const pushRisk = (scope, risk) => {
    if (risk === null || risk === undefined) return;
    if (risk && typeof risk === 'object') {
      const label = firstDefined(risk, ['id', 'code', 'label', 'name', 'risk', 'description', 'text']) || '—';
      const impact = firstDefined(risk, ['impact', 'wirkung', 'detail', 'reason', 'message']) || '—';
      const mitigation = firstDefined(risk, ['mitigation', 'countermeasure', 'gegenmassnahme', 'gegenmaßnahme']) || '—';
      const sig = signatureFromObject(risk, ['id', 'code', 'label', 'name', 'risk', 'description', 'text']);
      riskEntries.push({
        scope,
        label: String(label),
        impact: String(impact),
        mitigation: String(mitigation),
        signature: `${sig}::${normalizeCompareText(impact)}::${normalizeCompareText(mitigation)}`,
      });
      return;
    }
    const text = String(risk);
    riskEntries.push({
      scope,
      label: text,
      impact: '—',
      mitigation: '—',
      signature: normalizeCompareText(text),
    });
  };
  for (const task of tasks) {
    const scope = getStepDescription(task, warnings);
    if (isNonEmptyArray(task?.assetRisks)) {
      for (const risk of task.assetRisks) pushRisk(scope, risk);
    }
    if (isNonEmptyArray(task?.risks)) {
      for (const risk of task.risks) pushRisk(scope, risk);
    }
  }
  if (isNonEmptyArray(dr.assetRisks)) {
    for (const risk of dr.assetRisks) pushRisk('Prozess', risk);
  }
  if (isNonEmptyArray(dr.risks)) {
    for (const risk of dr.risks) pushRisk('Prozess', risk);
  }
  const dedupedRisks = dedupeBySignature(riskEntries, (entry) => entry.signature);
  if (dedupedRisks.length > 0) {
    const hasMixedScopes = new Set(dedupedRisks.map((entry) => entry.scope)).size > 1;
    const riskHeaders = hasMixedScopes
      ? ['Bezug', 'Risiko', 'Wirkung', 'Gegenmaßnahme']
      : ['Risiko', 'Wirkung', 'Gegenmaßnahme'];
    const riskRows = dedupedRisks.map((entry) => (
      hasMixedScopes
        ? [entry.scope, entry.label, entry.impact, entry.mitigation]
        : [entry.label, entry.impact, entry.mitigation]
    ));
    tables.push({ id: 'vdmi_risks', headers: riskHeaders, rows: riskRows });
    sections.push({
      id: 'risks',
      title: 'Risiken',
      content: markdownTable(riskHeaders, riskRows),
    });
  }

  const summary = summaryStatus !== undefined
    ? `VDMI-Prozess mit ${tasks.length} Schritten. Status: ${String(summaryStatus)}.`
    : `VDMI-Prozess mit ${tasks.length} Schritten.`;
  const uniqueWarnings = [...new Set(warnings)];

  const markdownParts = [
    `## ${title}`,
    '',
    summary,
    '',
    markdownTable(roleHeaders, roleRows),
  ];
  for (const section of sections) {
    markdownParts.push('', `### ${section.title}`, '', section.content);
  }

  return {
    success: true,
    presentation: {
      type: 'vdmi_matrix_table',
      title,
      summary,
      kpis: [],
      tables,
      sections,
      warnings: uniqueWarnings,
      sources: [],
      nextActions: dedupedNextActions.map((entry) => ({
        step: entry.scope,
        label: entry.label,
        type: entry.type,
      })),
    },
    markdown: markdownParts.join('\n'),
  };
}

function renderEvidenceGapTableStub(domainResult) {
  const dr = domainResult || {};
  const gaps = isNonEmptyArray(dr.evidenceGaps) ? dr.evidenceGaps : [];
  const warnings = ['evidence_gap_table_renderer_not_implemented_yet'];

  const rows = gaps.map((gap) => {
    if (gap && typeof gap === 'object') {
      return [
        firstDefined(gap, ['name', 'label', 'code', 'id']) || '—',
        firstDefined(gap, ['reason', 'detail', 'message']) || '—',
      ];
    }
    return [String(gap), '—'];
  });

  if (rows.length === 0) {
    warnings.push('insufficient_structured_data');
  }

  const tables = rows.length > 0
    ? [{ id: 'evidence_gaps', headers: ['Evidenzlücke', 'Grund'], rows }]
    : [];

  const markdown = [
    '## Evidenzlücken (Stub)',
    '',
    '> **Hinweis:** `evidence_gap_table_renderer_not_implemented_yet`',
    '',
    rows.length > 0 ? markdownTable(['Evidenzlücke', 'Grund'], rows) : '- Keine strukturierten Evidenzlücken vorhanden.',
  ].join('\n');

  return {
    success: true,
    presentation: {
      type: 'evidence_gap_table',
      title: 'Evidenzlücken (Stub)',
      summary: rows.length > 0 ? `${rows.length} Evidenzlücken erkannt.` : 'Keine auswertbaren Evidenzlücken.',
      kpis: [],
      tables,
      sections: [],
      warnings,
      sources: [],
      nextActions: [],
    },
    markdown,
  };
}

function renderRiskTableStub(domainResult) {
  const dr = domainResult || {};
  const risks = isNonEmptyArray(dr.assetRisks) ? dr.assetRisks : (isNonEmptyArray(dr.risks) ? dr.risks : []);
  const warnings = ['risk_table_renderer_not_implemented_yet'];

  const rows = risks.map((risk) => {
    if (risk && typeof risk === 'object') {
      return [
        firstDefined(risk, ['name', 'risk', 'label', 'id']) || '—',
        firstDefined(risk, ['impact', 'wirkung']) || '—',
        firstDefined(risk, ['mitigation', 'countermeasure', 'gegenmassnahme', 'gegenmaßnahme']) || '—',
      ];
    }
    return [String(risk), '—', '—'];
  });

  if (rows.length === 0) {
    warnings.push('insufficient_structured_data');
  }

  const tables = rows.length > 0
    ? [{ id: 'risk_list', headers: ['Risiko', 'Wirkung', 'Gegenmaßnahme'], rows }]
    : [];

  const markdown = [
    '## Risikoübersicht (Stub)',
    '',
    '> **Hinweis:** `risk_table_renderer_not_implemented_yet`',
    '',
    rows.length > 0 ? markdownTable(['Risiko', 'Wirkung', 'Gegenmaßnahme'], rows) : '- Keine strukturierten Risiken vorhanden.',
  ].join('\n');

  return {
    success: true,
    presentation: {
      type: 'risk_table',
      title: 'Risikoübersicht (Stub)',
      summary: rows.length > 0 ? `${rows.length} Risiken erkannt.` : 'Keine auswertbaren Risiken.',
      kpis: [],
      tables,
      sections: [],
      warnings,
      sources: [],
      nextActions: [],
    },
    markdown,
  };
}

function renderDecisionBriefStub(domainResult) {
  const dr = domainResult || {};
  const warnings = ['decision_brief_renderer_not_implemented_yet'];
  if (isNonEmptyArray(dr.warnings)) {
    for (const warning of dr.warnings) {
      if (typeof warning === 'string' && warning.trim()) {
        warnings.push(warning.trim());
      }
    }
  }

  const sources = dr.source
    ? [dr.source]
    : (isNonEmptyArray(dr.sources) ? dr.sources : []);

  const sections = [];
  const tables = [];

  const decisionStatus = firstDefined(dr, ['decisionStatus']);
  const expectedStatus = firstDefined(dr, ['expectedStatus', 'status']);
  const forbiddenAssumptions = isNonEmptyArray(dr.forbiddenAssumptions) ? dr.forbiddenAssumptions : [];
  const nextActions = isNonEmptyArray(dr.nextActions) ? dr.nextActions : [];
  const riskItems = isNonEmptyArray(dr.assetRisks) ? dr.assetRisks : (isNonEmptyArray(dr.risks) ? dr.risks : []);
  const evidenceRequirements = isNonEmptyArray(dr.evidenceRequirements) ? dr.evidenceRequirements : [];
  const evidenceGaps = isNonEmptyArray(dr.evidenceGaps) ? dr.evidenceGaps : [];

  if (decisionStatus !== undefined || expectedStatus !== undefined) {
    const lines = [];
    if (decisionStatus !== undefined) {
      lines.push(`- Entscheidungsstatus: ${String(decisionStatus)}`);
    }
    if (expectedStatus !== undefined) {
      lines.push(`- Erwarteter Status: ${String(expectedStatus)}`);
    }
    if (dr.asOf) {
      lines.push(`- Stand: ${String(dr.asOf)}`);
    }
    sections.push({
      id: 'decision_status',
      title: 'Status',
      content: lines.join('\n'),
    });
  }

  if (riskItems.length > 0) {
    const riskRows = riskItems.map((item) => {
      if (item && typeof item === 'object') {
        return [
          firstDefined(item, ['risk', 'name', 'label', 'id']) || '—',
          firstDefined(item, ['severity', 'level', 'priority']) || '—',
          firstDefined(item, ['impact', 'wirkung']) || '—',
          firstDefined(item, ['mitigation', 'countermeasure', 'gegenmassnahme', 'gegenmaßnahme']) || '—',
        ];
      }
      return [String(item), '—', '—', '—'];
    });

    tables.push({
      id: 'decision_risks',
      headers: ['Risiko', 'Schweregrad', 'Wirkung', 'Gegenmaßnahme'],
      rows: riskRows,
    });

    sections.push({
      id: 'risk_table',
      title: 'Risiken',
      content: markdownTable(['Risiko', 'Schweregrad', 'Wirkung', 'Gegenmaßnahme'], riskRows),
    });
  }

  const evidenceRows = [];
  for (const req of evidenceRequirements) {
    if (req && typeof req === 'object') {
      evidenceRows.push([
        'Anforderung',
        firstDefined(req, ['label', 'name', 'description', 'id']) || '—',
        firstDefined(req, ['detail', 'reason', 'message']) || '—',
      ]);
    } else {
      evidenceRows.push(['Anforderung', String(req), '—']);
    }
  }
  for (const gap of evidenceGaps) {
    if (gap && typeof gap === 'object') {
      evidenceRows.push([
        'Lücke',
        firstDefined(gap, ['label', 'name', 'description', 'id']) || '—',
        firstDefined(gap, ['reason', 'detail', 'message']) || '—',
      ]);
    } else {
      evidenceRows.push(['Lücke', String(gap), '—']);
    }
  }

  if (evidenceRows.length > 0) {
    tables.push({
      id: 'decision_evidence',
      headers: ['Typ', 'Evidenz / Lücke', 'Detail'],
      rows: evidenceRows,
    });

    sections.push({
      id: 'evidence_gap_table',
      title: 'Evidenz und offene Lücken',
      content: markdownTable(['Typ', 'Evidenz / Lücke', 'Detail'], evidenceRows),
    });
  }

  if (forbiddenAssumptions.length > 0) {
    sections.push({
      id: 'forbidden_assumptions',
      title: 'Verbotene Annahmen',
      content: forbiddenAssumptions.map((item) => `- ${String(item)}`).join('\n'),
    });
  }
  if (nextActions.length > 0) {
    const rows = nextActions.map((item) => {
      if (item && typeof item === 'object') {
        return [toSafeActionLabel(item), firstDefined(item, ['type']) || '—'];
      }
      return [toSafeActionLabel(item), '—'];
    });

    const actionTable = markdownTable(['Nächster Schritt', 'Typ'], rows);
    tables.push({
      id: 'decision_next_actions',
      headers: ['Nächster Schritt', 'Typ'],
      rows,
    });
    sections.push({
      id: 'next_actions',
      title: 'Nächste Schritte',
      content: actionTable,
    });
  }

  if (sections.length === 0) {
    warnings.push('insufficient_structured_data');
  }

  const uniqueWarnings = [...new Set(warnings)];

  const summary = decisionStatus !== undefined
    ? `Entscheidungsstatus: ${String(decisionStatus)}.`
    : (expectedStatus !== undefined
      ? `Erwarteter Status: ${String(expectedStatus)}.`
      : (sections.length > 0 ? 'Entscheidungsfelder wurden strukturiert erkannt.' : 'Keine auswertbaren Entscheidungsfelder.'));

  const markdownParts = [
    '## Entscheidungsbrief (Stub)',
    '',
    '> **Hinweis:** `decision_brief_renderer_not_implemented_yet`',
  ];
  for (const section of sections) {
    markdownParts.push('', `### ${section.title}`, '', section.content);
  }
  if (sections.length === 0) {
    markdownParts.push('', '- Keine strukturierten Entscheidungsfelder vorhanden.');
  }

  return {
    success: true,
    presentation: {
      type: 'decision_brief',
      title: 'Entscheidungsbrief (Stub)',
      summary,
      kpis: [],
      tables,
      sections,
      warnings: uniqueWarnings,
      sources,
      nextActions,
    },
    markdown: markdownParts.join('\n'),
  };
}

function renderComparisonTableStub(domainResult) {
  const dr = domainResult || {};
  const warnings = ['comparison_table_renderer_not_implemented_yet'];

  const collection = (isNonEmptyArray(dr.items) && dr.items)
    || (isNonEmptyArray(dr.rows) && dr.rows)
    || (isNonEmptyArray(dr.peers) && dr.peers)
    || (isNonEmptyArray(dr.variants) && dr.variants)
    || [];

  const rows = [];
  for (const item of collection) {
    if (item && typeof item === 'object') {
      rows.push([
        firstDefined(item, ['name', 'label', 'id']) || '—',
        firstDefined(item, ['value', 'score', 'status']) || '—',
      ]);
    } else {
      rows.push([String(item), '—']);
    }
  }

  if (rows.length === 0) {
    warnings.push('insufficient_structured_data');
  }

  const tables = rows.length > 0
    ? [{ id: 'comparison_items', headers: ['Eintrag', 'Wert'], rows }]
    : [];

  const markdown = [
    '## Vergleichstabelle (Stub)',
    '',
    '> **Hinweis:** `comparison_table_renderer_not_implemented_yet`',
    '',
    rows.length > 0 ? markdownTable(['Eintrag', 'Wert'], rows) : '- Keine strukturierten Vergleichsdaten vorhanden.',
  ].join('\n');

  return {
    success: true,
    presentation: {
      type: 'comparison_table',
      title: 'Vergleichstabelle (Stub)',
      summary: rows.length > 0 ? `${rows.length} Vergleichseinträge erkannt.` : 'Keine auswertbaren Vergleichsdaten.',
      kpis: [],
      tables,
      sections: [],
      warnings,
      sources: [],
      nextActions: [],
    },
    markdown,
  };
}

function renderStub(type, domainResult) {
  switch (type) {
    case 'vdmi_matrix_table':
      return renderVdmiMatrix(domainResult);
    case 'evidence_gap_table':
      return renderEvidenceGapTableStub(domainResult);
    case 'risk_table':
      return renderRiskTableStub(domainResult);
    case 'decision_brief':
      return renderDecisionBriefStub(domainResult);
    case 'comparison_table':
      return renderComparisonTableStub(domainResult);
    default:
      break;
  }

  const warningCode = `${type}_renderer_not_implemented_yet`;
  return {
    success: true,
    presentation: {
      type,
      title: `${type} (ausstehend)`,
      summary: `Renderer '${type}' ist noch nicht implementiert.`,
      kpis: [],
      tables: [],
      sections: [],
      warnings: [warningCode],
      sources: [],
      nextActions: [],
    },
    markdown: `## ${type}\n\n> **Hinweis:** Renderer noch nicht implementiert (\`${warningCode}\`).`,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function dispatch(format, domainResult, context, locale) {
  switch (format) {
    case 'kpi_fact':
      return renderKpiFact(domainResult, context, locale);
    case 'debug_summary':
      return renderDebugSummary(domainResult, context);
    default:
      return renderStub(format, domainResult);
  }
}

function mergeSelectionWarnings(result, selectionWarnings) {
  const existing = Array.isArray(result?.presentation?.warnings)
    ? result.presentation.warnings
    : [];
  const mergedWarnings = [...new Set([...existing, ...(selectionWarnings || [])])];
  return {
    ...result,
    presentation: {
      ...result.presentation,
      warnings: mergedWarnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Moleculer Service
// ---------------------------------------------------------------------------

module.exports = {
  name: 'presentation',

  settings: {},

  actions: {
    /**
     * Render a domain result as a structured human view.
     *
     * @param {string}  [intent]         - capability / intent hint
     * @param {string}  [audience]       - default: management
     * @param {string}  [preferredFormat]- renderer override; one of VALID_FORMATS
     * @param {object}  domainResult     - required: raw domain output to render
     * @param {object}  [context]        - optional extra context (tenantId, locale, …)
     * @param {string}  [locale]         - default: de-DE
     */
    render: {
      rest: 'POST /presentation/render',
      openapi: {
        summary: 'Render domain result as structured human view',
        description:
          'Deterministic system-to-human presentation layer. Translates domain results ' +
          'into management-grade artefacts (KPI cards, VDMI matrices, decision briefs, …). ' +
          'No LLM calls; all facts come from domainResult.',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['domainResult'],
                properties: {
                  intent: { type: 'string', example: 'asset_count_query' },
                  audience: { type: 'string', default: 'management', example: 'management' },
                  preferredFormat: {
                    type: 'string',
                    enum: [...VALID_FORMATS],
                    default: 'auto',
                  },
                  domainResult: {
                    type: 'object',
                    description: 'Raw domain output to be rendered',
                    example: {
                      label: 'PV-Anlagen in Wiesloch',
                      count: 312,
                      unit: 'Anlagen',
                      area: 'Wiesloch',
                      source: 'Marktstammdatenregister (MaStR)',
                      asOf: '2026-05-17',
                    },
                  },
                  context: {
                    type: 'object',
                    example: { tenantId: 'demo', locale: 'de-DE' },
                  },
                  locale: { type: 'string', default: 'de-DE', example: 'de-DE' },
                },
              },
              examples: {
                kpi_fact_pv_wiesloch: {
                  summary: 'KPI-Abfrage PV-Anlagen Wiesloch',
                  value: {
                    intent: 'asset_count_query',
                    domainResult: {
                      label: 'PV-Anlagen in Wiesloch',
                      count: 312,
                      unit: 'Anlagen',
                      area: 'Wiesloch',
                      source: 'Marktstammdatenregister (MaStR)',
                      asOf: '2026-05-17',
                    },
                  },
                },
                vdmi_matrix_stub: {
                  summary: 'VDMI-Matrix-Anfrage (Stub)',
                  value: {
                    intent: 'vdmi_role_boundary_governance',
                    domainResult: {
                      matrix: {
                        id: 'matrix-001',
                        name: 'Netzanschluss §17 EnWG',
                        tasks: [
                          {
                            taskId: 'network-operator-decision',
                            taskName: 'Formelle Netzbetreiberentscheidung',
                            verantwortlich: ['DSO_GATEKEEPER'],
                            durchfuehrend: ['TECHNICAL_PLANNER'],
                            mitwirkend: ['APPLICANT'],
                            information: ['REGULATOR'],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Structured presentation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    presentation: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        title: { type: 'string' },
                        summary: { type: 'string' },
                        kpis: { type: 'array', items: { type: 'object' } },
                        tables: { type: 'array', items: { type: 'object' } },
                        sections: { type: 'array', items: { type: 'object' } },
                        warnings: { type: 'array', items: { type: 'string' } },
                        sources: { type: 'array', items: { type: 'string' } },
                        nextActions: { type: 'array', items: { type: 'object' } },
                      },
                    },
                    markdown: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid input — domainResult missing' },
        },
      },
      params: {
        intent: { type: 'string', optional: true },
        audience: { type: 'string', optional: true, default: 'management' },
        preferredFormat: { type: 'string', optional: true, default: 'auto' },
        domainResult: { type: 'object' },
        context: { type: 'object', optional: true },
        locale: { type: 'string', optional: true, default: 'de-DE' },
      },

      handler(ctx) {
        const {
          intent,
          preferredFormat = 'auto',
          domainResult,
          context = {},
          locale = 'de-DE',
        } = ctx.params;

        if (!domainResult || typeof domainResult !== 'object') {
          return this.Promise.reject(
            new Error('presentation.render: domainResult is required and must be an object')
          );
        }

        const selection = selectRenderer({ preferredFormat, intent, domainResult });
        const rendered = dispatch(selection.type, domainResult, context, locale);
        return mergeSelectionWarnings(rendered, selection.warnings);
      },
    },
  },
};
