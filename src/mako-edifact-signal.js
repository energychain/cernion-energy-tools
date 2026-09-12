'use strict';

/**
 * Generic MaKo/EDIFACT code-context signal (energychain/cernion-energy-tools#498).
 * Shared by capability-broker routing and the personal-agent Copilot evidence
 * enrichment so the detection logic — and its no-code-special-case guarantee —
 * lives in exactly one place. Deliberately generic; Z17 is used only as an
 * acceptance-test example for this routing, and A06/EVUCL may be used as another
 * acceptance example; neither code is a special-cased branch.
 */
function hasMakoEdifactCodeContextSignal(text) {
  const haystack = String(text || '').toLowerCase();
  return (
    /(aperak|utilmd|mscons|edifact|evucl)/i.test(haystack) &&
    /(fehlercode|prüfidentifikator|pruefidentifikator|nachrichtentyp|segmentstruktur|segment|prüfhinweis|pruefhinweis|erkl[aä]r|bedeutet|marktkommunikation|mako.?kontext|\bmako\b|ablehnung|zurückweisung|zurueckweisung|anmeldung|kl[aä]rfall|verarbeitet|erneute anmeldung)/i.test(
      haystack
    )
  );
}

module.exports = { hasMakoEdifactCodeContextSignal };
