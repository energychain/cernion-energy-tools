'use strict';

/**
 * ChatGPT Sidecar session-ticket facade (energychain/cernion-energy-tools#388,
 * first-card slice).
 *
 * Approved scope (owner comment 2026-07-05T14:10:06Z):
 *   POST   /api/chatgpt-sidecar/sessions
 *   DELETE /api/chatgpt-sidecar/sessions/:sessionId   (authenticated Cernion side only)
 *   GET    /api/chatgpt-sidecar/s/:ticket/manifest
 *   POST   /api/chatgpt-sidecar/s/:ticket/ask
 *   GET    /api/chatgpt-sidecar/s/:ticket/ask          (browser read-only facade)
 *   POST   /api/chatgpt-sidecar/s/:ticket/plan
 *   GET    /api/chatgpt-sidecar/s/:ticket/plan         (browser read-only facade)
 *   GET    /api/chatgpt-sidecar/s/:ticket/action-openapi.json
 *   POST   /api/chatgpt-sidecar/s/:ticket/datapoints   (draft_write only)
 *   GET    /api/chatgpt-sidecar/s/:ticket/metering
 *
 * `execute`, `controlled_write`, `process_execute` and `requires_confirmation`
 * are policy outcomes only in this slice (see evaluateWriteRequest) — nothing
 * in this file mutates production state outside the draft datapoint path.
 * `dossier` is deferred to a later slice.
 *
 * Ticket-scoped routes (`/s/:ticket/*`) are intentionally reachable with zero
 * Cernion auth token — the opaque ticket itself is the credential, resolved
 * server-side against the session store. `sessions` create/delete require a
 * real authenticated tenant plus the `chatgpt-sidecar-creator` role (see
 * assertCreatorAllowed) so a bare CERNION_READONLY_TOKEN cannot mint sessions.
 */

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { hasRole } = require('../src/auth/rbac');
const { getAuthenticatedTenant } = require('../src/agent-sidecar-policy');
const {
  defaultStore,
  isValidTtl,
  TTL_OPTIONS,
  DEFAULT_TTL,
} = require('../src/chatgpt-sidecar-session-store');
const {
  DEFAULT_WRITE_SCOPE,
  normalizeCapabilityProfile,
  resolveWriteScope,
  evaluateWriteRequest,
  redactSessionForClient,
  resolveOntologyContext,
} = require('../src/chatgpt-sidecar-session-policy');
const { buildPromptText } = require('../src/chatgpt-sidecar-prompt');
const {
  compileReadOnlyExecutionPlan,
  buildAskBlueprintAnswer,
} = require('../src/blueprint-rest-plan-compiler');

const OPENAPI_TAG = 'ChatGPT Sidecar';
const CREATOR_ROLE = 'chatgpt-sidecar-creator';
const MAX_BROWSER_QUERY_LENGTH = 2000;
const OPENAPI_FALLBACK_SOURCE = 'openapi_semantic_router';
const UNSAFE_OPERATION_PATTERN =
  /\b(create|update|delete|remove|restore|execute|confirm|approve|reject|promote|rollback|deactivate|mutate|write|draft|token|backup|reload|sync|scan|start|stop|restart|send|email|webhook|subscribe|unsubscribe|login|logout|refresh)\b/i;
const READ_ONLY_FALLBACK_POST_SERVICES = new Set([
  'assets',
  'energy-market',
  'entsoe',
  'gas-storage',
  'german-grid',
  'oep',
  'osm-geo',
  'residual-load',
]);
const CAPABILITY_SERVICE_HINTS = {
  'datasource-gas-storage': ['gas-storage'],
  'datasource-mastr': ['energy-market', 'assets'],
  'datasource-entsoe': ['entsoe', 'energy-market'],
  'datasource-osm': ['osm-geo'],
  'datasource-oep': ['oep'],
  'energy-market': ['energy-market', 'entsoe', 'gas-storage', 'residual-load'],
};

function buildPositiveFollowUps(kind, details = {}) {
  const followUps = {
    capability_not_granted: [
      {
        missing: details.capability || 'requested capability',
        enablesDossierAddition:
          'An authenticated Cernion-side creator can provision a new scoped session that includes this capability.',
      },
      {
        missing: 'safe browser query within the current capability profile',
        enablesDossierAddition:
          'Retry with one of the manifest-listed capability ids to stay inside this ticket scope.',
      },
    ],
    expired_or_revoked_ticket: [
      {
        missing: 'active ChatGPT Sidecar session ticket',
        enablesDossierAddition:
          'Ask an authenticated Cernion-side creator to generate a fresh scoped session URL.',
      },
    ],
    unsupported_browser_query: [
      {
        missing: 'shorter GET question or task',
        enablesDossierAddition:
          `Retry with a URL-encoded question/task up to ${MAX_BROWSER_QUERY_LENGTH} characters using the manifest template.`,
      },
    ],
  };
  return followUps[kind] || [];
}

function buildPolicyBlockedResponse({ reason, capability, action }) {
  return {
    success: false,
    error: 'sidecar_policy_blocked',
    reason,
    capability,
    action,
    notAvailable: ['write_or_consequential_action', 'ungranted_capability'],
    positiveFollowUps: buildPositiveFollowUps(reason, { capability }),
  };
}

function getAuthenticatedUserId(ctx) {
  return ctx?.meta?.apiToken?.userId || ctx?.meta?.authUser?.userId || null;
}

function getAuthTokenScope(ctx) {
  return ctx?.meta?.apiToken?.scope || (ctx?.meta?.authSession ? 'session' : null);
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl ? String(baseUrl).replace(/\/+$/, '') : '';
}

function buildManifestUrl(baseUrl, ticket) {
  const prefix = normalizeBaseUrl(baseUrl);
  return `${prefix}/api/chatgpt-sidecar/s/${ticket}/manifest`;
}

function buildActionOpenApiUrl(baseUrl, ticket) {
  const prefix = normalizeBaseUrl(baseUrl);
  return `${prefix}/api/chatgpt-sidecar/s/${ticket}/action-openapi.json`;
}

function buildBrowserAskUrl(baseUrl, ticket, question, capability = null) {
  if (!question) return null;
  const prefix = normalizeBaseUrl(baseUrl);
  const params = new URLSearchParams({ query: question });
  if (capability) params.set('capability', capability);
  return `${prefix}/api/chatgpt-sidecar/s/${ticket}/ask?${params.toString()}`;
}

function buildBrowserUrlTemplates(baseUrl, ticket) {
  const prefix = normalizeBaseUrl(baseUrl);
  return {
    manifestUrl: `${prefix}/api/chatgpt-sidecar/s/${ticket}/manifest`,
    browserAskUrlTemplate: `${prefix}/api/chatgpt-sidecar/s/${ticket}/ask?query={urlencoded_question}&capability={optional_capability}`,
    browserPlanUrlTemplate: `${prefix}/api/chatgpt-sidecar/s/${ticket}/plan?task={urlencoded_task}&capability={optional_capability}`,
  };
}

function buildPythonClientHints(baseUrl, ticket) {
  const prefix = normalizeBaseUrl(baseUrl);
  return {
    usage: 'python_read_only_http_client_when_browser_navigation_blocks_dynamic_get_urls',
    askBaseUrl: `${prefix}/api/chatgpt-sidecar/s/${ticket}/ask`,
    planBaseUrl: `${prefix}/api/chatgpt-sidecar/s/${ticket}/plan`,
    queryEncoding: 'Use urllib.parse.urlencode for query/task plus optional capability and parentTurnId.',
    timeoutSeconds: 30,
    responseFields: {
      answer: 'Use answer first, then shortAnswer, then groundingAnswer.',
      evidence: 'Use evidence/citations as Cernion-provided grounding.',
      turnId: 'Persist for the next follow-up call.',
      resolvedQuestion: 'Use to make the interpreted user request explicit.',
      followUpContext: 'Use for conversational continuity; pass followUpContext.turnId as parentTurnId on the next Cernion call.',
    },
    example: [
      'import json, urllib.parse, urllib.request',
      'params = {"query": current_question}',
      'if parent_turn_id: params["parentTurnId"] = parent_turn_id',
      'url = ask_base_url + "?" + urllib.parse.urlencode(params)',
      'with urllib.request.urlopen(url, timeout=30) as response:',
      '    payload = json.loads(response.read().decode("utf-8"))',
    ].join('\n'),
  };
}

