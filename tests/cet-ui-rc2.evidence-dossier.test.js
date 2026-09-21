'use strict';

const {
  buildEvidenceDossier,
  isCompleteEvidenceDossier,
} = require('../src/cet-ui-rc2/evidence-dossier');

function presentationContract() {
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
        aggregatzustand: 'nachweisakte',
        granularitaet: 'aggregat',
        sicherheit: 'belegt',
        quelle: {
          klasse: 'caller_supplied',
          ref: 'evidence://inhouse/klaerfaelle#offen',
          stand: '2026-09-21T09:40:00Z',
        },
      },
      {
        id: 'zaehlpunkt_einzelreferenz',
        label: 'Einzeldatensatz Zählpunkt',
        aggregatzustand: 'nachweisakte',
        granularitaet: 'einzeldatensatz',
        materialisierung: 'hash_ref_only',
        hashRef: {
          algorithmus: 'sha256',
          wert: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        },
        reproduzierbarkeit: 'nur_mit_quelle_reproduzierbar',
        sicherheit: 'belegt',
        quelle: {
          klasse: 'system_of_record',
          ref: 'evidence://mako/raw-row#hash-only',
          stand: '2026-09-21T09:40:00Z',
        },
      },
    ],
    befunde: [],
    handlungen: [],
    nichtHandlungen: [{ was: 'Rohzeilen materialisieren', grund: 'F3 Einzeldatensatzgrenze' }],
  };
}

function interactionProjection() {
  return {
    schemaVersion: 'rc2.interaction-projection.v1',
    activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
    statementRefs: ['klaerfaelle_betroffen', 'zaehlpunkt_einzelreferenz'],
    entscheidungsdistanz: {
      criteria: [{ id: 'evidence_complete', state: 'erfuellt', beeinflussbarDurch: [] }],
    },
    naechsterBeitrag: { kind: 'keiner', reason: 'no_open_criterion' },
  };
}

