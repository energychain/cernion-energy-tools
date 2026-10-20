'use strict';

function sessionEvidenceScenario(scenario, turn, anchor) {
  const use = {
    require: [
      'Ich habe dafür',
      'aus Fall F-',
      '80 kg',
      'Zuordnung',
      'Gespräch',
      'Zeitpunkt',
      'Fundstelle',
    ],
    forbid: ['nicht hinterlegt', 'Letzte Einordnung', 'Der Benutzer möchte'],
    previousCaseMention: true,
  };
  return scenario(
    'earlier-session',
    '927',
    'Erkenntnis aus älterer Sitzung in neuem Chat nutzen',
    [
      turn(
        'intake',
        `Zum Standort Nord ${anchor}: Der Bestand beträgt 80 kg. Die Zuordnung ist offen. Ordne diese Angaben ein.`,
        'Belegte Einordnung im ersten Chat',
        { casePresent: true, require: ['80 kg'] },
        { chat: 'first' }
      ),
      turn(
        'question',
        `Welche Einordnung zum Bestand am Standort Nord ${anchor} liegt vor?`,
        'Ältere Sitzung mit Herkunft heranziehen',
        use,
        { chat: 'second' }
      ),
      turn(
        'paraphrase',
        `Wie wurde der Bestand für Standort Nord ${anchor} eingeordnet?`,
        'Andere Formulierung mit gleicher Evidenz',
        use,
        { chat: 'second' }
      ),
      turn(
        'unrelated',
        'Welche Temperatur ist im Depot West belegt?',
        'Keine unpassende Sitzung heranziehen',
        { forbid: ['Ich habe dafür', 'Das Material passt zu Fall'] },
        { chat: 'unrelated' }
      ),
      turn(
        'correction',
        'passt nicht',
        'Quellenwahl korrigieren',
        { require: ['Korrektur.*gespeichert'] },
        { chat: 'second' }
      ),
      turn(
        'after-correction',
        `Welche Einordnung zum Bestand am Standort Nord ${anchor} liegt vor?`,
        'Abgelehnte Sitzung später ausschließen',
        { forbid: ['Ich habe dafür', 'Das Material passt zu Fall'] },
        { chat: 'second' }
      ),
      turn(
        'fallback',
        `Ordne die Temperatur im Depot West ${anchor} ein.`,
        'Rückfallantwort im ersten Chat',
        { casePresent: true },
        { chat: 'fallback' }
      ),
      turn(
        'fallback-question',
        `Welche Einordnung zur Temperatur im Depot West ${anchor} liegt vor?`,
        'Rückfallantwort bietet sich nicht an',
        { forbid: ['Ich habe dafür', 'Letzte Einordnung', 'nicht hinterlegt', 'Fall F-[0-9]+:'] },
        { chat: 'after-fallback' }
      ),
    ],
    {
      actors: ['a', 'b'].map((id) => ({
        id,
        name: `Sachbearbeitung ${id.toUpperCase()}`,
        role: 'Koordination',
        functionLabel: 'Koordination',
      })),
    }
  );
}
module.exports = { sessionEvidenceScenario };
