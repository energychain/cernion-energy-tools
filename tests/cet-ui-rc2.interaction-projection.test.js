'use strict';

const {
  buildInteractionProjection,
} = require('../src/cet-ui-rc2/interaction-projection');

function presentationContract(overrides = {}) {
  return {
    schemaVersion: 'rc2.presentation-contract.v1',
    form: 'gate',
    titel: 'Betroffenheit Klärfälle',
    stand: '2026-09-21T09:40:00Z',
    aussagen: [
      {
        id: 'klaerfaelle_betroffen',
        label: 'Betroffene Klärfälle',
        wert: 14,
        einheit: 'Klärfälle',
        aggregatzustand: 'arbeitsstand',
        granularitaet: 'aggregat',
        sicherheit: 'klaerung',
        anschlussfrage:
          'Welche der 14 Klärfälle betreffen die Mehr-/Mindermengenabrechnung?',
        quelle: {
          klasse: 'caller_supplied',
          ref: 'evidence://inhouse/klaerfaelle#offen',
          stand: '2026-09-21T09:40:00Z',
        },
      },
      {
        id: 'artikel_id_aenderung',
        label: 'Artikel-ID-Änderung zum 1. Oktober',
        wert: true,
        aggregatzustand: 'arbeitsstand',
        granularitaet: 'aggregat',
        sicherheit: 'belegt',
        quelle: {
          klasse: 'system_of_record',
          ref: 'evidence://mako/change-notice#article-id',
          stand: '2026-09-21T09:40:00Z',
        },
      },
    ],
    befunde: [],
    handlungen: [
      {
        ref: 'cernion://operation/ui.case.claim',
        riskClass: 'cet_state_write',
        erlaubtFuerRolle: true,
      },
    ],
    nichtHandlungen: [
      { was: 'Klärfall schließen', grund: 'Kein externer Fachsystem-Write in RC2' },
    ],
    ...overrides,
  };
}

const criteria = [
  {
    id: 'evidence_complete',
    state: 'offen',
    beeinflussbarDurch: ['RC2_ROLE_MARKTKOMMUNIKATION'],
  },
  {
    id: 'approval_requested',
    state: 'erfuellt',
    beeinflussbarDurch: ['RC2_ROLE_ABTEILUNGSLEITUNG'],
  },
  {
    id: 'external_execute',
    state: 'nicht_anwendbar',
    beeinflussbarDurch: [],
  },
];

describe('CET UI RC2 interaction projection', () => {
  test('returns exactly one next contribution for a role that can influence an open criterion', () => {
    const projection = buildInteractionProjection(presentationContract(), {
      surface: 'vorgangsansicht',
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      decisionCriteria: criteria,
    });

    expect(projection.naechsterBeitrag).toEqual({
      kind: 'beitrag_erforderlich',
      criterionId: 'evidence_complete',
      erforderlichFuer: 'entscheidungsreife',
      textKey: 'rc2.nextContribution.evidenceComplete',
    });
  });

  test('preserves the same statement ids across different roles', () => {
    const first = buildInteractionProjection(presentationContract(), {
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      decisionCriteria: criteria,
    });
    const second = buildInteractionProjection(presentationContract(), {
      activeRoleId: 'RC2_ROLE_ABTEILUNGSLEITUNG',
      decisionCriteria: criteria,
    });

    expect(first.statementRefs).toEqual(['klaerfaelle_betroffen', 'artikel_id_aenderung']);
    expect(second.statementRefs).toEqual(first.statementRefs);
  });

  test('uses criterion states without percent scores', () => {
    const projection = buildInteractionProjection(presentationContract(), {
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      decisionCriteria: criteria,
    });

    expect(projection.entscheidungsdistanz.criteria.map((criterion) => criterion.state)).toEqual([
      'offen',
      'erfuellt',
      'nicht_anwendbar',
    ]);
    expect(projection.entscheidungsdistanz.score).toBeUndefined();
    expect(projection.entscheidungsdistanz.percent).toBeUndefined();
  });

  test('references an open criterion when next contribution is required for decision readiness', () => {
    const projection = buildInteractionProjection(presentationContract(), {
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      decisionCriteria: criteria,
    });

    const referenced = projection.entscheidungsdistanz.criteria.find(
      (criterion) => criterion.id === projection.naechsterBeitrag.criterionId
    );

    expect(projection.naechsterBeitrag.erforderlichFuer).toBe('entscheidungsreife');
    expect(referenced.state).toBe('offen');
  });

  test('returns keiner with influence explanation for a role without influence', () => {
    const projection = buildInteractionProjection(presentationContract(), {
      activeRoleId: 'RC2_ROLE_BEOBACHTER',
      decisionCriteria: criteria,
    });

    expect(projection.naechsterBeitrag).toEqual({
      kind: 'keiner',
      reason: 'role_has_no_open_influence',
      beeinflussbarDurch: ['RC2_ROLE_MARKTKOMMUNIKATION'],
      textKey: 'rc2.nextContribution.noneForRole',
    });
  });

  test('does not mutate the presentation contract', () => {
    const contract = presentationContract();
    const snapshot = JSON.stringify(contract);

    buildInteractionProjection(contract, {
      activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      decisionCriteria: criteria,
    });

    expect(JSON.stringify(contract)).toBe(snapshot);
  });
});
