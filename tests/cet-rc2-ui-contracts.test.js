'use strict';

const {
  assertGranularitaet,
  validatePresentationContract,
  toOperationResultRenderModel,
  canSwitchToRole,
  formatVisibleNoAction,
  checkForbiddenUserText,
  getBoundaryItems,
  shouldMaterializeStatement,
  validateGrammarParts,
} = require('../src/cet-rc2-ui-contracts');

describe('CET RC2 UI contract guardrails', () => {
  const statement = {
    id: 'klaerfaelle_betroffen',
    label: 'Betroffene Klärfälle',
    value: 14,
    unit: 'Klärfälle',
    aggregationState: 'arbeitsstand',
    granularitaet: 'aggregat',
    sicherheit: 'klaerung',
    anschlussfrage: 'Welche der 14 Klärfälle betreffen die Mehr-/Mindermengenabrechnung?',
    source: {
      class: 'caller_supplied',
      ref: 'evidence://inhouse/klaerfaelle#offen',
      stand: '2026-09-21T09:40:00Z',
    },
  };

  function validContract(overrides = {}) {
    return {
      grammarParts: ['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe'],
      elements: [
        {
          elementId: 'ref/vorgang',
          statements: [statement],
          nichtHandlungen: [
            { was: 'Klärfall schließen', grund: 'Kein Schreibpfad in dieser Ansicht' },
          ],
          approval: { required: true, role: 'ROLE_MARKET_OPERATIONS', status: 'offen' },
        },
      ],
      ...overrides,
    };
  }

  it('requires granularitaet on every projected statement', () => {
    expect(() => assertGranularitaet({ ...statement, granularitaet: undefined })).toThrow(
      /granularitaet/
    );
    expect(assertGranularitaet(statement)).toBe('aggregat');
  });

  it('rejects contracts without all five grammar parts in order', () => {
    expect(() => validateGrammarParts(['vorgang', 'quellen', 'pruefung', 'freigabe'])).toThrow(
      /five grammar parts/
    );
    expect(validateGrammarParts(validContract().grammarParts)).toEqual([
      'vorgang',
      'quellen',
      'pruefung',
      'unsicherheit',
      'freigabe',
    ]);
  });

  it('rejects renderable elements with empty nichtHandlungen', () => {
    const contract = validContract({
      elements: [{ ...validContract().elements[0], nichtHandlungen: [] }],
    });

    expect(() => validatePresentationContract(contract)).toThrow(/nichtHandlungen/);
  });

  it('keeps not-projected operation JSON separate from evidence semantics', () => {
    const model = toOperationResultRenderModel({
      projectionStatus: 'not_projected',
      rawPayload: { success: true, value: 14 },
      rawPayloadNotice: 'Noch nicht projiziert',
    });

    expect(model.kind).toBe('not_projected_json');
    expect(model.rawPayload.value).toBe(14);
    expect(model.aggregationState).toBeUndefined();
    expect(model.evidenceMarkers).toEqual([]);
  });

  it('allows role switching only for roles held in the active tenant', () => {
    const session = {
      tenantId: 'sw-beispiel',
      heldRoles: [
        { roleId: 'ROLE_MARKET_OPERATIONS', tenantId: 'sw-beispiel' },
        { roleId: 'ROLE_CONTROLLING', tenantId: 'sw-beispiel' },
        { roleId: 'ROLE_OTHER_TENANT', tenantId: 'anderer-mandant' },
      ],
    };

    expect(canSwitchToRole(session, 'ROLE_CONTROLLING')).toBe(true);
    expect(canSwitchToRole(session, 'ROLE_OTHER_TENANT')).toBe(false);
    expect(canSwitchToRole(session, 'ROLE_MANAGEMENT')).toBe(false);
  });

  it('uses explicit visible no-action wording instead of Kenntnis wording', () => {
    expect(formatVisibleNoAction({ displayName: 'Ada Beispiel' })).toBe(
      'In Bearbeitung durch Ada Beispiel'
    );
    expect(() => checkForbiddenUserText('Zur Kenntnis genommen')).toThrow(/Forbidden/);
  });

  it('materializes only aggregate statements into evidence files', () => {
    expect(shouldMaterializeStatement(statement)).toBe(true);
    expect(shouldMaterializeStatement({ ...statement, granularitaet: 'einzeldatensatz' })).toBe(
      false
    );
  });

  it('reads boundaries from the current element only', () => {
    expect(getBoundaryItems(validContract().elements[0])).toEqual([
      { was: 'Klärfall schließen', grund: 'Kein Schreibpfad in dieser Ansicht' },
    ]);
  });
});