function buildActionSetup(baseUrl, ticket) {
  const schemaUrl = buildActionOpenApiUrl(baseUrl, ticket);
  return {
    recommended: true,
    mode: 'custom_gpt_action',
    schemaUrl,
    authentication: {
      type: 'none_ticket_scoped',
      instruction:
        'Set Authentication to None in the GPT Action. The opaque session ticket is already embedded in the imported schema paths and expires with the Sidecar session.',
    },
    steps: [
      'Open ChatGPT and create or edit a Custom GPT.',
      'Go to Configure -> Actions -> Create new action.',
      `Import the schema from this URL: ${schemaUrl}`,
      'Set Authentication to None.',
      'Save the GPT and test the askCernion action with a short Cernion question.',
      'Use the Prompt-only section below only when a Custom GPT Action cannot be configured.',
    ],
    operations: [
      {
        operationId: 'askCernion',
        purpose: 'Free-form fachliche Cernion question with optional capability and parentTurnId.',
      },
      {
        operationId: 'planCernion',
        purpose: 'Read-only planning/routing request without execution.',
      },
    ],
    promptOnlyFallback:
      'Prompt-only remains available for environments where the user cannot create or edit a Custom GPT, but it depends on browser/Python transport and is less reliable for free follow-ups.',
  };
}

function buildActionOpenApiSchema(baseUrl, session) {
  const prefix = normalizeBaseUrl(baseUrl || session.baseUrl);
  const capabilityEnum = session.capabilityProfile.filter(
    (capability) => capability !== 'draft-datapoints'
  );
  const askPath = `/api/chatgpt-sidecar/s/${session.ticket}/ask`;
  const planPath = `/api/chatgpt-sidecar/s/${session.ticket}/plan`;
  const capabilitySchema =
    capabilityEnum.length > 0
      ? {
          type: 'string',
          enum: capabilityEnum,
          description:
            'Optional Cernion capability id. When provided, Cernion treats it as a hard grounding boundary.',
        }
      : {
          type: 'string',
          description: 'Optional Cernion capability id granted by this Sidecar session.',
        };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Cernion ChatGPT Sidecar Action',
      version: '1.0.0',
      description:
        'Session-scoped read-only Custom GPT Action for Cernion evidence questions and planning. The opaque session ticket is embedded in the paths and expires with the Sidecar session.',
    },
    servers: prefix ? [{ url: prefix }] : [{ url: '/' }],
    paths: {
      [askPath]: {
        post: {
          operationId: 'askCernion',
          summary: 'Ask Cernion with session-scoped evidence grounding',
          description:
            'Use for free-form user follow-up questions. Pass parentTurnId from the previous Cernion response when available.',
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AskCernionRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Cernion Sidecar answer with turn and grounding metadata.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CernionSidecarResponse' },
                },
              },
            },
          },
        },
      },
      [planPath]: {
        post: {
          operationId: 'planCernion',
          summary: 'Plan a read-only Cernion route without execution',
          description:
            'Use for capability/routing planning. This operation does not execute consequential actions.',
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlanCernionRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Cernion Sidecar plan with turn metadata.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CernionSidecarResponse' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        AskCernionRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['question'],
          properties: {
            question: {
              type: 'string',
              minLength: 3,
              description: 'The current user question to answer through Cernion.',
            },
            capability: capabilitySchema,
            parentTurnId: {
              type: 'string',
              description: 'Previous Cernion response turnId, if this is a follow-up.',
            },
            context: {
              type: 'object',
              description:
                'Optional compact context extracted from the conversation. For MaStR questions pass postalCode/postleitzahl and municipality when known.',
              additionalProperties: true,
            },
            inputs: {
              type: 'object',
              description:
                'Optional structured inputs extracted from the user request. For datasource-mastr use postalCode/postleitzahl, municipality, installationType, commissioningYear and operationalStatus.',
              additionalProperties: true,
            },
          },
        },
        PlanCernionRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['task'],
          properties: {
            task: {
              type: 'string',
              minLength: 3,
              description: 'The planning or routing task to resolve through Cernion.',
            },
            capability: capabilitySchema,
            parentTurnId: {
              type: 'string',
              description: 'Previous Cernion response turnId, if this is a follow-up.',
            },
            context: {
              type: 'object',
              description: 'Optional compact context extracted from the conversation.',
              additionalProperties: true,
            },
          },
        },
        CernionSidecarResponse: {
          type: 'object',
          additionalProperties: true,
          properties: {
            success: { type: 'boolean' },
            answer: { type: 'string' },
            shortAnswer: { type: 'string' },
            confidence: { type: 'string' },
            evidence: { type: 'array', items: { type: 'object', additionalProperties: true } },
            turnId: { type: 'string' },
            resolvedQuestion: { type: 'string' },
            followUpContext: { type: 'object', additionalProperties: true },
            responseContract: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  };
}

function buildResponseContract() {
  return {
    schemaVersion: 'cernion.chatgpt-sidecar.response.v1',
    turnIdField: 'turnId',
    resolvedQuestionField: 'resolvedQuestion',
    answerField: 'answer',
    summaryField: 'shortAnswer',
    confidenceField: 'confidence',
    evidenceField: 'evidence',
    followUpContextField: 'followUpContext',
    promptOnlyTransportBoundary:
      'A prompt-only browser client still needs a concrete URL, Action or MCP tool call to send each new free-form user question to Cernion.',
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function extractPostalCodeFromValue(value) {
  const match = String(value || '').match(/\b\d{5}\b/);
  return match ? match[0] : null;
}

function extractYearFromQuestion(question) {
  const match = String(question || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function extractMunicipalityFromQuestion(question) {
  const text = String(question || '').trim();
  const match = text.match(
    /\b(?:in|für|fuer|von|ort|gemeinde|kommune)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}){0,2})\b/
  );
  if (!match) return null;
  return match[1]
    .replace(/\b(?:installiert|zusätzlich|zusaetzlich|gebaut|ermitteln|ist|sind)\b.*$/i, '')
    .trim();
}

function resolveMastrInstallationType(question, context = {}, inputs = {}) {
  const explicit = firstString(
    inputs.installationType,
    inputs.type,
    context.installationType,
    context.type
  );
  if (explicit) return explicit;
  const haystack = String(question || '').toLowerCase();
  if (/\b(pv|photovoltaik|solar)\b/.test(haystack)) return 'solar';
  if (/\b(speicher|batterie|bess)\b/.test(haystack)) return 'storage';
  if (/\bwind\b/.test(haystack)) return 'wind';
  if (/\b(biomasse|biogas)\b/.test(haystack)) return 'biomass';
  if (/\b(wasser|hydro)\b/.test(haystack)) return 'hydro';
  return null;
}

function resolveMastrScope(question, context = {}, inputs = {}) {
  const postalCode =
    extractPostalCodeFromValue(
      firstString(
        inputs.postalCode,
        inputs.postleitzahl,
        inputs.plz,
        context.postalCode,
        context.postleitzahl,
        context.plz
      )
    ) || extractPostalCodeFromValue(question);
  const municipality =
    firstString(
      inputs.municipality,
      inputs.gemeinde,
      inputs.city,
      context.municipality,
      context.gemeinde,
      context.city
    ) || extractMunicipalityFromQuestion(question);
  const commissioningYear =
    Number(inputs.commissioningYear || context.commissioningYear || 0) ||
    extractYearFromQuestion(question);
  return {
    postalCode,
    municipality,
    commissioningYear,
    installationType: resolveMastrInstallationType(question, context, inputs),
  };
}

function normalizeInstallationsPayload(payload) {
  if (Array.isArray(payload?.installations)) return payload.installations;
  if (Array.isArray(payload?.data?.installations)) return payload.data.installations;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  return [];
}

function normalizeInstallationStats(payload, installations) {
  const stats = payload?.stats || payload?.data?.stats || {};
  const count = Number(stats.count ?? stats.total ?? installations.length) || installations.length;
  const totalCapacity =
    Number(stats.totalCapacity ?? stats.totalCapacityKW ?? stats.totalCapacityKw) ||
    installations.reduce(
      (sum, installation) =>
        sum + Number(installation.bruttoleistung || installation.Bruttoleistung || installation.capacityKW || installation.capacityKw || 0),
      0
    );
  return {
    count,
    totalCapacity,
    avgCapacity: count > 0 ? totalCapacity / count : 0,
  };
}

function formatKwValue(value) {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1000) {
    return `${(numeric / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3 })} MW`;
  }
  return `${numeric.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kW`;
}

