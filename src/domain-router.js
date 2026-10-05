'use strict';

const { listCompiledDomainRoutes } = require('./domain-routes-registry');
const { semanticDomains } = require('./semantic-domains');
const { domainHintsForText } = require('./workbench-activity-taxonomy');
const { confirmedCapability, choiceText } = require('./capability-clarification');

// Domain signals only: capabilities and receipts remain owned by their existing services.
const DOMAIN_SIGNALS = {
  market_communication: /aperak|\bz18\b|mscons|utilmd|marktkommunikation|\bmako\b/i,
  market_master_data:
    /\bmalo\b|\bmelo\b|marktlokation|messlokation|lieferbeginn|stammdaten|zuordnung|market.?master/i,
  edm: /lastgang|zeitreih|plausibilis|\bedm\b|bilanzkreis/i,
  metering_msb: /\bmsb\b|imsys|messstellen|zähler|meter/i,
  m2c_revenue_assurance: /\bm2c\b|billing|abrechnung|cashflow|revenue|erlös/i,
  grid_operations_system_control: /netzführung|leitwarte|system.?control|netzbetrieb/i,
  redispatch: /redispatch|abrufdaten/i,
  asset_grid_planning: /\bassets?\b|betriebsmittel|asset.management/i,
  target_grid_planning: /zielnetz|\bznp\b/i,
  grid_connection:
    /netzanschluss|anschlussbegehren|connection|anschlussleistung|spannungsebene|mittelspannung|niederspannung|hochspannung/i,
  regulatory_compliance: /regulator|compliance|bnetza/i,
  controlling_finance: /controlling|finance|budget|capex/i,
  strategic_committee_governance: /gremi|committee|aufsichtsrat/i,
  it_data_vendor_governance: /schnittstelle|interface|vendor|pipeline|dienstleister/i,
  org_roles_competence: /kompetenz|rollenklärung|zuständigkeit/i,
  management: /geschäftsführung|managementbericht|management\b|lage\b|dossier/i,
};
const BLOCKED = [
  'write',
  'approve',
  'freigabe',
  'buchung',
  'invoice',
  'budget_commitment',
  'binding_regulatory_claim',
];
const LINK_KEYS = [
  'cetCaseId',
  'conversationId',
  'agentSessionId',
  'roomId',
  'threadId',
  'clientId',
  'evidenceRef',
  'processRef',
  'laufkarteId',
  'stationId',
  'edgeId',
  'traceId',
  'controlPoint',
  'ownerRole',
  'roleFamily',
];

function evaluateDomainTransition(previous, c) {
  let type = 'continue';
  if (c.primaryDomain === 'unknown') type = 'fallback';
  else if (c.requestedMode === 'handoff' || c.vendorBlocker) type = 'handoff';
  else if (c.ambiguityFlags.length) type = c.branchRequested ? 'branch' : 'clarify';
  else if (previous && previous.currentDomain !== c.primaryDomain) {
    type =
      c.branchRequested ||
      (previous.currentDomain === 'target_grid_planning' &&
        c.primaryDomain === 'asset_grid_planning')
        ? 'branch'
        : 'reclassify';
  }
  return {
    type,
    fromDomain: previous?.currentDomain || null,
    toDomain: c.primaryDomain,
    reason: {
      continue: 'Domain remains stable',
      fallback: 'No reliable domain signal; request context',
      handoff: 'Target specialist review required',
      branch: 'Preserve related domain as a subcase',
      clarify: 'Several domains require clarification',
      reclassify: 'New turn provides stronger domain evidence',
    }[type],
    requiresUserInput: ['clarify', 'fallback', 'handoff'].includes(type),
  };
}

function buildClarificationPrompt(c) {
  return c.ambiguityFlags.length || c.primaryDomain === 'unknown'
    ? [
        `Bitte fachlichen Fokus klären: ${[c.primaryDomain, ...c.alternativeDomains.map((d) => d.domain)].join(' / ')}. Welche Evidenz und welcher Prozess sind betroffen?`,
      ]
    : [];
}
function buildRouterDiagnostics(c) {
  return {
    sources: c.sourceDiagnostics,
    scoreContributions: c.matchedSignals,
    scores: c.domainScores,
    knowledgeIsRoutingEvidenceOnly: true,
  };
}