describe('CET UI RC2 evidence dossier', () => {
  test('materializes aggregate statements with source metadata', () => {
    const dossier = buildEvidenceDossier({
      presentationContract: presentationContract(),
      interactionProjection: interactionProjection(),
      schnittplanVersion: 'rc2.schnittplan.v1',
      frozenAt: '2026-09-21T12:00:00Z',
    });

    expect(dossier.materializedStatements).toContainEqual({
      id: 'klaerfaelle_betroffen',
      label: 'Betroffene Klärfälle',
      wert: 14,
      einheit: 'Klärfälle',
      granularitaet: 'aggregat',
      source: {
        klasse: 'caller_supplied',
        ref: 'evidence://inhouse/klaerfaelle#offen',
        stand: '2026-09-21T09:40:00Z',
      },
      offlineRenderable: true,
    });
  });

  test('keeps single-record statements as hash/ref-only notices', () => {
    const dossier = buildEvidenceDossier({
      presentationContract: presentationContract(),
      interactionProjection: interactionProjection(),
      schnittplanVersion: 'rc2.schnittplan.v1',
      frozenAt: '2026-09-21T12:00:00Z',
    });

    expect(dossier.hashRefOnlyNotices).toEqual([
      {
        id: 'zaehlpunkt_einzelreferenz',
        label: 'Einzeldatensatz Zählpunkt',
        granularitaet: 'einzeldatensatz',
        materialisierung: 'hash_ref_only',
        hashRef: {
          algorithmus: 'sha256',
          wert: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        },
        sourceRef: 'evidence://mako/raw-row#hash-only',
        notice: 'nur_mit_quelle_reproduzierbar',
        offlineRenderable: false,
      },
    ]);
    expect(JSON.stringify(dossier)).not.toContain('zaehlpunkt_raw_value');
  });

  test('carries presentation contract and Schnittplan versions', () => {
    const dossier = buildEvidenceDossier({
      presentationContract: presentationContract(),
      interactionProjection: interactionProjection(),
      schnittplanVersion: 'rc2.schnittplan.v1',
      frozenAt: '2026-09-21T12:00:00Z',
    });

    expect(dossier.presentationContractVersion).toBe('rc2.presentation-contract.v1');
    expect(dossier.interactionProjectionVersion).toBe('rc2.interaction-projection.v1');
    expect(dossier.schnittplanVersion).toBe('rc2.schnittplan.v1');
  });

  test('renders offline except hash/ref-only notices and inventories all source refs', () => {
    const dossier = buildEvidenceDossier({
      presentationContract: presentationContract(),
      interactionProjection: interactionProjection(),
      schnittplanVersion: 'rc2.schnittplan.v1',
      frozenAt: '2026-09-21T12:00:00Z',
    });

    expect(dossier.offlineStatus).toEqual({
      aggregateStatementsOfflineRenderable: true,
      hashRefOnlyRequiresSource: ['zaehlpunkt_einzelreferenz'],
    });
    expect(dossier.sourceRefs).toEqual([
      'evidence://inhouse/klaerfaelle#offen',
      'evidence://mako/raw-row#hash-only',
    ]);
  });

  test('rejects invalid interaction projection and incomplete dossier predicates', () => {
    expect(() =>
      buildEvidenceDossier({
        presentationContract: presentationContract(),
        interactionProjection: {},
        schnittplanVersion: 'rc2.schnittplan.v1',
        frozenAt: '2026-09-21T12:00:00Z',
      })
    ).toThrow(/interaction projection/);

    expect(() =>
      buildEvidenceDossier({
        presentationContract: presentationContract(),
        interactionProjection: {
          ...interactionProjection(),
          statementRefs: [{}],
        },
        schnittplanVersion: 'rc2.schnittplan.v1',
        frozenAt: '2026-09-21T12:00:00Z',
      })
    ).toThrow(/statementRefs/);

    expect(() =>
      buildEvidenceDossier({
        presentationContract: presentationContract(),
        interactionProjection: {
          ...interactionProjection(),
          statementRefs: ['klaerfaelle_betroffen', 'unknown_statement'],
        },
        schnittplanVersion: 'rc2.schnittplan.v1',
        frozenAt: '2026-09-21T12:00:00Z',
      })
    ).toThrow(/statementRefs/);

    expect(
      isCompleteEvidenceDossier({
        schemaVersion: 'rc2.evidence-dossier.v1',
        frozenAt: '2026-09-21T12:00:00Z',
        presentationContractVersion: 'rc2.presentation-contract.v1',
        interactionProjectionVersion: 'rc2.interaction-projection.v1',
        schnittplanVersion: 'rc2.schnittplan.v1',
        statementRefs: [{}],
        materializedStatements: [],
        hashRefOnlyNotices: [],
        sourceRefs: [],
        offlineStatus: {
          aggregateStatementsOfflineRenderable: true,
          hashRefOnlyRequiresSource: [],
        },
      })
    ).toBe(false);

    expect(
      isCompleteEvidenceDossier({
        schemaVersion: 'rc2.evidence-dossier.v1',
        frozenAt: '2026-09-21T12:00:00Z',
        presentationContractVersion: 'rc2.presentation-contract.v1',
        interactionProjectionVersion: 'rc2.interaction-projection.v1',
        schnittplanVersion: 'rc2.schnittplan.v1',
        statementRefs: [],
        materializedStatements: [],
        hashRefOnlyNotices: [],
        sourceRefs: [],
        offlineStatus: {
          aggregateStatementsOfflineRenderable: true,
          hashRefOnlyRequiresSource: [],
        },
      })
    ).toBe(false);

    expect(
      isCompleteEvidenceDossier({
        schemaVersion: 'rc2.evidence-dossier.v1',
        frozenAt: '2026-09-21T12:00:00Z',
        presentationContractVersion: 'rc2.presentation-contract.v1',
        interactionProjectionVersion: 'rc2.interaction-projection.v1',
        schnittplanVersion: 'rc2.schnittplan.v1',
        statementRefs: ['zaehlpunkt_einzelreferenz'],
        materializedStatements: [],
        hashRefOnlyNotices: [
          {
            id: 'zaehlpunkt_einzelreferenz',
            label: 'Einzeldatensatz Zählpunkt',
            granularitaet: 'einzeldatensatz',
            materialisierung: 'hash_ref_only',
            sourceRef: 'evidence://mako/raw-row#hash-only',
            notice: 'nur_mit_quelle_reproduzierbar',
            offlineRenderable: false,
          },
        ],
        sourceRefs: ['evidence://mako/raw-row#hash-only'],
        offlineStatus: {
          aggregateStatementsOfflineRenderable: true,
          hashRefOnlyRequiresSource: ['zaehlpunkt_einzelreferenz'],
        },
      })
    ).toBe(false);

    expect(
      isCompleteEvidenceDossier({
        schemaVersion: 'rc2.evidence-dossier.v1',
        frozenAt: '2026-09-21T12:00:00Z',
        presentationContractVersion: 'rc2.presentation-contract.v1',
        interactionProjectionVersion: 'rc2.interaction-projection.v1',
        schnittplanVersion: 'rc2.schnittplan.v1',
        statementRefs: ['klaerfaelle_betroffen'],
        materializedStatements: [
          {
            id: 'klaerfaelle_betroffen',
            label: 'Betroffene Klärfälle',
            wert: 14,
            granularitaet: 'aggregat',
            source: { ref: '' },
            offlineRenderable: true,
          },
        ],
        hashRefOnlyNotices: [],
        sourceRefs: ['evidence://unrelated'],
        offlineStatus: {
          aggregateStatementsOfflineRenderable: true,
          hashRefOnlyRequiresSource: [],
        },
      })
    ).toBe(false);

    expect(
      isCompleteEvidenceDossier({
        schemaVersion: 'rc2.evidence-dossier.v1',
        frozenAt: '2026-09-21T12:00:00Z',
        presentationContractVersion: 'rc2.presentation-contract.v1',
        interactionProjectionVersion: 'rc2.interaction-projection.v1',
        schnittplanVersion: 'rc2.schnittplan.v1',
        statementRefs: ['klaerfaelle_betroffen'],
        materializedStatements: [
          {
            id: 'klaerfaelle_betroffen',
            label: 'Betroffene Klärfälle',
            wert: 14,
            granularitaet: 'aggregat',
            source: { ref: 'evidence://inhouse/klaerfaelle#offen' },
            offlineRenderable: true,
          },
        ],
        hashRefOnlyNotices: [],
        sourceRefs: ['evidence://unrelated'],
        offlineStatus: {
          aggregateStatementsOfflineRenderable: true,
          hashRefOnlyRequiresSource: [],
        },
      })
    ).toBe(false);

    expect(
      isCompleteEvidenceDossier({
        schemaVersion: 'rc2.evidence-dossier.v1',
        presentationContractVersion: 'rc2.presentation-contract.v1',
        schnittplanVersion: 'rc2.schnittplan.v1',
        materializedStatements: [],
        hashRefOnlyNotices: [],
        offlineStatus: {},
      })
    ).toBe(false);
  });

  test('does not treat Decision Frame metadata alone as a complete dossier', () => {
    const decisionFrameMetadataOnly = {
      frameId: 'df-1',
      metadata: {
        presentationContractVersion: 'rc2.presentation-contract.v1',
        schnittplanVersion: 'rc2.schnittplan.v1',
      },
    };

    expect(isCompleteEvidenceDossier(decisionFrameMetadataOnly)).toBe(false);
    expect(
      isCompleteEvidenceDossier(
        buildEvidenceDossier({
          presentationContract: presentationContract(),
          interactionProjection: interactionProjection(),
          schnittplanVersion: 'rc2.schnittplan.v1',
          frozenAt: '2026-09-21T12:00:00Z',
        })
      )
    ).toBe(true);
  });
});
