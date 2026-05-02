'use strict';

const { buildSnapshotEntry, computeDelta } = require('../src/mastr-monitor-diff');

describe('mastr-monitor-diff', () => {
  const watchFields = [
    'einheitBetriebsstatus',
    'netzbetreiberpruefungStatus',
    'napData.spannungsebene',
    'lastUpdatedAt',
  ];

  it('buildSnapshotEntry extracts only watchFields + identification fields', () => {
    const entry = buildSnapshotEntry(
      {
        mastrNummer: 'SEE001',
        name: 'PV Anlage',
        ort: 'Ludwigshafen',
        postleitzahl: '67059',
        lastUpdatedAt: '2026-04-17T06:00:00.000Z',
        napData: { spannungsebene: 352 },
        bruttoleistung: 110,
      },
      watchFields
    );

    expect(entry).toMatchObject({
      mastrNummer: 'SEE001',
      name: 'PV Anlage',
      ort: 'Ludwigshafen',
      postleitzahl: '67059',
      'napData.spannungsebene': 352,
    });
    expect(entry.bruttoleistung).toBeUndefined();
  });

  it('computeDelta ADDED detects new entries and returns full added entry', () => {
    const prev = [{ mastrNummer: 'SEE001', name: 'A', lastUpdatedAt: 't1' }];
    const curr = [
      { mastrNummer: 'SEE001', name: 'A', lastUpdatedAt: 't1' },
      { mastrNummer: 'SEE002', name: 'B', einheitBetriebsstatus: '35', lastUpdatedAt: 't2' },
    ];

    const delta = computeDelta(prev, curr, watchFields);
    expect(delta.added).toHaveLength(1);
    expect(delta.added[0].mastrNummer).toBe('SEE002');
  });

  it('computeDelta REMOVED uses Stilllegung for status 38 and filter reason otherwise', () => {
    const prev = [
      { mastrNummer: 'SEE001', einheitBetriebsstatus: '38', lastUpdatedAt: 't1' },
      { mastrNummer: 'SEE002', einheitBetriebsstatus: '35', lastUpdatedAt: 't1' },
    ];
    const curr = [];

    const delta = computeDelta(prev, curr, watchFields);
    expect(delta.removed).toHaveLength(2);

    const s1 = delta.removed.find((x) => x.mastrNummer === 'SEE001');
    const s2 = delta.removed.find((x) => x.mastrNummer === 'SEE002');
    expect(s1.removalReason).toBe('Stilllegung');
    expect(s2.removalReason).toBe('Nicht mehr im Filter');
  });

  it('computeDelta CHANGED includes fields and label mappings', () => {
    const prev = [
      {
        mastrNummer: 'SEE001',
        name: 'A',
        einheitBetriebsstatus: '35',
        netzbetreiberpruefungStatus: 2955,
        lastUpdatedAt: '2026-04-16T00:00:00.000Z',
      },
    ];
    const curr = [
      {
        mastrNummer: 'SEE001',
        name: 'A',
        einheitBetriebsstatus: '37',
        netzbetreiberpruefungStatus: 2954,
        lastUpdatedAt: '2026-04-17T00:00:00.000Z',
      },
    ];

    const delta = computeDelta(prev, curr, watchFields);
    expect(delta.changed).toHaveLength(1);

    const fields = delta.changed[0].fields;
    const statusField = fields.find((f) => f.field === 'einheitBetriebsstatus');
    const nbpField = fields.find((f) => f.field === 'netzbetreiberpruefungStatus');

    expect(statusField.fromLabel).toBe('In Betrieb');
    expect(statusField.toLabel).toBe('Vorübergehend stillgelegt');
    expect(nbpField.fromLabel).toBe('In Prüfung');
    expect(nbpField.toLabel).toBe('Geprüft');
  });

  it('computeDelta skips unchanged timestamp for performance optimization', () => {
    const prev = [{ mastrNummer: 'SEE001', einheitBetriebsstatus: '35', lastUpdatedAt: 'same' }];
    const curr = [{ mastrNummer: 'SEE001', einheitBetriebsstatus: '37', lastUpdatedAt: 'same' }];

    const delta = computeDelta(prev, curr, watchFields);
    expect(delta.changed).toHaveLength(0);
    expect(delta.summary.unchanged).toBe(1);
  });

  it('computeDelta NO CHANGE handles identical and empty snapshots', () => {
    const identical = [
      { mastrNummer: 'SEE001', einheitBetriebsstatus: '35', lastUpdatedAt: 'same' },
    ];
    const deltaIdentical = computeDelta(identical, identical, watchFields);
    expect(deltaIdentical.summary.changed).toBe(0);

    const deltaEmpty = computeDelta([], [], watchFields);
    expect(deltaEmpty.summary).toMatchObject({
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 0,
      total: 0,
    });
  });

  it('computeDelta SUMMARY counts are consistent', () => {
    const prev = [
      { mastrNummer: 'SEE001', einheitBetriebsstatus: '35', lastUpdatedAt: 't1' },
      { mastrNummer: 'SEE002', einheitBetriebsstatus: '35', lastUpdatedAt: 't1' },
    ];
    const curr = [
      { mastrNummer: 'SEE001', einheitBetriebsstatus: '37', lastUpdatedAt: 't2' },
      { mastrNummer: 'SEE003', einheitBetriebsstatus: '35', lastUpdatedAt: 't3' },
    ];

    const delta = computeDelta(prev, curr, watchFields);
    const sum =
      delta.summary.added + delta.summary.removed + delta.summary.changed + delta.summary.unchanged;

    expect(sum).toBe(delta.summary.total);
  });
});