function buildMastrEvidenceItems(installations, scope, stats) {
  const topInstallations = installations
    .slice()
    .sort(
      (a, b) =>
        Number(b.bruttoleistung || b.Bruttoleistung || b.capacityKW || b.capacityKw || 0) -
        Number(a.bruttoleistung || a.Bruttoleistung || a.capacityKW || a.capacityKw || 0)
    )
    .slice(0, 5);
  return [
    {
      source: 'energy-market.installations',
      capability: 'datasource-mastr',
      value: `MaStR ${scope.installationType || 'all'} ${scope.postalCode || scope.municipality || ''}: ${stats.count} Anlagen, ${formatKwValue(stats.totalCapacity)} Bruttoleistung.`,
      metadata: {
        postleitzahl: scope.postalCode,
        municipality: scope.municipality,
        installationType: scope.installationType,
        commissioningYear: scope.commissioningYear || null,
        count: stats.count,
        totalCapacityKw: stats.totalCapacity,
        examples: topInstallations.map((installation) => ({
          mastrNummer: installation.mastrNummer || installation.EinheitMastrNummer || null,
          name: installation.name || installation.EinheitName || null,
          bruttoleistungKw: Number(
            installation.bruttoleistung || installation.Bruttoleistung || installation.capacityKW || installation.capacityKw || 0
          ),
          inbetriebnahmedatum:
            installation.inbetriebnahmedatum || installation.Inbetriebnahmedatum || installation.commissioningDate || null,
          ort: installation.ort || installation.gemeinde || null,
          postleitzahl: installation.postleitzahl || null,
          netzbetreiberpruefungStatus: installation.netzbetreiberpruefungStatus ?? null,
        })),
      },
    },
  ];
}

function buildMastrMissingPostalCodeResponse({ question, scope, warning }) {
  const municipalityText = scope.municipality ? ` fuer "${scope.municipality}"` : '';
  const shortAnswer =
    `Für die MaStR-Capability brauche ich eine exakte 5-stellige Postleitzahl${municipalityText}, ` +
    'weil der produktive MaStR-Datenpfad nicht sicher nach freiem Ortsnamen filtert.';
  return {
    success: true,
    question,
    answer: shortAnswer,
    shortAnswer,
    confidence: 'low',
    evidence: [],
    evidenceBySource: {
      datasourceMastr: {
        source: 'energy-market.installations',
        status: 'missing_required_input',
        requiredInput: 'postleitzahl',
        trace: { warning: warning || null, municipality: scope.municipality || null },
      },
    },
    capabilityGrounding: {
      requestedCapability: 'datasource-mastr',
      mode: 'hard',
      status: 'missing_required_input',
      reason: 'postal_code_required',
      genericFallbackSuppressed: true,
    },
    processContext: [
      'capability:datasource-mastr',
      'mastr:postleitzahl:missing',
      'generic_fallback:suppressed',
    ],
    openQuestions: [
      scope.municipality
        ? `Welche PLZ soll fuer ${scope.municipality} verwendet werden?`
        : 'Welche 5-stellige PLZ soll fuer die MaStR-Abfrage verwendet werden?',
    ],
    recommendedNextSteps: [
      'Die Frage mit PLZ wiederholen, z.B. "PV-Leistung in 69256 Mauer".',
    ],
    allowedActions: ['explain', 'retrieve_evidence', 'prepare_intent'],
    forbiddenActions: ['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'],
  };
}

function buildMastrInstallationsResponse({ question, scope, payload }) {
  const installations = normalizeInstallationsPayload(payload);
  const stats = normalizeInstallationStats(payload, installations);
  const locationLabel = [scope.postalCode, scope.municipality].filter(Boolean).join(' ').trim();
  const typeLabel = scope.installationType === 'solar' ? 'PV-Anlagen' : 'Anlagen';
  const yearText = scope.commissioningYear ? ` mit Inbetriebnahmejahr ${scope.commissioningYear}` : '';
  const shortAnswer =
    installations.length > 0
      ? `Für ${locationLabel || 'den angefragten Standort'} weist die MaStR-Abfrage ${stats.count.toLocaleString('de-DE')} ${typeLabel}${yearText} mit zusammen ${formatKwValue(stats.totalCapacity)} Bruttoleistung aus.`
      : `Für ${locationLabel || 'den angefragten Standort'} lieferte die MaStR-Abfrage keine passenden ${typeLabel}${yearText}.`;
  const evidence = buildMastrEvidenceItems(installations, scope, stats);
  return {
    success: true,
    question,
    answer: shortAnswer,
    shortAnswer,
    confidence: installations.length > 0 ? 'high' : 'low',
    evidence,
    evidenceBySource: {
      datasourceMastr: {
        source: 'energy-market.installations',
        status: installations.length > 0 ? 'available' : 'missing',
        hits: evidence,
        trace: {
          requestedParams: {
            installationType: scope.installationType || 'all',
            postleitzahl: scope.postalCode || null,
            commissioningYear: scope.commissioningYear || null,
          },
          hitCount: installations.length,
        },
      },
    },
    capabilityGrounding: {
      requestedCapability: 'datasource-mastr',
      mode: 'hard',
      status: installations.length > 0 ? 'available' : 'missing',
      reason: installations.length > 0 ? 'capability_evidence_available' : 'no_matching_mastr_installations',
      genericFallbackSuppressed: true,
    },
    processContext: [
      'capability:datasource-mastr',
      installations.length > 0 ? 'capability_evidence:available' : 'capability_evidence:missing',
      'source:energy-market.installations',
    ],
    openQuestions: installations.length > 0 ? [] : ['Soll ein anderer Anlagenstatus oder eine andere PLZ geprueft werden?'],
    recommendedNextSteps: installations.length > 0 ? [] : ['MaStR-Abfrage mit anderem Scope wiederholen.'],
    allowedActions: ['explain', 'retrieve_evidence', 'prepare_intent'],
    forbiddenActions: ['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'],
  };
}

