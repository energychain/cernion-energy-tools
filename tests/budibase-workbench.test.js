const manifest = require('../integrations/budibase/manifests/stadtwerk-mauer-workbench.json');
const actionManifest = require('../integrations/budibase/manifests/workbench-action-manifest-stadtwerk-mauer.json');

function runTransformer(queryName, data) {
  const query = manifest.queries.find((item) => item.name === queryName);
  if (!query) throw new Error(`Missing query ${queryName}`);
  const fn = new Function('data', query.transformer);
  return fn(data);
}

function expectScalarRows(rows) {
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    for (const value of Object.values(row)) {
      expect(Array.isArray(value)).toBe(false);
      if (value && typeof value === 'object') {
        throw new Error(`Nested object leaked into Budibase row: ${JSON.stringify(row)}`);
      }
    }
  }
}

const profileFixture = {
  tenantId: 'stadtwerk-mauer',
  municipality: 'Mauer',
  postcode: '69256',
  status: 'partial_profile_with_evidence_gaps',
  safety: 'read_only',
  sparten: [{ id: 'strom', label: 'Strom', primaryMarketRoles: ['VNB', 'MSB'] }],
  roles: [
    {
      id: 'management',
      label: 'Management',
      type: 'internal',
      involvement: 'core_ring',
      vdmiResponsibility: 'Owns escalation boundaries.',
      decisionBoundary: 'advisory_only_in_phase_1',
      evidenceNeeds: ['owner_confirmation'],
    },
  ],
  evidenceGaps: [
    {
      missingDataPoint: 'role_owner_confirmation',
      label: 'missing VDMI role owner confirmation',
      status: 'partial',
      category: 'stadtwerk_mauer_vdmi_profile',
      enablesDossierAddition: 'add accountable owner',
    },
  ],
  decisionBoundaries: ['read-only and advisory-first in Phase 1'],
  demoQuestionAnswer: { summary: 'Synthetic Stadtwerk Mauer profile.' },
  sourceActions: { notCalled: ['event.inject', 'personal-agent.execute'] },
};

const capabilityFixture = {
  status: 'projection_ready',
  safety: 'read_only',
  classificationSummary: {
    readOnly: 4,
    advisory: 2,
    consequentialFollowUps: 1,
    executableConsequentialActions: 0,
  },
  roles: [
    {
      roleId: 'grid-planning',
      label: 'Grid Planning',
      vdmiResponsibilities: ['ZNP evidence'],
      readOnlyCapabilities: [
        {
          capability: 'znp_gate',
          classification: 'read_only',
          handoff: 'dossier_hydration_allowed',
        },
      ],
      advisoryCapabilities: [
        { capability: 'automation_risk_gate', classification: 'advisory', handoff: 'dossier_only' },
      ],
      consequentialFollowUps: [
        {
          capability: 'fnav_decision_proposal',
          classification: 'consequential_follow_up',
          handoff: 'proposal_only',
          executable: false,
        },
      ],
      descriptorSources: ['capability-catalog'],
    },
  ],
  evidenceGaps: [
    {
      roleId: 'grid-planning',
      missingDataPoint: 'missing_evidence_source',
      status: 'partial',
      category: 'stadtwerk_mauer_capability_projection',
      enablesDossierAddition: 'add source evidence',
    },
  ],
  decisionBoundaries: ['consequential capabilities are proposal only'],
  sourceActions: { notCalled: ['task.create', 'personal-agent.execute'] },
};

const eventFixture = {
  safety: 'read_only',
  replayPreview: [
    {
      eventId: 'sme:test',
      occurredAt: '2026-01-01T00:00:00.000Z',
      eventType: 'malo_melo_widerspruch',
      sparte: 'strom',
      marketRole: 'MSB',
      sourceActor: 'MSB',
      payload: { summary: 'Widerspruch' },
      expectedRouting: {
        vdmiRoles: ['msb', 'mako'],
        capabilities: ['market_communication_evidence_chain'],
        dossierPath: 'Messwesen-Klaerfall',
        nextOwner: 'edm',
      },
      evidenceQuality: 'missing',
      sideEffectPolicy: 'advisory_only',
      followUpClass: 'dossier_or_owner_evidence_followup',
    },
  ],
  eventTemplates: [
    {
      templateId: 'sm-event:test',
      title: 'Template',
      eventType: 'template_event',
      sparte: 'strom',
      marketRole: 'VNB',
      sourceActor: 'Kunde',
      payload: { summary: 'Template summary' },
      expectedRouting: {
        capabilities: ['owner_deadline_evidence_gate'],
        dossierPath: 'Owner-Frist-Evidenzsicht',
        nextOwner: 'kundenservice',
      },
      evidenceQuality: 'partial',
      sideEffectPolicy: 'read_only_event',
    },
  ],
  evidenceGaps: [
    {
      missingDataPoint: 'template_evidence',
      status: 'partial',
      category: 'stadtwerk_mauer_event_replay_preview',
      enablesDossierAddition: 'add supplied evidence',
    },
  ],
  decisionBoundaries: ['deterministic replay preview only'],
  sourceActions: { notCalled: ['event.inject', 'workflow.execute', 'personal-agent.execute'] },
};

