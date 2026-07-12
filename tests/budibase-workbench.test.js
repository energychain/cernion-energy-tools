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

const blueprintGridTransformationFixture = {
  ...blueprintVerifyFixture,
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-grid-connection-transformation-gate-v1',
    processFamily: 'grid_connection_transformation',
    controlCase: 'grid_connection_transformation_gate',
    requiredEvidence: [
      'napMaloReferenceEvidence',
      'divisionEvidence',
      'transformationOptionEvidence',
      'dataQualityEvidence',
      'investmentPathEvidence',
      'decommissionPathEvidence',
      'ownerNextActionEvidence',
      'sourceReferenceEvidence',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'divisionEvidence',
        state: 'clarification',
        enablesDossierAddition:
          'Adds the division/sparte classification so the dossier can frame the transformation path.',
      },
      {
        missingDataPoint: 'ownerNextActionEvidence',
        state: 'needs_owner',
        enablesDossierAddition:
          'Adds the accountable owner and next-gate action without creating a HITL ticket or workflow.',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'grid-connection-transformation-gate',
      expectedSlug: 'grid-connection-transformation-gate',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
      evidenceRequirements: [
        'napMaloReferenceEvidence',
        'divisionEvidence',
        'sourceReferenceEvidence',
        'dataQualityEvidence',
        'transformationOptionEvidence',
        'investmentPathEvidence',
        'decommissionPathEvidence',
        'ownerNextActionEvidence',
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
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_ASSET_MANAGEMENT',
            I: 'ROLE_ADMINISTRATOR',
          },
          evidenceRequirements: [
            'napMaloReferenceEvidence',
            'divisionEvidence',
            'sourceReferenceEvidence',
          ],
          dataClassRefs: ['publicContextLayer', 'syntheticTenantSeed'],
          status: 'evidence_gap',
          gateOutcome: 'nap_malo_division_evidence_visible',
          enablesDossierAddition:
            'Adds the NAP/MaLo, division and source-reference intake rows before the transformation case can be reviewed.',
        },
      ],
    },
    forbiddenActions: [
      'connection_commitment',
      'asset_mdm_write',
      'znp_write',
      'budibase_table_write',
      'device_control',
      'personal_agent_hardcoding',
    ],
    sourceActions: {
      notCalled: [
        'hitl.create',
        'assets.mutate',
        'external.connector.call',
        'personal-agent.execute',
      ],
    },
  },
};

const gridTransformationGateFixture = {
  status: 'review_ready',
  gateStatus: 'ready_for_review',
  readinessScore: 82,
  complianceContext: {
    meteringPointId: 'MaLo-SMM-406',
  },
  complianceEvidence: {
    division: 'electricity',
    transformationOption: 'h2_ready',
    dataQualityStatus: 'verified',
    investmentPath: 'capex_review_needed',
    decommissionPath: 'reuse_check_pending',
    owner: 'ROLE_NETZPLANUNG',
    nextAction: 'verify_asset_znp_context',
  },
  sourceRefs: ['blueprint-pack-404', 'stadtwerk-mauer-workbench'],
  missingEvidence: [],
};

const gasDataroomBlueprintFixture = {
  ...blueprintVerifyFixture,
  summary: {
    counts: {
      requiredEvidence: 6,
      roleRelations: 4,
      forbiddenActions: 5,
    },
  },
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-gas-transformation-dataroom-review-v1',
    processFamily: 'gas_transformation_dataroom_review',
    controlCase: 'gas_transformation_dataroom_status_review',
    requiredEvidence: [
      'roomMandateBoundaryEvidence',
      'transformationPathEvidence',
      'scenarioReferenceEvidence',
      'eogKanuBoundaryEvidence',
      'evidenceRegisterSnapshot',
      'decisionRoadmapEvidence',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'evidenceRegisterSnapshot',
        state: 'evidence_gap',
        enablesDossierAddition: 'show gas dataroom evidence-register gaps',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'gas-transformation-dataroom-review',
      expectedSlug: 'gas-transformation-dataroom-review',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
      evidenceRequirements: [
        'roomMandateBoundaryEvidence',
        'transformationPathEvidence',
        'scenarioReferenceEvidence',
        'evidenceRegisterSnapshot',
      ],
      dataClassRefs: ['publicContextLayer', 'syntheticTenantSeed'],
      downstreamHandoff: {
        blueprintPack: 'complete',
        landingRegistry: 'pending',
        productiveDemoRoom: 'pending',
      },
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_NETZSTRATEGIE',
            D: 'ROLE_ASSET_STRATEGY',
            M: 'ROLE_REGULATORY_AFFAIRS',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['roomMandateBoundaryEvidence', 'transformationPathEvidence'],
          status: 'room_boundary_review',
          gateOutcome: 'review_gate_pending',
          enablesDossierAddition: 'Adds gas dataroom boundary and path evidence.',
        },
      ],
    },
    forbiddenActions: [
      'gas-transformation.executeDecommissioning',
      'landing-registry.publish',
      'budibase.table.write',
      'external.connector.call',
      'personal-agent.execute',
    ],
    sourceActions: {
      notCalled: [
        'gas-transformation.executeDecommissioning',
        'landing-registry.publish',
        'budibase.table.write',
        'external.connector.call',
        'personal-agent.execute',
      ],
    },
  },
};

const gasDataroomStatusFixture = {
  status: 'review_ready_with_gaps',
  roomId: 'smm-gas-dataroom',
  summary: {
    status: 'review_ready_with_gaps',
    transformationPaths: 'H2-ready corridor, decommissioning reserve',
    legalBoundary: 'EOG/KANU context only; no legal decision',
    owner: 'ROLE_NETZSTRATEGIE',
    nextAction: 'clarify evidence-register owner',
  },
  roomProfile: { roomId: 'smm-gas-dataroom' },
  mandateBoundary: { status: 'synthetic workbench review only' },
  transformationPaths: [
    { pathId: 'h2-ready-corridor', label: 'H2-ready corridor' },
    { pathId: 'decommissioning-reserve', label: 'Decommissioning reserve' },
  ],
  scenarioReferences: [{ referenceId: 'KANU-2026', label: 'KANU scenario reference' }],
  evidenceRegister: { status: 'partial_register' },
  decisionLog: { status: 'decision_log_open' },
  roadmap: { status: 'roadmap_review_pending' },
  owner: { role: 'ROLE_NETZSTRATEGIE' },
  nextAction: 'complete missing evidence-register snapshot',
  sourceReferences: [{ id: 'blueprint-pack', label: 'Blueprint-Pack seed #366' }],
  missingEvidence: [{ missingDataPoint: 'evidenceRegisterSnapshot' }],
  sourceActions: {
    notCalled: [
      'budibase.table.write',
      'gas-transformation.executeDecommissioning',
      'external.connector.call',
      'personal-agent.execute',
    ],
  },
};

const connectionDeadlineBlueprintFixture = {
  ...blueprintVerifyFixture,
  summary: {
    counts: {
      requiredEvidence: 6,
      roleRelations: 7,
      forbiddenActions: 8,
    },
  },
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-connection-deadline-evidence-queue-v1',
    processFamily: 'connection_deadline_governance',
    controlCase: 'connection_deadline_evidence_queue',
    requiredEvidence: [
      'connectionCaseIntakeEvidence',
      'deadlineRiskEvidence',
      'technicalPlausibilityEvidence',
      'clarificationOwnerEvidence',
      'communicationNoteDraftEvidence',
      'nextGateReadinessEvidence',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'technicalPlausibilityEvidence',
        state: 'clarification',
        enablesDossierAddition: 'show technical plausibility marker without capacity reservation',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'connection-deadline-evidence-queue',
      expectedSlug: 'connection-deadline-evidence-queue',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
      evidenceRequirements: [
        'connectionCaseIntakeEvidence',
        'deadlineRiskEvidence',
        'technicalPlausibilityEvidence',
        'nextGateReadinessEvidence',
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
            D: 'ROLE_ANSCHLUSSWESEN',
            M: 'ROLE_CERNION_GOVERNANCE',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['connectionCaseIntakeEvidence'],
          status: 'evidence_gap',
          gateOutcome: 'synthetic_connection_case_identified',
        },
        {
          phase: '2',
          roles: {
            V: 'ROLE_NETZPLANUNG',
            D: 'ROLE_ANSCHLUSSWESEN',
            M: 'ROLE_GRID_CAPACITY_PLANNING',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['deadlineRiskEvidence', 'technicalPlausibilityEvidence'],
          status: 'clarification',
          gateOutcome: 'deadline_risk_and_plausibility_review_pending',
        },
      ],
    },
    forbiddenActions: [
      'customer.communication.send',
      'crm.update',
      'grid-connection.reserveCapacity',
      'deadline.legalCalculate',
      'budibase.table.write',
      'external.connector.call',
      'personal-agent.execute',
    ],
    sourceActions: {
      notCalled: [
        'customer.communication.send',
        'crm.update',
        'grid-connection.reserveCapacity',
        'deadline.legalCalculate',
        'budibase.table.write',
        'external.connector.call',
        'personal-agent.execute',
      ],
    },
  },
};

const connectionDeadlineStatusFixture = {
  status: 'fristkritisch',
  deadlineRisk: 'fristkritisch',
  evidenceQueue: {
    caseId: 'smm-connection-deadline-001',
    connectionType: 'pv',
    deadlineDate: '2026-07-16',
    daysUntilDeadline: 7,
    responsibleVnb: 'stadtwerk-mauer',
    technicalPlausibility: 'capacity-context-pending',
    owner: 'ROLE_NETZPLANUNG',
    nextGate: 'evidence-review',
    communicationSent: false,
    connectionDecisionApplied: false,
  },
  missingEvidence: [
    {
      missingDataPoint: 'technical_plausibility',
      enablesDossierAddition: 'adds technical-readiness evidence for gate advancement',
    },
  ],
  positiveFollowUps: [
    {
      missingDataPoint: 'technical_plausibility',
      enablesDossierAddition: 'adds technical-readiness evidence for gate advancement',
    },
  ],
  communicationNoteDraft: {
    status: 'draft_ready',
    sent: false,
  },
  sourceActions: {
    notCalled: [
      'communication.send',
      'crm.update',
      'grid-connection.reserveCapacity',
      'deadline.legalCalculate',
      'external.connector.call',
      'personal-agent.execute',
    ],
  },
};

const investmentOwnerBudgetBlueprintFixture = {
  ...blueprintVerifyFixture,
  summary: {
    counts: {
      requiredEvidence: 8,
      roleRelations: 6,
      forbiddenActions: 12,
    },
  },
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-investment-owner-deadline-budget-gate-v1',
    processFamily: 'investment_governance',
    controlCase: 'investment_owner_deadline_budget_gate',
    requiredEvidence: [
      'investmentMeasureIdentityEvidence',
      'accountableOwnerEvidence',
      'deadlineEvidence',
      'budgetEffectEvidence',
      'approvalSourceEvidence',
      'blockedDecisionEvidence',
      'nextEscalationGateEvidence',
      'readinessMarker',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'budgetEffectEvidence',
        state: 'budget_gap',
        enablesDossierAddition: 'show budget effect without booking or approval',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'investment-owner-deadline-budget-gate',
      expectedSlug: 'investment-owner-deadline-budget-gate',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
      evidenceRequirements: [
        'investmentMeasureIdentityEvidence',
        'accountableOwnerEvidence',
        'deadlineEvidence',
        'budgetEffectEvidence',
        'blockedDecisionEvidence',
        'readinessMarker',
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
            V: 'ROLE_ASSET_MANAGEMENT',
            D: 'ROLE_CONTROLLING',
            M: 'ROLE_CERNION_GOVERNANCE',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['investmentMeasureIdentityEvidence', 'accountableOwnerEvidence'],
          status: 'owner_gap',
          gateOutcome: 'measure_identity_and_owner_review_pending',
        },
        {
          phase: '2',
          roles: {
            V: 'ROLE_ASSET_MANAGEMENT',
            D: 'ROLE_CONTROLLING',
            M: 'ROLE_GOVERNANCE_OWNER',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: ['deadlineEvidence', 'budgetEffectEvidence'],
          status: 'budget_gap',
          gateOutcome: 'deadline_and_budget_effect_review_pending',
        },
      ],
    },
  },
};

