'use strict';

/**
 * Generic MaKo/EDIFACT code-context signal (energychain/cernion-energy-tools#498).
 * Shared by capability-broker routing and the personal-agent Copilot evidence
 * enrichment so the detection logic — and its no-Z17-special-case guarantee —
 * lives in exactly one place. Deliberately generic; Z17 is used only as an
 * acceptance-test example for this routing, never as a special-cased branch.
 */
function hasMakoEdifactCodeContextSignal(text) {
  const haystack = String(text || '').toLowerCase();
  return (
    /(aperak|utilmd|mscons|edifact)/i.test(haystack) &&
    /(fehlercode|prüfidentifikator|pruefidentifikator|nachrichtentyp|segmentstruktur|segment|prüfhinweis|pruefhinweis|erkl[aä]r|bedeutet|marktkommunikation|mako.?kontext|\bmako\b)/i.test(
      haystack
    )
  );
}

module.exports = { hasMakoEdifactCodeContextSignal };