const vnbQueueFixture = {
  capabilityKey: 'cross_channel_vnb_signal_queue',
  safety: 'read_only',
  queueStatus: 'blocked',
  signalCount: 1,
  normalizedSignals: [
    {
      signalId: 'vnb-delta-demo-anschluss',
      riskSeverity: 'high',
      affectedProcess: 'grid_connection_capacity',
      ownerRole: 'ROLE_NETZPLANUNG',
      dueAt: '2026-07-03T12:00:00.000Z',
      evidenceStatus: 'missing',
      nextDatapoint: 'capacity-window-evidence',
    },
  ],
  nextDatapoints: ['capacity-window-evidence'],
  overdueSignals: [],
  needsOwnerSignals: [],
  needsEvidenceSignals: ['vnb-delta-demo-anschluss'],
  readyForActionSignals: [],
  dossierEvidence: {
    overdueCount: 0,
    needsOwnerCount: 0,
    needsEvidenceCount: 1,
    readyForActionCount: 0,
  },
};

const vnbClassifierFixture = {
  capabilityKey: 'vnb_delta_signal_classifier',
  safety: 'read_only_advisory_classification',
  status: 'classification_with_evidence_gaps',
  classifications: [
    {
      signalId: 'vnb-delta-demo-anschluss',
      sourceType: 'synthetic-demo',
      receivedAt: '2026-06-28T08:30:00.000Z',
      noveltyLevel: 'unknown_baseline',
      decisionRelevance: 'medium',
      affectedProcess: 'grid_connection_capacity',
      ownerSuggestion: 'ROLE_NETZPLANUNG',
      deadlineUrgency: 'near_term',
      blockedDecision: 'Freigabe Anschlusskapazitaet',
      nextEvidencePoint: 'Kapazitaetsfenster und NAP-Bezug',
      confidence: 0.82,
      missingEvidence: ['known_context_anchors'],
      contentPolicy: 'caller_supplied_sanitized_excerpt_only_no_private_content_persistence',
    },
  ],
  sourceBoundary: {
    suppliedInputOnly: true,
    connectorRead: false,
    persistsRawPrivateContent: false,
    createsExternalAction: false,
  },
  sourceActions: {
    notCalled: [
      'mail.connector.ingest',
      'teams.connector.read',
      'ticket.create',
      'personal-agent.execute',
    ],
  },
};

const vnbOwnerEvidenceFixture = {
  safety: 'read_only',
  ownerContext: {
    ownerRole: 'ROLE_NETZPLANUNG',
    dueAt: '2026-07-03T12:00:00.000Z',
  },
  readinessSignals: [
    {
      code: 'owner',
      label: 'Owner',
      status: 'ready',
      rawStatus: 'ready',
      ownerRole: 'ROLE_NETZPLANUNG',
      dueAt: '2026-07-03T12:00:00.000Z',
      finding: null,
      enablesDossierAddition: 'add accountable VNB owner role or contact evidence',
      statusWhenMissing: 'needs_owner',
    },
    {
      code: 'evidence_ref',
      label: 'Evidence Reference',
      status: 'missing',
      rawStatus: 'missing',
      ownerRole: 'ROLE_NETZPLANUNG',
      dueAt: '2026-07-03T12:00:00.000Z',
      finding: 'attach the blocking evidence proof',
      enablesDossierAddition: 'attach the blocking evidence proof',
      statusWhenMissing: 'needs_evidence_ref',
    },
  ],
  evidenceGaps: [
    {
      missingDataPoint: 'evidence_ref',
      status: 'missing',
      enablesDossierAddition: 'attach the blocking evidence proof',
    },
  ],
  nextActions: [
    {
      ownerRole: 'ROLE_NETZPLANUNG',
      dueAt: '2026-07-03T12:00:00.000Z',
      missingDataPoint: 'evidence_ref',
      action: 'attach the blocking evidence proof',
    },
  ],
};

const vnbLeadershipFixture = {
  capabilityKey: 'leadership_delta_cockpit',
  safety: 'read_only',
  status: 'blocked',
  topics: [
    {
      topicId: 'leadership-delta:VNB Delta Signal Queue',
      title: 'VNB Delta Signal Queue',
      domain: 'grid_connection_capacity',
      role: 'ROLE_MANAGEMENT',
      status: 'blocked',
      deltaSummary: {
        signalCount: 1,
        newestSignal: 'vnb-delta-demo-anschluss',
        summary: '1 new signal(s) require leadership attention',
      },
      owner: { role: 'ROLE_NETZPLANUNG' },
      dueAt: '2026-07-03T12:00:00.000Z',
      evidenceStatus: 'missing',
      blockedDecision: 'Freigabe Anschlusskapazitaet',
      escalation: { state: 'needs_owner_attention', escalated: false },
      nextLever: 'read_only_validation',
      linkedEntities: ['smm-budibase-workbench'],
      sourceSignals: ['vnb-demo-001'],
    },
  ],
};

const evidenceFreshnessFixture = {
  capabilityKey: 'evidence_freshness_guard',
  safety: 'read_only_metadata_classification',
  signalId: 'vnb-delta-demo-anschluss',
  status: 'fresh_delta_escalation_candidate',
  freshnessState: 'fresh_signal',
  deltaState: 'new_delta',
  stalenessDays: 0,
  baselineAgeDays: 1,
  isKnownAnchor: false,
  isNewDelta: true,
  escalationRecommended: true,
  nonEscalationReason: null,
  blockedDecision: 'Freigabe Anschlusskapazitaet',
  owner: 'ROLE_NETZPLANUNG',
  dueDate: '2026-07-03',
  processArea: 'grid_connection_capacity',
  evidenceGaps: [],
  positiveFollowUps: [],
  sourceBoundary: {
    suppliedMetadataOnly: true,
    connectorRead: false,
    persistsRawPrivateContent: false,
    createsExternalAction: false,
  },
  sourceActions: {
    notCalled: [
      'mail.connector.ingest',
      'teams.connector.read',
      'workflow.execute',
      'personal-agent.execute',
    ],
  },
  dossierEvidence: {
    blockedDecision: 'Freigabe Anschlusskapazitaet',
    owner: 'ROLE_NETZPLANUNG',
    dueDate: '2026-07-03',
  },
};