const investmentOwnerBudgetStatusFixture = {
  status: 'evidence_gap',
  gate: {
    measureId: 'smm-invest-owner-budget-001',
    ownerRole: 'ROLE_ASSET_MANAGEMENT',
    deadline: '2026-09-30',
    budgetEffect: 'capex-review-needed',
    approvalStatus: 'source-evidence-missing',
    blockedDecision: 'committee-prep-release',
    nextGate: 'investment-review-board-prep',
  },
  approvalSource: {
    status: 'source-evidence-missing',
  },
  missingEvidence: [
    {
      missingDataPoint: 'budgetEffectEvidence',
      enablesDossierAddition: 'adds budget effect evidence without booking or approval',
    },
  ],
  positiveFollowUps: [
    {
      missingDataPoint: 'budgetEffectEvidence',
      enablesDossierAddition: 'adds budget effect evidence without booking or approval',
    },
  ],
  sourceActions: {
    notCalled: [
      'erp.write',
      'sap.write',
      'accounting.post',
      'budget.approve',
      'committee.execute',
      'external.connector.call',
      'budibase.table.write',
      'personal-agent.execute',
    ],
  },
};

const directMarketerRiskGateBlueprintFixture = {
  ...blueprintVerifyFixture,
  summary: {
    counts: {
      requiredEvidence: 7,
      roleRelations: 6,
      forbiddenActions: 15,
    },
  },
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-direct-marketer-risk-gate-v1',
    processFamily: 'market_partner_readiness',
    controlCase: 'direct_marketer_risk_gate',
    requiredEvidence: [
      'syntheticHandoverScopeEvidence',
      'forecastQualityEvidence',
      'allocationRuleEvidence',
      'balancingGroupScheduleImpactEvidence',
      'billingSettlementStatusEvidence',
      'ownerDeadlineEvidence',
      'riskGateReadinessEvidence',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'forecastQualityEvidence',
        state: 'forecast_quality_gap',
        enablesDossierAddition: 'add forecast-quality evidence',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'direct-marketer-risk-gate',
      expectedSlug: 'direct-marketer-risk-gate',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
      evidenceRequirements: [
        'syntheticHandoverScopeEvidence',
        'forecastQualityEvidence',
        'allocationRuleEvidence',
        'balancingGroupScheduleImpactEvidence',
        'billingSettlementStatusEvidence',
        'ownerDeadlineEvidence',
        'riskGateReadinessEvidence',
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
            V: 'ROLE_MARKET_OPERATIONS',
            D: 'ROLE_ENERGY_SHARING_LEAD',
            M: 'ROLE_CERNION_GOVERNANCE',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['syntheticHandoverScopeEvidence'],
          status: 'handover_scope_gap',
          gateOutcome: 'synthetic_handover_scope_review_pending',
        },
        {
          phase: '2',
          roles: {
            V: 'ROLE_MARKET_OPERATIONS',
            D: 'ROLE_ENERGY_SHARING_LEAD',
            M: 'ROLE_CERNION_GOVERNANCE',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: ['forecastQualityEvidence'],
          status: 'forecast_quality_gap',
          gateOutcome: 'forecast_quality_review_pending',
        },
      ],
    },
  },
};

const directMarketerRiskGateStatusFixture = {
  status: 'risk_calculable',
  gate: {
    projectId: 'smm-market-handover-001',
    forecastQuality: 'quality-reviewed',
    forecastDeviationPct: '7.5',
    allocationRules: 'allocation-rule-reviewed',
    scheduleImpact: 'no-submission',
    billingStatus: 'source-evidence-present',
    settlementStatus: 'not-executed-review-only',
    roleOwner: 'ROLE_MARKET_OPERATIONS',
    deadline: '2026-10-15',
    nextGate: 'direct-marketer-review-package',
  },
  missingEvidence: [],
  positiveFollowUps: [
    {
      missingDataPoint: 'forecastQualityEvidence',
      enablesDossierAddition: 'add forecast-quality evidence',
    },
  ],
  sourceActions: {
    notCalled: [
      'market.execute',
      'schedule.submit',
      'balancing-group.transfer',
      'offer.approve',
      'contract.approve',
      'customer.communication.send',
      'mako.write',
      'billing.run',
      'settlement.run',
      'external.connector.call',
      'budibase.table.write',
      'personal-agent.execute',
    ],
  },
};

const directMarketerLandingRegistryDraftFixture = {
  capabilityKey: 'stadtwerk_mauer_landing_registry_draft',
  safety: 'read_only_workbench_projection',
  status: 'landing_registry_draft_ready',
  tenantId: 'stadtwerk-mauer',
  seedId: 'stadtwerk-mauer-direct-marketer-risk-gate-v1',
  found: true,
  rowCount: 5,
  draft: {
    slug: 'direct-marketer-risk-gate',
    title: 'Direct Marketer Risk Gate',
    processFamily: 'market_partner_readiness',
    controlCase: 'direct_marketer_risk_gate',
    seedId: 'stadtwerk-mauer-direct-marketer-risk-gate-v1',
    roleHeaders: [
      'Phase',
      'V = Verantwortlich',
      'D = Durchfuehrend',
      'M = Mitwirkend',
      'I = Informiert',
      'Nachweise',
    ],
    rowCount: 5,
    rows: [
      {
        phase: '1',
        V: 'ROLE_MARKET_OPERATIONS',
        D: 'ROLE_ENERGY_SHARING_LEAD',
        M: 'ROLE_CERNION_GOVERNANCE',
        I: 'ROLE_MANAGEMENT',
        evidenceRequirements: ['syntheticHandoverScopeEvidence'],
        gateOutcome: 'synthetic_handover_scope_review_pending',
        status: 'handover_scope_gap',
        positiveFollowUp: 'Adds synthetic handover scope evidence.',
      },
    ],
    syncProof: {
      blueprintPack: { status: 'complete' },
      landingRegistryDraft: { status: 'draft_ready' },
      productiveDemoRoom: { status: 'pending' },
    },
    publicationBlockers: [
      'productive_demo_room_publication_issue_missing',
      'direct_marketer_publication_review_owner_missing',
    ],
    safetyBoundaries: ['landing-registry.write', 'cernion.de.publish'],
    sourceActions: {
      notCalled: [
        'landing-registry.write',
        'cernion.de.publish',
        'market.execute',
        'personal-agent.execute',
      ],
    },
  },
};

const interconnectionReleaseFileFixture = {
  releaseFileStatusId: 'irf:c3RhZHR3ZXJrLW1hdWVyOnNtbS1r',
  capabilityKey: 'interconnection_release_file',
  safety: 'read_only',
  found: true,
  status: 'reviewable_release_file',
  syntheticDemo: false,
  subject: {
    caseId: 'smm-koppelpunkt-release-demo',
    koppelpunktId: 'KP-SYN-MAUER-01',
    marketPartnerId: 'MP-SYN-MAUER-01',
    timeseriesId: 'TS-SYN-MAUER-01',
    mappingVersion: 'v1',
    tenantId: 'stadtwerk-mauer',
  },
  summaryRows: [
    { key: 'status', label: 'Release-file status', value: 'reviewable_release_file' },
    { key: 'case_id', label: 'Case', value: 'smm-koppelpunkt-release-demo' },
    { key: 'owner', label: 'Approval owner', value: 'marktkommunikation' },
    { key: 'mapping_version', label: 'Mapping version', value: 'v1' },
    { key: 'next_change_gate', label: 'Next change gate', value: '2026-Q3' },
    { key: 'evidence_basis', label: 'Evidence basis', value: 'request_provided_read_model' },
  ],
  mappingRows: [
    {
      key: 'koppelpunkt',
      label: 'Koppelpunkt',
      value: 'KP-SYN-MAUER-01',
      evidenceStatus: 'synthetic_demo_evidence',
    },
    {
      key: 'market_partner',
      label: 'Marktpartner',
      value: 'MP-SYN-MAUER-01',
      evidenceStatus: 'synthetic_demo_evidence',
    },
    {
      key: 'timeseries',
      label: 'Zeitreihe',
      value: 'TS-SYN-MAUER-01',
      evidenceStatus: 'synthetic_demo_evidence',
    },
  ],
  evidenceRows: [
    {
      sourceSystem: 'a2mdm-demo',
      sourceReference: 'KP-SYN-MAUER-01:MP-SYN-MAUER-01:TS-SYN-MAUER-01',
      mappingVersion: 'v1',
      evidenceStatus: 'synthetic_demo_evidence',
      confidence: 'medium',
    },
  ],
  approvalRows: [
    {
      owner: 'marktkommunikation',
      approvalStatus: 'approved',
      reviewerRole: 'marktkommunikation',
      openCheck: 'none',
    },
  ],
  processImpactRows: [
    {
      processFamily: 'market_communication',
      impact: 'descriptive_only',
      boundary: 'no MaKo message submission or partner master-data mutation',
    },
    {
      processFamily: 'metering',
      impact: 'descriptive_only',
      boundary: 'no MeLo/MaLo write and no meter operation',
    },
  ],
  missingEvidence: [],
  positiveFollowUps: [],
  sourceActions: {
    notCalled: [
      'mapping.write',
      'mapping.releaseExecute',
      'mako.submit',
      'billing.release',
      'settlement.prepareBilling',
      'settlement.exportA96',
      'tariff.mutate',
      'device-control.execute',
      'budibase.table.write',
      'personal-agent.execute',
      'production.mutate',
    ],
  },
};

const landingRegistryDraftFixture = {
  capabilityKey: 'stadtwerk_mauer_landing_registry_draft',
  safety: 'read_only_workbench_projection',
  status: 'landing_registry_draft_ready',
  tenantId: 'stadtwerk-mauer',
  seedId: 'stadtwerk-mauer-cross-system-variance-evidence-matrix-v1',
  found: true,
  rowCount: 4,
  draft: {
    slug: 'cross-system-variance-evidence-matrix',
    title: 'Cross-System Variance Evidence Matrix',
    processFamily: 'vnb_data_quality_governance',
    controlCase: 'cross_system_variance_evidence_matrix',
    seedId: 'stadtwerk-mauer-cross-system-variance-evidence-matrix-v1',
    roleHeaders: [
      'Phase',
      'V = Verantwortlich',
      'D = Durchfuehrend',
      'M = Mitwirkend',
      'I = Informiert',
      'Nachweise',
    ],
    rowCount: 4,
    rows: [
      {
        phase: '1',
        V: 'ROLE_ASSET_MDM_OWNER',
        D: 'ROLE_CERNION_GOVERNANCE',
        M: 'ROLE_CONTROLLING',
        I: 'ROLE_COMMERCIAL_AUDIT',
        evidenceRequirements: [
          'sourceSystemEvidence',
          'targetSystemEvidence',
          'affectedObjectEvidence',
        ],
        gateOutcome: 'source_target_and_object_lineage_visible',
        status: 'evidence_gap',
        positiveFollowUp: 'Adds source, target and affected-object lineage.',
      },
    ],
    syncProof: {
      blueprintPack: { status: 'complete' },
      landingRegistryDraft: { status: 'draft_ready' },
      productiveDemoRoom: { status: 'pending' },
    },
    publicationBlockers: [
      'productive_demo_room_publication_issue_missing',
      'landing_registry_review_owner_missing',
    ],
    safetyBoundaries: ['landing-registry.write', 'cernion.de.publish'],
    sourceActions: {
      notCalled: ['landing-registry.write', 'cernion.de.publish', 'personal-agent.execute'],
    },
  },
};

