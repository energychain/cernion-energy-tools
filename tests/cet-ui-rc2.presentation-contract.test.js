'use strict';

const {
  validatePresentationContract,
  classifyOperationResult,
} = require('../src/cet-ui-rc2/presentation-contract-validator');

function aggregateStatement(overrides = {}) {
  const statement = {
    id: 'klaerfaelle_betroffen',
    label: 'Betroffene Klärfälle',
    wert: 14,
    einheit: 'Klärfälle',
    aggregatzustand: 'arbeitsstand',
    granularitaet: 'aggregat',
    sicherheit: 'klaerung',
    anschlussfrage: 'Welche der 14 Klärfälle betreffen die Mehr-/Mindermengenabrechnung?',
    quelle: {
      klasse: 'caller_supplied',
      ref: 'evidence://inhouse/klaerfaelle#offen',
      stand: '2026-09-21T09:40:00Z',
    },
    ...overrides,
  };
  for (const [key, value] of Object.entries(statement)) {
    if (value === undefined) delete statement[key];
  }
  return statement;
}

function validContract(overrides = {}) {
  return {
    schemaVersion: 'rc2.presentation-contract.v1',
    form: 'gate',
    titel: 'Betroffenheit Klärfälle',
    stand: '2026-09-21T09:40:00Z',
    aussagen: [aggregateStatement()],
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
    freigabe: { erforderlich: true, rolle: 'market_communication_operator' },
    ...overrides,
  };
}

describe('CET UI RC2 presentation contract', () => {
  test('accepts a valid aggregate presentation contract', () => {
    const result = validatePresentationContract(validContract());
    expect(result.valid).toBe(true);
    expect(result.contract.aussagen[0].granularitaet).toBe('aggregat');
  });

  test('rejects a projected assertion without granularitaet', () => {
    const contract = validContract({
      aussagen: [aggregateStatement({ granularitaet: undefined })],
    });

    expect(() => validatePresentationContract(contract)).toThrow(/granularitaet/);
  });

  test('rejects a statement without source ref', () => {
    const contract = validContract({
      aussagen: [aggregateStatement({ quelle: { klasse: 'caller_supplied', stand: '2026-09-21T09:40:00Z' } })],
    });

    expect(() => validatePresentationContract(contract)).toThrow(/quelle.*ref/);
  });

  test('rejects empty nichtHandlungen', () => {
    expect(() => validatePresentationContract(validContract({ nichtHandlungen: [] }))).toThrow(
      /nichtHandlungen/
    );
  });

  test('rejects materialized single-record statements without hash/ref-only boundary', () => {
    const contract = validContract({
      aussagen: [
        aggregateStatement({
          granularitaet: 'einzeldatensatz',
          wert: { zaehlpunkt: 'DE001234567890000000000000000001', status: 'offen' },
        }),
      ],
    });

    expect(() => validatePresentationContract(contract)).toThrow(/hash_ref_only/);
  });

  test('accepts single-record statements only as hash/ref-only notices', () => {
    const contract = validContract({
      aussagen: [
        aggregateStatement({
          granularitaet: 'einzeldatensatz',
          wert: undefined,
          materialisierung: 'hash_ref_only',
          hashRef: {
            algorithmus: 'sha256',
            wert: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          },
          reproduzierbarkeit: 'nur_mit_quelle',
        }),
      ],
    });

    expect(validatePresentationContract(contract).valid).toBe(true);
  });

  test('does not accept unprojected operation JSON as presentation contract', () => {
    const result = {
      projectionStatus: 'nicht_projiziert',
      raw: { ok: true, count: 14 },
    };

    expect(() => validatePresentationContract(result)).toThrow(/presentation contract/);
    expect(classifyOperationResult(result)).toEqual({
      kind: 'unprojected_raw_result',
      projectionStatus: 'nicht_projiziert',
      hasMarkerSemantics: false,
      hasAggregatzustand: false,
    });
  });
});
