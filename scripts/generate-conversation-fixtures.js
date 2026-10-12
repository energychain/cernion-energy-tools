'use strict';
const fs = require('node:fs');
const path = require('node:path');
const legacy = require('../tests/fixtures/workbench-752.json');
const live = require('../tests/fixtures/workbench-758.json');
const corpus = [
  {
    id: 'orientation',
    turns: [
      { message: 'Kennst Du Dich mit Schleupen aus?', question: true },
      {
        message: 'Ich bin in der Netzabrechnung und möchte unsere Abläufe besser verstehen.',
        question: false,
      },
      { message: 'Sind Dir jetzt schon Fälle bekannt?', question: false, search: true },
    ],
  },
  {
    id: 'file-purpose',
    turns: [
      {
        message:
          '<context><source id="synthetic-file-813" name="Projektpapier.md"># Projektpapier\nFür das synthetische Projekt Nord ist eine Abstimmung für den 15. November geplant. Offen ist die Freigabe des Zeitplans.</source></context><user_query>Was kannst Du mir dazu sagen?</user_query>',
        question: true,
      },
      { message: 'Mir geht es um einen kurzen Überblick.', question: false },
    ],
  },
  {
    id: 'filing',
    turns: [
      {
        message: 'Zur Kenntnis und Ablage:\n' + legacy.R3.slice(legacy.R3.indexOf('Von:')),
        question: false,
      },
    ],
  },
  {
    id: 'counter',
    turns: live.liveTurns.map((message, index) => ({
      message,
      question: index === 0 ? true : 'optional',
    })),
  },
  {
    id: 'supplier',
    turns: legacy.R2.map((message, index) => ({ message, question: index === 0 })),
  },
  {
    id: 'task',
    turns: [
      {
        message:
          'Prüfe die Anfrage und erstelle einen Antwortentwurf mit nächsten Schritten.\n' +
          legacy.R1,
        question: false,
        draft: true,
      },
    ],
  },
  {
    id: 'thread',
    turns: [
      {
        message: 'Fasse den Verlauf zusammen und erstelle einen Antwortentwurf.\n' + legacy.R3,
        question: false,
        draft: true,
        summary: true,
      },
    ],
  },
  {
    id: 'load',
    turns: [
      {
        message: 'Erkläre, wie ich aus Viertelstundenwerten in kW die Energie in kWh berechne.',
        question: false,
      },
      {
        message: 'Berechne die Energie für diese vier Viertelstundenwerte: 4 kW, 8 kW, 6 kW, 2 kW.',
        question: false,
      },
    ],
  },
];
const target = path.join(__dirname, '../tests/fixtures/workbench-813.generated.json');
const content = JSON.stringify(corpus, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) process.exitCode = 1;
} else fs.writeFileSync(target, content);

function generateHotfixConversationFixtures() {
  const mail = [
    'Kannst Du mir hier weiterhelfen?',
    'Von: Lieferant Beispiel Mako <mako@lieferant-beispiel.example>',
    'Gesendet: Montag, 5. Oktober 2026 09:12',
    'An: Netz Beispiel <netz@stadtwerk-beispiel.example>',
    'Betreff: Überfällige Antwort Netzanmeldung, MaLo 50800000001, Referenz SYN-REF-001',
    '',
    'Sehr geehrte Damen und Herren,',
    '',
    'zu unserer Netzanmeldung vom 21.09.2026 liegt uns bis heute keine Antwort vor.',
    'Lieferstelle: Beispielweg 1, 12345 Musterstadt',
    'Marktlokation: 50800000001',
    '',
    'Mit freundlichen Grüßen',
    'Erika Beispiel',
    'Team Wechselmanagement, Lieferant Beispiel GmbH',
    'Tel.: 0000 000000, Fax: 0000 000001',
  ].join('\n');
  return {
    mail,
    draftQuestion: 'Mach mir die Antwort fertig',
    thread:
      mail +
      '\n\nVon: Netz Beispiel <netz@stadtwerk-beispiel.example>\nGesendet: 04.10.2026 08:00\nBetreff: SYN-REF-001\nDie APERAK bestätigt den Empfang der Nachricht. Die fachliche Antwort zur Netzanmeldung bleibt offen.',
    explicitQuestion: 'Schlüssele SYN-INV-002 auf',
    keywordQuestion: 'Die APERAK Nachricht bitte prüfen.',
    labelledProse:
      'Thema: Synthetische Abstimmung\nStand: Offen\nThema: Synthetische Rückmeldung\nStand: Ausstehend',
    ambiguousTexts: ['None: 2\nFreitext: bleibt Text', 'Titel;Datum: Dokument\nErgebnis: Offen'],
    newsText: 'Die synthetische Gasleitung endet 2030; das Stromnetz wird erst 2034 erweitert.',
  };
}
const hotfixTarget = path.join(__dirname, '../tests/fixtures/workbench-846.generated.json');
const hotfixContent = JSON.stringify(generateHotfixConversationFixtures(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(hotfixTarget) || fs.readFileSync(hotfixTarget, 'utf8') !== hotfixContent)
    process.exitCode = 1;
} else fs.writeFileSync(hotfixTarget, hotfixContent);
module.exports = { generateHotfixConversationFixtures };

function generateChatPolishFixtures() {
  return {
    humanProposal: 'Die ausstehende Fallprüfung braucht eine Freigabe.',
    gapLabels: [
      'Die erste Angabe fehlt',
      'Die weitere Angabe fehlt',
      'Die zusätzliche Angabe fehlt',
    ],
    internalNotice:
      'Internal Review Proposal: Case 00000000-0000-4000-8000-000000000850 requires operational review due to blocking breaches in the handover process.',
    unsafeNotices: [
      'Operational status requires immediate attention.',
      'Die interne Funktion fn-private-review ist offen.',
      'Die Abfrage meldet READ_SOURCE_FAILED.',
      'Die Prüfung von internalSource.pending steht aus.',
    ],
    relationshipNotice:
      'Die geplante Stilllegung der Gasleitung bis 2030 beeinflusst den Netzausbau ab 2034.',
    summaryQuestion: 'Fasse das Protokoll kurz zusammen.',
    functionQuestion: 'Welche Funktionen passen zu diesem Fall?',
    peakQuestion: 'Wann war die Spitzenlast?',
    peakAnswer: 'Die Spitzenlast beträgt 1.243,7 kW am 14.01.2025 18:15.',
    detailsQuestion: 'Zeig mir den Rechenweg',
    draftQuestion: 'Mach mir die Antwort fertig',
    displayName: 'ben',
    draft:
      'Guten Tag,\n\nzu der offenen Netzanmeldung fehlt noch [… Bearbeitungsstand].\n\nMit freundlichen Grüßen\n[Name]',
    fieldError:
      'Ein angefordertes Auswertungsfeld ist nicht in den Daten enthalten. Wiederhole die Abfrage mit den korrekten Feldbezeichnungen.',
  };
}
const polishTarget = path.join(__dirname, '../tests/fixtures/workbench-850.generated.json');
const polishContent = JSON.stringify(generateChatPolishFixtures(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(polishTarget) || fs.readFileSync(polishTarget, 'utf8') !== polishContent)
    process.exitCode = 1;
} else fs.writeFileSync(polishTarget, polishContent);
module.exports.generateChatPolishFixtures = generateChatPolishFixtures;
