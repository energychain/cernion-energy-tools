'use strict';

const { aggregateDeltas, computeFieldDeltas, joinByOeoClass } = require('../src/oep-delta-engine');
const { getOepFieldMappings } = require('../src/oep-tables');

describe('oep-delta-engine', () => {
  const fieldMap = getOepFieldMappings('supply', 'ego_dp_res_powerplant');

  it('matches rows heuristically and aggregates matched/unmatched counts', () => {
    const mastrInstallations = [
      {
        mastrNummer: 'SEE1001',
        name: 'PV Höheinöd Nord',
        bruttoleistung: 1000,
        postleitzahl: '66989',
        ort: 'Höheinöd',
        inbetriebnahmejahr: 2022,
        latitude: 49.3202,
        longitude: 7.6052,
      },
      {
        mastrNummer: 'SEE1002',
        name: 'PV Höheinöd Süd',
        bruttoleistung: 850,
        postleitzahl: '66989',
        ort: 'Höheinöd',
        inbetriebnahmejahr: 2023,
      },
    ];
    const oepRows = [
      {
        id: 1,
        name: 'PV Höheinöd Nord',
        capacity_mw: 1.0,
        postal_code: '66989',
        city: 'Höheinöd',
        commissioning_year: 2022,
        latitude: 49.3201,
        longitude: 7.6051,
      },
      {
        id: 2,
        name: 'Wind Höheinöd West',
        capacity_mw: 2.2,
        postal_code: '66989',
        city: 'Höheinöd',
        commissioning_year: 2021,
      },
    ];

    const joined = joinByOeoClass(mastrInstallations, oepRows, 'oeo:PowerPlant', fieldMap);
    const delta = aggregateDeltas(joined, fieldMap);

    expect(joined.pairs).toHaveLength(1);
    expect(delta).toEqual(
      expect.objectContaining({
        matchedPairs: 1,
        mastrOnly: 1,
        oepOnly: 1,
        totalUnmatched: 2,
        capacityDeltaMW: 0,
      })
    );
    expect(delta.fieldDeltas.capacityKw).toEqual(
      expect.objectContaining({ mean: 0, max: 0, mismatchCount: 0 })
    );
  });

  it('computes field deltas and critical mismatches for large capacity deviations', () => {
    const joinedPair = {
      mastrFeatures: {
        name: 'PV Süd',
        capacityKw: 1000,
        commissioningYear: 2024,
        postalCode: '66989',
        city: 'Höheinöd',
        latitude: 49.31,
        longitude: 7.61,
      },
      oepFeatures: {
        name: 'PV Süd',
        capacityKw: 800,
        commissioningYear: 2022,
        postalCode: '66989',
        city: 'Höheinöd',
        latitude: 49.31,
        longitude: 7.61,
      },
    };

    const deltas = computeFieldDeltas(joinedPair, fieldMap);
    const capacityDelta = deltas.find((delta) => delta.field === 'capacityKw');
    const commissioningDelta = deltas.find((delta) => delta.field === 'commissioningYear');

    expect(capacityDelta).toEqual(
      expect.objectContaining({
        deltaPct: 25,
        severity: 'critical',
      })
    );
    expect(commissioningDelta).toEqual(
      expect.objectContaining({
        absoluteDelta: 2,
        severity: 'warning',
      })
    );
  });
});