async function tryBuildDatasourceMastrAnswer(ctx, { question, context, inputs }) {
  const scope = resolveMastrScope(question, context, inputs);
  if (!scope.installationType && !/mastr|anlage|leistung|installiert|zubau|pv|solar/i.test(question)) {
    return null;
  }

  if (!scope.postalCode) {
    if (!scope.municipality) return null;
    return buildMastrMissingPostalCodeResponse({ question, scope });
  }

  const payload = await ctx.call('energy-market.installations', {
    installationType: scope.installationType || 'all',
    postleitzahl: scope.postalCode,
    commissioningYear: scope.commissioningYear || undefined,
    operationalStatus: firstString(inputs.operationalStatus, context.operationalStatus) || '35',
    includeNapData: false,
    limit: 'all',
  });

  return buildMastrInstallationsResponse({ question, scope, payload });
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function tokenizeSearchText(value) {
  const base = normalizeSearchText(value);
  const tokens = new Set(base.split(/[^a-z0-9]+/).filter((token) => token.length >= 2));
  const expansions = {
    deutschland: ['de', 'germany', 'german'],
    germany: ['de', 'deutschland', 'german'],
    deutsch: ['de', 'germany', 'german'],
    gasspeicher: ['gas', 'storage', 'agsi', 'speicher', 'fuellstand'],
    gas: ['gasspeicher', 'storage', 'agsi'],
    speicher: ['storage', 'gasspeicher'],
    fuellstand: ['fill', 'level', 'percentage', 'storage'],
    fullstand: ['fill', 'level', 'percentage', 'storage'],
    aktuell: ['current', 'latest'],
    current: ['aktuell', 'latest'],
    pv: ['solar', 'photovoltaik', 'mastr'],
    photovoltaik: ['pv', 'solar', 'mastr'],
  };
  for (const token of Array.from(tokens)) {
    for (const expanded of expansions[token] || []) tokens.add(expanded);
  }
  return tokens;
}

function parseRestDefinition(rest) {
  if (!rest) return null;
  if (typeof rest === 'string') {
    const match = rest.trim().match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
    if (match) return { method: match[1].toUpperCase(), path: match[2].trim() };
    return { method: 'POST', path: rest.trim() };
  }
  if (typeof rest === 'object') {
    const method = String(rest.method || rest.type || 'POST').toUpperCase();
    const path = rest.path || rest.url || rest.fullPath;
    return path ? { method, path: String(path).trim() } : null;
  }
  return null;
}

function normalizeRestPath(serviceName, path) {
  const normalized = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  if (normalized.startsWith('/api/')) return normalized;
  if (normalized.startsWith(`/${serviceName}/`)) return `/api${normalized}`;
  return `/api/${serviceName}${normalized}`;
}

function getActionEntriesFromBroker(broker) {
  const entries = [];
  const services = broker?.registry?.getServiceList
    ? broker.registry.getServiceList({ withActions: true, onlyAvailable: true })
    : [];

  for (const service of services || []) {
    const actions = service.actions || {};
    for (const [actionName, action] of Object.entries(actions)) {
      entries.push({
        serviceName: service.name,
        actionName,
        actionRef: action.name || `${service.name}.${actionName}`,
        action,
      });
    }
  }

  return entries;
}

function getActionOpenApiText(action) {
  const openapi = action?.openapi || {};
  return [
    action?.description,
    openapi.summary,
    openapi.description,
    Array.isArray(openapi.tags) ? openapi.tags.join(' ') : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function isReadOnlyFallbackOperation(operation) {
  if (!operation || UNSAFE_OPERATION_PATTERN.test(operation.searchText)) return false;
  if (operation.method === 'GET') return true;
  return (
    operation.method === 'POST' &&
    READ_ONLY_FALLBACK_POST_SERVICES.has(operation.serviceName)
  );
}

function buildOpenApiFallbackOperationIndex(broker) {
  const operations = [];
  for (const entry of getActionEntriesFromBroker(broker)) {
    const rest = parseRestDefinition(entry.action?.rest);
    if (!rest?.path) continue;
    const searchText = [
      entry.serviceName,
      entry.actionName,
      entry.actionRef,
      rest.method,
      rest.path,
      getActionOpenApiText(entry.action),
      JSON.stringify(entry.action?.params || {}),
      JSON.stringify(entry.action?.openapi?.requestBody || {}),
    ]
      .filter(Boolean)
      .join(' ');
    const operation = {
      serviceName: entry.serviceName,
      actionName: entry.actionName,
      actionRef: entry.actionRef,
      operationId: entry.actionRef.replace(/\./g, '_'),
      method: rest.method,
      path: normalizeRestPath(entry.serviceName, rest.path),
      paramsSchema: entry.action?.params || null,
      requestBody: entry.action?.openapi?.requestBody || null,
      summary: entry.action?.openapi?.summary || entry.action?.description || null,
      searchText: normalizeSearchText(searchText),
    };
    if (isReadOnlyFallbackOperation(operation)) operations.push(operation);
  }
  return operations;
}

function scoreOpenApiFallbackOperation(operation, { question, capability }) {
  const queryTokens = tokenizeSearchText(`${question} ${capability || ''}`);
  const serviceHints = CAPABILITY_SERVICE_HINTS[capability] || [];
  let score = serviceHints.includes(operation.serviceName) ? 100 : 0;

  for (const token of queryTokens) {
    if (operation.searchText.includes(token)) score += token.length > 3 ? 8 : 3;
  }

  if (capability && operation.searchText.includes(normalizeSearchText(capability))) score += 30;
  if (
    /gasspeicher|gas storage|gas/i.test(normalizeSearchText(question)) &&
    operation.serviceName === 'gas-storage'
  ) {
    score += 50;
  }
  if (
    /deutschland|germany|de\b/i.test(normalizeSearchText(question)) &&
    /country/i.test(operation.actionName)
  ) {
    score += 25;
  }
  if (
    /fuellstand|fullstand|fill|level|speicher/i.test(normalizeSearchText(question)) &&
    /storage/i.test(operation.searchText)
  ) {
    score += 25;
  }
  return score;
}

function selectOpenApiFallbackOperation(broker, { question, capability }) {
  if (!capability || capability === 'knowledge-rag') return null;
  const candidates = buildOpenApiFallbackOperationIndex(broker)
    .map((operation) => ({
      ...operation,
      score: scoreOpenApiFallbackOperation(operation, { question, capability }),
    }))
    .sort((a, b) => b.score - a.score);
  const selected = candidates[0];
  if (!selected || selected.score < 120) return null;
  return {
    ...selected,
    alternatives: candidates.slice(1, 4).map((candidate) => ({
      operationId: candidate.operationId,
      actionRef: candidate.actionRef,
      path: candidate.path,
      score: candidate.score,
    })),
  };
}

function resolveCountryCode(question, context = {}, inputs = {}) {
  const explicit = firstString(
    inputs.country,
    context.country,
    inputs.countryCode,
    context.countryCode
  );
  if (explicit && /^[a-z]{2}$/i.test(explicit.trim())) return explicit.trim().toUpperCase();

  const text = normalizeSearchText(
    `${question} ${JSON.stringify(context)} ${JSON.stringify(inputs)}`
  );
  const countryMap = [
    [/deutschland|germany|\bde\b/, 'DE'],
    [/frankreich|france|\bfr\b/, 'FR'],
    [/italien|italy|\bit\b/, 'IT'],
    [/oesterreich|osterreich|austria|\bat\b/, 'AT'],
    [/niederlande|netherlands|\bnl\b/, 'NL'],
    [/belgien|belgium|\bbe\b/, 'BE'],
    [/spanien|spain|\bes\b/, 'ES'],
    [/polen|poland|\bpl\b/, 'PL'],
  ];
  const match = countryMap.find(([pattern]) => pattern.test(text));
  return match ? match[1] : null;
}

function actionRequiresParam(operation, paramName) {
  const schema = operation?.paramsSchema?.[paramName];
  if (!schema) return false;
  if (typeof schema === 'string') return true;
  return schema.optional !== true;
}

function resolveOpenApiFallbackParams(operation, { question, context, inputs }) {
  const params = {};
  const missing = [];

  if (
    operation.paramsSchema?.country ||
    operation.requestBody?.content?.['application/json']?.schema?.properties?.country
  ) {
    const country = resolveCountryCode(question, context, inputs);
    if (country) params.country = country;
    else if (actionRequiresParam(operation, 'country')) missing.push('country');
  }

  for (const [key, schema] of Object.entries(operation.paramsSchema || {})) {
    if (params[key] !== undefined) continue;
    const provided = inputs[key] ?? context[key];
    if (provided !== undefined && provided !== null && provided !== '') {
      params[key] = provided;
      continue;
    }
    if (typeof schema === 'object' && schema.default !== undefined) params[key] = schema.default;
    if (typeof schema === 'object' && schema.type === 'boolean' && params[key] === undefined) {
      params[key] = false;
    }
    if (actionRequiresParam(operation, key) && params[key] === undefined) missing.push(key);
  }

  return { params, missing: Array.from(new Set(missing)) };
}

function unwrapDataPayload(payload) {
  if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload;
}

function formatPercentageValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${number.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`;
}

function formatTwhValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${number.toLocaleString('de-DE', { maximumFractionDigits: 2 })} TWh`;
}

function buildOpenApiFallbackAnswerText({ operation, payload, params }) {
  const data = unwrapDataPayload(payload) || {};
  if (operation.actionRef === 'gas-storage.countryStorage') {
    const fill =
      data.gasInStoragePercentage ??
      data.fillLevelPercentage ??
      data.fillPercentage ??
      data.percentage ??
      data.full;
    const gas = data.gasInStorage ?? data.workingGasInStorage ?? data.storageTwh;
    const capacity = data.fullCapacity ?? data.workingGasVolume ?? data.capacity;
    const date = data.updatedAt || data.timestamp || data.date || data.gasDayStart || null;
    const parts = [
      `Cernion hat per OpenAPI-Fallback ${operation.actionRef} fuer ${params.country || data.country || 'das angefragte Land'} ausgefuehrt.`,
      fill != null ? `Der gemeldete Fuellstand betraegt ${formatPercentageValue(fill) || fill}.` : null,
      gas != null ? `Gas im Speicher: ${formatTwhValue(gas) || gas}.` : null,
      capacity != null ? `Arbeitsgas-/Kapazitaetswert: ${formatTwhValue(capacity) || capacity}.` : null,
      date ? `Zeitstempel/Stand: ${date}.` : null,
    ].filter(Boolean);
    return parts.join(' ');
  }

  return `Cernion hat per OpenAPI-Fallback ${operation.actionRef} ausgefuehrt und eine read-only Antwort erhalten.`;
}

function buildOpenApiMissingInputResponse({ question, capability, operation, missing }) {
  const shortAnswer =
    `Cernion hat einen read-only OpenAPI-Fallback fuer "${capability}" gefunden (${operation.actionRef}), ` +
    `kann ihn aber ohne folgende Pflichtparameter nicht belastbar ausfuehren: ${missing.join(', ')}.`;
  return {
    success: true,
    question,
    shortAnswer,
    confidence: 'low',
    evidence: [],
    capabilityGrounding: {
      requestedCapability: capability,
      mode: 'hard',
      status: 'missing_required_input',
      reason: 'openapi_fallback_missing_input',
      fallbackSource: OPENAPI_FALLBACK_SOURCE,
      notDedicatedCapabilityRoute: true,
      resolvedOperationId: operation.operationId,
      resolvedPath: operation.path,
      method: operation.method,
      missing,
    },
    processContext: [
      `capability:${capability}`,
      `fallback:${OPENAPI_FALLBACK_SOURCE}`,
      'capability_fallback:missing_required_input',
      `source:${operation.actionRef}`,
    ],
    openQuestions: [`Bitte folgende Parameter nachreichen: ${missing.join(', ')}.`],
    recommendedNextSteps: ['Frage mit den fehlenden Parametern wiederholen.'],
    allowedActions: ['explain', 'retrieve_evidence', 'prepare_intent'],
    forbiddenActions: ['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'],
  };
}

function buildOpenApiFallbackResponse({ question, capability, operation, params, payload }) {
  const shortAnswer = buildOpenApiFallbackAnswerText({ operation, payload, params });
  const data = unwrapDataPayload(payload);
  return {
    success: true,
    question,
    shortAnswer,
    confidence: data ? 'medium' : 'low',
    evidence: [
      {
        source: operation.actionRef,
        capability,
        value: shortAnswer,
        metadata: {
          fallbackSource: OPENAPI_FALLBACK_SOURCE,
          notDedicatedCapabilityRoute: true,
          operationId: operation.operationId,
          path: operation.path,
          method: operation.method,
          params,
          data,
        },
      },
    ],
    evidenceBySource: {
      openapiFallback: {
        source: operation.actionRef,
        status: data ? 'available' : 'missing',
        hits: data ? [{ operationId: operation.operationId, path: operation.path }] : [],
      },
    },
    capabilityGrounding: {
      requestedCapability: capability,
      mode: 'hard',
      status: data ? 'fallback' : 'missing',
      reason: OPENAPI_FALLBACK_SOURCE,
      fallbackSource: OPENAPI_FALLBACK_SOURCE,
      notDedicatedCapabilityRoute: true,
      resolvedOperationId: operation.operationId,
      resolvedPath: operation.path,
      method: operation.method,
      action: operation.actionRef,
      score: operation.score,
      alternatives: operation.alternatives,
    },
    processContext: [
      `capability:${capability}`,
      'capability_evidence:fallback',
      `fallback:${OPENAPI_FALLBACK_SOURCE}`,
      `source:${operation.actionRef}`,
      'not_dedicated_capability_route:true',
    ],
    risks: [
      'Diese Antwort stammt aus einem generischen read-only OpenAPI-Fallback, nicht aus einer dedizierten Capability-Route.',
    ],
    openQuestions: [],
    recommendedNextSteps: ['Bei wiederkehrendem Bedarf eine dedizierte Capability-Route fuer diese Datenquelle ergaenzen.'],
    allowedActions: ['explain', 'retrieve_evidence', 'prepare_intent'],
    forbiddenActions: ['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'],
  };
}

async function tryBuildOpenApiFallbackAnswer(ctx, { question, capability, context, inputs }) {
  const operation = selectOpenApiFallbackOperation(ctx.broker, { question, capability });
  if (!operation) return null;

  const resolved = resolveOpenApiFallbackParams(operation, { question, context, inputs });
  if (resolved.missing.length > 0) {
    return buildOpenApiMissingInputResponse({
      question,
      capability,
      operation,
      missing: resolved.missing,
    });
  }

  const payload = await ctx.call(operation.actionRef, resolved.params, {
    meta: {
      cernionToken: ctx.meta?.cernionToken || ctx.meta?.apiToken?.token || null,
      chatgptSidecarFallback: OPENAPI_FALLBACK_SOURCE,
    },
  });

  return buildOpenApiFallbackResponse({
    question,
    capability,
    operation,
    params: resolved.params,
    payload,
  });
}

function generateTurnId() {
  return `cgs_turn_${crypto.randomUUID()}`;
}

function resolveParentTurnId(ctx, context = {}, inputs = {}) {
  const candidates = [
    ctx?.params?.parentTurnId,
    context?.parentTurnId,
    context?.turnId,
    inputs?.parentTurnId,
    inputs?.turnId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function resolveAnswerText(result) {
  if (typeof result?.answer === 'string' && result.answer.trim()) return result.answer;
  if (typeof result?.shortAnswer === 'string' && result.shortAnswer.trim()) return result.shortAnswer;
  if (typeof result?.groundingAnswer === 'string' && result.groundingAnswer.trim()) {
    return result.groundingAnswer;
  }
  return null;
}

function statusFromEvidenceBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  if (typeof bucket.status === 'string') return bucket.status;
  if (Array.isArray(bucket.hits)) return bucket.hits.length > 0 ? 'available' : 'missing';
  return null;
}

function processContextHas(result, expected) {
  return Array.isArray(result?.processContext) && result.processContext.includes(expected);
}

function evidenceBucketHasHits(bucket) {
  return !!bucket && Array.isArray(bucket.hits) && bucket.hits.length > 0;
}

function capabilityMatchesEvidenceItem(item, capability) {
  if (!item || !capability) return false;
  const candidates = [
    item.capability,
    item.sourceCapability,
    item.routeCapability,
    item.metadata?.capability,
    item.metadata?.sourceCapability,
    item.metadata?.routeCapability,
    item.metadata?.capabilityId,
  ];
  return candidates.some((candidate) => candidate === capability);
}

function hasCapabilitySpecificEvidence(result, capability) {
  if (!capability) return true;
  if (result?.capability === capability || result?.requestedCapability === capability) return true;
  if (Array.isArray(result?.evidence) && result.evidence.some((item) => capabilityMatchesEvidenceItem(item, capability))) {
    return true;
  }

  const evidenceBySource = result?.evidenceBySource || {};
  const datapoints = evidenceBySource.datapoints;
  const objects = evidenceBySource.objects;
  return evidenceBucketHasHits(datapoints) || evidenceBucketHasHits(objects);
}

function shouldSuppressGenericFallbackForCapability(result, capability) {
  if (!capability || capability === 'knowledge-rag') return false;
  if (hasCapabilitySpecificEvidence(result, capability)) return false;

  const evidenceBySource = result?.evidenceBySource || {};
  const datapointStatus =
    statusFromEvidenceBucket(evidenceBySource.datapoints) ||
    (processContextHas(result, 'datapoints:missing') ? 'missing' : null);
  const objectStatus =
    statusFromEvidenceBucket(evidenceBySource.objects) ||
    (processContextHas(result, 'objects:missing') ? 'missing' : null);
  const knowledgeStatus =
    statusFromEvidenceBucket(evidenceBySource.knowledge) ||
    (processContextHas(result, 'knowledge:available') ? 'available' : null);

  return (
    datapointStatus === 'missing' &&
    objectStatus === 'missing' &&
    ['available', 'timeout', 'unavailable'].includes(knowledgeStatus)
  );
}

function buildNoCapabilityEvidenceResponse({ question, capability, result }) {
  const fallbackEvidenceCount = Array.isArray(result?.evidence) ? result.evidence.length : 0;
  const processContext = Array.from(
    new Set([
      ...(Array.isArray(result?.processContext) ? result.processContext : []),
      `capability:${capability}`,
      'capability_evidence:missing',
      'generic_fallback:suppressed',
    ])
  );
  const shortAnswer =
    `Für die explizit angeforderte Capability "${capability}" konnte Cernion keine belastbare Capability-Evidence ermitteln. ` +
    'Generische Knowledge-/RAG-Treffer wurden nicht als Antwortgrundlage verwendet.';

  return {
    success: true,
    question,
    shortAnswer,
    groundingAnswer: [
      'GROUNDING ANSWER FUER COPILOT',
      shortAnswer,
      `BENUTZERFRAGE: ${question}`,
      `REQUESTED CAPABILITY: ${capability}`,
      'REASON: no_capability_evidence',
      'ANTWORTREGEL: Sage klar, dass fuer diese explizit angeforderte Cernion-Capability keine belastbare Evidence vorliegt. Erfinde keine Daten und verwende unterdrueckte generische RAG-Treffer nicht als Nachweis.',
    ].join('\n'),
    confidence: 'low',
    evidence: [],
    evidenceBySource: result?.evidenceBySource || null,
    capabilityGrounding: {
      requestedCapability: capability,
      mode: 'hard',
      status: 'missing',
      reason: 'no_capability_evidence',
      genericFallbackSuppressed: true,
      fallbackEvidenceCount,
    },
    processContext,
    risks: [
      `Keine belastbare Evidence fuer die explizit angeforderte Capability "${capability}" gefunden.`,
      fallbackEvidenceCount > 0
        ? 'Generische Fallback-Treffer wurden unterdrueckt, damit ChatGPT sie nicht als Capability-Nachweis ausgibt.'
        : null,
    ].filter(Boolean),
    openQuestions: [
      'Welche konkrete Cernion-Datenquelle, Objekt-ID, Kommune, Anlage oder Zeitreihe soll fuer diese Capability geprueft werden?',
    ],
    recommendedNextSteps: [
      'Capability-spezifische Evidenzquelle pruefen oder eine Session/Action mit passender Datenroute bereitstellen.',
    ],
    allowedActions: ['explain', 'retrieve_evidence', 'prepare_intent'],
    forbiddenActions: ['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'],
  };
}

function buildFollowUpContext({
  turnId,
  parentTurnId,
  resolvedQuestion,
  capability,
  transport,
  result,
  ontology,
  restPlan,
}) {
  return {
    turnId,
    parentTurnId,
    resolvedQuestion,
    capability: capability || null,
    transport,
    confidence: result?.confidence || null,
    ontology: ontology
      ? {
          supported: ontology.supported || false,
          mode: ontology.mode || null,
          fallbackReason: ontology.fallbackReason || null,
        }
      : null,
    restPlan: restPlan
      ? {
          ok: !!restPlan.ok,
          reason: restPlan.reason || null,
          resolved: restPlan.resolved || null,
        }
      : null,
    promptOnly: {
      statefulContextAvailable: true,
      requiresConcreteNextCall: true,
      instruction:
        'Use this context to interpret follow-ups, but the next free-form user question must still be transported by a concrete URL, Action or MCP tool call.',
    },
  };
}

function attachTurnContract({
  session,
  ctx,
  operation,
  transport,
  promptText,
  result,
  context = {},
  inputs = {},
  capability = null,
  ontology = null,
  restPlan = null,
}) {
  const turnId = generateTurnId();
  const parentTurnId = resolveParentTurnId(ctx, context, inputs);
  const resolvedQuestion =
    result?.resolvedQuestion || result?.question || result?.task || promptText || null;
  const answer = resolveAnswerText(result);
  const followUpContext = buildFollowUpContext({
    turnId,
    parentTurnId,
    resolvedQuestion,
    capability,
    transport,
    result,
    ontology,
    restPlan,
  });
  const wrapped = {
    ...result,
    turnId,
    resolvedQuestion,
    followUpContext,
    responseContract: buildResponseContract(),
  };
  if (answer && !wrapped.answer) wrapped.answer = answer;

  defaultStore.recordTurn(session.sessionId, {
    turnId,
    parentTurnId,
    operation,
    transport,
    capability,
    promptHash: shortHash(promptText),
    queryPreview: redactedPreview(resolvedQuestion),
    answerPreview: redactedPreview(answer || result?.shortAnswer || result?.groundingAnswer),
    confidence: result?.confidence || null,
    responseKind: resolveResponseKind(result, restPlan),
    capabilityGrounding: result?.capabilityGrounding
      ? {
          requestedCapability: result.capabilityGrounding.requestedCapability || null,
          status: result.capabilityGrounding.status || null,
          reason: result.capabilityGrounding.reason || null,
          genericFallbackSuppressed: !!result.capabilityGrounding.genericFallbackSuppressed,
        }
      : null,
    restPlan: restPlan
      ? {
          ok: !!restPlan.ok,
          reason: restPlan.reason || null,
          blueprintId: restPlan.blueprintId || restPlan.blueprint?.id || null,
          resolved: restPlan.resolved || null,
        }
      : null,
  });

  return wrapped;
}

function resolveInitialQuestion(metadata) {
  const candidates = [
    metadata?.initialQuestion,
    metadata?.question,
    metadata?.query,
    metadata?.useCase,
    metadata?.task,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function shortHash(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

function redactedPreview(value, maxLength = 220) {
  const text = String(value || '')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text || null;
  return `${text.slice(0, maxLength - 1)}…`;
}

function resolveResponseKind(result, restPlan = null) {
  if (result?.capabilityGrounding?.reason) return result.capabilityGrounding.reason;
  if (Array.isArray(result?.processContext)) {
    if (result.processContext.includes('source:energy-market.installations')) {
      return 'mastr_installations';
    }
    if (result.processContext.includes('generic_fallback:suppressed')) {
      return 'generic_fallback_suppressed';
    }
  }
  if (restPlan?.ok || result?.restPlan || result?.blueprint || result?.blueprintId) {
    return 'blueprint_plan';
  }
  if (Array.isArray(result?.evidence) && result.evidence.length > 0) return 'evidence_answer';
  return result?.success === false ? 'error' : 'answer';
}

function generateDraftDatapointName(sessionId) {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shortSession = String(sessionId)
    .replace(/[^a-z0-9]/gi, '')
    .slice(-8)
    .toLowerCase();
  return `cgs-draft-${shortSession}-${suffix}`;
}

function parseOptionalObject(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeBrowserText(value, fieldName) {
  const normalized = String(value || '').trim();
  if (normalized.length > MAX_BROWSER_QUERY_LENGTH) {
    throw new MoleculerClientError(
      `${fieldName} is too long for the browser-compatible ChatGPT Sidecar GET facade.`,
      400,
      'CHATGPT_SIDECAR_BROWSER_QUERY_TOO_LONG',
      { positiveFollowUps: buildPositiveFollowUps('unsupported_browser_query') }
    );
  }
  return normalized;
}

async function handleAsk(ctx, { browserFacade = false } = {}) {
  const session = resolveActiveSessionOrFail(ctx.params.ticket);
  const rawQuestion = ctx.params.question || ctx.params.query || ctx.params.q;
  const question = browserFacade ? normalizeBrowserText(rawQuestion, 'query') : rawQuestion;
  if (!question) {
    throw new MoleculerClientError(
      'question is required.',
      400,
      'CHATGPT_SIDECAR_QUESTION_REQUIRED'
    );
  }

  const capability = ctx.params.capability || null;
  if (capability && !session.capabilityProfile.includes(capability)) {
    defaultStore.recordMeteringEvent(session.sessionId, 'blocked_policy_attempt', {
      capability,
      action: browserFacade ? 'browser_ask' : 'ask',
    });
    return buildPolicyBlockedResponse({
      reason: 'capability_not_granted',
      capability,
      action: browserFacade ? 'browser_ask' : 'ask',
    });
  }

  defaultStore.recordMeteringEvent(session.sessionId, 'ask_call', {
    capability,
    transport: browserFacade ? 'browser_get' : 'post',
  });

  const context = parseOptionalObject(ctx.params.context);
  const inputs = parseOptionalObject(ctx.params.inputs);
  const ontologyEnabled = session.capabilityProfile.includes('ontology-guardrail');
  const ontology = resolveOntologyContext({ ontologyEnabled, capability });
  if (ontologyEnabled) {
    defaultStore.recordMeteringEvent(session.sessionId, 'ontology_guardrail_used', {
      capability,
      supported: ontology?.supported || false,
    });
  }

  if (capability === 'datasource-mastr') {
    const mastrResult = await tryBuildDatasourceMastrAnswer(ctx, { question, context, inputs });
    if (mastrResult) {
      return attachTurnContract({
        session,
        ctx,
        operation: 'ask',
        transport: browserFacade ? 'browser_get' : 'post',
        promptText: question,
        result: { ...mastrResult, ontology },
        context,
        inputs,
        capability,
        ontology,
        restPlan: null,
      });
    }
  }

  const restPlan = compileReadOnlyExecutionPlan({
    question,
    context: { ...context, ...inputs, tenantId: session.tenantId },
    broker: ctx.broker,
  });

  if (restPlan.ok) {
    const answer = buildAskBlueprintAnswer(restPlan, { question, sessionId: null });
    return attachTurnContract({
      session,
      ctx,
      operation: 'ask',
      transport: browserFacade ? 'browser_get' : 'post',
      promptText: question,
      result: { ...answer, ontology },
      context,
      inputs,
      capability,
      ontology,
      restPlan,
    });
  }

  const openApiFallbackResult = await tryBuildOpenApiFallbackAnswer(ctx, {
    question,
    capability,
    context,
    inputs,
  });
  if (openApiFallbackResult) {
    return attachTurnContract({
      session,
      ctx,
      operation: 'ask',
      transport: browserFacade ? 'browser_get' : 'post',
      promptText: question,
      result: { ...openApiFallbackResult, ontology },
      context,
      inputs,
      capability,
      ontology,
      restPlan,
    });
  }

  const result = await ctx.call('personal-agent.askCernionAgent', {
    question,
    sessionId: null,
    context: {
      ...context,
      tenantId: session.tenantId,
      requestedCapability: capability,
      capabilityGrounding: capability ? 'hard' : null,
    },
    inputs,
    domain: 'auto',
    mode: 'answer',
    maxEvidence: 5,
  });
  const groundedResult = shouldSuppressGenericFallbackForCapability(result, capability)
    ? buildNoCapabilityEvidenceResponse({ question, capability, result })
    : result;

  return attachTurnContract({
    session,
    ctx,
    operation: 'ask',
    transport: browserFacade ? 'browser_get' : 'post',
    promptText: question,
    result: { ...groundedResult, ontology },
    context,
    inputs,
    capability,
    ontology,
    restPlan,
  });
}

async function handlePlan(ctx, { browserFacade = false } = {}) {
  const session = resolveActiveSessionOrFail(ctx.params.ticket);
  const task = browserFacade
    ? normalizeBrowserText(ctx.params.task || ctx.params.q, 'task')
    : ctx.params.task;
  if (!task || task.length < 3) {
    throw new MoleculerClientError('task is required.', 400, 'CHATGPT_SIDECAR_TASK_REQUIRED');
  }

  const capability = ctx.params.capability || null;
  if (capability && !session.capabilityProfile.includes(capability)) {
    defaultStore.recordMeteringEvent(session.sessionId, 'blocked_policy_attempt', {
      capability,
      action: browserFacade ? 'browser_plan' : 'plan',
    });
    return buildPolicyBlockedResponse({
      reason: 'capability_not_granted',
      capability,
      action: browserFacade ? 'browser_plan' : 'plan',
    });
  }

  defaultStore.recordMeteringEvent(session.sessionId, 'plan_call', {
    capability,
    transport: browserFacade ? 'browser_get' : 'post',
  });

  const context = parseOptionalObject(ctx.params.context);
  const ontologyEnabled = session.capabilityProfile.includes('ontology-guardrail');
  const ontology = resolveOntologyContext({ ontologyEnabled, capability });
  if (ontologyEnabled) {
    defaultStore.recordMeteringEvent(session.sessionId, 'ontology_guardrail_used', {
      capability,
      supported: ontology?.supported || false,
    });
  }

  const recommendation = await ctx.call('capability-broker.recommend', {
    mode: 'initial',
    task,
    knownContext: { ...context, tenantId: session.tenantId },
  });

  const restPlan = compileReadOnlyExecutionPlan({
    question: task,
    context: { ...context, tenantId: session.tenantId },
    broker: ctx.broker,
  });

  return attachTurnContract({
    session,
    ctx,
    operation: 'plan',
    transport: browserFacade ? 'browser_get' : 'post',
    promptText: task,
    context,
    capability,
    ontology,
    restPlan,
    result: {
      success: true,
      task,
      recommendation,
      restPlan: restPlan.ok
        ? { resolved: restPlan.resolved, recommendedEndpoints: restPlan.recommendedEndpoints }
        : { ok: false, reason: restPlan.reason },
      ontology,
      writeScope: session.writeScope,
    },
  });
}

// Fails closed: requires a real authenticated tenant, a non-read-only token
// scope, and the explicit `chatgpt-sidecar-creator` role/scope — an operator
// must grant that role deliberately (e.g. custom API-token scope or IdP group
// mapping); it is never implied by `full-access` alone, unlike the existing
// `hitl-approver` transition role.
function assertCreatorAllowed(ctx) {
  const tenantId = getAuthenticatedTenant(ctx);
  if (!tenantId) {
    throw new MoleculerClientError(
      'Authentication required to create or revoke a ChatGPT Sidecar session.',
      401,
      'AUTH_REQUIRED'
    );
  }

  const scope = getAuthTokenScope(ctx);
  if (scope === 'read-only') {
    throw new MoleculerClientError(
      'A read-only token cannot create or revoke a ChatGPT Sidecar session.',
      403,
      'CHATGPT_SIDECAR_CREATE_FORBIDDEN'
    );
  }

  const roles = ctx?.meta?.authUser?.roles || [];
  if (!hasRole(roles, CREATOR_ROLE)) {
    throw new MoleculerClientError(
      `Role required: ${CREATOR_ROLE}.`,
      403,
      'CHATGPT_SIDECAR_CREATE_FORBIDDEN'
    );
  }

  return { tenantId, userId: getAuthenticatedUserId(ctx) };
}

// Unknown and revoked tickets return the identical hard failure (404) so a
// caller cannot use response shape to confirm a ticket ever existed. Expiry
// is a distinguishable, expected lifecycle event and returns 410 with a
// regenerate-session instruction, per the issue's acceptance criteria.
function resolveActiveSessionOrFail(ticket) {
  const resolution = defaultStore.resolveByTicket(ticket);
  if (resolution.status === 'not_found') {
    throw new MoleculerClientError(
      'Unknown or revoked ChatGPT Sidecar session ticket.',
      404,
      'CHATGPT_SIDECAR_TICKET_NOT_FOUND'
    );
  }
  if (resolution.status === 'expired') {
    throw new MoleculerClientError(
      'This ChatGPT Sidecar session has expired. Ask the user to generate a new session/prompt.',
      410,
      'CHATGPT_SIDECAR_SESSION_EXPIRED'
    );
  }
  return resolution.session;
}

module.exports = {
  name: 'chatgpt-sidecar',

  actions: {
    createSession: {
      rest: 'POST /sessions',
      params: {
        ttl: { type: 'string', optional: true, default: DEFAULT_TTL },
        capabilityProfile: { type: 'array', optional: true, default: [] },
        writeScope: { type: 'string', optional: true, default: DEFAULT_WRITE_SCOPE },
        origin: { type: 'string', optional: true, default: 'chatgpt_prompt_generator' },
        metadata: { type: 'object', optional: true, default: {} },
        baseUrl: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Create a ChatGPT Sidecar session ticket with scoped capabilities',
        description:
          'Requires an authenticated Cernion tenant/user with the chatgpt-sidecar-creator ' +
          'role. Returns an opaque ticket URL and backend-generated prompt text; the ' +
          'response never echoes the session id/prompt back through the ticket endpoints.',
      },
      async handler(ctx) {
        const { tenantId, userId } = assertCreatorAllowed(ctx);

        if (!isValidTtl(ctx.params.ttl)) {
          throw new MoleculerClientError(
            `Invalid ttl. Allowed values: ${Object.keys(TTL_OPTIONS).join(', ')}.`,
            400,
            'CHATGPT_SIDECAR_INVALID_TTL'
          );
        }

        const capabilityProfile = normalizeCapabilityProfile(ctx.params.capabilityProfile);
        const writeScope = resolveWriteScope(ctx.params.writeScope);

        const created = defaultStore.createSession({
          tenantId,
          userId,
          ttl: ctx.params.ttl,
          capabilityProfile,
          writeScope,
          origin: ctx.params.origin,
          metadata: ctx.params.metadata,
          baseUrl: ctx.params.baseUrl,
        });

        if (!created.ok) {
          throw new MoleculerClientError(
            'Unable to create ChatGPT Sidecar session.',
            400,
            'CHATGPT_SIDECAR_SESSION_CREATE_FAILED'
          );
        }

        const { session } = created;
        defaultStore.recordMeteringEvent(session.sessionId, 'session_created', {
          ttl: session.ttl,
        });

        const manifestUrl = buildManifestUrl(session.baseUrl, session.ticket);
        const actionOpenApiUrl = buildActionOpenApiUrl(session.baseUrl, session.ticket);
        const actionSetup = buildActionSetup(session.baseUrl, session.ticket);
        const initialQuestion = resolveInitialQuestion(session.metadata);
        const initialAskUrl = buildBrowserAskUrl(session.baseUrl, session.ticket, initialQuestion);
        const promptText = buildPromptText({
          manifestUrl,
          initialAskUrl,
          expiresAt: session.expiresAt,
          capabilityProfile: session.capabilityProfile,
          writeScope: session.writeScope,
          ontologyEnabled: session.capabilityProfile.includes('ontology-guardrail'),
        });

        return {
          success: true,
          sessionId: session.sessionId,
          ticketUrl: manifestUrl,
          actionOpenApiUrl,
          actionSetup,
          initialAskUrl,
          expiresAt: session.expiresAt,
          promptText,
          capabilities: session.capabilityProfile,
          writeScope: session.writeScope,
        };
      },
    },

    revokeSession: {
      rest: 'DELETE /sessions/:sessionId',
      params: { sessionId: { type: 'string', min: 1 } },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Revoke a ChatGPT Sidecar session (authenticated Cernion side only)',
      },
      handler(ctx) {
        const { tenantId } = assertCreatorAllowed(ctx);
        const result = defaultStore.revoke(ctx.params.sessionId, { tenantId });
        if (!result.ok) {
          throw new MoleculerClientError(
            'Session not found.',
            404,
            'CHATGPT_SIDECAR_SESSION_NOT_FOUND'
          );
        }
        defaultStore.recordMeteringEvent(result.session.sessionId, 'session_revoked', {});
        return {
          success: true,
          sessionId: result.session.sessionId,
          revokedAt: result.session.revokedAt,
        };
      },
    },

    manifest: {
      rest: 'GET /s/:ticket/manifest',
      params: { ticket: { type: 'string', min: 1 } },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Read the session-scoped capability manifest (allowlist only)',
        parameters: [
          {
            name: 'ticket',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'opaque-ticket' },
            description: 'Opaque ChatGPT Sidecar session ticket.',
          },
        ],
      },
      handler(ctx) {
        const session = resolveActiveSessionOrFail(ctx.params.ticket);
        defaultStore.recordMeteringEvent(session.sessionId, 'manifest_read', {});
        const redacted = redactSessionForClient(session);
        return {
          success: true,
          schemaVersion: 'cernion.chatgpt-sidecar.v1',
          ...redacted,
          initialAskUrl: buildBrowserAskUrl(
            session.baseUrl,
            session.ticket,
            resolveInitialQuestion(session.metadata)
          ),
          endpoints: {
            manifest: `GET /api/chatgpt-sidecar/s/${session.ticket}/manifest`,
            ask: `POST /api/chatgpt-sidecar/s/${session.ticket}/ask`,
            browserAsk: `GET /api/chatgpt-sidecar/s/${session.ticket}/ask?query={urlencoded_question}&capability={optional_capability}`,
            plan: `POST /api/chatgpt-sidecar/s/${session.ticket}/plan`,
            browserPlan: `GET /api/chatgpt-sidecar/s/${session.ticket}/plan?task={urlencoded_task}&capability={optional_capability}`,
            actionOpenApi: `GET /api/chatgpt-sidecar/s/${session.ticket}/action-openapi.json`,
            datapoints: `POST /api/chatgpt-sidecar/s/${session.ticket}/datapoints`,
            metering: `GET /api/chatgpt-sidecar/s/${session.ticket}/metering`,
          },
          primaryIntegration: 'custom_gpt_action',
          actionSetup: buildActionSetup(session.baseUrl, session.ticket),
          browserFacade: {
            safety: 'read_only_non_consequential',
            maxQueryLength: MAX_BROWSER_QUERY_LENGTH,
            ...buildBrowserUrlTemplates(session.baseUrl, session.ticket),
            pythonClient: buildPythonClientHints(session.baseUrl, session.ticket),
            positiveFollowUps: {
              expiredOrRevokedTicket: buildPositiveFollowUps('expired_or_revoked_ticket'),
              unsupportedBrowserQuery: buildPositiveFollowUps('unsupported_browser_query'),
            },
            unavailableOperations: [
              'datapoint_write_via_get',
              'hitl_or_workflow_creation',
              'mail_or_webhook',
              'mako_billing_settlement_tariff',
              'smgw_cls_device_control_dispatch',
              'external_connector_call',
              'public_context_or_production_mutation',
            ],
          },
          responseContract: buildResponseContract(),
          conversation: {
            stateful: true,
            turnState: 'server_recorded',
            turnIdField: 'turnId',
            parentTurnIdField: 'parentTurnId',
            followUpContextField: 'followUpContext',
            promptOnlyTransportBoundary:
              'Server-side turn state helps resolve context after a call, but it does not let a prompt-only browser client send arbitrary new follow-up text without a concrete URL, Action or MCP tool call.',
          },
        };
      },
    },

    actionOpenApi: {
      rest: 'GET /s/:ticket/action-openapi.json',
      params: { ticket: { type: 'string', min: 1 } },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Read the session-scoped Custom GPT Action OpenAPI schema',
        description:
          'Returns a minimal ticket-scoped OpenAPI schema for Custom GPT Actions. The schema intentionally exposes only read-only ask/plan operations.',
        parameters: [
          {
            name: 'ticket',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'opaque-ticket' },
            description: 'Opaque ChatGPT Sidecar session ticket.',
          },
        ],
      },
      handler(ctx) {
        const session = resolveActiveSessionOrFail(ctx.params.ticket);
        defaultStore.recordMeteringEvent(session.sessionId, 'action_openapi_read', {});
        return buildActionOpenApiSchema(session.baseUrl, session);
      },
    },

    ask: {
      rest: 'POST /s/:ticket/ask',
      params: {
        ticket: { type: 'string', min: 1 },
        question: { type: 'string', optional: true },
        query: { type: 'string', optional: true },
        context: { type: 'object', optional: true, default: {} },
        inputs: { type: 'object', optional: true, default: {} },
        capability: { type: 'string', optional: true },
        parentTurnId: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Ask Cernion through the session-scoped evidence/capability facade',
      },
      async handler(ctx) {
        return handleAsk(ctx);
      },
    },

    browserAsk: {
      rest: 'GET /s/:ticket/ask',
      params: {
        ticket: { type: 'string', min: 1 },
        question: { type: 'string', optional: true },
        query: { type: 'string', optional: true },
        q: { type: 'string', optional: true },
        context: { type: 'any', optional: true },
        inputs: { type: 'any', optional: true },
        capability: { type: 'string', optional: true },
        parentTurnId: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Ask Cernion through a browser-compatible read-only GET facade',
        description:
          'For prompt-only ChatGPT.com usage where only URL reads are available. This ' +
          'facade is read-only and delegates to the same session policy as POST ask.',
      },
      async handler(ctx) {
        return handleAsk(ctx, { browserFacade: true });
      },
    },

    plan: {
      rest: 'POST /s/:ticket/plan',
      params: {
        ticket: { type: 'string', min: 1 },
        task: { type: 'string', min: 3 },
        context: { type: 'object', optional: true, default: {} },
        capability: { type: 'string', optional: true },
        parentTurnId: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Resolve a request to a Blueprint/Capability Broker route (no execution)',
      },
      async handler(ctx) {
        return handlePlan(ctx);
      },
    },

    browserPlan: {
      rest: 'GET /s/:ticket/plan',
      params: {
        ticket: { type: 'string', min: 1 },
        task: { type: 'string', optional: true },
        q: { type: 'string', optional: true },
        context: { type: 'any', optional: true },
        capability: { type: 'string', optional: true },
        parentTurnId: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Resolve a request through a browser-compatible read-only GET facade',
        description:
          'For prompt-only ChatGPT.com usage where only URL reads are available. This ' +
          'facade is read-only and delegates to the same session policy as POST plan.',
      },
      async handler(ctx) {
        return handlePlan(ctx, { browserFacade: true });
      },
    },

    datapoints: {
      rest: 'POST /s/:ticket/datapoints',
      params: {
        ticket: { type: 'string', min: 1 },
        capability: { type: 'string', optional: true, default: 'draft-datapoints' },
        writeClass: { type: 'string', optional: true, default: DEFAULT_WRITE_SCOPE },
        value: { type: 'any' },
        description: { type: 'string', optional: true, default: '' },
        message: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Create a draft datapoint through the session (draft_write only)',
        description:
          'Only draft_write mutates in this slice. controlled_write, process_execute and ' +
          'requires_confirmation return a policy decision without creating anything.',
      },
      async handler(ctx) {
        const session = resolveActiveSessionOrFail(ctx.params.ticket);
        const capability = ctx.params.capability || 'draft-datapoints';

        const decision = evaluateWriteRequest({
          requestedWriteClass: ctx.params.writeClass,
          session,
          capability,
        });

        if (decision.decision !== 'allowed') {
          defaultStore.recordMeteringEvent(session.sessionId, 'blocked_policy_attempt', {
            action: 'datapoints',
            writeClass: decision.writeClass,
            reason: decision.reason,
          });
          return {
            success: false,
            error: 'sidecar_policy_blocked',
            decision: decision.decision,
            reason: decision.reason,
            writeClass: decision.writeClass,
          };
        }

        const now = new Date().toISOString();
        const promptHash = shortHash(ctx.params.message);
        const name = generateDraftDatapointName(session.sessionId);

        await ctx.call('datapoint.create', {
          name,
          value: ctx.params.value,
          description: ctx.params.description,
          owner: 'chatgpt-sidecar',
          tags: ['chatgpt-sidecar', 'draft'],
          oeoTags: [],
          provenance: 'chatgpt_sidecar',
          metadata: {
            origin: 'chatgpt_sidecar',
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            userId: session.userId,
            capability,
            promptHash,
            timestamp: now,
            policyResult: decision.decision,
          },
        });

        defaultStore.recordMeteringEvent(session.sessionId, 'draft_datapoint_created', {
          capability,
        });

        return {
          success: true,
          datapointName: name,
          capability,
          writeScope: 'draft_write',
          createdAt: now,
          policyResult: decision.decision,
        };
      },
    },

    metering: {
      rest: 'GET /s/:ticket/metering',
      params: { ticket: { type: 'string', min: 1 } },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Read a redacted metering summary for the session',
        parameters: [
          {
            name: 'ticket',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Opaque ChatGPT Sidecar session ticket.',
          },
        ],
      },
      handler(ctx) {
        const session = resolveActiveSessionOrFail(ctx.params.ticket);
        const summary = defaultStore.getMeteringSummary(session.sessionId);
        return { success: true, ...summary };
      },
    },
  },
};
