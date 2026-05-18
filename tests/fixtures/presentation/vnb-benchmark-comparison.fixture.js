'use strict';

module.exports = {
  intent: 'vnb_benchmark_comparison',
  audience: 'management',
  preferredFormat: 'auto',
  domainResult: {
    peers: [
      {
        name: 'TWL Netze',
        value: 'Umsetzungsquote 0.82 | Digitalisierungsindex 0.76',
        implementationRate: 0.82,
        digitalizationIndex: 0.76,
        note: 'fixture-only',
      },
      {
        name: 'Stadtwerke Troisdorf',
        value: 'Umsetzungsquote 0.74 | Digitalisierungsindex —',
        implementationRate: 0.74,
        digitalizationIndex: null,
        note: 'fehlender Wert bleibt leer/neutral',
      },
    ],
    source: 'fixture:vnb-benchmark',
    asOf: '2026-05-18',
  },
};
