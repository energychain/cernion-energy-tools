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
function generateMemoryAnchorFixture() {
  const suffix = require('node:crypto')
    .randomUUID()
    .replace(/[^a-f]/g, '')
    .slice(0, 12);
  const base = `Prüfbezug${suffix}`;
  const textA = `Das Stromnetz im ${base} ist bis 2034 für alle weiteren Arbeiten begrenzt.`;
  const textB = `Die Gasleitung im ${base} wird bis 2030 für alle Betroffenen außer Betrieb genommen.`;
  const assertion = (text, value, qualifier = '') => ({
    scope: 'organization',
    text,
    basis: text,
    commitment: 'planned',
    anchors: [{ value, qualifier, aliases: [] }],
    time: { from: '', until: '', latest: '', earliest: '', date: '' },
    expiresAt: '',
  });
  return {
    base,
    otherBase: `Prüfvariante${suffix}`,
    thirdBase: `Prüfanker${suffix}`,
    actorA: `PrüfpersonA${suffix}`,
    actorB: `PrüfpersonB${suffix}`,
    foreignName: `Fremdperson${suffix}`,
    textA,
    textB,
    assertion,
    first: assertion(textA, `Stromnetz im ${base}`),
    second: assertion(textB, `Gasleitung im ${base}`),
    query: `Was wissen wir zu ${base}?`,
    variants: [`Leitung in der ${base}`, `Netz am ${base}`, `${base} (Gasleitung)`],
    internalFunction: 'Synthetic processing chain (pending follow up)',
    rule: 'Synthetische Regel: ' + 'Die angegebenen Fristen bedürfen einer Prüfung. '.repeat(24),
    signature: `Mit freundlichen Grüßen\nFremdperson${suffix}\nFremdes Testteam`,
    draft: 'Hallo,\n\nSynthetischer Entwurf.',
    signaturePlaceholder: '[… Ihr name/team]',
    peakQuestion: 'Wann war die Spitzenlast des synthetischen Lastprofils?',
    peakAnswer: 'Die Spitzenlast lag bei 42 kW am 11.10.2026 12:30 (Europe/Berlin).',
    scopeQuestion: 'Welchen Zeitraum oder Bereich meinst du?',
  };
}
module.exports = { generateMemoryCleanupFixture, generateMemoryAnchorFixture };