const blueprintVerifyFixture = {
  runbookId: 'vdmi-blueprint-pack-verify',
  status: 'completed',
  riskClass: 'read_only',
  tenantId: 'stadtwerk-mauer',
  summary: {
    counts: {
      requiredEvidence: 5,
      roleRelations: 3,
      forbiddenActions: 4,
    },
  },
  warnings: [],
  nextActions: [
    'Render the verify read model in Budibase',
    'Use /api/governance/role-workbench for role-specific case projection',
  ],
  data: {
    seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
    tenantId: 'stadtwerk-mauer',
    processFamily: 'pv_registration',
    controlCase: 'electrician_missing_nap',
    validation: { valid: true, errors: [] },
    publicContextLayer: {
      present: true,
      mutable: false,
      description: 'MaStR and OSM reference context',
      examples: ['mastr_public_context'],
    },
    syntheticTenantSeed: {
      present: true,
      syntheticOnly: true,
      description: 'Synthetic Stadtwerk Mauer seed',
      examples: ['stadtwerk-mauer-pv-missing-nap-v1'],
    },
    sandboxRuntimeArtifacts: {
      present: true,
      ignoredByVerify: true,
      resettable: true,
      description: 'Resettable runtime evidence',
      examples: ['sandbox_annotation'],
    },
    requiredEvidence: ['napReference', 'maloId', 'meloId', 'meterId', 'customerConsentStatus'],
    missingEvidence: [
      {
        missingDataPoint: 'napReference',
        state: 'evidence_gap',
        enablesDossierAddition: 'show NAP reference evidence',
      },
    ],
    roleRelations: [
      {
        roleId: 'ROLE_NETZPLANUNG',
        relation: 'verantwortlich',
        responsibility: 'NAP clarification and grid-planning evidence',
      },
      {
        roleId: 'ROLE_GRID_OPERATOR',
        relation: 'mitwirkend',
        responsibility: 'operational boundary review',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'pv-registration-missing-nap',
      expectedSlug: 'pv-registration-missing-nap',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
      evidenceRequirements: [
        'napReference',
        'maloId',
        'meloId',
        'meterId',
        'customerConsentStatus',
      ],
      dataClassRefs: ['publicContextLayer', 'syntheticTenantSeed', 'sandboxRuntimeArtifact'],
      downstreamHandoff: {
        blueprintPack: 'complete',
        landingRegistry: 'pending',
        productiveDemoRoom: 'pending',
      },
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_NETZPLANUNG',
            D: 'ROLE_GRID_OPERATOR',
            M: 'ROLE_ELECTRICIAN',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: ['publicMunicipalityContext', 'napReference'],
          dataClassRefs: ['publicContextLayer', 'syntheticTenantSeed'],
          status: 'clarification',
          gateOutcome: 'missing_nap_clarification',
          enablesDossierAddition: 'Adds NAP assignment and grid-connection context.',
        },
      ],
    },
    budibaseRenderTarget: 'budibase:stadtwerk-mauer-workbench',
    forbiddenActions: [
      'tenant.provision',
      'seed.import',
      'rundeck.execute',
      'public-context.mutate',
    ],
    sourceActions: {
      notCalled: [
        'blueprint-pack.load',
        'tenant.provision',
        'rundeck.execute',
        'budibase.api.call',
        'personal-agent.execute',
      ],
    },
    brokerDossierHydration: {
      exposed: false,
      reason:
        'Runbook-only verify slice; Capability Broker and Hydration Registry exposure is intentionally deferred.',
    },
  },
};

const blueprintVarianceFixture = {
  ...blueprintVerifyFixture,
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-cross-system-variance-evidence-matrix-v1',
    processFamily: 'vnb_data_quality_governance',
    controlCase: 'cross_system_variance_evidence_matrix',
    requiredEvidence: [
      'sourceSystemVarianceSnapshot',
      'targetSystemVarianceSnapshot',
      'varianceOwner',
      'dataClassBoundary',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'targetSystemVarianceSnapshot',
        state: 'evidence_gap',
        enablesDossierAddition: 'show target-system variance snapshot evidence',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'cross-system-variance-evidence-matrix',
      expectedSlug: 'cross-system-variance-evidence-matrix',
      synced: false,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
      evidenceRequirements: [
        'sourceSystemVarianceSnapshot',
        'targetSystemVarianceSnapshot',
        'varianceOwner',
        'dataClassBoundary',
      ],
      dataClassRefs: ['publicContextLayer', 'syntheticTenantSeed'],
      downstreamHandoff: {
        blueprintPack: 'complete',
        landingRegistry: 'pending',
        productiveDemoRoom: 'blocked',
      },
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_VDMI_GOVERNANCE',
            D: 'ROLE_DATENMANAGEMENT',
            M: 'ROLE_NETZPLANUNG',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['sourceSystemVarianceSnapshot', 'targetSystemVarianceSnapshot'],
          dataClassRefs: ['publicContextLayer', 'syntheticTenantSeed'],
          status: 'variance_review',
          gateOutcome: 'sync_proof_required',
          enablesDossierAddition: 'Adds cross-system variance evidence boundaries.',
        },
      ],
    },
    forbiddenActions: [
      'landing-registry.publish',
      'cernion.de.publish',
      'seed.import',
      'budibase.table.write',
    ],
    sourceActions: {
      notCalled: [
        'landing-registry.publish',
        'cernion.de.publish',
        'budibase.table.write',
        'personal-agent.execute',
      ],
    },
  },
};

