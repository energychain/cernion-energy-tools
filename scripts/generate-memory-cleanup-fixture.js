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
    genericVariants: [
      'Die Abstimmung erfolgt im Rahmen der Planung.',
      'Die Planung erfolgt in der Planung.',
      'Die Abstimmung erfolgt in der Planung.',
    ],
    measureQuestion: 'Wie hoch ist der größte Wert?',
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
function generateMemoryMessageFixture() {
  const f = generateMemoryAnchorFixture();
  const x = f.base;
  return {
    ...f,
    patterns: [
      [
        `Die Gasleitung im ${x} müssen wir bis 2030 außer Betrieb nehmen.`,
        `Das Stromnetz im ${x} ist bis 2034 am Limit, neue Wärmepumpen sind bis dahin eingeschränkt.`,
      ],
      [
        `Gasleitung im ${x}: Außerbetriebnahme spätestens 2030 geplant.`,
        `Stromnetz ${x}: frühestens 2034 wieder Kapazität für neue Wärmepumpen.`,
      ],
      [
        `Für den ${x} haben wir beschlossen: Gasversorgung endet spätestens Ende 2030.`,
        `Im ${x} ist der Ortsnetztrafo voll, Wärmepumpen-Anträge gehen dort erst ab 2034.`,
      ],
      [
        `Die Leitung in der ${x} legen wir bis 2030 still.`,
        `Das Netz am ${x} ist bis 2034 ausgelastet, neue Wärmepumpen sind bis dahin eingeschränkt.`,
      ],
      [`${x}-Gasleitung wird 2030 stillgelegt.`, `Bei ${x} keine neuen Wärmepumpen vor 2034.`],
    ],
    punctuation: [':', ',', ';', '.', '(', ')', '—', '–'].map(
      (end) => `Weitere Arbeiten im ${x}${end} Außerbetriebnahme geplant.`
    ),
    initial: [
      `Im ${x} ist das Netz begrenzt.`,
      `Für den ${x} haben wir beschlossen: Weitere Arbeiten sind begrenzt.`,
      `Am ${x} ist die Planung begrenzt.`,
    ],
    fragment: 'Gasversorgung endet spätestens Ende 2030.',
    common: 'Wärmepumpen',
    commonText: 'Wärmepumpen werden für weitere Arbeiten geplant.',
    singleCase: `Eine einzelne Anlage im ${x} wird geprüft.`,
    unrelated: 'Was ist eine allgemeine Definition?',
    news: 'Gibt es Neuigkeiten?',
    reason: 'Die Fristen 2030 und 2034 müssen abgestimmt werden.',
  };
}
module.exports = {
  generateMemoryCleanupFixture,
  generateMemoryAnchorFixture,
  generateMemoryMessageFixture,
};
