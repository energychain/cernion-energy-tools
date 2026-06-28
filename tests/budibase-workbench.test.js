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
});
