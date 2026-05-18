'use strict';

module.exports = {
  intent: 'asset_count_query',
  audience: 'management',
  preferredFormat: 'auto',
  domainResult: {
    metric: 'PV-Anlagen',
    label: 'PV-Anlagen im Testgebiet Wiesloch',
    count: 42,
    unit: 'Anlagen',
    answer: '42 PV-Anlagen im Testgebiet',
    source: 'fixture:mastr-local-test',
    asOf: '2026-05-18',
    note: 'Fixture-Datensatz, keine Live-Abfrage',
  },
};
