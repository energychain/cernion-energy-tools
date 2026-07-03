const caseViewManifest = require('../integrations/budibase/manifests/case-view-manifest-stadtwerk-mauer-pv-missing-nap.json');
const {
  DATA_CLASSES,
  SAFE_ACTION_CLASSES,
  validateCaseViewManifest,
} = require('../integrations/budibase/manifests/case-view-manifest');

describe('Case View Manifest contract', () => {
  it('validates the Stadtwerk Mauer selected-case manifest', () => {
    const result = validateCaseViewManifest(caseViewManifest);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('cuts the first manifest for Zielnetzplanung and the selected PV missing-NAP case', () => {
    expect(caseViewManifest).toMatchObject({
      controlCase: 'selected_case_evidence_trace_artifact_review',
      tenantId: 'stadtwerk-mauer',
      caseId: 'smm-budibase-workbench',
      seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
      personaRole: 'ROLE_NETZPLANUNG',
      serviceBoundary: 'static/read-only manifest contract; no new endpoint',
      safetyClassification: 'read_only_manifest',
      systemOfRecord: 'cernion',
    });
    expect(caseViewManifest.rendererTargets).toContain('budibase');
    expect(caseViewManifest.brokerRouting.enabled).toBe(false);
    expect(caseViewManifest.hydrationRegistry.enabled).toBe(false);
  });

  it('declares the expected reusable role-workbench sections', () => {
    expect(caseViewManifest.sections.map((section) => section.id)).toEqual([
      'selected_case_summary',
      'evidence_rows',
      'trace_rows',
      'artifact_rows',
      'next_gate_rows',
      'safe_action_rows',
      'source_boundary_rows',
      'data_class_rows',
    ]);
  });

  it('keeps every section scalar and renderer-safe', () => {
    for (const section of caseViewManifest.sections) {
      expect(SAFE_ACTION_CLASSES.has(section.safeActionClass)).toBe(true);
      expect(DATA_CLASSES.has(section.dataClass)).toBe(true);
      expect(section.sourceDashboardEndpoint).toMatch(/^\/api\/dashboard\//);
      expect(section.columns.length).toBeGreaterThan(0);
      expect(section.forbiddenActions).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/budibase|rundeck|personal-agent|mako|billing|device-control/),
        ])
      );
      for (const column of section.columns) {
        expect(['string', 'number', 'boolean']).toContain(column.type);
      }
      for (const row of section.sampleRows) {
        for (const value of Object.values(row)) {
          expect(Array.isArray(value)).toBe(false);
          expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(
            true
          );
          expect(String(value)).not.toContain('[object Object]');
        }
      }
    }
  });

  it('captures transfer parameters and positive follow-ups without unsafe commands', () => {
    expect(caseViewManifest.transferParameters.map((item) => item.key)).toEqual([
      'tenantId',
      'roleMapping',
      'caseId',
      'seedId',
      'municipalityAgs',
      'allowedCommandScope',
    ]);
    expect(caseViewManifest.positiveFollowUps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missingDataPoint: 'napReference',
          enablesDossierAddition: 'add selected-case evidence row with NAP reference status',
        }),
        expect.objectContaining({
          missingDataPoint: 'traceId',
          enablesDossierAddition: 'add trace review row for the selected case',
        }),
      ])
    );
    expect(caseViewManifest.forbiddenActions).toEqual(
      expect.arrayContaining([
        'budibase.table.write',
        'budibase.system_of_record',
        'rundeck.execute',
        'personal-agent.execute',
      ])
    );
  });

  it('reports object cell leakage as a validation error', () => {
    const invalid = JSON.parse(JSON.stringify(caseViewManifest));
    invalid.sections[0].sampleRows[0].unsafe = { nested: true };
    invalid.sections[0].columns.push({ key: 'unsafe', label: 'Unsafe', type: 'object' });

    const result = validateCaseViewManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'selected_case_summary: column unsafe must not be object',
        'selected_case_summary: sampleRows[0].unsafe is not scalar',
      ])
    );
  });
});
