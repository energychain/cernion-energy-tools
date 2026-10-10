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
          'Was kannst Du mir dazu sagen?\n\n# Projektpapier\nFür das synthetische Projekt Nord ist eine Abstimmung für den 15. November geplant. Offen ist die Freigabe des Zeitplans.',
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
      },
    ],
  },
  {
    id: 'thread',
    turns: [
      {
        message: 'Fasse den Verlauf zusammen und erstelle einen Antwortentwurf.\n' + legacy.R3,
        question: false,
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