const crossSystemVarianceMatrixFixture = {
  status: 'evidence_gap',
  positiveFollowUps: [
    {
      missingDataPoint: 'source_system',
      label: 'Source system',
      enablesDossierAddition: 'add source-system lineage for the variance',
    },
    {
      missingDataPoint: 'owner',
      label: 'Variance owner',
      enablesDossierAddition: 'add accountable clarification owner',
    },
  ],
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

const monitoringNonEscalationFixture = {
  capabilityKey: 'non_escalation_control_evidence',
  safety: 'read_only',
  status: 'non_escalation_evidence_complete',
  signal: {
    signalId: 'vnb-delta-demo-anschluss',
    domain: 'grid_connection_capacity',
    assetContext: 'smm-budibase-workbench',
  },
  checkedSource: {
    sourceName: 'synthetic-vnb-delta-monitor',
    sourceCheckedAt: '2026-06-28T08:35:00.000Z',
    sourceCheckedAtValid: true,
  },
  novelty: 'unchanged',
  absentBlocker: {
    blockingFinding: 'none',
    blockerAbsent: true,
    classification: 'absent_blocker_documented',
  },
  evidenceItems: [
    {
      id: 'checked_source',
      label: 'Checked source',
      value: 'synthetic-vnb-delta-monitor',
      evidenceStatus: 'provided',
      sourceClass: 'monitoring_non_escalation_evidence',
    },
    {
      id: 'blocking_finding',
      label: 'Absent blocker evidence',
      value: 'none',
      evidenceStatus: 'provided',
      sourceClass: 'monitoring_non_escalation_evidence',
    },
  ],
  missingEvidence: [],
  positiveFollowUps: [],
  sourceActions: {
    notCalled: [
      'monitoring.scheduler.run',
      'alerting.escalate',
      'hitl.create',
      'mail.send',
      'workflow.execute',
      'external.connector.call',
      'object-store.write',
      'rag.ingest',
      'budibase.apply',
      'personal-agent.execute',
    ],
  },
  dossierEvidence: {
    signalId: 'vnb-delta-demo-anschluss',
    domain: 'grid_connection_capacity',
    sourceName: 'synthetic-vnb-delta-monitor',
    sourceCheckedAt: '2026-06-28T08:35:00.000Z',
    novelty: 'unchanged',
    blockerAbsent: true,
    owner: 'ROLE_NETZFUEHRUNG',
    nextCheckAt: '2026-07-03T12:00:00.000Z',
    rationale:
      'Synthetic demo signal has fresh source metadata, no documented blocker and a named next check owner.',
  },
};

const monitoringBlueprintFixture = {
  ...blueprintVerifyFixture,
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-monitoring-non-escalation-status-v1',
    processFamily: 'vnb_signal_monitoring',
    controlCase: 'monitoring_non_escalation_status',
    requiredEvidence: [
      'selectedSignalContext',
      'sourceFreshnessEvidence',
      'absentBlockerEvidence',
      'ownerNextCheckEvidence',
    ],
    missingEvidence: [],
    demoProcessMatrixSync: {
      slug: 'monitoring-non-escalation-status',
      expectedSlug: 'monitoring-non-escalation-status',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'no_escalation_action',
      evidenceRequirements: [
        'selectedSignalContext',
        'sourceFreshnessEvidence',
        'absentBlockerEvidence',
        'ownerNextCheckEvidence',
      ],
      rows: [
        {
          phase: 'non_escalation_review',
          roles: {
            V: 'ROLE_NETZFUEHRUNG',
            D: 'ROLE_GOVERNANCE_OWNER',
            M: 'ROLE_NETZPLANUNG',
            I: 'ROLE_MANAGEMENT',
          },
          evidenceRequirements: ['sourceFreshnessEvidence', 'absentBlockerEvidence'],
          status: 'review_ready',
          gateOutcome: 'keep_non_escalated_until_next_check',
        },
      ],
    },
  },
};

const redispatchParticipationFixture = {
  capabilityKey: 'redispatch_participation_readiness_status',
  safety: 'read_only_blueprint_seed',
  status: 'ready_for_review',
  readinessId: 'rprs:redispatch-participation-demo',
  syntheticRedispatchAssetPortfolio: 'synthetic-portfolio-mauer',
  installationGridLocationEvidence: 'mastr-and-osm-reviewed',
  remoteControlCommunicationTestEvidence: 'communication-test-success',
  forecastDispatchTestProof: 'test-dispatch-forecast-matching',
  readinessReviewDecision: 'redispatch-readiness-reviewed-by-ops-lead',
  evidenceItems: [
    {
      id: 'syntheticRedispatchAssetPortfolio',
      label: 'Synthetic Redispatch asset portfolio',
      value: 'synthetic-portfolio-mauer',
      evidenceStatus: 'provided',
      sourceClass: 'synthetic_tenant_seed',
    },
    {
      id: 'installationGridLocationEvidence',
      label: 'Installation grid location evidence',
      value: 'mastr-and-osm-reviewed',
      evidenceStatus: 'provided',
      sourceClass: 'synthetic_tenant_seed',
    },
  ],
  missingEvidence: [],
  positiveFollowUps: [],
};

const redispatchParticipationBlueprintFixture = {
  ...blueprintVerifyFixture,
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-redispatch-participation-readiness-v1',
    processFamily: 'redispatch_readiness',
    controlCase: 'redispatch_participation_readiness',
    requiredEvidence: [
      'syntheticRedispatchAssetPortfolio',
      'installationGridLocationEvidence',
      'remoteControlCommunicationTestEvidence',
      'forecastDispatchTestProof',
      'readinessReviewDecision',
    ],
    missingEvidence: [],
    demoProcessMatrixSync: {
      slug: 'redispatch-participation-readiness',
      expectedSlug: 'redispatch-participation-readiness',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'no_redispatch_action',
      evidenceRequirements: [
        'syntheticRedispatchAssetPortfolio',
        'installationGridLocationEvidence',
        'remoteControlCommunicationTestEvidence',
        'forecastDispatchTestProof',
        'readinessReviewDecision',
      ],
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_GRID_OPERATIONS_LEAD',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_ASSET_PLANNING_LEAD',
            I: 'ROLE_REGULATORY_AFFAIRS',
          },
          evidenceRequirements: ['syntheticRedispatchAssetPortfolio', 'installationGridLocationEvidence'],
          status: 'clarification',
          gateOutcome: 'redispatch_portfolio_pending',
        },
      ],
    },
    forbiddenActions: [
      'redispatch_enrollment',
      'dispatch_control',
      'mako_write',
      'billing',
      'settlement',
    ],
    sourceActions: {
      notCalled: ['redispatch_enrollment', 'dispatch_control', 'mako_write', 'billing', 'settlement'],
    },
  },
};

const mastrSyncGapStatusFixture = {
  readinessId: 'msga:mastr-sync-gap-alerting-id',
  status: 'ready_for_review',
  safety: 'read_only_blueprint_seed',
  mastrFreshnessEvidence: 'harvest-freshness-ok',
  redispatchStammdatenComparison: 'stammdaten-comparison-complete',
  syncGapAlertFeed: 'sync-gap-active-alerts-verified',
  reconciliationApprovalDecision: 'reconciliation-signed-off-by-ops-lead',
  evidenceItems: [
    {
      id: 'mastrFreshnessEvidence',
      label: 'MaStR freshness evidence',
      value: 'harvest-freshness-ok',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'redispatchStammdatenComparison',
      label: 'Redispatch Stammdaten comparison',
      value: 'stammdaten-comparison-complete',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'syncGapAlertFeed',
      label: 'Sync gap alert feed',
      value: 'sync-gap-active-alerts-verified',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'reconciliationApprovalDecision',
      label: 'Reconciliation approval decision',
      value: 'reconciliation-signed-off-by-ops-lead',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    }
  ],
  missingEvidence: [],
  positiveFollowUps: [],
  sourceActions: {
    notCalled: [
      'redispatch_enrollment',
      'dispatch_control'
    ]
  }
};

const mastrSyncGapSeedGuardFixture = {
  data: {
    seedId: 'stadtwerk-mauer-mastr-sync-gap-alerting-v1',
    processFamily: 'mastr_sync_gap_alerting',
    controlCase: 'mastr_sync_gap_alerting_status',
    validation: {
      valid: true
    },
    requiredEvidence: [
      'mastrFreshnessEvidence',
      'redispatchStammdatenComparison',
      'syncGapAlertFeed',
      'reconciliationApprovalDecision'
    ],
    missingEvidence: [],
    demoProcessMatrixSync: {
      slug: 'mastr-sync-gap-alerting',
      expectedSlug: 'mastr-sync-gap-alerting',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'no_mastr_action',
      evidenceRequirements: [
        'mastrFreshnessEvidence',
        'redispatchStammdatenComparison',
        'syncGapAlertFeed',
        'reconciliationApprovalDecision'
      ],
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_NETZBETRIEB',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_REDISPATCH_KOORDINATOR',
            I: 'ROLE_REDISPATCH_KOORDINATOR'
          },
          evidenceRequirements: ['mastrFreshnessEvidence'],
          status: 'ready_for_review',
          gateOutcome: 'mastr_freshness_harvested'
        }
      ]
    },
    forbiddenActions: [
      'redispatch_enrollment',
      'dispatch_control'
    ],
    sourceActions: {
      notCalled: ['redispatch_enrollment', 'dispatch_control']
    }
  }
};

const decommissionedAssetStatusFixture = {
  readinessId: 'dars:decommissioned-asset-id',
  status: 'ready_for_review',
  safety: 'read_only_blueprint_seed',
  gisDecommissionedAssetsEvidence: 'gis-decommissioned-ok',
  sapAnlagenspiegelEvidence: 'sap-anlagenspiegel-complete',
  reconciliationDiscrepancyFeed: 'discrepancy-feed-verified',
  reconciliationApprovalDecision: 'reconciliation-signed-off-by-reconciliation-lead',
  evidenceItems: [
    {
      id: 'gisDecommissionedAssetsEvidence',
      label: 'GIS decommissioned assets evidence',
      value: 'gis-decommissioned-ok',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'sapAnlagenspiegelEvidence',
      label: 'SAP Anlagenspiegel evidence',
      value: 'sap-anlagenspiegel-complete',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'reconciliationDiscrepancyFeed',
      label: 'Reconciliation discrepancy feed',
      value: 'discrepancy-feed-verified',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'reconciliationApprovalDecision',
      label: 'Reconciliation approval decision',
      value: 'reconciliation-signed-off-by-reconciliation-lead',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    }
  ],
  missingEvidence: [],
  positiveFollowUps: [],
  sourceActions: {
    notCalled: [
      'redispatch_enrollment',
      'dispatch_control'
    ]
  }
};

const decommissionedAssetSeedGuardFixture = {
  data: {
    seedId: 'stadtwerk-mauer-decommissioned-asset-reconciliation-v1',
    processFamily: 'decommissioned_asset_reconciliation',
    controlCase: 'decommissioned_asset_reconciliation_status',
    validation: {
      valid: true
    },
    requiredEvidence: [
      'gisDecommissionedAssetsEvidence',
      'sapAnlagenspiegelEvidence',
      'reconciliationDiscrepancyFeed',
      'reconciliationApprovalDecision'
    ],
    missingEvidence: [],
    demoProcessMatrixSync: {
      slug: 'decommissioned-asset-reconciliation',
      expectedSlug: 'decommissioned-asset-reconciliation',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'no_decommission_action',
      evidenceRequirements: [
        'gisDecommissionedAssetsEvidence',
        'sapAnlagenspiegelEvidence',
        'reconciliationDiscrepancyFeed',
        'reconciliationApprovalDecision'
      ],
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_NETZPLANUNG',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_ANLAGENBUCHHALTUNG',
            I: 'ROLE_COMMERCIAL_AUDIT'
          },
          evidenceRequirements: ['gisDecommissionedAssetsEvidence'],
          status: 'ready_for_review',
          gateOutcome: 'gis_decommissioned_assets_harvested'
        }
      ]
    },
    forbiddenActions: [
      'redispatch_enrollment',
      'dispatch_control'
    ],
    sourceActions: {
      notCalled: ['redispatch_enrollment', 'dispatch_control']
    }
  }
};

const coordinationMeaningPreservationFixture = {
  capabilityKey: 'coordination_meaning_preservation_profile',
  safety: 'read_only',
  status: 'needs_decision_context',
  coordinationLossClassification: 'decision_context_missing',
  requestContext: {
    caseId: 'smm-budibase-workbench',
    sourceDomain: 'Netzbetrieb',
    targetDomain: 'Zielnetzplanung',
    handoverContext: 'selected_case_context_loss_review',
  },
  preservedDimensions: [
    {
      id: 'regulatory_reference',
      label: 'Regulatory reference',
      value: '14a-redispatch-boundary',
      category: 'regulatory_context',
      evidenceStatus: 'provided',
    },
    {
      id: 'network_constraint',
      label: 'Network constraint',
      value: 'nap-clarification-required',
      category: 'grid_context',
      evidenceStatus: 'provided',
    },
    {
      id: 'owner',
      label: 'Owner',
      value: 'ROLE_NETZPLANUNG',
      category: 'ownership_context',
      evidenceStatus: 'provided',
    },
  ],
  missingDimensions: [
    {
      missingDataPoint: 'commercial_effect',
      label: 'Commercial effect',
      category: 'commercial_context',
      enablesDossierAddition: 'add kaufmaennische Auswirkung',
    },
    {
      missingDataPoint: 'deadline',
      label: 'Deadline',
      category: 'time_context',
      enablesDossierAddition: 'add Frist / Wiedervorlage',
    },
    {
      missingDataPoint: 'next_decision',
      label: 'Next decision',
      category: 'decision_context',
      enablesDossierAddition: 'add naechster Entscheidungspunkt',
    },
  ],
  weakDimensions: [
    {
      id: 'evidence_proof',
      label: 'Evidence proof',
      category: 'proof_context',
      enablesDossierAddition: 'strengthen Nachweisquelle',
    },
  ],
  positiveFollowUps: [
    {
      missingDataPoint: 'commercial_effect',
      enablesDossierAddition: 'add kaufmaennische Auswirkung',
      category: 'coordination_meaning_preservation_profile',
    },
  ],
  sourceActions: {
    notCalled: [
      'external.connector.call',
      'hitl.create',
      'budibase.write',
      'device-control.execute',
    ],
  },
};