const portfolioBlueprintFixture = {
  ...blueprintVerifyFixture,
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-portfolio-market-value-readiness-v1',
    processFamily: 'energy_market_portfolio_readiness',
    controlCase: 'portfolio_market_value_readiness',
    requiredEvidence: [
      'portfolioScopeEvidence',
      'generationProfileEvidence',
      'priceCacheCoverage',
      'marketValueRiskBoundary',
      'nonAdviceGate',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'priceCacheCoverage',
        state: 'evidence_gap',
        enablesDossierAddition: 'show price/cache evidence for market-value plausibility',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'portfolio-market-value-readiness',
      expectedSlug: 'portfolio-market-value-readiness',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'no_market_action',
      evidenceRequirements: [
        'portfolioScopeEvidence',
        'generationProfileEvidence',
        'priceCacheCoverage',
        'marketValueRiskBoundary',
        'nonAdviceGate',
      ],
      rows: [
        {
          phase: 'plausibility',
          roles: {
            V: 'ROLE_PORTFOLIO_OWNER',
            D: 'ROLE_ENERGY_MARKET_ANALYST',
            M: 'ROLE_VDMI_GOVERNANCE',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['generationProfileEvidence', 'priceCacheCoverage'],
          status: 'review_ready',
          gateOutcome: 'read_only_non_advice_review',
        },
      ],
    },
    forbiddenActions: ['trading.execute', 'investment-advice.publish', 'portfolio.persist'],
    sourceActions: {
      notCalled: ['external.connector.call', 'budibase.table.write', 'personal-agent.execute'],
    },
  },
};

const portfolioBacktestFixture = {
  success: true,
  portfolio: {
    assetCount: 2,
    generationMwh: 32.4,
    marketValueEur: 2510.75,
    captureRate: 0.91,
    weightedMarketValueEurPerMwh: 77.49,
    averageSpotPriceEurPerMwh: 85.15,
    negativePriceHours: 2,
  },
  plausibility: {
    specificYieldKwhPerKw: 946,
    orientationYieldKwhPerKw: 980,
    yieldRatio: 0.965,
    generationCoverage: 0.82,
  },
};

