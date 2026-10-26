'use strict';

function realCaseScenarios(scenario, turn) {
  const document = {
    kind: 'text',
    name: 'Arbeitsstand-A.txt',
    text: '# Projekt Nord\n## Bestand\nDer Bestand beträgt 80 kg.\n## Prüfung\nDie Zuordnung ist offen.',
  };
  const role =
    'Ich übernehme die Governance/Aufsicht und soll im Gremium A durch Fragen gezielt aktuelle Probleme und Risiken für das Ergebnis der Organisation A in den kommenden Jahren vermeiden.';
  const roleRules = {
    require: ['Ich richte mich', 'Rolle „Governance/Aufsicht“', 'Auftrag', 'Ziel'],
    forbid: ['Welche Funktion meinst', 'Beobachtung:', 'Hypothese:'],
  };
  const contentRules = {
    require: ['80 kg', 'Zuordnung', 'Arbeitsstand-A'],
    forbid: ['Fall F-[0-9]+:', 'nicht hinterlegt', 'Letzte Einordnung', 'Der Nutzer'],
  };
  return [
    scenario('task-without-role', 'RC3', 'Einarbeitungsauftrag ohne Rollenangabe', [
      turn(
        'pronoun',
        'Ich soll mich in das Thema einarbeiten. Kannst Du mir einen aktuellen Status geben, um was es geht?',
        'Keine Rolle aus Sprecherbezug speichern',
        { ...contentRules, forbid: [...contentRules.forbid, 'Ich richte mich'] },
        { document }
      ),
      turn(
        'sentence',
        'Ich soll mich in das Thema von Projekt Nord einarbeiten. Was kannst Du mir sagen?',
        'Keine Rolle aus ganzem Aufgabensatz speichern',
        { ...contentRules, forbid: [...contentRules.forbid, 'Ich richte mich'] },
        { chat: 'fresh', document }
      ),
    ]),
    scenario('role-before-correction', 'RC3', 'Eigene Rolle vor Funktionskorrektur erkennen', [
      turn('role', role, 'Arbeitskontext sichtbar setzen', roleRules),
    ]),
    scenario('content-before-status', 'RC3', 'Befassung im Arbeitskontext beantworten', [
      turn(
        'distractor',
        'Ordne den Ablauf am Standort West ein.',
        'Eigenständigen anderen Fall anlegen',
        { casePresent: true },
        { chat: 'other' }
      ),
      turn(
        'intake',
        'Ich bin in der Aufsicht für Gremium A. Ordne die Unterlage ein.',
        'Dokument und Arbeitskontext aufnehmen',
        {},
        { document }
      ),
      turn(
        'followup',
        'Die nächste Befassung ist, dass ich mich zunächst mit dem Stand (s. hochgeladenes Dokument) befassen muss. Vor dem nächsten Termin im Gremium kann ich Rückfragen an die beteiligten Autoren stellen, muss aber meine Governance-Fragen im Gremium stellen.',
        'Belegte Fragen an Autoren und Gremium',
        { ...contentRules, require: [...contentRules.require, 'Autoren', 'Gremium'] }
      ),
    ]),
    scenario(
      'table-record-reference',
      'RC3',
      'Tabelle dieses Chats mit vorhandener Akte abgleichen',
      [
        turn(
          'document',
          'Bitte ablegen.',
          'Grundlage im früheren Chat speichern',
          {},
          { chat: 'first', document }
        ),
        turn(
          'table',
          'Zum Thema Projekt Nord habe ich nun folgende Daten aus System A bekommen. Was sagt dies zur Akte?',
          'Neue Tabelle in Beziehung zur Akte setzen',
          {},
          {
            chat: 'second',
            document: {
              kind: 'text',
              name: 'Export-A.csv',
              text: 'Datum;Klasse;Bestand (kg)\n2025-01-01;Gruppe A;40\n2025-01-02;Gruppe B;55\n2025-01-03;Summe;95',
            },
          }
        ),
        turn(
          'reference',
          'Deckt sich dies mit der Akte, die Du bereits hast?',
          'Beide Quellen mit Abweichung, Lücke und Herkunft',
          {
            require: [
              'Ich habe dafür',
              'Arbeitsstand-A',
              'Export-A',
              'Abweichung|weichen|Unterschied',
              'Zuordnung',
            ],
            forbid: ['Anzahl: 3 Zeilen', 'Welche konkreten', 'nicht hinterlegt'],
            numeric: [
              { value: 80, tolerance: 0 },
              { value: 95, tolerance: 0 },
            ],
          },
          { chat: 'second' }
        ),
      ]
    ),
  ].map((item) => ({
    ...item,
    actors: ['a', 'b'].map((id) => ({
      id,
      name: `Sachbearbeitung ${id.toUpperCase()}`,
      role: 'Koordination',
      functionLabel: 'Koordination',
    })),
  }));
}
module.exports = { realCaseScenarios };