const energySharingCollectiveApprovalStatusFixture = {
  readinessId: 'esca:energy-sharing-collective-id',
  status: 'ready_for_review',
  safety: 'read_only_blueprint_seed',
  syntheticCollectiveBoundaryEvidence: 'collective-boundary-ok',
  operatorParticipantBoundaryEvidence: 'operator-participant-complete',
  meteringConceptEvidence: 'metering-concept-verified',
  contractConsentMarketRoleEvidence: 'contract-consent-signed-off',
  allocationBillingSettlementGapEvidence: 'allocation-gap-closed',
  approvalReadinessDecision: 'collective-approval-signed-off-by-product-owner',
  evidenceItems: [
    {
      id: 'syntheticCollectiveBoundaryEvidence',
      label: 'Synthetic collective boundary evidence',
      value: 'collective-boundary-ok',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'operatorParticipantBoundaryEvidence',
      label: 'Operator participant boundary evidence',
      value: 'operator-participant-complete',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'meteringConceptEvidence',
      label: 'Metering concept evidence',
      value: 'metering-concept-verified',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'contractConsentMarketRoleEvidence',
      label: 'Contract consent market role evidence',
      value: 'contract-consent-signed-off',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'allocationBillingSettlementGapEvidence',
      label: 'Allocation billing settlement gap evidence',
      value: 'allocation-gap-closed',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    },
    {
      id: 'approvalReadinessDecision',
      label: 'Approval readiness decision',
      value: 'collective-approval-signed-off-by-product-owner',
      sourceClass: 'synthetic_tenant_seed',
      evidenceStatus: 'provided'
    }
  ],
  missingEvidence: [],
  positiveFollowUps: [],
  sourceActions: {
    notCalled: [
      'redispatch_enrollment',
      'dispatch_control'
    ]
  }
};

const energySharingCollectiveApprovalSeedGuardFixture = {
  data: {
    seedId: 'stadtwerk-mauer-energy-sharing-collective-approval-v1',
    processFamily: 'energy_sharing_governance',
    controlCase: 'energy_sharing_collective_approval',
    validation: {
      valid: true
    },
    requiredEvidence: [
      'syntheticCollectiveBoundaryEvidence',
      'operatorParticipantBoundaryEvidence',
      'meteringConceptEvidence',
      'contractConsentMarketRoleEvidence',
      'allocationBillingSettlementGapEvidence',
      'approvalReadinessDecision'
    ],
    missingEvidence: [],
    demoProcessMatrixSync: {
      slug: 'energy-sharing-collective-approval',
      expectedSlug: 'energy-sharing-collective-approval',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'no_energy_sharing_action',
      evidenceRequirements: [
        'syntheticCollectiveBoundaryEvidence',
        'operatorParticipantBoundaryEvidence',
        'meteringConceptEvidence',
        'contractConsentMarketRoleEvidence',
        'allocationBillingSettlementGapEvidence',
        'approvalReadinessDecision'
      ],
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_LEGAL_REGULATORY_AFFAIRS',
            I: 'ROLE_MANAGEMENT'
          },
          evidenceRequirements: ['syntheticCollectiveBoundaryEvidence'],
          status: 'ready_for_review',
          gateOutcome: 'synthetic_collective_review_case_identified'
        }
      ]
    },
    forbiddenActions: [
      'redispatch_enrollment',
      'dispatch_control'
    ],
    sourceActions: {
      notCalled: ['redispatch_enrollment', 'dispatch_control']
    }
  }
};

const costReviewCommitteeFixture = {
  capabilityKey: 'cost_review_committee_status',
  safety: 'read_only',
  status: 'committee_ready',
  costReviewId: 'crcs:cost-review-committee-demo',
  owner: 'ROLE_CONTROLLING',
  reviewStatus: 'fachlich-geprueft',
  dataOrigin: 'synthetic-cost-register',
  assetRelevance: 'netzanschluss-portfolio',
  revenueRelevance: 'municipal-value-context',
  decisionReadiness: 'ready-for-committee-review',
  escalationThreshold: 'abweichung-groesser-10p',
  nextCommitteeGate: 'cost-review-board-2026-q3',
  evidenceItems: [
    {
      id: 'owner',
      label: 'Cost review owner',
      value: 'ROLE_CONTROLLING',
      evidenceStatus: 'provided',
      sourceClass: 'governance_owner',
    },
    {
      id: 'next_committee_gate',
      label: 'Next committee gate',
      value: 'cost-review-board-2026-q3',
      evidenceStatus: 'provided',
      sourceClass: 'committee_gate',
    },
  ],
  missingEvidence: [],
  positiveFollowUps: [],
};

