'use strict';

const {
  canCollapseCriterion,
  explainBundle,
  groupAttentionItems,
  resolveProminence,
  sortAttentionItems,
} = require('../apps/cet-ui/src/shared/prominence-helpers');
const {
  recordBoundaryShown,
  recordContractRenderError,
  recordOperationConsoleUse,
  recordViewOpened,
} = require('../apps/cet-ui/src/shared/audit-hooks');

describe('CET UI RC2 Phase B prominence and audit hooks', () => {
  test('sorts Tagesfläche items by Feinkonzept attention prominence without KPI dashboard semantics', () => {
    const items = [
      { caseId: 'normal', aufmerksamkeitsgrund: 'uebergabe_an_mich', frist: null },
      { caseId: 'late', aufmerksamkeitsgrund: 'frist_ueberschritten', frist: '2026-09-20' },
      { caseId: 'approval', aufmerksamkeitsgrund: 'freigabe_angefordert', frist: '2026-09-25' },
    ];

    expect(sortAttentionItems(items).map((item) => item.caseId)).toEqual([
      'late',
      'approval',
      'normal',
    ]);
    expect(resolveProminence(items[0])).toEqual(
      expect.objectContaining({ reason: 'uebergabe_an_mich', prominence: 'normal' })
    );
  });

  test('bundles only identical attention reason and next contribution type', () => {
    const items = [
      {
        caseId: 'a',
        aufmerksamkeitsgrund: 'uebergabe_an_mich',
        interactionProjection: { naechsterBeitrag: { kind: 'klaeren' } },
      },
      {
        caseId: 'b',
        aufmerksamkeitsgrund: 'uebergabe_an_mich',
        interactionProjection: { naechsterBeitrag: { kind: 'klaeren' } },
      },
      {
        caseId: 'c',
        aufmerksamkeitsgrund: 'uebergabe_an_mich',
        interactionProjection: { naechsterBeitrag: { kind: 'freigeben' } },
      },
      {
        caseId: 'd',
        aufmerksamkeitsgrund: 'frist_naht',
        interactionProjection: { naechsterBeitrag: { kind: 'klaeren' } },
      },
    ];

    const groups = groupAttentionItems(items);

    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.bundleKey === 'uebergabe_an_mich::klaeren').count).toBe(2);
    expect(groups.find((group) => group.bundleKey === 'uebergabe_an_mich::freigeben').count).toBe(
      1
    );
    expect(explainBundle(groups[0])).toContain('identischem Aufmerksamkeitsgrund');
  });

  test('collapses only nicht_anwendbar criteria', () => {
    expect(canCollapseCriterion({ state: 'nicht_anwendbar' })).toBe(true);
    expect(canCollapseCriterion({ state: 'offen' })).toBe(false);
    expect(canCollapseCriterion({ state: 'erfuellt' })).toBe(false);
  });

  test('audit hooks call only UI Gateway audit endpoint and never external telemetry', async () => {
    const calls = [];
    const apiClient = {
      recordAudit: async (payload) => {
        calls.push(payload);
        return { ok: true, stored: true };
      },
    };
    const baseContext = {
      tenantId: 'rc2-stadtwerk-a',
      userId: 'user-mako-1',
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      at: '2026-09-21T12:00:00Z',
    };

    await recordViewOpened(apiClient, { ...baseContext, view: 'tagesflaeche' });
    await recordOperationConsoleUse(apiClient, { ...baseContext, operationId: 'mako.case.lookup' });
    await recordContractRenderError(apiClient, {
      ...baseContext,
      view: 'vorgang',
      errorCode: 'invalid_contract',
    });
    await recordBoundaryShown(apiClient, { ...baseContext, boundary: 'no_external_execute' });

    expect(calls.map((call) => call.event)).toEqual([
      'view_opened',
      'operation_console_used',
      'contract_render_error',
      'boundary_shown',
    ]);
    expect(calls.every((call) => call.transport === 'ui_gateway')).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('http');
  });
});
