'use strict';

const {
  createApiClient,
  classifyApiError,
  normalizeApiBaseUrl,
} = require('../apps/cet-ui/src/shared/api-client');
const {
  validatePresentationContract,
  assertGranularitaet,
  getGrammarParts,
  getBoundaryItems,
} = require('../apps/cet-ui/src/shared/contract-validators');
const {
  assertNoEvidenceSemanticsForRawJson,
  isProjected,
  toNotProjectedRenderModel,
} = require('../apps/cet-ui/src/shared/projection-helpers');
const {
  canSwitchToRole,
  filterActionsByRole,
  isPlaceholderAgent,
  renderRoleActor,
} = require('../apps/cet-ui/src/shared/role-tenant-helpers');
const {
  checkForbiddenUserText,
  formatApprovalStatus,
  formatVisibleNoAction,
  labelProjectionStatus,
} = require('../apps/cet-ui/src/shared/wording-helpers');
const { shouldMaterializeStatement } = require('../apps/cet-ui/src/shared/evidence-helpers');

describe('CET UI RC2 Phase B shared functions', () => {
  test('normalizes REST base URLs without duplicate /api', () => {
    expect(normalizeApiBaseUrl('https://api.cernion.de/api/')).toBe('https://api.cernion.de');
    expect(normalizeApiBaseUrl('https://api.cernion.de')).toBe('https://api.cernion.de');
  });

  test('API client sends tenant/auth headers and classifies errors', async () => {
    const calls = [];
    const client = createApiClient({
      baseUrl: 'https://api.cernion.de/api/',
      tenantId: 'rc2-stadtwerk-a',
      token: 'test-token',
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          async json() {
            return { ok: true };
          },
        };
      },
    });

    await client.getToday();

    expect(calls[0].url).toBe('https://api.cernion.de/api/ui/v0/daily-surface');
    expect(calls[0].options.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer test-token',
        'x-tenant-id': 'rc2-stadtwerk-a',
      })
    );
    expect(classifyApiError({ status: 409 })).toBe('conflict');
    expect(classifyApiError({ status: 422 })).toBe('validation');
    expect(classifyApiError(new TypeError('Failed to fetch'))).toBe('network');
  });

  test('contract validators enforce granularitaet, boundaries and grammar parts', () => {
    const contract = {
      grammarParts: ['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe'],
      elements: [
        {
          elementId: 'e1',
          statements: [
            {
              id: 's1',
              label: 'Treffer',
              granularitaet: 'aggregat',
              source: { ref: 'evidence://s1' },
            },
          ],
          nichtHandlungen: [{ was: 'Externes Fachsystem ausführen', grund: 'Out of scope' }],
        },
      ],
    };

    expect(getGrammarParts(contract)).toEqual(contract.grammarParts);
    expect(getBoundaryItems(contract.elements[0])).toHaveLength(1);
    expect(assertGranularitaet(contract.elements[0].statements[0])).toBe('aggregat');
    expect(validatePresentationContract(contract)).toBe(contract);
    expect(() => validatePresentationContract({ ...contract, grammarParts: ['vorgang'] })).toThrow(
      /grammar/
    );
  });

  test('projection helpers keep raw JSON away from evidence semantics', () => {
    const rawModel = toNotProjectedRenderModel({
      operationId: 'mako.case.lookup',
      projectionStatus: 'nicht_projiziert',
      unprojected: { raw: { rows: [1] }, notice: 'nicht_projiziert' },
    });

    expect(isProjected(rawModel)).toBe(false);
    expect(assertNoEvidenceSemanticsForRawJson(rawModel)).toBe(rawModel);
    expect(rawModel).toEqual(
      expect.objectContaining({
        badge: 'Nicht projiziert',
        raw: { rows: [1] },
        evidenceMarkers: [],
        aggregationState: null,
      })
    );
  });

  test('role helpers permit only held tenant roles and format placeholder agents', () => {
    const session = {
      tenantId: 'rc2-stadtwerk-a',
      activeRoleCandidates: [
        { roleId: 'RC2_ROLE_MARKTKOMMUNIKATION', available: true, placeholderAgent: false },
        {
          roleId: 'RC2_ROLE_GESCHAEFTSFUEHRUNG',
          available: true,
          placeholderAgent: true,
          actorId: 'agent-gf',
        },
        { roleId: 'RC2_ROLE_NETZPLANUNG', available: false, placeholderAgent: false },
      ],
    };

    expect(canSwitchToRole(session, 'RC2_ROLE_MARKTKOMMUNIKATION')).toBe(true);
    expect(canSwitchToRole(session, 'RC2_ROLE_NETZPLANUNG')).toBe(false);
    expect(isPlaceholderAgent(session.activeRoleCandidates[1])).toBe(true);
    expect(renderRoleActor(session.activeRoleCandidates[1])).toContain('Agent');
    expect(
      filterActionsByRole(
        [{ id: 'claim', roleIds: ['RC2_ROLE_MARKTKOMMUNIKATION'] }],
        'RC2_ROLE_MARKTKOMMUNIKATION'
      )
    ).toHaveLength(1);
  });

  test('wording and evidence helpers enforce Feinkonzept wording', () => {
    expect(formatVisibleNoAction({ displayName: 'Ada' })).toBe('In Bearbeitung durch Ada');
    expect(formatApprovalStatus({ status: 'verweigert', actor: { displayName: 'Ada' } })).toContain(
      'verweigert'
    );
    expect(labelProjectionStatus('nicht_projiziert')).toBe('Nicht projiziert');
    expect(() => checkForbiddenUserText('Zur Kenntnis genommen')).toThrow(/Forbidden/);
    expect(shouldMaterializeStatement({ granularitaet: 'aggregat' })).toBe(true);
    expect(shouldMaterializeStatement({ granularitaet: 'einzeldatensatz' })).toBe(false);
  });
});
