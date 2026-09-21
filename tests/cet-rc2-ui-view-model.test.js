'use strict';

const {
  buildDailySurfaceModel,
  buildCaseViewModel,
  buildEvidenceViewModel,
  buildOperationsConsoleModel,
} = require('../apps/cet-ui/src/shared/ui-view-model');

describe('CET RC2 frontend shared view models', () => {
  const caseModel = {
    caseId: 'vorgang-1',
    label: 'Vorgang Artikel-ID-Änderung',
    status: 'in_bearbeitung',
    primaryRoleId: 'ROLE_MARKET_OPERATIONS',
    sinceLastAccess: [{ label: 'Neu seit letztem Zugriff' }],
    takeover: { status: 'mir_zugewiesen' },
    freeze: { status: 'eingefroren' },
    visibleNoAction: 'In Bearbeitung durch Ada',
    presentationContract: {
      grammarParts: ['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe'],
      elements: [
        {
          elementId: 'summary',
          title: 'Zusammenfassung',
          statements: [
            {
              id: 's1',
              label: 'Betroffene Klärfälle',
              value: 14,
              granularitaet: 'aggregat',
              source: { ref: 'evidence://s1' },
            },
          ],
          nichtHandlungen: [{ was: 'Fachsystem execute', grund: 'Nicht im RC2-Scope' }],
        },
      ],
    },
    nextContribution: { label: 'Reifegradcheck vorbereiten' },
    decisionDistance: [{ criterionId: 'owner', label: 'Owner benannt', state: 'offen' }],
  };

  it('normalizes Tagesfläche cards without Laufkarte wording', () => {
    const surface = buildDailySurfaceModel({
      vorgaenge: [
        {
          vorgangId: 'vorgang-1',
          label: 'Vorgang Artikel-ID-Änderung',
          status: 'in_bearbeitung',
          primaryRoleId: 'ROLE_MARKET_OPERATIONS',
        },
      ],
    });

    expect(surface.cards).toEqual([
      {
        id: 'vorgang-1',
        title: 'Vorgang Artikel-ID-Änderung',
        status: 'in_bearbeitung',
        roleId: 'ROLE_MARKET_OPERATIONS',
      },
    ]);
  });

  it('builds Vorgangsansicht sections in grammar order', () => {
    const view = buildCaseViewModel(caseModel);

    expect(view.title).toBe('Vorgang Artikel-ID-Änderung');
    expect(view.sections.map((section) => section.id)).toEqual([
      'vorgang',
      'quellen',
      'pruefung',
      'unsicherheit',
      'freigabe',
    ]);
    expect(view.boundaries).toEqual([{ was: 'Fachsystem execute', grund: 'Nicht im RC2-Scope' }]);
  });

  it('builds Nachweisansicht from aggregate materialized statements only', () => {
    const view = buildEvidenceViewModel({
      freeze: { status: 'eingefroren' },
      approvalRequests: [{ status: 'angefordert', roleId: 'ROLE_DEPARTMENT_HEAD' }],
      materializedStatements: [caseModel.presentationContract.elements[0].statements[0]],
    });

    expect(view.freezeStatus).toBe('eingefroren');
    expect(view.approvals).toHaveLength(1);
    expect(view.evidenceItems[0].label).toBe('Betroffene Klärfälle');
  });

  it('marks Operationskonsole raw JSON as not projected', () => {
    const view = buildOperationsConsoleModel({
      operations: [{ id: 'op1', label: 'Operation 1' }],
      preparedResult: {
        kind: 'not_projected_json',
        rawPayload: { ok: true },
        rawPayloadNotice: 'nicht projiziert',
        evidenceMarkers: [],
      },
    });

    expect(view.operations).toHaveLength(1);
    expect(view.preparedResult.badge).toBe('Nicht projiziert');
    expect(view.preparedResult.evidenceMarkers).toEqual([]);
  });
});
