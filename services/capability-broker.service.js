const {
  BROKER_SCHEMA_VERSION,
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
  GLOBAL_DO_NOT_USE,
} = require('../src/capability-catalog');
const { buildServiceCatalogue } = require('../src/agent-planning-utils');

const MODES = new Set(['initial', 'next_step', 'repair', 'compare']);

function normalizeRequestSchemaVersion(schemaVersion, warnings) {
  if (!schemaVersion) {
    warnings.push(
      `Missing request schemaVersion mapped to ${BROKER_SCHEMA_VERSION}`
    );
    return BROKER_SCHEMA_VERSION;
  }
  if (schemaVersion !== BROKER_SCHEMA_VERSION) {
    warnings.push(
      `Unsupported request schemaVersion mapped to ${BROKER_SCHEMA_VERSION}`
    );
    return BROKER_SCHEMA_VERSION;
  }
  return schemaVersion;
}

function normalizeMode(mode, alreadyExecutedSteps, compareCandidates, warnings) {
  if (!mode || !MODES.has(mode)) {
    return 'initial';
  }

  if (mode === 'next_step' && alreadyExecutedSteps.length === 0) {
    warnings.push(
      'Requested mode next_step but alreadyExecutedSteps was empty; degraded to initial recommendation.'
    );
    return 'initial';
  }

  if (mode === 'repair' && alreadyExecutedSteps.length === 0) {
    warnings.push(
      'Requested mode repair without step/error context; degraded to initial recommendation.'
    );
    return 'initial';
  }

  if (mode === 'compare' && compareCandidates.length === 0) {
    warnings.push(
      'Requested mode compare but no candidates were provided; degraded to initial recommendation.'
    );
    return 'initial';
  }

  return mode;
}