const costReviewBlueprintFixture = {
  ...blueprintVerifyFixture,
  data: {
    ...blueprintVerifyFixture.data,
    seedId: 'stadtwerk-mauer-cost-review-committee-readiness-v1',
    processFamily: 'investment_cost_review',
    controlCase: 'cost_review_committee_readiness',
    requiredEvidence: [
      'costItemOwnerEvidence',
      'dataOriginEvidence',
      'assetRelevanceEvidence',
      'revenueMunicipalValueEvidence',
      'escalationThresholdEvidence',
      'nextCommitteeGateEvidence',
      'decisionReadinessMarker',
    ],
    missingEvidence: [
      {
        missingDataPoint: 'escalationThresholdEvidence',
        state: 'evidence_gap',
        enablesDossierAddition:
          'Adds escalation-threshold comparison as review evidence without approving budget or committee action.',
      },
    ],
    demoProcessMatrixSync: {
      slug: 'cost-review-committee-readiness',
      expectedSlug: 'cost-review-committee-readiness',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'no_committee_action',
      evidenceRequirements: [
        'costItemOwnerEvidence',
        'dataOriginEvidence',
        'assetRelevanceEvidence',
        'revenueMunicipalValueEvidence',
        'escalationThresholdEvidence',
        'nextCommitteeGateEvidence',
        'decisionReadinessMarker',
      ],
      rows: [
        {
          phase: '1',
          roles: {
            V: 'ROLE_CONTROLLING',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_ASSET_PLANNING',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: ['costItemOwnerEvidence', 'dataOriginEvidence'],
          status: 'clarification',
          gateOutcome: 'cost_item_scope_and_source_class_pending',
        },
      ],
    },
    forbiddenActions: [
      'erp.write',
      'sap.psp.write',
      'accounting.post',
      'budget.approve',
      'committee.decision.execute',
    ],
    sourceActions: {
      notCalled: ['workflow_create', 'mail_send', 'budibase_table_write', 'personal_agent_hardcoding'],
    },
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
    'landing_registry_draft_sync_summary',
    'landing_registry_draft_preview',
    'landing_registry_blueprint_validity',
    'landing_registry_matrix_sync',
    'landing_registry_publication_blockers',
    'landing_registry_positive_followups',
    'landing_registry_no_call_guards',
    'portfolio_market_value_seed_guard',
    'portfolio_market_value_matrix',
    'portfolio_market_value_backtest',
    'portfolio_market_value_evidence',
    'portfolio_market_value_boundaries',
    'monitoring_non_escalation_status',
    'monitoring_non_escalation_evidence',
    'monitoring_non_escalation_seed_guard',
    'monitoring_non_escalation_matrix',
    'monitoring_non_escalation_boundaries',
    'cost_review_committee_status',
    'cost_review_committee_evidence',
    'cost_review_committee_seed_guard',
    'cost_review_committee_matrix',
    'cost_review_committee_boundaries',
    'action_button_contract',
    'action_button_guards',
    'vnb_delta_signal_queue_classifier',
    'vnb_delta_signal_queue_owner_evidence',
    'vnb_delta_signal_queue_safe_next_actions',
    'vnb_delta_signal_queue_leadership',
    'vnb_delta_signal_queue_boundaries',
    'gas_dataroom_seed_selector',
    'gas_dataroom_verify_summary',
    'gas_dataroom_demo_process_matrix',
    'gas_dataroom_required_evidence',
    'gas_dataroom_focus',
    'gas_dataroom_transfer_readiness',
    'gas_dataroom_no_call_guards',
    'connection_deadline_evidence_queue_seed_selector',
    'connection_deadline_evidence_queue_verify_summary',
    'connection_deadline_evidence_queue_demo_process_matrix',
    'connection_deadline_evidence_queue_required_evidence',
    'connection_deadline_evidence_queue_focus',
    'connection_deadline_evidence_queue_transfer_readiness',
    'connection_deadline_evidence_queue_no_call_guards',
    'investment_owner_deadline_budget_gate_seed_selector',
    'investment_owner_deadline_budget_gate_verify_summary',
    'investment_owner_deadline_budget_gate_demo_process_matrix',
    'investment_owner_deadline_budget_gate_required_evidence',
    'investment_owner_deadline_budget_gate_focus',
    'investment_owner_deadline_budget_gate_transfer_readiness',
    'investment_owner_deadline_budget_gate_no_call_guards',
    'selected_case_context_binding',
    'selected_case_read_model_bindings',
    'selected_case_evidence_trace_artifacts',
    'selected_case_next_gate_actions',
    'selected_case_context_no_call_guards',
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
        '/api/dashboard/grid-connection-transformation-gate',
      ])
    );
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-cross-system-variance-evidence-matrix-v1')
      )
    ).toBe(true);
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-grid-connection-transformation-gate-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('blueprint_variance'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('blueprint_grid_transformation'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);
  });

  it('adds the gas transformation dataroom panel from existing read-only bricks', () => {
    const queries = manifest.queries.filter((query) =>
      query.name.includes('GasTransformationDataroom')
    );
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
        '/api/dashboard/gas-transformation-dataroom',
        '/api/dashboard/stadtwerk-mauer-transfer-readiness',
      ])
    );
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-gas-transformation-dataroom-review-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('gas_dataroom'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);
    expect(manifest.notes.join(' ')).toContain('Gas Transformation Dataroom binds');
  });

  it('adds the Anschlussfristen evidence queue panel from existing read-only bricks', () => {
    const queries = manifest.queries.filter((query) =>
      query.name.includes('ConnectionDeadlineEvidenceQueue')
    );
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
        '/api/dashboard/connection-deadline-evidence-queue',
        '/api/dashboard/stadtwerk-mauer-transfer-readiness',
      ])
    );
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-connection-deadline-evidence-queue-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('connection_deadline_evidence_queue'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);
    expect(manifest.notes.join(' ')).toContain('Anschlussfristen Evidence Queue binds');
  });

  it('adds the Investment Owner-Frist-Budget panel from existing read-only bricks', () => {
    const queries = manifest.queries.filter((query) =>
      query.name.includes('InvestmentOwnerDeadlineBudgetGate')
    );
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
        '/api/dashboard/investment-owner-deadline-budget-gate',
        '/api/dashboard/stadtwerk-mauer-transfer-readiness',
      ])
    );
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-investment-owner-deadline-budget-gate-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('investment_owner_deadline_budget_gate'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);
    expect(manifest.notes.join(' ')).toContain('Investment Owner-Frist-Budget Gate binds');
  });

  it('adds the Direct Marketer Risk Gate panel from existing read-only bricks', () => {
    const queries = manifest.queries.filter((query) =>
      query.name.includes('DirectMarketerRiskGate')
    );
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
        '/api/dashboard/direct-marketer-risk-gate',
        '/api/dashboard/stadtwerk-mauer-transfer-readiness',
        '/api/dashboard/stadtwerk-mauer-landing-registry-draft',
      ])
    );
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-direct-marketer-risk-gate-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('direct_marketer_risk_gate'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);
    expect(manifest.notes.join(' ')).toContain('Direct Marketer Risk Gate binds');
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

  it('adds the Monitoring Non-Escalation panel from existing safe endpoints', () => {
    const queries = manifest.queries.filter((query) =>
      query.name.includes('MonitoringNonEscalation')
    );
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/monitoring-non-escalation',
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
      ])
    );
    expect(
      queries.every(
        (query) => query.path !== '/api/dashboard/stadtwerk-mauer-monitoring-non-escalation'
      )
    ).toBe(true);
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-monitoring-non-escalation-status-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('monitoring_non_escalation'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);

    const statusQuery = queries.find(
      (query) => query.name === 'getMonitoringNonEscalationStatusRows'
    );
    expect(statusQuery).toMatchObject({
      method: 'GET',
      path: '/api/dashboard/monitoring-non-escalation',
    });
    expect(statusQuery.queryString).toContain('signalId=vnb-delta-demo-anschluss');
    expect(statusQuery.queryString).toContain('blockingFinding=none');
    expect(statusQuery.queryString).toContain('owner=ROLE_NETZFUEHRUNG');
  });

  it('adds the Cost Review Committee Readiness panel from existing safe endpoints', () => {
    const queries = manifest.queries.filter((query) =>
      query.name.includes('CostReviewCommittee')
    );
    const paths = new Set(queries.map((query) => query.path));

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/cost-review-committee-status',
        '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
      ])
    );
    expect(
      queries.every(
        (query) => query.path !== '/api/dashboard/stadtwerk-mauer-cost-review-committee-readiness'
      )
    ).toBe(true);
    expect(
      queries.some((query) =>
        query.queryString?.includes('stadtwerk-mauer-cost-review-committee-readiness-v1')
      )
    ).toBe(true);
    expect(
      manifest.sections
        .filter((section) => section.id.startsWith('cost_review_committee'))
        .every((section) => queries.some((query) => query.name === section.queryName))
    ).toBe(true);

    const statusQuery = queries.find(
      (query) => query.name === 'getCostReviewCommitteeStatusRows'
    );
    expect(statusQuery).toMatchObject({
      method: 'GET',
      path: '/api/dashboard/cost-review-committee-status',
    });
    expect(statusQuery.queryString).toContain('owner=ROLE_CONTROLLING');
    expect(statusQuery.queryString).toContain('nextCommitteeGate=cost-review-board-2026-q3');
    expect(statusQuery.queryString).toContain('decisionReadiness=ready-for-committee-review');
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
          selectedSeedId: 'stadtwerk-mauer-grid-connection-transformation-gate-v1',
          selected: false,
          controlCase: 'cross_system_variance_evidence_matrix',
        }),
        expect.objectContaining({
          availableSeedId: 'stadtwerk-mauer-grid-connection-transformation-gate-v1',
          selectedSeedId: 'stadtwerk-mauer-grid-connection-transformation-gate-v1',
          selected: true,
          processFamily: 'grid_connection_transformation',
          controlCase: 'grid_connection_transformation_gate',
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

    const gridSummaryRows = runTransformer(
      'getVdmiBlueprintSelectorGridTransformationVerifySummaryRows',
      blueprintGridTransformationFixture
    );
    expectScalarRows(gridSummaryRows);
    expect(gridSummaryRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-grid-connection-transformation-gate-v1',
      processFamily: 'grid_connection_transformation',
      controlCase: 'grid_connection_transformation_gate',
      sourceClass: 'vdmi_blueprint_pack_verify_selector',
    });

    const gridMatrixRows = runTransformer(
      'getVdmiBlueprintSelectorGridTransformationMatrixRows',
      blueprintGridTransformationFixture
    );
    expectScalarRows(gridMatrixRows);
    assertNoRawObjectText(gridMatrixRows);
    expect(gridMatrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'grid_transformation_matrix_sync_summary',
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          downstreamHandoff: 'complete -> pending -> pending',
        }),
        expect.objectContaining({
          rowKey: 'grid_transformation_matrix_row_1',
          v: 'ROLE_NETZPLANUNG',
          d: 'ROLE_CERNION_GOVERNANCE',
          m: 'ROLE_ASSET_MANAGEMENT',
          i: 'ROLE_ADMINISTRATOR',
          nachweise:
            'napMaloReferenceEvidence, divisionEvidence, sourceReferenceEvidence',
        }),
      ])
    );
    expect(gridMatrixRows[1]).not.toHaveProperty('roles');

    const gridEvidenceRows = runTransformer(
      'getVdmiBlueprintSelectorGridTransformationEvidenceRows',
      blueprintGridTransformationFixture
    );
    expectScalarRows(gridEvidenceRows);
    expect(gridEvidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: 'divisionEvidence',
          enablesDossierAddition: expect.stringContaining('division/sparte'),
        }),
        expect.objectContaining({
          evidenceId: 'ownerNextActionEvidence',
          enablesDossierAddition: expect.stringContaining('accountable owner'),
        }),
      ])
    );

    const gridDataClassRows = runTransformer(
      'getVdmiBlueprintSelectorGridTransformationDataClassRows',
      blueprintGridTransformationFixture
    );
    expectScalarRows(gridDataClassRows);
    expect(gridDataClassRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataClass: 'public_context', mutable: false }),
        expect.objectContaining({ dataClass: 'synthetic_seed', syntheticOnly: true }),
      ])
    );

    const gridGuardRows = runTransformer(
      'getVdmiBlueprintSelectorGridTransformationForbiddenActionRows',
      blueprintGridTransformationFixture
    );
    expectScalarRows(gridGuardRows);
    expect(gridGuardRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'budibase_table_write', status: 'forbidden' }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const gridSyncRows = runTransformer('getVdmiBlueprintSelectorGridTransformationSyncFocusRows', {
      status: 'transfer_readiness_pending',
      transferSummaryRows: [{ status: 'blocked', transferState: 'sync_proof_required' }],
    });
    expectScalarRows(gridSyncRows);
    expect(gridSyncRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selectedSeedId: 'stadtwerk-mauer-grid-connection-transformation-gate-v1',
          focusPath: '/api/dashboard/grid-connection-transformation-gate',
          syncStatus: 'sync_proof_required',
        }),
        expect.objectContaining({
          rowKey: 'grid_transformation_demo_raum_sync_gate',
          status: 'pending_downstream_sync_proof',
        }),
      ])
    );

    const gridFocusRows = runTransformer(
      'getVdmiBlueprintSelectorGridTransformationFocusRows',
      gridTransformationGateFixture
    );
    expectScalarRows(gridFocusRows);
    assertNoRawObjectText(gridFocusRows);
    expect(gridFocusRows[0]).toMatchObject({
      meteringPointId: 'MaLo-SMM-406',
      division: 'electricity',
      transformationOption: 'h2_ready',
      dataQualityStatus: 'verified',
      investmentPath: 'capex_review_needed',
      decommissionPath: 'reuse_check_pending',
      owner: 'ROLE_NETZPLANUNG',
      nextAction: 'verify_asset_znp_context',
      sourceClass: 'grid_connection_transformation_gate_focus',
    });

    const gasSelectorRows = runTransformer(
      'getGasTransformationDataroomSeedSelectorRows',
      gasDataroomBlueprintFixture
    );
    expectScalarRows(gasSelectorRows);
    assertNoRawObjectText(gasSelectorRows);
    expect(gasSelectorRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableSeedId: 'stadtwerk-mauer-gas-transformation-dataroom-review-v1',
          selectedSeedId: 'stadtwerk-mauer-gas-transformation-dataroom-review-v1',
          selected: true,
          controlCase: 'gas_transformation_dataroom_status_review',
        }),
      ])
    );

    const gasMatrixRows = runTransformer(
      'getGasTransformationDataroomMatrixRows',
      gasDataroomBlueprintFixture
    );
    expectScalarRows(gasMatrixRows);
    assertNoRawObjectText(gasMatrixRows);
    expect(gasMatrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'gas_dataroom_matrix_sync_summary',
          roleLegendM: 'Mitwirkend',
          rowCount: 5,
          downstreamHandoff: 'complete -> pending -> pending',
        }),
        expect.objectContaining({
          rowKey: 'gas_dataroom_matrix_row_1',
          phase: '1',
          v: 'ROLE_NETZSTRATEGIE',
          d: 'ROLE_ASSET_STRATEGY',
          m: 'ROLE_REGULATORY_AFFAIRS',
          i: 'ROLE_MANAGEMENT',
          nachweise: 'roomMandateBoundaryEvidence, transformationPathEvidence',
        }),
      ])
    );

    const gasEvidenceRows = runTransformer(
      'getGasTransformationDataroomRequiredEvidenceRows',
      gasDataroomBlueprintFixture
    );
    expectScalarRows(gasEvidenceRows);
    expect(gasEvidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: 'evidenceRegisterSnapshot',
          enablesDossierAddition: 'show gas dataroom evidence-register gaps',
        }),
      ])
    );

    const gasFocusRows = runTransformer(
      'getGasTransformationDataroomFocusRows',
      gasDataroomStatusFixture
    );
    expectScalarRows(gasFocusRows);
    assertNoRawObjectText(gasFocusRows);
    expect(gasFocusRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'eog_kanu_boundary',
          value: 'EOG/KANU context only; no legal decision',
        }),
        expect.objectContaining({
          rowKey: 'demo_raum_sync_status',
          value: 'Blueprint-Pack complete / Landing-Registry pending / productive page pending',
        }),
      ])
    );

    const gasTransferRows = runTransformer('getGasTransformationDataroomTransferRows', {
      status: 'transfer_blocked',
    });
    expectScalarRows(gasTransferRows);
    expect(gasTransferRows[0]).toMatchObject({
      rowKey: 'gas_dataroom_transfer_pending',
      value: 'Landing-Registry and productive page sync proof pending',
    });

    const gasNoCallRows = runTransformer(
      'getGasTransformationDataroomNoCallRows',
      gasDataroomStatusFixture
    );
    expectScalarRows(gasNoCallRows);
    expect(gasNoCallRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'budibase.table.write', status: 'not_called' }),
        expect.objectContaining({
          action: 'gas-transformation.executeDecommissioning',
          status: 'not_called',
        }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const connectionSelectorRows = runTransformer(
      'getConnectionDeadlineEvidenceQueueSeedSelectorRows',
      connectionDeadlineBlueprintFixture
    );
    expectScalarRows(connectionSelectorRows);
    assertNoRawObjectText(connectionSelectorRows);
    expect(connectionSelectorRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableSeedId: 'stadtwerk-mauer-connection-deadline-evidence-queue-v1',
          selectedSeedId: 'stadtwerk-mauer-connection-deadline-evidence-queue-v1',
          selected: true,
          controlCase: 'connection_deadline_evidence_queue',
        }),
      ])
    );

    const connectionMatrixRows = runTransformer(
      'getConnectionDeadlineEvidenceQueueMatrixRows',
      connectionDeadlineBlueprintFixture
    );
    expectScalarRows(connectionMatrixRows);
    assertNoRawObjectText(connectionMatrixRows);
    expect(connectionMatrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'connection_deadline_matrix_sync_summary',
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          downstreamHandoff: 'complete -> pending -> pending',
        }),
        expect.objectContaining({
          rowKey: 'connection_deadline_matrix_row_1',
          phase: '1',
          v: 'ROLE_NETZPLANUNG',
          d: 'ROLE_ANSCHLUSSWESEN',
          m: 'ROLE_CERNION_GOVERNANCE',
          i: 'ROLE_MANAGEMENT',
          nachweise: 'connectionCaseIntakeEvidence',
        }),
      ])
    );

    const connectionEvidenceRows = runTransformer(
      'getConnectionDeadlineEvidenceQueueRequiredEvidenceRows',
      connectionDeadlineBlueprintFixture
    );
    expectScalarRows(connectionEvidenceRows);
    expect(connectionEvidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: 'technicalPlausibilityEvidence',
          enablesDossierAddition: 'show technical plausibility marker without capacity reservation',
        }),
      ])
    );

    const connectionFocusRows = runTransformer(
      'getConnectionDeadlineEvidenceQueueFocusRows',
      connectionDeadlineStatusFixture
    );
    expectScalarRows(connectionFocusRows);
    assertNoRawObjectText(connectionFocusRows);
    expect(connectionFocusRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'deadline_risk',
          value: 'fristkritisch',
        }),
        expect.objectContaining({
          rowKey: 'communication_note',
          value: 'draft_ready; sent=false',
        }),
        expect.objectContaining({
          rowKey: 'demo_raum_sync_status',
          value: 'Blueprint-Pack complete / Landing-Registry pending / productive page pending',
        }),
      ])
    );

    const connectionTransferRows = runTransformer('getConnectionDeadlineEvidenceQueueTransferRows', {
      status: 'transfer_blocked',
    });
    expectScalarRows(connectionTransferRows);
    expect(connectionTransferRows[0]).toMatchObject({
      rowKey: 'connection_deadline_transfer_pending',
      value: 'Landing-Registry and productive page sync proof pending',
    });

    const connectionNoCallRows = runTransformer(
      'getConnectionDeadlineEvidenceQueueNoCallRows',
      connectionDeadlineStatusFixture
    );
    expectScalarRows(connectionNoCallRows);
    expect(connectionNoCallRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'communication.send', status: 'not_called' }),
        expect.objectContaining({
          action: 'grid-connection.reserveCapacity',
          status: 'not_called',
        }),
        expect.objectContaining({ action: 'deadline.legalCalculate', status: 'not_called' }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const investmentSelectorRows = runTransformer(
      'getInvestmentOwnerDeadlineBudgetGateSeedSelectorRows',
      investmentOwnerBudgetBlueprintFixture
    );
    expectScalarRows(investmentSelectorRows);
    assertNoRawObjectText(investmentSelectorRows);
    expect(investmentSelectorRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableSeedId: 'stadtwerk-mauer-investment-owner-deadline-budget-gate-v1',
          selectedSeedId: 'stadtwerk-mauer-investment-owner-deadline-budget-gate-v1',
          selected: true,
          controlCase: 'investment_owner_deadline_budget_gate',
        }),
      ])
    );

    const investmentMatrixRows = runTransformer(
      'getInvestmentOwnerDeadlineBudgetGateMatrixRows',
      investmentOwnerBudgetBlueprintFixture
    );
    expectScalarRows(investmentMatrixRows);
    assertNoRawObjectText(investmentMatrixRows);
    expect(investmentMatrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'investment_owner_budget_matrix_sync_summary',
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          downstreamHandoff: 'complete -> pending -> pending',
        }),
        expect.objectContaining({
          rowKey: 'investment_owner_budget_matrix_row_1',
          phase: '1',
          v: 'ROLE_ASSET_MANAGEMENT',
          d: 'ROLE_CONTROLLING',
          m: 'ROLE_CERNION_GOVERNANCE',
          i: 'ROLE_MANAGEMENT',
          nachweise: 'investmentMeasureIdentityEvidence, accountableOwnerEvidence',
        }),
      ])
    );

    const investmentEvidenceRows = runTransformer(
      'getInvestmentOwnerDeadlineBudgetGateRequiredEvidenceRows',
      investmentOwnerBudgetBlueprintFixture
    );
    expectScalarRows(investmentEvidenceRows);
    expect(investmentEvidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: 'budgetEffectEvidence',
          enablesDossierAddition: 'show budget effect without booking or approval',
        }),
      ])
    );

    const investmentFocusRows = runTransformer(
      'getInvestmentOwnerDeadlineBudgetGateFocusRows',
      investmentOwnerBudgetStatusFixture
    );
    expectScalarRows(investmentFocusRows);
    assertNoRawObjectText(investmentFocusRows);
    expect(investmentFocusRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'measure_identity',
          value: 'smm-invest-owner-budget-001',
        }),
        expect.objectContaining({
          rowKey: 'budget_effect',
          value: 'capex-review-needed',
        }),
        expect.objectContaining({
          rowKey: 'demo_raum_sync_status',
          value: 'Blueprint-Pack complete / Landing-Registry pending / productive page pending',
        }),
      ])
    );

    const investmentTransferRows = runTransformer(
      'getInvestmentOwnerDeadlineBudgetGateTransferRows',
      { status: 'transfer_blocked' }
    );
    expectScalarRows(investmentTransferRows);
    expect(investmentTransferRows[0]).toMatchObject({
      rowKey: 'investment_owner_budget_transfer_pending',
      value: 'Landing-Registry and productive page sync proof pending',
    });

    const investmentNoCallRows = runTransformer(
      'getInvestmentOwnerDeadlineBudgetGateNoCallRows',
      investmentOwnerBudgetStatusFixture
    );
    expectScalarRows(investmentNoCallRows);
    expect(investmentNoCallRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'budget.approve', status: 'not_called' }),
        expect.objectContaining({ action: 'committee.execute', status: 'not_called' }),
        expect.objectContaining({ action: 'budibase.table.write', status: 'not_called' }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const directMarketerSelectorRows = runTransformer(
      'getDirectMarketerRiskGateSeedSelectorRows',
      directMarketerRiskGateBlueprintFixture
    );
    expectScalarRows(directMarketerSelectorRows);
    assertNoRawObjectText(directMarketerSelectorRows);
    expect(directMarketerSelectorRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableSeedId: 'stadtwerk-mauer-direct-marketer-risk-gate-v1',
          selectedSeedId: 'stadtwerk-mauer-direct-marketer-risk-gate-v1',
          selected: true,
          controlCase: 'direct_marketer_risk_gate',
        }),
      ])
    );

    const directMarketerMatrixRows = runTransformer(
      'getDirectMarketerRiskGateMatrixRows',
      directMarketerRiskGateBlueprintFixture
    );
    expectScalarRows(directMarketerMatrixRows);
    assertNoRawObjectText(directMarketerMatrixRows);
    expect(directMarketerMatrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'direct_marketer_risk_gate_matrix_sync_summary',
          roleLegendM: 'Mitwirkend',
          rowCount: 5,
          downstreamHandoff: 'complete -> pending -> pending',
        }),
        expect.objectContaining({
          rowKey: 'direct_marketer_risk_gate_matrix_row_1',
          phase: '1',
          v: 'ROLE_MARKET_OPERATIONS',
          d: 'ROLE_ENERGY_SHARING_LEAD',
          m: 'ROLE_CERNION_GOVERNANCE',
          i: 'ROLE_MANAGEMENT',
          nachweise: 'syntheticHandoverScopeEvidence',
        }),
      ])
    );

    const directMarketerEvidenceRows = runTransformer(
      'getDirectMarketerRiskGateRequiredEvidenceRows',
      directMarketerRiskGateBlueprintFixture
    );
    expectScalarRows(directMarketerEvidenceRows);
    expect(directMarketerEvidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: 'forecastQualityEvidence',
          enablesDossierAddition: 'add forecast-quality evidence',
        }),
      ])
    );

    const directMarketerFocusRows = runTransformer(
      'getDirectMarketerRiskGateFocusRows',
      directMarketerRiskGateStatusFixture
    );
    expectScalarRows(directMarketerFocusRows);
    assertNoRawObjectText(directMarketerFocusRows);
    expect(directMarketerFocusRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'project_identity',
          value: 'smm-market-handover-001',
        }),
        expect.objectContaining({
          rowKey: 'billing_status',
          value: 'source-evidence-present / not-executed-review-only',
        }),
        expect.objectContaining({
          rowKey: 'demo_raum_sync_status',
          value: 'Blueprint-Pack complete / Landing-Registry pending / productive page pending',
        }),
      ])
    );

    const directMarketerTransferRows = runTransformer(
      'getDirectMarketerRiskGateTransferRows',
      { status: 'transfer_blocked' }
    );
    expectScalarRows(directMarketerTransferRows);
    expect(directMarketerTransferRows[0]).toMatchObject({
      rowKey: 'direct_marketer_risk_gate_transfer_pending',
      value: 'Landing-Registry and productive page sync proof pending',
    });

    const directMarketerSyncSummaryRows = runTransformer(
      'getDirectMarketerRiskGateSyncProofSummaryRows',
      directMarketerLandingRegistryDraftFixture
    );
    expectScalarRows(directMarketerSyncSummaryRows);
    assertNoRawObjectText(directMarketerSyncSummaryRows);
    expect(directMarketerSyncSummaryRows[0]).toMatchObject({
      rowKey: 'direct_marketer_sync_proof_summary',
      renderTarget: 'budibase:stadtwerk-mauer-workbench:direct-marketer-risk-gate-sync-proof-panel',
      seedId: 'stadtwerk-mauer-direct-marketer-risk-gate-v1',
      draftDerivable: true,
      draftStatus: 'draft_ready',
      downstreamHandoff: 'complete -> draft_ready -> pending',
      rowCount: 5,
    });

    const directMarketerDraftRows = runTransformer(
      'getDirectMarketerRiskGateDraftPreviewRows',
      directMarketerLandingRegistryDraftFixture
    );
    expectScalarRows(directMarketerDraftRows);
    assertNoRawObjectText(directMarketerDraftRows);
    expect(directMarketerDraftRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'direct_marketer_draft_preview_summary',
          m: 'Mitwirkend',
          sourceClass: 'direct_marketer_risk_gate_draft_preview_summary',
        }),
        expect.objectContaining({
          rowKey: 'direct_marketer_draft_row_1',
          phase: '1',
          v: 'ROLE_MARKET_OPERATIONS',
          d: 'ROLE_ENERGY_SHARING_LEAD',
          m: 'ROLE_CERNION_GOVERNANCE',
          i: 'ROLE_MANAGEMENT',
          nachweise: 'syntheticHandoverScopeEvidence',
        }),
      ])
    );
    expect(directMarketerDraftRows[1]).not.toHaveProperty('V');

    const directMarketerBlockerRows = runTransformer(
      'getDirectMarketerRiskGatePublicationBlockerRows',
      directMarketerLandingRegistryDraftFixture
    );
    expectScalarRows(directMarketerBlockerRows);
    expect(directMarketerBlockerRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blocker: 'productive_demo_room_publication_issue_missing',
          status: 'blocked',
          productiveDemoRoomStatus: 'pending',
        }),
      ])
    );

    const directMarketerFollowupRows = runTransformer(
      'getDirectMarketerRiskGatePositiveFollowupRows',
      directMarketerRiskGateStatusFixture
    );
    expectScalarRows(directMarketerFollowupRows);
    expect(directMarketerFollowupRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missingDataPoint: 'forecastQualityEvidence',
          enablesDossierAddition: 'add forecast-quality evidence',
        }),
      ])
    );

    const directMarketerSyncNoCallRows = runTransformer(
      'getDirectMarketerRiskGateSyncProofNoCallRows',
      directMarketerLandingRegistryDraftFixture
    );
    expectScalarRows(directMarketerSyncNoCallRows);
    expect(directMarketerSyncNoCallRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'landing-registry.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'cernion.de.publish', status: 'not_called' }),
        expect.objectContaining({ boundary: 'market.execute', status: 'not_called' }),
        expect.objectContaining({ boundary: 'budibase.table.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const directMarketerNoCallRows = runTransformer(
      'getDirectMarketerRiskGateNoCallRows',
      directMarketerRiskGateStatusFixture
    );
    expectScalarRows(directMarketerNoCallRows);
    expect(directMarketerNoCallRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'market.execute', status: 'not_called' }),
        expect.objectContaining({ action: 'schedule.submit', status: 'not_called' }),
        expect.objectContaining({ action: 'balancing-group.transfer', status: 'not_called' }),
        expect.objectContaining({ action: 'budibase.table.write', status: 'not_called' }),
        expect.objectContaining({ action: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const releaseFileSummaryRows = runTransformer(
      'getInterconnectionReleaseFileSummaryRows',
      interconnectionReleaseFileFixture
    );
    expectScalarRows(releaseFileSummaryRows);
    assertNoRawObjectText(releaseFileSummaryRows);
    expect(releaseFileSummaryRows[0]).toMatchObject({
      renderTarget: 'budibase:stadtwerk-mauer-workbench:interconnection-release-file-panel',
      roleTarget: 'ROLE_MARKTKOMMUNIKATION',
      caseId: 'smm-koppelpunkt-release-demo',
      status: 'reviewable_release_file',
      safety: 'read_only',
      syntheticDemoLabel: 'synthetic_default_parameters',
      approvalOwner: 'marktkommunikation',
      mappingVersion: 'v1',
      nextChangeGate: '2026-Q3',
    });

    const releaseFileMappingRows = runTransformer(
      'getInterconnectionReleaseFileMappingRows',
      interconnectionReleaseFileFixture
    );
    expectScalarRows(releaseFileMappingRows);
    assertNoRawObjectText(releaseFileMappingRows);
    expect(releaseFileMappingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Koppelpunkt',
          value: 'KP-SYN-MAUER-01',
          evidenceStatus: 'synthetic_demo_evidence',
        }),
        expect.objectContaining({
          label: 'Marktpartner',
          value: 'MP-SYN-MAUER-01',
        }),
        expect.objectContaining({
          label: 'Zeitreihe',
          value: 'TS-SYN-MAUER-01',
        }),
      ])
    );

    const releaseFileEvidenceRows = runTransformer(
      'getInterconnectionReleaseFileEvidenceRows',
      interconnectionReleaseFileFixture
    );
    expectScalarRows(releaseFileEvidenceRows);
    assertNoRawObjectText(releaseFileEvidenceRows);
    expect(releaseFileEvidenceRows[0]).toMatchObject({
      sourceSystem: 'a2mdm-demo',
      mappingVersion: 'v1',
      evidenceStatus: 'synthetic_demo_evidence',
    });

    const releaseFileApprovalRows = runTransformer(
      'getInterconnectionReleaseFileApprovalRows',
      interconnectionReleaseFileFixture
    );
    expectScalarRows(releaseFileApprovalRows);
    expect(releaseFileApprovalRows[0]).toMatchObject({
      owner: 'marktkommunikation',
      approvalStatus: 'approved',
      decisionBoundary: 'display_only_no_approval_execution',
    });

    const releaseFileProcessRows = runTransformer(
      'getInterconnectionReleaseFileProcessImpactRows',
      interconnectionReleaseFileFixture
    );
    expectScalarRows(releaseFileProcessRows);
    assertNoRawObjectText(releaseFileProcessRows);
    expect(releaseFileProcessRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          processFamily: 'market_communication',
          impact: 'descriptive_only',
        }),
      ])
    );

    const releaseFileFollowupRows = runTransformer(
      'getInterconnectionReleaseFileMissingEvidenceRows',
      interconnectionReleaseFileFixture
    );
    expectScalarRows(releaseFileFollowupRows);
    expect(releaseFileFollowupRows[0]).toMatchObject({
      missingDataPoint: 'none',
      label: 'No missing Freigabeakte evidence in synthetic default demo',
      enablesDossierAddition:
        'summary, mapping, evidence, approval and next-gate rows can stay complete',
    });

    const releaseFileNoCallRows = runTransformer(
      'getInterconnectionReleaseFileNoCallRows',
      interconnectionReleaseFileFixture
    );
    expectScalarRows(releaseFileNoCallRows);
    expect(releaseFileNoCallRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'mapping.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'mako.submit', status: 'not_called' }),
        expect.objectContaining({ boundary: 'billing.release', status: 'not_called' }),
        expect.objectContaining({ boundary: 'budibase.table.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'personal-agent.execute', status: 'not_called' }),
      ])
    );

    const draftSummaryRows = runTransformer(
      'getLandingRegistryDraftSyncSummaryRows',
      landingRegistryDraftFixture
    );
    expectScalarRows(draftSummaryRows);
    expect(draftSummaryRows[0]).toMatchObject({
      rowKey: 'landing_registry_draft_sync_summary',
      draftDerivable: true,
      draftStatus: 'draft_ready',
      downstreamHandoff: 'complete -> draft_ready -> pending',
      sourceClass: 'landing_registry_draft_sync_summary',
    });

    const draftPreviewRows = runTransformer(
      'getLandingRegistryDraftPreviewRows',
      landingRegistryDraftFixture
    );
    expectScalarRows(draftPreviewRows);
    assertNoRawObjectText(draftPreviewRows);
    expect(draftPreviewRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'landing_registry_draft_route',
          m: 'Mitwirkend',
          sourceClass: 'landing_registry_draft_preview_summary',
        }),
        expect.objectContaining({
          rowKey: 'landing_registry_draft_row_1',
          phase: '1',
          v: 'ROLE_ASSET_MDM_OWNER',
          d: 'ROLE_CERNION_GOVERNANCE',
          m: 'ROLE_CONTROLLING',
          i: 'ROLE_COMMERCIAL_AUDIT',
          nachweise: 'sourceSystemEvidence, targetSystemEvidence, affectedObjectEvidence',
        }),
      ])
    );
    expect(draftPreviewRows[1]).not.toHaveProperty('V');

    const draftValidityRows = runTransformer(
      'getLandingRegistryDraftBlueprintValidityRows',
      blueprintVarianceFixture
    );
    expectScalarRows(draftValidityRows);
    expect(draftValidityRows[0]).toMatchObject({
      valid: true,
      rowCount: 4,
      roleLegendM: 'Mitwirkend',
      sourceClass: 'landing_registry_blueprint_validity',
    });

    const draftMatrixRows = runTransformer(
      'getLandingRegistryDraftMatrixSyncRows',
      blueprintVarianceFixture
    );
    expectScalarRows(draftMatrixRows);
    expect(draftMatrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'landing_registry_matrix_sync_summary',
          m: 'Mitwirkend',
          status: 'sync_proof_required',
        }),
        expect.objectContaining({
          rowKey: 'landing_registry_matrix_row_1',
          phase: '1',
          v: 'ROLE_VDMI_GOVERNANCE',
          d: 'ROLE_DATENMANAGEMENT',
          m: 'ROLE_NETZPLANUNG',
          i: 'ROLE_MANAGEMENT',
        }),
      ])
    );

    const blockerRows = runTransformer(
      'getLandingRegistryDraftPublicationBlockerRows',
      landingRegistryDraftFixture
    );
    expectScalarRows(blockerRows);
    expect(blockerRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blocker: 'productive_demo_room_publication_issue_missing',
          status: 'blocked',
          productiveDemoRoomStatus: 'pending',
        }),
      ])
    );

    const followupRows = runTransformer(
      'getLandingRegistryDraftVarianceFollowupRows',
      crossSystemVarianceMatrixFixture
    );
    expectScalarRows(followupRows);
    expect(followupRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missingDataPoint: 'source_system',
          enablesDossierAddition: 'add source-system lineage for the variance',
        }),
      ])
    );

    const noCallRows = runTransformer(
      'getLandingRegistryDraftNoCallRows',
      landingRegistryDraftFixture
    );
    expectScalarRows(noCallRows);
    expect(noCallRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'landing-registry.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'cernion.de.publish', status: 'not_called' }),
        expect.objectContaining({ boundary: 'budibase.table.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'personal-agent.execute', status: 'not_called' }),
      ])
    );
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

  it('flattens Monitoring Non-Escalation rows and no-call guards', () => {
    const statusRows = runTransformer(
      'getMonitoringNonEscalationStatusRows',
      monitoringNonEscalationFixture
    );
    expectScalarRows(statusRows);
    expect(statusRows[0]).toMatchObject({
      rowKey: 'monitoring_non_escalation_status',
      signalId: 'vnb-delta-demo-anschluss',
      status: 'non_escalation_evidence_complete',
      blockerAbsent: true,
      owner: 'ROLE_NETZFUEHRUNG',
      safeNextGate: 'keep_signal_non_escalated_until_next_check',
      sourceClass: 'monitoring_non_escalation_status',
    });
    expect(statusRows[0].rationale).toContain('fresh source metadata');

    const evidenceRows = runTransformer(
      'getMonitoringNonEscalationEvidenceRows',
      monitoringNonEscalationFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'checked_source',
          value: 'synthetic-vnb-delta-monitor',
          sourceClass: 'monitoring_non_escalation_evidence',
        }),
        expect.objectContaining({
          rowKey: 'blocking_finding',
          status: 'provided',
        }),
      ])
    );

    const guardRows = runTransformer(
      'getMonitoringNonEscalationSeedGuardRows',
      monitoringBlueprintFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-monitoring-non-escalation-status-v1',
      panelEnabled: true,
      matrixRows: 4,
      sourceClass: 'monitoring_non_escalation_blueprint_guard',
    });

    const matrixRows = runTransformer(
      'getMonitoringNonEscalationMatrixRows',
      monitoringBlueprintFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'monitoring_non_escalation_matrix_sync_summary',
          status: 'matrix_ready',
          v: 'ROLE_NETZFUEHRUNG',
          d: 'ROLE_GOVERNANCE_OWNER',
        }),
        expect.objectContaining({
          rowKey: 'monitoring_non_escalation_matrix_row_1',
          phase: 'non_escalation_review',
          m: 'ROLE_NETZPLANUNG',
          gateOutcome: 'keep_non_escalated_until_next_check',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getMonitoringNonEscalationBoundaryRows',
      monitoringNonEscalationFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'alerting.escalate', status: 'not_called' }),
        expect.objectContaining({ boundary: 'hitl.create', status: 'not_called' }),
        expect.objectContaining({ boundary: 'external.connector.call', status: 'not_called' }),
        expect.objectContaining({ boundary: 'personal-agent.execute', status: 'not_called' }),
      ])
    );
  });

  it('flattens Cost Review Committee rows and no-call guards', () => {
    const statusRows = runTransformer(
      'getCostReviewCommitteeStatusRows',
      costReviewCommitteeFixture
    );
    expectScalarRows(statusRows);
    expect(statusRows[0]).toMatchObject({
      rowKey: 'cost_review_committee_status',
      status: 'committee_ready',
      safety: 'read_only',
      owner: 'ROLE_CONTROLLING',
      nextCommitteeGate: 'cost-review-board-2026-q3',
      safeNextGate: 'review_committee_package_without_budget_approval',
      sourceClass: 'cost_review_committee_status',
    });

    const evidenceRows = runTransformer(
      'getCostReviewCommitteeEvidenceRows',
      costReviewCommitteeFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'owner',
          value: 'ROLE_CONTROLLING',
          sourceClass: 'governance_owner',
        }),
        expect.objectContaining({
          rowKey: 'next_committee_gate',
          value: 'cost-review-board-2026-q3',
          sourceClass: 'committee_gate',
        }),
      ])
    );

    const guardRows = runTransformer(
      'getCostReviewCommitteeSeedGuardRows',
      costReviewBlueprintFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-cost-review-committee-readiness-v1',
      panelEnabled: true,
      matrixRows: 4,
      sourceClass: 'cost_review_committee_blueprint_guard',
    });

    const matrixRows = runTransformer(
      'getCostReviewCommitteeMatrixRows',
      costReviewBlueprintFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'cost_review_committee_matrix_sync_summary',
          status: 'matrix_ready',
          v: 'ROLE_CONTROLLING',
          m: 'Mitwirkend',
        }),
        expect.objectContaining({
          rowKey: 'cost_review_committee_matrix_row_1',
          phase: '1',
          m: 'ROLE_ASSET_PLANNING',
          gateOutcome: 'cost_item_scope_and_source_class_pending',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getCostReviewCommitteeBoundaryRows',
      costReviewBlueprintFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'erp.write', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'budget.approve', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'committee.decision.execute', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'budibase_table_write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'personal_agent_hardcoding', status: 'not_called' }),
      ])
    );
  });

  it('flattens Redispatch Participation rows and no-call guards', () => {
    const statusRows = runTransformer(
      'getRedispatchParticipationStatusRows',
      redispatchParticipationFixture
    );
    expectScalarRows(statusRows);
    expect(statusRows[0]).toMatchObject({
      rowKey: 'redispatch_participation_status',
      status: 'ready_for_review',
      safety: 'read_only_blueprint_seed',
      syntheticRedispatchAssetPortfolio: 'synthetic-portfolio-mauer',
      sourceClass: 'redispatch_participation_readiness_status',
    });

    const evidenceRows = runTransformer(
      'getRedispatchParticipationEvidenceRows',
      redispatchParticipationFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'syntheticRedispatchAssetPortfolio',
          value: 'synthetic-portfolio-mauer',
          sourceClass: 'synthetic_tenant_seed',
        }),
      ])
    );

    const guardRows = runTransformer(
      'getRedispatchParticipationSeedGuardRows',
      redispatchParticipationBlueprintFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-redispatch-participation-readiness-v1',
      panelEnabled: true,
      matrixRows: 4,
      sourceClass: 'redispatch_participation_blueprint_guard',
    });

    const matrixRows = runTransformer(
      'getRedispatchParticipationMatrixRows',
      redispatchParticipationBlueprintFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'redispatch_participation_matrix_sync_summary',
          status: 'matrix_ready',
          v: 'ROLE_GRID_OPERATIONS_LEAD',
          m: 'Mitwirkend',
        }),
        expect.objectContaining({
          rowKey: 'redispatch_participation_matrix_row_1',
          phase: '1',
          gateOutcome: 'redispatch_portfolio_pending',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getRedispatchParticipationBoundaryRows',
      redispatchParticipationBlueprintFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'redispatch_enrollment', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'dispatch_control', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'personal_agent_hardcoding', status: 'not_called' }),
      ])
    );
  });

  it('flattens MaStR Sync-Gap Alerting rows and no-call guards', () => {
    const statusRows = runTransformer(
      'getMastrSyncGapStatusRows',
      mastrSyncGapStatusFixture
    );
    expectScalarRows(statusRows);
    expect(statusRows[0]).toMatchObject({
      rowKey: 'mastr_sync_gap_status',
      status: 'ready_for_review',
      safety: 'read_only_blueprint_seed',
      mastrFreshnessEvidence: 'harvest-freshness-ok',
      sourceClass: 'mastr_sync_gap_status',
    });

    const evidenceRows = runTransformer(
      'getMastrSyncGapEvidenceRows',
      mastrSyncGapStatusFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'mastrFreshnessEvidence',
          value: 'harvest-freshness-ok',
          sourceClass: 'synthetic_tenant_seed',
        }),
      ])
    );

    const guardRows = runTransformer(
      'getMastrSyncGapSeedGuardRows',
      mastrSyncGapSeedGuardFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-mastr-sync-gap-alerting-v1',
      panelEnabled: true,
      matrixRows: 4,
      sourceClass: 'mastr_sync_gap_blueprint_guard',
    });

    const matrixRows = runTransformer(
      'getMastrSyncGapMatrixRows',
      mastrSyncGapSeedGuardFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'mastr_sync_gap_matrix_sync_summary',
          status: 'matrix_ready',
          v: 'ROLE_NETZBETRIEB',
          m: 'Mitwirkend',
        }),
        expect.objectContaining({
          rowKey: 'mastr_sync_gap_matrix_row_1',
          phase: '1',
          gateOutcome: 'mastr_freshness_harvested',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getMastrSyncGapBoundaryRows',
      mastrSyncGapSeedGuardFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'redispatch_enrollment', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'dispatch_control', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'personal_agent_hardcoding', status: 'not_called' }),
      ])
    );
  });

  it('flattens Decommissioned Asset Reconciliation rows and no-call guards', () => {
    const statusRows = runTransformer(
      'getDecommissionedAssetStatusRows',
      decommissionedAssetStatusFixture
    );
    expectScalarRows(statusRows);
    expect(statusRows[0]).toMatchObject({
      rowKey: 'decommissioned_asset_status',
      status: 'ready_for_review',
      safety: 'read_only_blueprint_seed',
      gisDecommissionedAssetsEvidence: 'gis-decommissioned-ok',
      sourceClass: 'decommissioned_asset_status',
    });

    const evidenceRows = runTransformer(
      'getDecommissionedAssetEvidenceRows',
      decommissionedAssetStatusFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'gisDecommissionedAssetsEvidence',
          value: 'gis-decommissioned-ok',
          sourceClass: 'synthetic_tenant_seed',
        }),
      ])
    );

    const guardRows = runTransformer(
      'getDecommissionedAssetSeedGuardRows',
      decommissionedAssetSeedGuardFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-decommissioned-asset-reconciliation-v1',
      panelEnabled: true,
      matrixRows: 4,
      sourceClass: 'decommissioned_asset_blueprint_guard',
    });

    const matrixRows = runTransformer(
      'getDecommissionedAssetMatrixRows',
      decommissionedAssetSeedGuardFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'decommissioned_asset_matrix_sync_summary',
          status: 'matrix_ready',
          v: 'ROLE_NETZPLANUNG',
          m: 'Mitwirkend',
        }),
        expect.objectContaining({
          rowKey: 'decommissioned_asset_matrix_row_1',
          phase: '1',
          gateOutcome: 'gis_decommissioned_assets_harvested',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getDecommissionedAssetBoundaryRows',
      decommissionedAssetSeedGuardFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'redispatch_enrollment', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'dispatch_control', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'personal_agent_hardcoding', status: 'not_called' }),
      ])
    );
  });

  it('flattens Coordination Meaning Preservation rows and no-call guards', () => {
    const summaryRows = runTransformer(
      'getCoordinationMeaningPreservationSummaryRows',
      coordinationMeaningPreservationFixture
    );
    expectScalarRows(summaryRows);
    expect(summaryRows[0]).toMatchObject({
      rowKey: 'meaning_preservation_summary',
      status: 'needs_decision_context',
      classification: 'decision_context_missing',
      caseId: 'smm-budibase-workbench',
      roleTarget: 'ROLE_NETZPLANUNG',
      sourceClass: 'coordination_meaning_preservation_summary',
    });

    const preservedRows = runTransformer(
      'getCoordinationMeaningPreservationPreservedRows',
      coordinationMeaningPreservationFixture
    );
    expectScalarRows(preservedRows);
    expect(preservedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'owner',
          value: 'ROLE_NETZPLANUNG',
          sourceClass: 'coordination_meaning_preserved_dimension',
        }),
      ])
    );

    const gapRows = runTransformer(
      'getCoordinationMeaningPreservationGapRows',
      coordinationMeaningPreservationFixture
    );
    expectScalarRows(gapRows);
    expect(gapRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'deadline',
          gapClass: 'missing',
          enablesDossierAddition: 'add Frist / Wiedervorlage',
        }),
        expect.objectContaining({
          rowKey: 'evidence_proof',
          gapClass: 'weak',
          sourceClass: 'coordination_meaning_weak_dimension',
        }),
      ])
    );

    const ownerDecisionRows = runTransformer(
      'getCoordinationMeaningPreservationOwnerDecisionRows',
      coordinationMeaningPreservationFixture
    );
    expectScalarRows(ownerDecisionRows);
    expect(ownerDecisionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowKey: 'meaning_owner', status: 'provided' }),
        expect.objectContaining({ rowKey: 'meaning_deadline', status: 'missing' }),
        expect.objectContaining({ rowKey: 'meaning_next_decision', status: 'missing' }),
      ])
    );

    expectScalarRows(
      runTransformer(
        'getCoordinationMeaningPreservationFollowupRows',
        coordinationMeaningPreservationFixture
      )
    );

    const transferRows = runTransformer(
      'getCoordinationMeaningPreservationTransferRows',
      coordinationMeaningPreservationFixture
    );
    expectScalarRows(transferRows);
    expect(transferRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowKey: 'tenant_id', value: 'stadtwerk-mauer' }),
        expect.objectContaining({ rowKey: 'role_mapping', value: 'ROLE_NETZPLANUNG' }),
        expect.objectContaining({
          rowKey: 'allowed_command_scope',
          value: 'read_only_verify_only_no_mutation',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getCoordinationMeaningPreservationGuardRows',
      coordinationMeaningPreservationFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'external.connector.call', status: 'not_called' }),
        expect.objectContaining({ boundary: 'budibase.write', status: 'not_called' }),
        expect.objectContaining({ boundary: 'personal-agent.hardcoding', status: 'not_called' }),
      ])
    );

    expect(manifest.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining([
        'meaning_preservation_summary',
        'meaning_preservation_preserved_dimensions',
        'meaning_preservation_gap_dimensions',
        'meaning_preservation_owner_decision',
        'meaning_preservation_followups',
        'meaning_preservation_transfer_parameters',
        'meaning_preservation_boundaries',
      ])
    );
  });

  it('flattens Energy Sharing Collective Approval rows and no-call guards', () => {
    const statusRows = runTransformer(
      'getEnergySharingCollectiveApprovalStatusRows',
      energySharingCollectiveApprovalStatusFixture
    );
    expectScalarRows(statusRows);
    expect(statusRows[0]).toMatchObject({
      rowKey: 'energy_sharing_collective_approval_status',
      status: 'ready_for_review',
      safety: 'read_only_blueprint_seed',
      syntheticCollectiveBoundaryEvidence: 'collective-boundary-ok',
      sourceClass: 'energy_sharing_collective_approval_status',
    });

    const evidenceRows = runTransformer(
      'getEnergySharingCollectiveApprovalEvidenceRows',
      energySharingCollectiveApprovalStatusFixture
    );
    expectScalarRows(evidenceRows);
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'syntheticCollectiveBoundaryEvidence',
          value: 'collective-boundary-ok',
          sourceClass: 'synthetic_tenant_seed',
        }),
      ])
    );

    const guardRows = runTransformer(
      'getEnergySharingCollectiveApprovalSeedGuardRows',
      energySharingCollectiveApprovalSeedGuardFixture
    );
    expectScalarRows(guardRows);
    expect(guardRows[0]).toMatchObject({
      seedId: 'stadtwerk-mauer-energy-sharing-collective-approval-v1',
      panelEnabled: true,
      matrixRows: 5,
      sourceClass: 'energy_sharing_collective_approval_blueprint_guard',
    });

    const matrixRows = runTransformer(
      'getEnergySharingCollectiveApprovalMatrixRows',
      energySharingCollectiveApprovalSeedGuardFixture
    );
    expectScalarRows(matrixRows);
    expect(matrixRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'energy_sharing_collective_approval_matrix_sync_summary',
          status: 'matrix_ready',
          v: 'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
          m: 'Mitwirkend',
        }),
        expect.objectContaining({
          rowKey: 'energy_sharing_collective_approval_matrix_row_1',
          phase: '1',
          gateOutcome: 'synthetic_collective_review_case_identified',
        }),
      ])
    );

    const boundaryRows = runTransformer(
      'getEnergySharingCollectiveApprovalBoundaryRows',
      energySharingCollectiveApprovalSeedGuardFixture
    );
    expectScalarRows(boundaryRows);
    expect(boundaryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 'redispatch_enrollment', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'dispatch_control', status: 'forbidden' }),
        expect.objectContaining({ boundary: 'personal_agent_hardcoding', status: 'not_called' }),
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

  it('adds a manifest-only selected-case context binding panel with scalar rows', () => {
    const paths = new Set(
      manifest.queries
        .filter((query) =>
          [
            'getSelectedCaseContextBindingRows',
            'getSelectedCaseReadModelBindingRows',
            'getSelectedCaseEvidenceTraceArtifactRows',
            'getSelectedCaseNextGateActionBindingRows',
            'getSelectedCaseContextNoCallRows',
          ].includes(query.name)
        )
        .map((query) => query.path)
    );

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/stadtwerk-mauer-workbench-selected-target',
        '/api/dashboard/stadtwerk-mauer-workbench-hub',
        '/api/dashboard/stadtwerk-mauer-case-detail',
        '/api/dashboard/stadtwerk-mauer-case-actions',
      ])
    );
    expect(manifest.notes.join('\n')).toContain(
      'no new backend endpoint, Capability Broker route or Hydration Registry rule'
    );

    const selectedTargetFixture = {
      tenantId: 'stadtwerk-mauer',
      caseId: 'smm-budibase-workbench',
      requestedTargetId: 'selected-case-detail',
      selectedTargetId: 'selected-case-detail',
      selectedTitle: 'Selected Case Detail',
      selectedRows: [{ valueLabel: 'Selected Case Detail' }],
    };
    const contextRows = runTransformer(
      'getSelectedCaseContextBindingRows',
      selectedTargetFixture
    );
    expectScalarRows(contextRows);
    expect(contextRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'case_id',
          value: 'smm-budibase-workbench',
          role: 'ROLE_NETZPLANUNG',
          seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
          sourceClass: 'selected_case_context_binding',
        }),
        expect.objectContaining({
          rowKey: 'target',
          value: 'selected-case-detail',
        }),
      ])
    );

    const bindingRows = runTransformer('getSelectedCaseReadModelBindingRows', {
      caseId: 'smm-budibase-workbench',
      targetRows: [
        {
          routeKey: 'selected-case-detail',
          status: 'ready',
        },
      ],
    });
    expectScalarRows(bindingRows);
    expect(bindingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKey: 'case_detail',
          queryName: 'getStadtwerkMauerCaseDetail',
          safeNextAction: 'refresh_existing_cernion_read_query_only',
        }),
        expect.objectContaining({
          rowKey: 'demo_raum_sync',
          intentionallyUnavailable: 'only visible for canonical Blueprint-Pack matrix seeds',
        }),
      ])
    );

    const detailRows = runTransformer('getSelectedCaseEvidenceTraceArtifactRows', {
      evidenceRows: [
        {
          evidenceId: 'napReference',
          label: 'NAP reference',
          status: 'missing',
          enablesDossierAddition: 'show NAP reference evidence',
        },
      ],
      traceRows: [{ traceId: 'trace:selected-case', status: 'available' }],
      artifactRows: [{ artifactId: 'artifact:blueprint', status: 'available' }],
    });
    expectScalarRows(detailRows);
    expect(detailRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'evidence', rowKey: 'napReference' }),
        expect.objectContaining({ kind: 'trace', rowKey: 'trace:selected-case' }),
        expect.objectContaining({ kind: 'artifact', rowKey: 'artifact:blueprint' }),
      ])
    );

    const actionRows = runTransformer('getSelectedCaseNextGateActionBindingRows', {
      nextGateRows: [
        {
          gateId: 'blueprint-verify',
          label: 'Blueprint verify',
          status: 'visible',
          safeNextAction: 'refresh verify rows',
        },
      ],
      actionRows: [
        {
          actionId: 'verify_blueprint_seed',
          label: 'Verify Blueprint seed',
          enabled: true,
          enabledLabel: 'enabled_safe_verify',
          riskClass: 'verify_only',
        },
      ],
    });
    expectScalarRows(actionRows);
    expect(actionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'next_gate', enabled: false }),
        expect.objectContaining({
          actionId: 'verify_blueprint_seed',
          enabled: true,
          riskClass: 'verify_only',
        }),
      ])
    );

    const guardRows = runTransformer('getSelectedCaseContextNoCallRows', {
      sourceActions: { notCalled: ['personal-agent.execute'] },
      forbiddenActionRows: [{ boundary: 'budibase.table.write' }],
    });
    expectScalarRows(guardRows);
    expect(guardRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          boundary: 'personal-agent.execute',
          status: 'not_called',
          disabled: true,
        }),
        expect.objectContaining({
          boundary: 'budibase.table.write',
          status: 'not_called',
          disabled: true,
        }),
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