describe('Budibase Stadtwerk Mauer workbench manifest', () => {
  const expectedSectionIds = [
    'vdmi_profile_summary',
    'vdmi_profile_sparten',
    'vdmi_profile_roles',
    'vdmi_profile_evidence',
    'vdmi_profile_boundaries',
    'vdmi_capability_summary',
    'vdmi_capability_roles',
    'vdmi_capability_rows',
    'vdmi_capability_evidence',
    'vdmi_capability_boundaries',
    'vdmi_event_preview',
    'vdmi_event_templates',
    'vdmi_event_evidence',
    'vdmi_event_boundaries',
    'vnb_delta_signal_queue_summary',
    'evidence_freshness_guard',
    'evidence_freshness_guard_gaps',
    'evidence_freshness_guard_boundaries',
    'blueprint_verify_summary',
    'blueprint_verify_demo_process_matrix',
    'blueprint_verify_data_classes',
    'blueprint_verify_required_evidence',
    'blueprint_verify_role_relations',
    'blueprint_verify_warnings_next_gates',
    'blueprint_verify_forbidden_actions',
    'blueprint_seed_selector',
    'blueprint_variance_verify_summary',
    'blueprint_variance_demo_process_matrix',
    'blueprint_variance_required_evidence',
    'blueprint_variance_data_classes',
    'blueprint_variance_forbidden_actions',
    'blueprint_variance_sync_focus',
    'blueprint_variance_matrix_focus',
    'portfolio_market_value_seed_guard',
    'portfolio_market_value_matrix',
    'portfolio_market_value_backtest',
    'portfolio_market_value_evidence',
    'portfolio_market_value_boundaries',
    'action_button_contract',
    'action_button_guards',
    'vnb_delta_signal_queue_classifier',
    'vnb_delta_signal_queue_owner_evidence',
    'vnb_delta_signal_queue_safe_next_actions',
    'vnb_delta_signal_queue_leadership',
    'vnb_delta_signal_queue_boundaries',
  ];

  it('renders the VDMI profile and synthetic event preview as query-backed sections', () => {
    const sectionIds = manifest.sections.map((section) => section.id);
    expect(sectionIds).toEqual(expect.arrayContaining(expectedSectionIds));
    for (const sectionId of expectedSectionIds) {
      const section = manifest.sections.find((item) => item.id === sectionId);
      expect(manifest.queries.some((query) => query.name === section.queryName)).toBe(true);
    }
  });

  it('uses the existing read-only dashboard bricks for the VDMI panel', () => {
    const paths = new Set(
      manifest.queries
        .filter(
          (query) =>
            (query.name.includes('Vdmi') &&
              !query.name.includes('VdmiBlueprintPackVerify') &&
              !query.name.includes('VdmiBlueprintSelector') &&
              !query.name.includes('VdmiBlueprintSeedSelector')) ||
            query.name.includes('CapabilityProjection') ||
            query.name.includes('EventReplay')
        )
        .map((query) => query.path)
    );

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-vdmi-profile',
        '/api/dashboard/stadtwerk-mauer-capability-projection',
        '/api/dashboard/stadtwerk-mauer-event-replay-preview',
      ])
    );
  });

  it('uses the existing read-only dashboard bricks for the VNB delta signal queue panel', () => {
    const paths = new Set(
      manifest.queries
        .filter(
          (query) =>
            query.name.includes('VnbDeltaSignalQueue') || query.name.includes('EvidenceFreshness')
        )
        .map((query) => query.path)
    );

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/cross-channel-vnb-signal-queue',
        '/api/dashboard/evidence-freshness-guard',
        '/api/dashboard/vnb-delta-signal-classifier/classify',
        '/api/dashboard/owner-deadline-evidence-gate',
        '/api/dashboard/leadership-delta-cockpit',
      ])
    );
  });

  it('uses the read-only dashboard facade for Blueprint Pack verify panels', () => {
    const paths = new Set(
      manifest.queries
        .filter((query) => query.name.includes('VdmiBlueprintPackVerify'))
        .map((query) => query.path)
    );

    expect(paths).toEqual(new Set(['/api/dashboard/stadtwerk-mauer-blueprint-pack-verify']));
  });

  it('composes the Blueprint seed selector from read-only Workbench bricks', () => {
    const queries = manifest.queries.filter((query) => query.name.includes('BlueprintSelector'));
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
        '/api/dashboard/stadtwerk-mauer-transfer-readiness',
        '/api/dashboard/cross-system-variance-matrix',
      ])
    );
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-cross-system-variance-evidence-matrix-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('blueprint_variance'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);
  });

  it('adds the Portfolio Market Value Readiness panel from existing safe endpoints', () => {
    const queries = manifest.queries.filter(
      (query) =>
        query.name.includes('PortfolioMarketValueReadiness') ||
        query.name === 'runPortfolioMarketValueReadinessBacktestRows'
    );
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
        '/api/energy-market/portfolio-backtest',
      ])
    );
    expect(
      queries.every(
        (query) =>
          query.path !== '/api/dashboard/stadtwerk-mauer-portfolio-market-value-readiness'
      )
    ).toBe(true);
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-portfolio-market-value-readiness-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('portfolio_market_value'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);

    const backtestQuery = queries.find(
      (query) => query.name === 'runPortfolioMarketValueReadinessBacktestRows'
    );
    expect(backtestQuery).toMatchObject({
      method: 'POST',
      path: '/api/energy-market/portfolio-backtest',
    });
    expect(backtestQuery.body).toMatchObject({
      region: 'Deutschland',
      includeTimeseries: false,
    });
    expect(backtestQuery.body.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'solar', postleitzahl: '69256' }),
        expect.objectContaining({ type: 'biomass' }),
      ])
    );
  });

  it('declares a separate Workbench action-button manifest with only safe enabled actions', () => {
    expect(actionManifest).toMatchObject({
      manifestId: 'workbench-action-manifest-stadtwerk-mauer-v1',
      tenantId: 'stadtwerk-mauer',
      caseId: 'smm-budibase-workbench',
      persona: 'ROLE_NETZPLANUNG',
    });
    expect(actionManifest.enabledActions.map((action) => action.actionId)).toEqual([
      'refresh_read_model',
      'verify_blueprint_seed',
      'validate_evidence_completeness',
    ]);
    expect(new Set(actionManifest.enabledActions.map((action) => action.safetyClass))).toEqual(
      new Set(['read_only', 'verify_only'])
    );
    expect(actionManifest.disabledActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'add_sandbox_annotation',
          safetyClass: 'sandbox_annotation',
        }),
        expect.objectContaining({ actionId: 'run_rundeck_job', safetyClass: 'consequential' }),
      ])
    );
    expect(actionManifest.forbiddenClasses).toEqual(
      expect.arrayContaining([
        'budibase.table.write',
        'rundeck.execute',
        'external.connector.call',
        'personal-agent.execute',
      ])
    );
  });

  it('renders curated action-button rows as scalar enabled read-only and verify actions', () => {
    const rows = runTransformer('getStadtwerkMauerActionButtonContractRows', {
      tenantId: 'stadtwerk-mauer',
      caseId: 'smm-budibase-workbench',
    });
    expectScalarRows(rows);

    const enabledRows = rows.filter((row) => row.enabled);
    expect(enabledRows.map((row) => row.actionId)).toEqual([
      'refresh_read_model',
      'verify_blueprint_seed',
      'validate_evidence_completeness',
    ]);
    expect(new Set(enabledRows.map((row) => row.safetyClass))).toEqual(
      new Set(['read_only', 'verify_only'])
    );
    expect(enabledRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'refresh_read_model',
          persona: 'ROLE_NETZPLANUNG',
          sourceEndpoint: 'GET /api/dashboard/stadtwerk-mauer-case-detail',
          dataClass: 'synthetic_tenant_seed',
        }),
        expect.objectContaining({
          actionId: 'verify_blueprint_seed',
          expectedReadback: expect.stringContaining('Blueprint validity'),
        }),
        expect.objectContaining({
          actionId: 'validate_evidence_completeness',
          transferParameters: expect.stringContaining('allowedCommandScope=verify_only'),
        }),
      ])
    );

    const disabledRows = rows.filter((row) => !row.enabled);
    expect(disabledRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'add_sandbox_annotation',
          safetyClass: 'sandbox_annotation',
          disabledReason: expect.stringContaining('guarded'),
        }),
        expect.objectContaining({
          actionId: 'run_rundeck_job',
          safetyClass: 'consequential',
          disabledReason: expect.stringContaining('forbidden'),
        }),
      ])
    );
  });

  it('renders action-button forbidden classes as no-call guard rows', () => {
    const guardRows = runTransformer('getStadtwerkMauerActionButtonForbiddenGuardRows', {});
    expectScalarRows(guardRows);
    expect(guardRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'budibase.table.write', status: 'forbidden' }),
        expect.objectContaining({ action: 'rundeck.execute', status: 'forbidden' }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'forbidden' }),
      ])
    );
  });

  it('flattens evidence freshness rows for the selected synthetic signal', () => {
    const freshnessRows = runTransformer('getEvidenceFreshnessGuardRows', evidenceFreshnessFixture);
    expectScalarRows(freshnessRows);
    expect(freshnessRows[0]).toMatchObject({
      signalId: 'vnb-delta-demo-anschluss',
      freshnessState: 'fresh_signal',
      deltaState: 'new_delta',
      escalationRecommended: true,
      owner: 'ROLE_NETZPLANUNG',
      sourceClass: 'evidence_freshness_guard',
    });

    const gapRows = runTransformer('getEvidenceFreshnessGuardGapRows', evidenceFreshnessFixture);
    expectScalarRows(gapRows);
    expect(gapRows[0]).toMatchObject({
      missingDataPoint: 'none',
      sourceClass: 'freshness_positive_follow_up',
    });

    const boundaryRows = runTransformer(
      'getEvidenceFreshnessGuardBoundaryRows',
      evidenceFreshnessFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'suppliedMetadataOnly', status: 'true' }),
        expect.objectContaining({ boundary: 'personal-agent.execute', status: 'not_called' }),
      ])
    );
  });

  it('flattens Blueprint Pack verify rows for presenter-safe Budibase tables', () => {
    const summaryRows = runTransformer(
      'getVdmiBlueprintPackVerifySummaryRows',
      blueprintVerifyFixture
    );
    expectScalarRows(summaryRows);
    expect(summaryRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
      valid: true,
      riskClass: 'read_only',
      requiredEvidenceCount: 5,
      roleRelationCount: 3,
      sourceClass: 'vdmi_blueprint_pack_verify',
    });

    const dataClassRows = runTransformer(
      'getVdmiBlueprintPackVerifyDataClassRows',
      blueprintVerifyFixture
    );
    expectScalarRows(dataClassRows);
    expect(dataClassRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataClass: 'public_context', mutable: false }),
        expect.objectContaining({ dataClass: 'synthetic_seed', syntheticOnly: true }),
        expect.objectContaining({ dataClass: 'sandbox_runtime', resettable: true }),
      ])
    );

    const matrixRows = runTransformer(
      'getVdmiBlueprintPackVerifyMatrixRows',
      blueprintVerifyFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'matrix_sync_summary',
          slug: 'pv-registration-missing-nap',
          synced: true,
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          rowCountValid: true,
          roleCellsClean: true,
          dataClassesLimited: true,
          downstreamHandoff: 'complete -> pending -> pending',
          sourceClass: 'blueprint_demo_process_matrix',
        }),
        expect.objectContaining({
          rowKey: 'matrix_row_1',
          phase: '1',
          roles: 'V:ROLE_NETZPLANUNG | D:ROLE_GRID_OPERATOR | M:ROLE_ELECTRICIAN | I:ROLE_COMMERCIAL_AUDIT',
          evidenceRequirements: 'publicMunicipalityContext, napReference',
          dataClassRefs: 'publicContextLayer, syntheticTenantSeed',
          gateOutcome: 'missing_nap_clarification',
          sourceClass: 'blueprint_demo_process_matrix_row',
        }),
      ])
    );

    const evidenceRows = runTransformer(
      'getVdmiBlueprintPackVerifyEvidenceRows',
      blueprintVerifyFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: 'napReference',
          enablesDossierAddition: 'show NAP reference evidence',
        }),
      ])
    );

    const roleRows = runTransformer('getVdmiBlueprintPackVerifyRoleRows', blueprintVerifyFixture);
    expectScalarRows(roleRows);
    expect(roleRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: 'ROLE_NETZPLANUNG', relation: 'verantwortlich' }),
      ])
    );

    const warningRows = runTransformer(
      'getVdmiBlueprintPackVerifyWarningRows',
      blueprintVerifyFixture
    );
    expectScalarRows(warningRows);
    expect(warningRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowType: 'next_gate',
          sourceClass: 'blueprint_verify_next_gate',
        }),
        expect.objectContaining({ rowKey: 'broker_dossier_hydration', status: 'not_exposed' }),
      ])
    );

    const forbiddenActionRows = runTransformer(
      'getVdmiBlueprintPackVerifyForbiddenActionRows',
      blueprintVerifyFixture
    );
    expectScalarRows(forbiddenActionRows);
    expect(forbiddenActionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'rundeck.execute', status: 'forbidden' }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'not_called' }),
      ])
    );
  });

  it('flattens the Blueprint selector and #382 matrix-sync rows for display-safe cells', () => {
    const assertNoRawObjectText = (rows) => {
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (typeof value === 'string') {
            expect(value).not.toContain('[object Object]');
            expect(value).not.toMatch(/^\s*[{[]/);
          }
        }
      }
    };

    const selectorRows = runTransformer(
      'getVdmiBlueprintSeedSelectorRows',
      blueprintVerifyFixture
    );
    expectScalarRows(selectorRows);
    assertNoRawObjectText(selectorRows);
    expect(selectorRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableSeedId: 'stadtwerk-mauer-substation-load-assessment-v1',
          selected: false,
          sourceClass: 'blueprint_seed_selector',
        }),
        expect.objectContaining({
          availableSeedId: 'stadtwerk-mauer-cross-system-variance-evidence-matrix-v1',
          selectedSeedId: 'stadtwerk-mauer-cross-system-variance-evidence-matrix-v1',
          selected: true,
          controlCase: 'cross_system_variance_evidence_matrix',
        }),
      ])
    );

    const summaryRows = runTransformer(
      'getVdmiBlueprintSelectorVarianceVerifySummaryRows',
      blueprintVarianceFixture
    );
    expectScalarRows(summaryRows);
    expect(summaryRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-cross-system-variance-evidence-matrix-v1',
      processFamily: 'vnb_data_quality_governance',
      controlCase: 'cross_system_variance_evidence_matrix',
      sourceClass: 'vdmi_blueprint_pack_verify_selector',
    });

    const matrixRows = runTransformer(
      'getVdmiBlueprintSelectorVarianceMatrixRows',
      blueprintVarianceFixture
    );
    expectScalarRows(matrixRows);
    assertNoRawObjectText(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'variance_matrix_sync_summary',
          roleLegendM: 'Mitwirkend',
          status: 'sync_proof_required',
          downstreamHandoff: 'complete -> pending -> blocked',
        }),
        expect.objectContaining({
          rowKey: 'variance_matrix_row_1',
          phase: '1',
          v: 'ROLE_VDMI_GOVERNANCE',
          d: 'ROLE_DATENMANAGEMENT',
          m: 'ROLE_NETZPLANUNG',
          i: 'ROLE_MANAGEMENT',
          nachweise: 'sourceSystemVarianceSnapshot, targetSystemVarianceSnapshot',
        }),
      ])
    );
    expect(matrixRows[1]).not.toHaveProperty('roles');

    const evidenceRows = runTransformer(
      'getVdmiBlueprintSelectorVarianceEvidenceRows',
      blueprintVarianceFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: 'targetSystemVarianceSnapshot',
          enablesDossierAddition: 'show target-system variance snapshot evidence',
        }),
      ])
    );

    const dataClassRows = runTransformer(
      'getVdmiBlueprintSelectorVarianceDataClassRows',
      blueprintVarianceFixture
    );
    expectScalarRows(dataClassRows);
    expect(dataClassRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataClass: 'public_context', mutable: false }),
        expect.objectContaining({ dataClass: 'synthetic_seed', syntheticOnly: true }),
      ])
    );

    const guardRows = runTransformer(
      'getVdmiBlueprintSelectorVarianceForbiddenActionRows',
      blueprintVarianceFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'landing-registry.publish', status: 'forbidden' }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const syncRows = runTransformer('getVdmiBlueprintSelectorSyncFocusRows', {
      status: 'transfer_readiness_pending',
      transferSummaryRows: [{ status: 'blocked', transferState: 'sync_proof_required' }],
    });
    expectScalarRows(syncRows);
    expect(syncRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selectedSeedId: 'stadtwerk-mauer-cross-system-variance-evidence-matrix-v1',
          focusPath: '/api/dashboard/cross-system-variance-matrix',
          sourceClass: 'blueprint_selector_sync_focus',
        }),
      ])
    );

    const focusRows = runTransformer('getVdmiBlueprintSelectorVarianceMatrixFocusRows', {
      status: 'matrix_ready',
      matrixStatus: 'variance_matrix_ready',
      evidenceStatus: 'read_only_evidence_complete',
    });
    expectScalarRows(focusRows);
    expect(focusRows[0]).toMatchObject({
      focusPath: '/api/dashboard/cross-system-variance-matrix',
      matrixStatus: 'variance_matrix_ready',
      sourceClass: 'blueprint_selector_variance_matrix_focus',
    });
  });

  it('flattens Portfolio Market Value Readiness rows and no-call guards', () => {
    const guardRows = runTransformer(
      'getPortfolioMarketValueReadinessSeedGuardRows',
      portfolioBlueprintFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-portfolio-market-value-readiness-v1',
      panelEnabled: true,
      matrixRows: 5,
      rolePair: 'ROLE_PORTFOLIO_OWNER / ROLE_ENERGY_MARKET_ANALYST',
      sourceClass: 'portfolio_market_value_blueprint_guard',
    });

    const matrixRows = runTransformer(
      'getPortfolioMarketValueReadinessMatrixRows',
      portfolioBlueprintFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'portfolio_matrix_sync_summary',
          status: 'matrix_ready',
          v: 'ROLE_PORTFOLIO_OWNER',
          d: 'ROLE_ENERGY_MARKET_ANALYST',
        }),
        expect.objectContaining({
          rowKey: 'portfolio_matrix_row_1',
          phase: 'plausibility',
          m: 'ROLE_VDMI_GOVERNANCE',
          gateOutcome: 'read_only_non_advice_review',
        }),
      ])
    );

    const backtestRows = runTransformer(
      'runPortfolioMarketValueReadinessBacktestRows',
      portfolioBacktestFixture
    );
    expectScalarRows(backtestRows);
    expect(backtestRows[0]).toMatchObject({
      rowKey: 'portfolio_market_value_backtest',
      assetCount: 2,
      captureRate: 0.91,
      specificYieldKwhPerKw: 946,
      orientationYieldKwhPerKw: 980,
      yieldRatio: 0.965,
      generationCoverage: 0.82,
      sourceClass: 'portfolio_market_value_backtest',
    });
    expect(backtestRows[0].nonAdviceBoundary).toContain('no trading');

    const evidenceRows = runTransformer(
      'getPortfolioMarketValueReadinessEvidenceRows',
      portfolioBlueprintFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missingDataPoint: 'priceCacheCoverage',
          enablesDossierAddition: 'show price/cache evidence for market-value plausibility',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getPortfolioMarketValueReadinessBoundaryRows',
      portfolioBlueprintFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'trading.execute', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'investment-advice.publish', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'budibase.table.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'personal-agent.execute', status: 'not_called' }),
      ])
    );
  });

  it('flattens VDMI profile rows for display-safe Budibase tables', () => {
    expectScalarRows(runTransformer('getStadtwerkMauerVdmiProfileSummaryRows', profileFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerVdmiProfileSparteRows', profileFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerVdmiProfileRoleRows', profileFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerVdmiProfileEvidenceRows', profileFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerVdmiProfileBoundaryRows', profileFixture));
  });

  it('flattens capability rows and keeps consequential actions non-executable', () => {
    expectScalarRows(
      runTransformer('getStadtwerkMauerCapabilityProjectionSummaryRows', capabilityFixture)
    );
    expectScalarRows(
      runTransformer('getStadtwerkMauerCapabilityProjectionRoleRows', capabilityFixture)
    );
    const capabilityRows = runTransformer(
      'getStadtwerkMauerCapabilityProjectionCapabilityRows',
      capabilityFixture
    );
    expectScalarRows(capabilityRows);
    expect(
      capabilityRows.find((row) => row.classification === 'consequential_follow_up')
    ).toMatchObject({
      executable: false,
      sourceClass: 'proposal_only_followup',
    });
    expectScalarRows(
      runTransformer('getStadtwerkMauerCapabilityProjectionEvidenceRows', capabilityFixture)
    );
    expectScalarRows(
      runTransformer('getStadtwerkMauerCapabilityProjectionBoundaryRows', capabilityFixture)
    );
  });

  it('flattens synthetic event preview rows without exposing executable event payloads', () => {
    const previewRows = runTransformer('getStadtwerkMauerEventReplayPreviewRows', eventFixture);
    expectScalarRows(previewRows);
    expect(previewRows[0]).toMatchObject({
      eventId: 'sme:test',
      nextOwner: 'edm',
      capabilities: 'market_communication_evidence_chain',
      sourceClass: 'synthetic_event_preview',
    });
    expectScalarRows(runTransformer('getStadtwerkMauerEventReplayTemplateRows', eventFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerEventReplayEvidenceRows', eventFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerEventReplayBoundaryRows', eventFixture));
  });

  it('flattens VNB delta signal queue rows for display-safe Budibase tables', () => {
    const summaryRows = runTransformer('getVnbDeltaSignalQueueSummaryRows', vnbQueueFixture);
    expectScalarRows(summaryRows);
    expect(summaryRows[0]).toMatchObject({
      label: 'VNB Delta / Signal Queue',
      highPriorityCount: 1,
      needsEvidenceCount: 1,
      sourceClass: 'synthetic_caller_supplied_queue',
    });

    const classifierRows = runTransformer(
      'getVnbDeltaSignalQueueClassifierRows',
      vnbClassifierFixture
    );
    expectScalarRows(classifierRows);
    expect(classifierRows[0]).toMatchObject({
      signalId: 'vnb-delta-demo-anschluss',
      ownerSuggestion: 'ROLE_NETZPLANUNG',
      sourceClass: 'synthetic_signal_classification',
    });

    expectScalarRows(
      runTransformer('getVnbDeltaSignalQueueOwnerEvidenceRows', vnbOwnerEvidenceFixture)
    );
    expectScalarRows(
      runTransformer('getVnbDeltaSignalQueueSafeNextActionRows', vnbOwnerEvidenceFixture)
    );
    expectScalarRows(runTransformer('getVnbDeltaSignalQueueLeadershipRows', vnbLeadershipFixture));

    const boundaryRows = runTransformer('getVnbDeltaSignalQueueBoundaryRows', vnbClassifierFixture);
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'mail.connector.ingest', status: 'not_called' }),
        expect.objectContaining({ boundary: 'suppliedInputOnly', status: 'true' }),
      ])
    );
  });

  it('binds sandbox annotation command and flattens annotation readback rows', () => {
    const commandQuery = manifest.queries.find(
      (query) => query.name === 'recordStadtwerkMauerCaseAnnotation'
    );
    expect(commandQuery).toMatchObject({
      method: 'POST',
      path: '/api/dashboard/stadtwerk-mauer-case-annotations',
    });
    expect(commandQuery.body).toMatchObject({
      tenantId: 'stadtwerk-mauer',
      caseId: 'smm-budibase-workbench',
      commandType: 'add_operator_note_sandbox',
    });

    const fixture = {
      annotationRows: [
        {
          annotationId: 'smm-case-annotation:test',
          caseId: 'smm-budibase-workbench',
          commandType: 'add_operator_note_sandbox',
          currentStatus: 'needs_evidence',
          priorStatus: 'needs_evidence',
          actorLabel: 'budibase:operator',
          sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
          noteLabel: 'Budibase sandbox handover note',
          reasonLabel: 'visible-demo annotation command',
          dataClass: 'sandbox_runtime_artifact',
          createdAt: '2026-06-28T17:00:00.000Z',
        },
      ],
      annotationAuditRows: [
        {
          auditId: 'smm-case-annotation:test',
          caseId: 'smm-budibase-workbench',
          actorLabel: 'budibase:operator',
          sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
          transitionLabel: 'needs_evidence -> needs_evidence',
          commandType: 'add_operator_note_sandbox',
          idempotencyKey: 'budibase-smm-workbench-case-annotation',
          createdAt: '2026-06-28T17:00:00.000Z',
        },
      ],
    };

    expectScalarRows(runTransformer('getStadtwerkMauerCaseAnnotationRows', fixture));
    expectScalarRows(runTransformer('getStadtwerkMauerCaseAnnotationAuditRows', fixture));
    expect(manifest.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining([
        'case_annotation_command',
        'case_annotation_rows',
        'case_annotation_audit',
      ])
    );
  });
});
