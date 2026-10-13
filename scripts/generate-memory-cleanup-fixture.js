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
    identifier: `97${Date.now().toString().slice(-9)}`,
    generic: 'Im Rahmen der Planung werden weitere Arbeiten abgestimmt.',
    greeting: 'Mit freundlichen Grüßen',
    shortGreeting: 'Viele Grüße',
    nextQuestion: 'Wie geht es weiter?',
    identifierFields: [
      'marketLocationId',
      'meterLocationId',
      'MaLoId',
      'MeLoID',
      'Marktlokations-ID',
      'Marktlokation',
      'Messlokation',
      'Zählpunkt',
      'Referenznummer',
    ],
    otherBase: `Prüfvariante${suffix}`,
    thirdBase: `Prüfanker${suffix}`,
    actorA: `PrüfpersonA${suffix}`,
    actorB: `PrüfpersonB${suffix}`,
    foreignName: `Fremdperson${suffix}`,
    textA,
    textB,
    incomplete: assertion(textB, 'Gasleitung'),
    omitted: { ...assertion(textB, 'Gasleitung'), anchors: [] },
    mail: `Wie geht es weiter?\n\nVon: Fremdperson${suffix}\nBetreff: Synthetischer Verlauf\nMarktlokations-ID: 97000000001\nBitte stimmen Sie die nächsten Arbeiten ab.`,
    assertion,
    first: assertion(textA, `Stromnetz im ${base}`),
    second: assertion(textB, `Gasleitung im ${base}`),
    query: `Was wissen wir zu ${base}?`,
    variants: [`Leitung in der ${base}`, `Netz am ${base}`, `${base} (Gasleitung)`],
    compoundVariants: [
      `Prüfgegenstand über Prüfmittel im ${base}`,
      `Gasleitung im ${base} (Prüfvariante)`,
    ],
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
