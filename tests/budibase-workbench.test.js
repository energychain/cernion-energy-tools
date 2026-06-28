const manifest = require('../integrations/budibase/manifests/stadtwerk-mauer-workbench.json');

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
        { capability: 'znp_gate', classification: 'read_only', handoff: 'dossier_hydration_allowed' },
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
    notCalled: ['mail.connector.ingest', 'teams.connector.read', 'ticket.create', 'personal-agent.execute'],
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
        .filter((query) =>
          query.name.includes('Vdmi') ||
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
        .filter((query) => query.name.includes('VnbDeltaSignalQueue'))
        .map((query) => query.path)
    );

    expect(paths).toEqual(
      new Set([
        '/api/dashboard/cross-channel-vnb-signal-queue',
        '/api/dashboard/vnb-delta-signal-classifier/classify',
        '/api/dashboard/owner-deadline-evidence-gate',
        '/api/dashboard/leadership-delta-cockpit',
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
    expectScalarRows(runTransformer('getStadtwerkMauerCapabilityProjectionSummaryRows', capabilityFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerCapabilityProjectionRoleRows', capabilityFixture));
    const capabilityRows = runTransformer('getStadtwerkMauerCapabilityProjectionCapabilityRows', capabilityFixture);
    expectScalarRows(capabilityRows);
    expect(capabilityRows.find((row) => row.classification === 'consequential_follow_up')).toMatchObject({
      executable: false,
      sourceClass: 'proposal_only_followup',
    });
    expectScalarRows(runTransformer('getStadtwerkMauerCapabilityProjectionEvidenceRows', capabilityFixture));
    expectScalarRows(runTransformer('getStadtwerkMauerCapabilityProjectionBoundaryRows', capabilityFixture));
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

    const classifierRows = runTransformer('getVnbDeltaSignalQueueClassifierRows', vnbClassifierFixture);
    expectScalarRows(classifierRows);
    expect(classifierRows[0]).toMatchObject({
      signalId: 'vnb-delta-demo-anschluss',
      ownerSuggestion: 'ROLE_NETZPLANUNG',
      sourceClass: 'synthetic_signal_classification',
    });

    expectScalarRows(runTransformer('getVnbDeltaSignalQueueOwnerEvidenceRows', vnbOwnerEvidenceFixture));
    expectScalarRows(runTransformer('getVnbDeltaSignalQueueSafeNextActionRows', vnbOwnerEvidenceFixture));
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
    const commandQuery = manifest.queries.find((query) => query.name === 'recordStadtwerkMauerCaseAnnotation');
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
      expect.arrayContaining(['case_annotation_command', 'case_annotation_rows', 'case_annotation_audit'])
    );
  });
});
