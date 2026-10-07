'use strict';

// Synthetic neutral planning text. No customer material or domain standards.
const fs = require('node:fs');
const path = require('node:path');
const chapters = [];
for (let chapter = 1; chapter <= 12; chapter++) {
  const lines = [`Kapitel ${chapter}: Planung`, `Seite ${chapter * 3}`];
  if (chapter === 1)
    lines.push(
      'Die Gesamtzahl der Einheiten beträgt im Ausgangsjahr 100. Das Gesamtbudget beträgt 1000.'
    );
  if (chapter === 6)
    lines.push(
      'Die Gesamtzahl der Einheiten beträgt im gleichen Ausgangsjahr 240. Das Gesamtbudget beträgt 700.'
    );
  if (chapter === 3)
    lines.push(
      'Annahme: Die Einheiten wachsen jedes Jahr um 90 Prozent. Es gibt keine Begründung, keine Vergleichsdaten und keine zusätzlichen Mittel.'
    );
  if (chapter === 8)
    lines.push(
      'Tabelle: Jahr | Einheiten\n0 | 100\n1 | 190\n2 | 200\nDie Tabelle setzt das behauptete jährliche Wachstum von 90 Prozent um.'
    );
  if (chapter === 4)
    lines.push('Der Start der Maßnahme ist am 01.06.2030, ihr Abschluss am 01.05.2030.');
  for (let row = 0; row < 65; row++)
    lines.push(
      `Abschnitt ${chapter}-${row}: Die Arbeitsgruppe dokumentiert den Umfang und die Abhängigkeiten. Angaben sind Annahmen und bedürfen einer nachvollziehbaren Grundlage. Die Maßnahme wird regelmäßig geprüft; Änderungen werden mit Datum und Fundstelle vermerkt.\nTabelle: Position | Aufwand | Status\n${row} | ${row + 10} | geplant`
    );
  chapters.push(lines.join('\n'));
}
const target = path.join(__dirname, '../tests/fixtures/document-review/neutral-long-document.txt');
fs.writeFileSync(target, chapters.join('\n\n') + '\n');
console.log(`Synthetic review fixture: ${fs.statSync(target).size} bytes`);