async function classifyDomain(input, dependencies = {}) {
  const known = input.knownContext || {};
  const text = input.userRequest || '';
  const choice = confirmedCapability(text, dependencies.previousState, dependencies.model);
  const signals = [];
  const scores = {};
  const sourceDiagnostics = {};
  const add = (domain, score, source, ref) => {
    if (!DOMAIN_SIGNALS[domain]) return;
    scores[domain] = (scores[domain] || 0) + score;
    signals.push({ domain, score, source, ref });
  };
  const infer = (value, score, source) => {
    for (const [domain, pattern] of Object.entries(DOMAIN_SIGNALS)) {
      if (pattern.test(String(value || '').replace(/_/g, ' ')))
        add(domain, score, source, String(value));
    }
  };
  infer(text, 60, 'task');
  if (choice) add(dependencies.previousState.currentDomain, 60, 'confirmed_choice', 'person');
  const activityHints = domainHintsForText(text, { limit: 4 });
  for (const hint of activityHints) {
    add(hint.domain, Math.min(25, 8 + hint.score), 'activity_taxonomy', hint.activityId);
    for (const handoffDomain of hint.handoffDomains || [])
      add(handoffDomain, 4, 'activity_handoff', hint.activityId);
  }
  sourceDiagnostics.activityTaxonomy = 'consulted';
  if (/zielnetz|\bznp\b|produktionsreife/i.test(text)) {
    add('target_grid_planning', 20, 'task_context', 'target_grid_planning_readiness');
  }
  if (/anschlussleistung|spannungsebene|mittelspannung|niederspannung|hochspannung/i.test(text)) {
    add('grid_connection', 20, 'task_context', 'connection_voltage_or_capacity');
  }
  if (/aperak|\bz18\b/i.test(text)) {
    add('market_communication', 20, 'task_context', 'aperak_message_rejection');
  }
  if (
    /aperak|\bz18\b/i.test(text) &&
    /lieferbeginn|stammdaten|\bmalo\b|\bmelo\b|zuordnung/i.test(text)
  ) {
    add('market_communication', 18, 'task_context', 'aperak_master_data_boundary');
    add('market_master_data', 15, 'task_context', 'mako_master_data_boundary');
  }
  const routes = (dependencies.domainRoutes || listCompiledDomainRoutes)();
  for (const r of routes) {
    if (
      (r.triggers || []).some((t) => text.toLowerCase().includes(t.toLowerCase())) ||
      (r._compiledCombos || []).some((c) => c.all.every((p) => p.test(text)))
    ) {
      infer(`${r.id} ${r.label}`, 12, 'domain_routes');
    }
  }
  sourceDiagnostics.domainRoutes = 'consulted';
  for (const d of dependencies.semanticDomains || semanticDomains) {
    if ((d.indicators.filenameTokens || []).some((t) => text.toLowerCase().includes(t))) {
      const mapped = { metering: 'edm', 'grid-assets': 'asset_grid_planning' }[d.id];
      if (mapped) add(mapped, 8, 'semantic_domains', d.id);
    }
  }
  sourceDiagnostics.semanticDomains = 'consulted';
  const consult = async (name, fn, required = false) => {
    if (!fn) {
      sourceDiagnostics[name] = 'unavailable';
      return {};
    }
    try {
      const result = await fn();
      sourceDiagnostics[name] = 'consulted';
      return result || {};
    } catch (error) {
      if (required) throw error;
      sourceDiagnostics[name] = `unavailable:${error.type || error.code || 'error'}`;
      return {};
    }
  };
  const broker = choice
    ? {
        uncertain: false,
        candidateCapabilities: [choice],
        recommendedCapabilities: [choice],
        scoringBreakdown: {
          ...dependencies.previousState.lastClassification.scoringBreakdown,
          uncertain: false,
          activatesCoverage: true,
          selectionSource: 'person',
        },
      }
    : await consult(
        'broker',
        dependencies.recommend &&
          (() =>
            dependencies.recommend({
              ...input,
              primaryDomain:
                Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
            }))
      );
  const receiptResponse = await consult(
    'receipts',
    dependencies.selectReceipts && (() => dependencies.selectReceipts(input)),
    !!input.forceReceipt
  );
  const receipts = receiptResponse.data || receiptResponse;
  if (input.forceReceipt && (!receipts.selected || receipts.receiptId !== input.forceReceipt))
    throw Object.assign(new Error('Forced receipt is not available'), {
      code: 422,
      type: 'RECEIPT_NOT_FOUND_OR_INVALID',
    });
  const candidateCapabilities =
    broker.candidateCapabilities ||
    broker.recommendedCapabilities ||
    (broker.capability ? [{ capability: broker.capability }] : []);
  if (!broker.uncertain && !broker.scoringBreakdown?.usedFallback)
    (broker.recommendedCapabilities || candidateCapabilities.slice(0, 1)).forEach((c) =>
      infer(c.capability, 15, 'broker')
    );
  if (receipts.selected)
    infer(`${receipts.receiptId} ${receipts.selectedReceipt?.domain || ''}`, 15, 'receipts');
  const knowledge = input.disableKnowledgeRouting
    ? {}
    : await consult('knowledge', dependencies.knowledge && (() => dependencies.knowledge(input)));
  const knowledgeRefs = knowledge.refs || [];
  for (const ref of knowledgeRefs) add(ref.domain, 5, 'knowledge', ref.id);
  const previous = dependencies.previousState;
  if (previous) add(previous.currentDomain, 3, 'prior_state', previous.cetCaseId);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primaryDomain = ranked[0]?.[0] || 'unknown';
  // A domain hit in the current turn remains significant even when broker scores differ.
  const alternatives = ranked
    .slice(1)
    .map(([domain, score]) => ({ domain, confidence: Math.min(0.95, score / 100) }));
  const strong = ranked.filter(([, score]) => score >= 55);
  const missingEvidence = [
    ...new Set([
      ...(known.missingEvidence || []),
      ...(dependencies.validatedEvidence?.length ? [] : ['validated_process_evidence']),
    ]),
  ];
  const ownerGap = !!known.controlPoint && !known.ownerRole;
  const c = {
    schemaVersion: '1.1',
    primaryDomain,
    domainConfidence: Math.min(0.98, (ranked[0]?.[1] || 0) / 100),
    alternativeDomains: alternatives,
    ambiguityFlags: [
      ...(strong.length > 1 ? ['multiple_strong_domains'] : []),
      ...(broker.uncertain ? ['uncertain_capability_selection'] : []),
    ],
    uncertain: broker.uncertain === true,
    scoringBreakdown: broker.scoringBreakdown || null,
    matchedSignals: signals,
    roleInterpretation: { actorRoles: input.actorRoles || [], source: 'authenticated_policy' },
    candidateCapabilities,
    operationCandidates: broker.operationCandidates || [],
    selectedCapabilities: [],
    candidateReceipts: receipts.diagnostics?.candidates || [],
    selectedReceipts: receipts.selected ? [receipts.receiptId] : [],
    knowledgeRefs,
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: [...BLOCKED, ...(broker.doNotUse || []).map((x) => x.action)],
    requestedMode: input.requestedMode,
    branchRequested: known.branch === true || /auch|zusätzlich|branch|parallel/i.test(text),
    vendorBlocker: known.vendorBlocker === true,
    evidenceRequirements: missingEvidence,
    responseGuidance:
      'Routing advice only. Knowledge hits are unverified routing hints. Obtain evidence and human review; never claim approval, booking or binding regulatory decisions.',
    matchedLaufkarten: [
      ...new Set([known.laufkarteId, ...knowledgeRefs.map((r) => r.laufkarteId)].filter(Boolean)),
    ],
    currentStation: known.stationId || null,
    candidateStations: knowledgeRefs.map((r) => r.stationId).filter(Boolean),
    controlPoint: known.controlPoint || null,
    nextSafeStep: 'Collect missing evidence and request responsible owner review',
    hitlBoundary: 'Human review required; router cannot grant approval',
    readinessState: missingEvidence.length ? 'evidence_required' : 'human_review_required',
    readinessScore: null,
    missingEvidence,
    noCallGuards: BLOCKED,
    roleProjection: {
      roleFamily: known.roleFamily || null,
      influenceRights: ['suggest'],
      allowedContributions: ['evidence', 'clarification'],
      forbiddenClaims: BLOCKED,
      hitlBoundary: 'human_review',
      ownerGap,
    },
    sourceDiagnostics,
    domainScores: scores,
    activityHints,
  };
  c.transition = evaluateDomainTransition(previous, c);
  c.requiredClarifications = buildClarificationPrompt(c);
  if (c.uncertain) {
    c.responseGuidance = choiceText(c, dependencies.model);
    c.requiredClarifications = [c.responseGuidance];
  }
  if (choice)
    c.responseGuidance =
      'Die Funktion ist ausgewählt. Bitte ergänze die noch fehlenden Angaben zum Fall.';
  if (choice || (!c.uncertain && !['clarify', 'fallback'].includes(c.transition.type)))
    c.selectedCapabilities = broker.recommendedCapabilities || candidateCapabilities.slice(0, 1);
  c.diagnostics = buildRouterDiagnostics(c);
  return c;
}
module.exports = {
  classifyDomain,
  evaluateDomainTransition,
  buildClarificationPrompt,
  buildRouterDiagnostics,
  LINK_KEYS,
};
