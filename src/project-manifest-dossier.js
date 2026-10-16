'use strict';

function projectSourceInstructions(evidence, selection) {
  const titles = [
    ...new Set(
      [selection?.title, ...evidence.map((entry) => entry.metadata?.projectTitle)].filter(Boolean)
    ),
  ];
  if (!titles.length) return [];
  return [
    ...titles.map(
      (title) =>
        `- Aktenwahl sichtbar formulieren: Ich habe dafür die Projektakte „${title}“ herangezogen.`
    ),
    '- Teilantworten mit getrennter Herkunft formulieren: Aus Projektakte …; aus der jeweiligen Katalogquelle … . Datei, Fundstelle und Hash erhalten.',
    '- Manifestinhalte sind nur Kandidaten. Jede Zahl muss aus der Abfrage oder gelesenen Passage stammen. Konkrete Lücken benennen; keine Schätzung.',
  ];
}

module.exports = { projectSourceInstructions };
