'use strict';

function tenantEvidenceScenario(scenario, turn, anchor) {
  const rules = {
    require: [
      'Ich habe dafür',
      'Standort Nord.txt',
      'Standort Nord.csv',
      'Abweichung|weichen|Unterschied',
      'offen|Lücke',
    ],
    forbid: ['nicht hinterlegt', 'Letzte Einordnung'],
    numeric: [
      { value: 80, tolerance: 0 },
      { value: 95, tolerance: 0 },
    ],
  };
  return scenario(
    'document-table',
    '927',
    'Dokument und Tabelle in getrennten Chats abgleichen',
    [
      turn(
        'document',
        'Bitte ablegen.',
        'Dokument im ersten Chat ablegen',
        { require: ['Abgelegt|gespeichert'], casePresent: true },
        {
          chat: 'first',
          dependencies: ['927'],
          document: {
            kind: 'text',
            name: 'Standort Nord.txt',
            text: `# Standort Nord ${anchor}\n## Bestand\nDie Unterlagen nennen einen Bestand von 80 kg.\n## Zuordnung\nDie Zuordnung ist offen.`,
          },
        }
      ),
      turn(
        'table',
        'Bitte speichern.',
        'Tabelle im zweiten Chat speichern',
        { require: ['abgelegt'] },
        {
          chat: 'second',
          dependencies: ['927'],
          document: {
            kind: 'text',
            name: 'Standort Nord.csv',
            text: 'Datum;Bestand (kg)\n2025-01-01;95\n2025-01-02;90\n2025-01-03;80',
          },
        }
      ),
      turn(
        'question',
        `Ordne den Bestand am Standort Nord ${anchor} anhand der Unterlagen und Daten ein.`,
        'Beide Quellen mit Herkunft und Abweichung nennen',
        rules,
        { chat: 'second', dataQuestion: true, dependencies: ['927'] }
      ),
      turn(
        'reference',
        'Was ergibt sich daraus für die bereits vorliegenden Unterlagen?',
        'Bezug aus dem aktuellen Chat mit beiden Quellen beantworten',
        rules,
        { chat: 'second', dataQuestion: true, dependencies: ['927'] }
      ),
      turn(
        'unrelated',
        'Welche Temperatur ist im Depot West belegt?',
        'Keine unpassende Quellenwahl oder Fallzuordnung',
        { forbid: ['Ich habe dafür', 'Das Material passt zu Fall'] },
        { chat: 'unrelated', dependencies: ['927'] }
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
module.exports = { tenantEvidenceScenario };
