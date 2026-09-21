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
    visibleStatus: 'mir_zugewiesen',
    primaryRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
    presentationContract: {
      schemaVersion: 'rc2.presentation-contract.v1',
      titel: 'Vorgang Artikel-ID-Änderung',
      aussagen: [
        {
          id: 's1',
          label: 'Betroffene Klärfälle',
          wert: 14,
          granularitaet: 'aggregat',
          quelle: { ref: 'evidence://s1' },
        },
      ],
      nichtHandlungen: [{ was: 'Fachsystem execute', grund: 'Nicht im RC2-Scope' }],
    },
    interactionProjection: {
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      naechsterBeitrag: { kind: 'klaeren', textKey: 'rc2.nextContribution.articleIdReview' },
      entscheidungsdistanz: {
        criteria: [
          { id: 'owner', label: 'Owner benannt', state: 'offen' },
          { id: 'legacy', label: 'Alte Fachsystemfreigabe', state: 'nicht_anwendbar' },
        ],
      },
    },
  };

  it('normalizes Tagesfläche cards with attention reason, role effect and next contribution', () => {
    const surface = buildDailySurfaceModel({
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      items: [
        {
          caseId: 'vorgang-1',
          title: 'Vorgang Artikel-ID-Änderung',
          aufmerksamkeitsgrund: 'uebergabe_an_mich',
          rollenwirkung: '14 Klärfälle müssen fachlich zugeordnet werden',
          status: 'Mir zugewiesen',
          interactionProjection: caseModel.interactionProjection,
        },
      ],
    });

    expect(surface.route).toBe('/api/ui/v0/daily-surface');
    expect(surface.cards).toEqual([
      {
        id: 'vorgang-1',
        title: 'Vorgang Artikel-ID-Änderung',
        attentionReason: 'uebergabe_an_mich',
        roleEffect: '14 Klärfälle müssen fachlich zugeordnet werden',
        nextContribution: caseModel.interactionProjection.naechsterBeitrag,
        status: 'Mir zugewiesen',
        roleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      },
    ]);
  });

  it('builds Vorgangsansicht in the five fixed grammar sections', () => {
    const view = buildCaseViewModel(caseModel);

    expect(view.title).toBe('Vorgang Artikel-ID-Änderung');
    expect(view.sections.map((section) => section.id)).toEqual([
      'vorgang',
      'quellen',
      'pruefung',
      'unsicherheit',
      'freigabe',
    ]);
    expect(view.sections.find((section) => section.id === 'pruefung').statements).toEqual(
      caseModel.presentationContract.aussagen
    );
    expect(view.sections.find((section) => section.id === 'unsicherheit')).toEqual(
      expect.objectContaining({
        criteria: [{ id: 'owner', label: 'Owner benannt', state: 'offen' }],
        collapsedCriteria: [
          {
            id: 'legacy',
            label: 'Alte Fachsystemfreigabe',
            state: 'nicht_anwendbar',
            collapsed: true,
          },
        ],
      })
    );
    expect(view.boundaries).toEqual([{ was: 'Fachsystem execute', grund: 'Nicht im RC2-Scope' }]);
  });

  it('builds Nachweisansicht from aggregate materialized statements only', () => {
    const view = buildEvidenceViewModel({
      frozenAt: '2026-09-21T12:00:00Z',
      approvalRequests: [{ status: 'angefordert', roleId: 'RC2_ROLE_ABTEILUNGSLEITUNG' }],
      materializedStatements: [
        {
          id: 's1',
          label: 'Betroffene Klärfälle',
          wert: 14,
          source: { ref: 'evidence://s1' },
        },
      ],
    });

    expect(view.freezeStatus).toBe('eingefroren');
    expect(view.approvals).toHaveLength(1);
    expect(view.evidenceItems[0].label).toBe('Betroffene Klärfälle');
  });

  it('marks Operationskonsole raw JSON as not projected', () => {
    const view = buildOperationsConsoleModel({
      operations: { available: [{ id: 'op1', label: 'Operation 1', riskClass: 'read' }] },
      preparedResult: {
        projectionStatus: 'nicht_projiziert',
        unprojected: {
          raw: { ok: true },
          notice: 'nicht_projiziert',
        },
      },
    });

    expect(view.operations).toHaveLength(1);
    expect(view.operations[0].riskClass).toBe('read');
    expect(view.preparedResult.badge).toBe('Nicht projiziert');
    expect(view.preparedResult.evidenceMarkers).toEqual([]);
  });
});