function findBestCapability(taskText) {
  const haystack = taskText.toLowerCase();

  const findCapabilityByName = (capabilityName) =>
    CURATED_CAPABILITIES.find((capability) => capability.capability === capabilityName) || null;

  const cyaSignals = [
    'versorgungssicherheit',
    'belastbare aussagen',
    'journalist',
    'fazit',
    'unsicher',
    'kernaussagen',
  ];
  const benchmarkSignals = [
    'benchmark',
    'vergleich',
    'rangliste',
    'digitalisierungsindex',
    'umsetzungsquote',
    'kpi',
  ];
  const fnavSignals = [
    'netzfahrplan',
    'n-1',
    'requestedcapacitykw',
    'voltage level',
    'rechenzentrum',
    'kupferausbau',
    'firm capacity',
    'flexible capacity',
  ];
  const vdmiGovernanceSignals = [
    'arealnetzbetreiber',
    '§17 enwg',
    '17 enwg',
    'ohne formales netzanschlussbegehren',
    'netzanschlussbegehren',
    'projektträger nicht netzbetreiber',
    'darf keine netzanschlusszusage treffen',
    'zulässige aussagen',
    'rollengrenze',
  ];

  const hasVdmiBoundaryCombo =
    /(rollen|rolle|schnittstellen)/i.test(haystack)
    && /(netzanschluss|enwg|arealnetz|gatekeeper)/i.test(haystack);

  if (vdmiGovernanceSignals.some((signal) => haystack.includes(signal)) || hasVdmiBoundaryCombo) {
    const vdmiGovernanceCapability = findCapabilityByName('vdmi_role_boundary_governance');
    if (vdmiGovernanceCapability) {
      return {
        capability: vdmiGovernanceCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (cyaSignals.some((signal) => haystack.includes(signal))) {
    const cyaCapability = findCapabilityByName('cya_assessment_briefing');
    if (cyaCapability) {
      return {
        capability: cyaCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (benchmarkSignals.some((signal) => haystack.includes(signal))) {
    const benchmarkCapability = findCapabilityByName('vnb_kpi_benchmark_comparison');
    if (benchmarkCapability) {
      return {
        capability: benchmarkCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (fnavSignals.some((signal) => haystack.includes(signal))) {
    const fnavCapability = findCapabilityByName('netzfahrplan_fnav_assessment');
    if (fnavCapability) {
      return {
        capability: fnavCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  let best = null;

  for (const capability of CURATED_CAPABILITIES) {
    let score = capability.keywords.reduce(
      (acc, keyword) => (haystack.includes(keyword.toLowerCase()) ? acc + 1 : acc),
      0
    );

    if (capability.capability === 'mastr_asset_inventory') {
      const hasExplicitMastrSignal = [
        'mastr',
        'redispatch',
        'fernsteuerbarkeit',
        'anlage',
        'anlagen',
        'pv',
        'wind',
        'speicher',
      ].some((signal) => haystack.includes(signal));

      const hasCompetingScenarioSignal = [...cyaSignals, ...benchmarkSignals, ...fnavSignals].some(
        (signal) => haystack.includes(signal)
      );

      if (!hasExplicitMastrSignal || hasCompetingScenarioSignal) {
        score = 0;
      }
    }

    if (!best || score > best.score) {
      best = { capability, score };
    }
  }

  if (!best || best.score === 0) {
    return {
      capability: INTERFACE_PLACEHOLDER_CAPABILITY,
      score: 0,
      usedFallback: true,
    };
  }

  return {
    capability: best.capability,
    score: best.score,
    usedFallback: false,
  };
}

function buildActionTemplate(action) {
  if (action === 'interface-placeholder.markGap') {
    return {
      role: null,
      reason: 'NEEDS_INTERFACE',
      blockingLevel: 'soft',
      replacementCriteria: {
        kind: 'process',
        capabilityHint: null,
        deadline: null,
      },
    };
  }
  if (action === 'interface-placeholder.requestEvidence') {
    return {
      placeholderId: '__previous_step.placeholder.placeholderId',
    };
  }
  if (action === 'interface-placeholder.listGaps') {
    return {
      includeResolved: false,
      limit: 25,
    };
  }
  if (action === 'znp.assessPortfolio') {
    return {
      projectId: null,
      kaufmaennischeFreigabeFnav: false,
    };
  }
  if (action === 'grid-operations.marketPartners') {
    return {
      query: null,
      limit: 3,
    };
  }
  if (action === 'grid-operations.vnbLookup') {
    return {
      bdew: '__step_1.data.results[0].bdewCode',
      city: '__step_1.data.results[0].contacts[0].city',
    };
  }
  if (action === 'residual-load.netResidualLoad') {
    return {
      gridOperatorMastrId: '__step_2.data.mastrId',
      region: '__step_1.data.results[0].contacts[0].city',
      forecastDays: null,
    };
  }
  if (action === 'energy-market.co2Intensity') {
    return {
      location: '__step_1.data.results[0].contacts[0].city',
      forecast: true,
      resolution: 'hourly',
    };
  }
  if (action === 'energy-market.prices') {
    return {
      market: 'day-ahead',
      region: 'Deutschland',
      startDate: null,
      endDate: null,
    };
  }
  if (action === 'grid-connection.fnavValidate') {
    return {
      gridOperatorId: null,
      gridOperatorBdew: null,
      gridOperatorName: null,
      voltageLevel: null,
      ownerContact: null,
      fnavProfile: null,
    };
  }
  if (action === 'grid-operations.netzfahrplanGenerate') {
    return {
      gridOperatorName: null,
      voltageLevel: null,
      requestedCapacityKW: null,
      firmCapacityKW: null,
      flexibleCapacityKW: null,
      curtailmentWindow: null,
      contractStatus: null,
      legalStatus: null,
      ownerContact: null,
    };
  }
  if (action === 'finance-agent.fnavEconomics') {
    return {
      gridOperator: null,
      voltageLevel: null,
      ownerContact: null,
      annualFeeEur: null,
      fnavProfile: null,
    };
  }
  if (action === 'vdmi.agentRole') {
    return {
      agentId: null,
      processType: 'grid-connection-governance',
      taskId: null,
    };
  }
  if (action === 'vdmi.context') {
    return {
      jobId: null,
    };
  }
  if (action === 'ewk-monitoring.benchmarkVnb') {
    return {
      vnbName: null,
      bnr: null,
    };
  }
  if (action === 'datasource-cache.query') {
    return {
      sourceId: null,
      query: null,
    };
  }
  if (action === 'in-memory-join.meteringSpotCost') {
    return {
      sourceId: null,
      date: null,
    };
  }
  return {};
}

function parseBenchmarkNames(taskText = '') {
  const text = String(taskText || '');
  const againstMatch = text.match(/\b(?:benchmark(?:e|t)?|vergleich(?:e|t)?)\s+(.+?)\s+gegen\s+(.+?)(?:[\.!?]|$)/i);
  if (againstMatch) {
    const first = String(againstMatch[1] || '').trim();
    const secondPart = String(againstMatch[2] || '').trim();
    const second = secondPart.split(/\s+(?:und|,|vs\.?|versus)\s+/i)[0]?.trim() || secondPart;
    return {
      vnb1Name: first || null,
      vnb2Name: second || null,
    };
  }
  return {
    vnb1Name: null,
    vnb2Name: null,
  };
}

function parseRequestedCapacityKW(taskText = '') {
  const text = String(taskText || '');
  const explicitMatch = text.match(/\brequested\s*capacity\s*kw\s*[:=]?\s*(\d+(?:[\.,]\d+)?)/i)
    || text.match(/\brequestedcapacitykw\s*[:=]?\s*(\d+(?:[\.,]\d+)?)/i)
    || text.match(/\brequested\s*capacity\s*[:=]?\s*(\d+(?:[\.,]\d+)?)/i);
  if (explicitMatch) {
    return Number(String(explicitMatch[1]).replace(',', '.'));
  }
  return null;
}

function buildFnavProfile(knownContext = {}, taskText = '') {
  if (knownContext?.fnavProfile && typeof knownContext.fnavProfile === 'object') {
    return knownContext.fnavProfile;
  }

  const requestedCapacity =
    knownContext?.requestedCapacityKW
    ?? knownContext?.requestedCapacity
    ?? parseRequestedCapacityKW(taskText);

  if (requestedCapacity == null) {
    return null;
  }

  return {
    requestedCapacity,
    firmCapacity: knownContext?.firmCapacity ?? knownContext?.firmCapacityKW,
    flexibleCapacity: knownContext?.flexibleCapacity ?? knownContext?.flexibleCapacityKW,
    curtailmentWindow: knownContext?.curtailmentWindow,
    contractStatus: knownContext?.contractStatus,
    legalStatus: knownContext?.legalStatus,
  };
}

function interpolateTemplateWithKnownContext(action, paramsTemplate = {}, knownContext = {}, taskText = '') {
  const hydrated = { ...(paramsTemplate || {}) };
  const parsedBenchmarkNames = parseBenchmarkNames(taskText);
  const parsedRequestedCapacityKW = parseRequestedCapacityKW(taskText);
  const queryCandidate =
    knownContext.query ||
    knownContext.vnb1Name ||
    parsedBenchmarkNames.vnb1Name ||
    knownContext.vnb1Name ||
    knownContext.gridOperatorName ||
    knownContext.operatorName ||
    String(taskText || '').trim() ||
    '*';

  if (action === 'grid-operations.marketPartners') {
    if (hydrated.query === null || hydrated.query === undefined || hydrated.query === '') {
      hydrated.query = queryCandidate;
    }
  }

  if (action === 'ewk-monitoring.benchmarkVnb') {
    if (hydrated.vnbName == null) {
      hydrated.vnbName = knownContext.vnbName || knownContext.vnb1Name || parsedBenchmarkNames.vnb1Name || null;
    }
    if (hydrated.bnr == null && knownContext.bnr) {
      hydrated.bnr = knownContext.bnr;
    }
  }

  if (action === 'grid-connection.fnavValidate') {
    if (hydrated.gridOperatorName == null && knownContext.gridOperatorName) {
      hydrated.gridOperatorName = knownContext.gridOperatorName;
    }
    if (hydrated.voltageLevel == null && knownContext.voltageLevel) {
      hydrated.voltageLevel = knownContext.voltageLevel;
    }
    if (hydrated.ownerContact == null && knownContext.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
    if (hydrated.fnavProfile == null) {
      hydrated.fnavProfile = buildFnavProfile(knownContext, taskText);
    }
  }

  if (action === 'grid-operations.netzfahrplanGenerate') {
    if (hydrated.gridOperatorName == null && knownContext.gridOperatorName) {
      hydrated.gridOperatorName = knownContext.gridOperatorName;
    }
    if (hydrated.voltageLevel == null && knownContext.voltageLevel) {
      hydrated.voltageLevel = knownContext.voltageLevel;
    }
    if (hydrated.requestedCapacityKW == null) {
      hydrated.requestedCapacityKW =
        knownContext.requestedCapacityKW
        ?? knownContext.requestedCapacity
        ?? parsedRequestedCapacityKW;
    }
    if (hydrated.firmCapacityKW == null) {
      hydrated.firmCapacityKW = knownContext.firmCapacityKW ?? knownContext.firmCapacity ?? null;
    }
    if (hydrated.flexibleCapacityKW == null) {
      hydrated.flexibleCapacityKW = knownContext.flexibleCapacityKW ?? knownContext.flexibleCapacity ?? null;
    }
    if (hydrated.curtailmentWindow == null && knownContext.curtailmentWindow != null) {
      hydrated.curtailmentWindow = knownContext.curtailmentWindow;
    }
    if (hydrated.contractStatus == null && knownContext.contractStatus) {
      hydrated.contractStatus = knownContext.contractStatus;
    }
    if (hydrated.legalStatus == null && knownContext.legalStatus) {
      hydrated.legalStatus = knownContext.legalStatus;
    }
    if (hydrated.ownerContact == null && knownContext.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
  }

  if (action === 'finance-agent.fnavEconomics') {
    if (hydrated.gridOperator == null) {
      hydrated.gridOperator = knownContext.gridOperator || knownContext.gridOperatorName || null;
    }
    if (hydrated.voltageLevel == null && knownContext.voltageLevel) {
      hydrated.voltageLevel = knownContext.voltageLevel;
    }
    if (hydrated.ownerContact == null && knownContext.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
    if (hydrated.annualFeeEur == null && knownContext.annualFeeEur != null) {
      hydrated.annualFeeEur = knownContext.annualFeeEur;
    }
    if (hydrated.fnavProfile == null) {
      hydrated.fnavProfile = buildFnavProfile(knownContext, taskText);
    }
  }

  return hydrated;
}

function buildRequiredInputSet(capability, requiredActions) {
  const fields = [];
  const seen = new Set();

  for (const input of capability.requiredInputs || []) {
    if (seen.has(input.name)) continue;
    seen.add(input.name);
    fields.push({
      ...input,
      default: input.default !== undefined ? input.default : undefined,
    });
  }

  const hasPriceStep = requiredActions.includes('energy-market.prices');
  if (hasPriceStep) {
    if (!seen.has('startDate')) {
      fields.push({
        name: 'startDate',
        label: 'Startdatum',
        type: 'date',
        required: true,
      });
      seen.add('startDate');
    }
    if (!seen.has('endDate')) {
      fields.push({
        name: 'endDate',
        label: 'Enddatum',
        type: 'date',
        required: true,
      });
      seen.add('endDate');
    }
  }

  return fields;
}

function discoverSupplementalActions(services, taskText, blockedActions) {
  const catalogue = buildServiceCatalogue(services);
  const words = taskText
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);

  const picks = [];
  for (const item of catalogue) {
    if (blockedActions.has(item.actionName)) continue;
    const text = `${item.actionName} ${item.description || ''} ${item.descriptionDetail || ''}`.toLowerCase();
    const hit = words.some((w) => text.includes(w));
    if (hit) {
      picks.push(item.actionName);
    }
    if (picks.length >= 3) break;
  }

  return picks;
}

module.exports = {
  name: 'capability-broker',

  settings: {
    defaultTimeout: 30 * 1000,
  },

  actions: {
    recommend: {
      params: {
        schemaVersion: { type: 'string', optional: true },
        mode: {
          type: 'enum',
          values: ['initial', 'next_step', 'repair', 'compare'],
          optional: true,
          default: 'initial',
        },
        task: { type: 'string', min: 3 },
        agentRole: { type: 'string', optional: true },
        knownContext: { type: 'object', optional: true, default: {} },
        alreadyExecutedSteps: { type: 'array', optional: true, default: [] },
        currentQuestion: { type: 'string', optional: true },
        compareCandidates: { type: 'array', optional: true, default: [] },
        doNotUse: { type: 'array', optional: true, default: [] },
      },
      async handler(ctx) {
        const warnings = [];
        normalizeRequestSchemaVersion(ctx.params.schemaVersion, warnings);

        const alreadyExecutedSteps = Array.isArray(ctx.params.alreadyExecutedSteps)
          ? ctx.params.alreadyExecutedSteps
          : [];
        const compareCandidates = Array.isArray(ctx.params.compareCandidates)
          ? ctx.params.compareCandidates
          : [];

        const effectiveMode = normalizeMode(
          ctx.params.mode,
          alreadyExecutedSteps,
          compareCandidates,
          warnings
        );

        const taskText = `${ctx.params.task || ''} ${ctx.params.currentQuestion || ''}`.trim();
        const selected = findBestCapability(taskText);
        const capability = selected.capability;

        const blockedActions = new Set([
          ...GLOBAL_DO_NOT_USE.map((item) => item.action),
          ...capability.avoid,
          ...ctx.params.doNotUse,
        ]);

        const alreadyExecuted = new Set(
          alreadyExecutedSteps
            .map((step) => (typeof step.action === 'string' ? step.action : ''))
            .filter(Boolean)
        );

        let preferredActionPath = [...capability.preferredActions].filter(
          (action) => !blockedActions.has(action)
        );
        if (effectiveMode === 'next_step' || effectiveMode === 'repair') {
          preferredActionPath = preferredActionPath.filter((action) => !alreadyExecuted.has(action));
        }
        if (preferredActionPath.length === 0) {
          preferredActionPath = [...capability.fallbackActions].filter(
            (action) => !blockedActions.has(action)
          );
        }

        const discovered = discoverSupplementalActions(
          ctx.broker.registry.getServiceList({ withActions: true }),
          taskText,
          blockedActions
        ).filter((action) => !preferredActionPath.includes(action));

        const knownContext =
          ctx.params.knownContext && typeof ctx.params.knownContext === 'object'
            ? ctx.params.knownContext
            : {};

        const recommendedPlan = preferredActionPath.map((action, index) => ({
          step: index + 1,
          action,
          purpose: `Execute capability path for ${capability.capability}`,
          params: interpolateTemplateWithKnownContext(
            action,
            buildActionTemplate(action),
            knownContext,
            taskText
          ),
          expectedOutput: 'Action-specific response payload',
          source: 'curated',
        }));

        if (recommendedPlan.length < 2 && discovered.length > 0) {
          recommendedPlan.push(
            ...discovered.slice(0, 2).map((action, idx) => ({
              step: recommendedPlan.length + idx + 1,
              action,
              purpose: 'Supplemental candidate from registry/openapi discovery',
              params: {},
              expectedOutput: 'Action-specific response payload',
              source: 'supplemental',
            }))
          );
        }

        const requiredInputs = buildRequiredInputSet(
          capability,
          recommendedPlan.map((step) => step.action)
        );

        const doNotUse = [
          ...GLOBAL_DO_NOT_USE,
          ...capability.avoid.map((action) => ({
            action,
            reason: `Avoided by curated capability ${capability.capability}`,
          })),
          ...ctx.params.doNotUse.map((action) => ({
            action,
            reason: 'Explicitly forbidden by caller doNotUse rule',
          })),
        ];

        const confidenceBase = selected.score > 0 ? 0.8 : 0.55;
        const confidence = Math.min(0.98, confidenceBase + Math.min(selected.score, 4) * 0.04);

        if (selected.usedFallback) {
          warnings.push(
            'No curated deterministic capability matched; returning explicit interface-placeholder fallback recommendation.'
          );
        }

        return {
          schemaVersion: BROKER_SCHEMA_VERSION,
          summary: selected.usedFallback
            ? 'No deterministic capability matched. Recommend explicit gap marking via interface-placeholder.'
            : `Recommended ${capability.capability} via curated deterministic path with doNotUse enforcement.`,
          intent: capability.intent,
          confidence: Number(confidence.toFixed(2)),
          mode: ctx.params.mode,
          effectiveMode,
          recommendedCapabilities: [
            {
              capability: capability.capability,
              abstractionLevel: capability.abstractionLevel,
              reason: `Matched curated domain capability in ${capability.domain}.`,
              actions: preferredActionPath,
            },
          ],
          recommendedPlan,
          requiredInputs,
          doNotUse,
          risksAndNotes: capability.risksAndNotes,
          nextBrokerQuestionSuggestion:
            'Nach Ausführung der nächsten Schritte erneut mit alreadyExecutedSteps aufrufen.',
          warnings,
        };
      },
    },

    catalog: {
      params: {},
      handler() {
        return {
          schemaVersion: BROKER_SCHEMA_VERSION,
          capabilities: CURATED_CAPABILITIES,
          globalDoNotUse: GLOBAL_DO_NOT_USE,
        };
      },
    },
  },
};
