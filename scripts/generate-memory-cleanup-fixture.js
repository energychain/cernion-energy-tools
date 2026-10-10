'use strict';
// Entirely synthetic; no persisted fixture or customer identifiers.
function generateMemoryCleanupFixture() {
  return {
    anchor: 'Ulmenstraße',
    text: 'Die Gasleitung in der Ulmenstraße wird bis 2030 außer Betrieb genommen.',
    revoke:
      'Die Aussage zur Gasleitung in der Ulmenstraße (Außerbetriebnahme bis 2030) gilt nicht mehr – bitte streichen',
    other: 'Die Gasleitung in der Ulmenstraße wird bis 2030 geprüft.',
  };
}
module.exports = { generateMemoryCleanupFixture };
