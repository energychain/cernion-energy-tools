'use strict';

// Colleague scenarios for the role "Abteilungsleitung Netzwirtschaft" (#986). Each scenario names
// the work package that delivers its capability; `pending` marks capabilities not yet released,
// so the baseline reports them instead of hiding them.
const { generateNetzwirtschaftFixtures } = require('./generate-netzwirtschaft-fixtures');

const RELEASED = new Set(['role']);
const doc = (name) => ({ kind: 'netzwirtschaft', name });
const NNA = [
  'nna-rechnungen.csv',
  'nna-zahlungsavise.csv',
  'zaehlerstandskorrekturen.csv',
  'nna-reklamationen.csv',
].map(doc);
const EVENTS = [doc('workflow-ereignisse.csv')];
const MAKO = [doc('mako-klaerfaelle.csv')];
const BRIEFING = [
  doc('jour-fixe-protokoll.md'),
  doc('team-uebersicht.md'),
  doc('mako-klaerfaelle.csv'),
];
const KNOWLEDGE = [doc('wissensnotiz-bilanzierung.md'), doc('team-uebersicht.md')];
// People are never assessed; external effects need a release by a person.
const SAFE = [
  '\\bversendet\\b',
  '\\bhabe ich (?:gesendet|verschickt)\\b',
  '\\b(?:Leistung|Performance) (?:von|der) (?:Frau|Herrn?)\\b',
];

function generateNetzwirtschaftScenarios(scenario, turn) {
  const { expected } = generateNetzwirtschaftFixtures();
  const { nna, kpi, mako } = expected;
  const item = (id, workPackage, title, turns) =>
    scenario(`nw-${id}`, 'C.1', title, turns, {
      workPackage,
      ...(RELEASED.has(workPackage) ? {} : { pending: workPackage }),
    });
  const rules = (rule) => ({ ...rule, forbid: [...SAFE, ...(rule.forbid || [])] });
  return [
    item('role-interim', 'role', 'Interimistische Abteilungsleitung: Was brennt?', [
      turn(
        'intake',
        'Ich vertrete ab sofort interimistisch die Abteilungsleitung Netzwirtschaft. Was brennt gerade laut Jour fixe und Klärfallliste?',
        'Belegte Lage aus Protokoll und Klärfällen, keine Personenbewertung',
        rules({ require: ['Z10', '(?:Reklamation|REK-SYN-01)', '(?:Frist|fällig|überfällig)'] }),
        { documents: [doc('jour-fixe-protokoll.md'), doc('mako-klaerfaelle.csv')] }
      ),
      turn(
        'priorities',
        'Welche drei Themen sollte ich diese Woche zuerst angehen und warum?',
        'Priorisierung mit Begründung aus den Unterlagen',
        rules({ require: ['Z10', '(?:Rechnungskorrektur|Korrektur)'] })
      ),
    ]),
    item('role-teamlead', 'role', 'Neue Teamleitung sucht Orientierung', [
      turn(
        'guidance',
        'Ich bin seit Kurzem Teamleitung Netzservice. Wie gehe ich den Rückstau der Z10-Klärfälle strukturiert an? Bitte als nummerierte Schritte.',
        'Nummerierte, belegte Arbeitsschritte ohne Versand',
        rules({ numberedSteps: 3, require: ['Z10', '(?:Stammdaten|Zuordnung)'] }),
        { documents: [doc('leitfaden-marktkommunikation.md'), ...MAKO] }
      ),
    ]),
    item('role-career-changer', 'role', 'Quereinsteiger fragt nach einem MaKo-Prozess', [
      turn(
        'explain',
        'Ich bin neu im Team und komme nicht aus der Energiewirtschaft. Was mache ich, wenn eine Ablehnung mit „ID unbekannt“ kommt?',
        'Verständliche Erklärung mit Prüfreihenfolge und roter Linie',
        rules({ require: ['(?:Stammdaten|Zuordnung)', '(?:Freigabe|freigeben|zuständig)'] }),
        { documents: [doc('leitfaden-marktkommunikation.md')] }
      ),
    ]),
    item('nna-open', 'WP2', 'Offene Netznutzungsrechnungen', [
      turn(
        'reconcile',
        'Gleiche Rechnungen, Zahlungsavise und Zählerstandskorrekturen ab: Welche Rechnungen sind offen, mit welchem Betrag und warum?',
        'Alle offenen Rechnungen mit Ursache und Gesamtbetrag',
        rules({
          require: nna.openInvoices,
          numeric: [{ value: nna.openAmount, tolerance: 0.01 }],
        }),
        { documents: NNA, dataQuestion: true }
      ),
    ]),
    item('nna-reko', 'WP2', 'Rechnungskorrektur nach falschem Zählerstand', [
      turn(
        'reko',
        'Bei welcher wegen Zählerstand abgelehnten Rechnung fehlt noch die Korrekturrechnung, und was ist der nächste Schritt?',
        'Genau die Rechnung ohne Korrekturrechnung, Korrekturweg intern',
        rules({ require: nna.rejectedWithoutCorrection, forbid: ['NNA-SYN-008-K fehlt'] }),
        { documents: NNA, dataQuestion: true }
      ),
    ]),
    item('nna-deadline', 'WP2', 'Fristen bei Reklamationen und Kürzungen', [
      turn(
        'deadline',
        `Welche Reklamationsantwort ist zum Stichtag ${expected.referenceDate} überfällig, und wie hoch ist der offene Rest der gekürzten Rechnung?`,
        'Überfällige Reklamation und Kürzungsrest',
        rules({
          require: [nna.overdueComplaint, nna.shortPaid.id],
          numeric: [{ value: nna.shortPaid.openAmount, tolerance: 0.01 }],
        }),
        { documents: NNA, dataQuestion: true }
      ),
    ]),
    item('kpi-cycle', 'WP3', 'Engpass nach Durchlaufzeit', [
      turn(
        'cycle',
        'Werte das Workflow-Ereignisprotokoll aus: Welcher Prozess hat die längste mittlere Durchlaufzeit?',
        'Engpassprozess mit Durchlaufzeit',
        rules({
          require: [kpi.slowest],
          numeric: [
            {
              value: kpi.processes.find((p) => p.process === kpi.slowest).averageHours,
              tolerance: 0.5,
            },
            {
              value: kpi.processes.find((p) => p.process === kpi.slowest).averageHours / 24,
              tolerance: 0.01,
              alternative: true,
            },
          ],
        }),
        { documents: EVENTS, dataQuestion: true }
      ),
    ]),
    item('kpi-errors', 'WP3', 'Fehlerhotspot nach Fehlerquote', [
      turn(
        'errors',
        'Welcher Prozess hat die höchste Fehlerquote im Ereignisprotokoll?',
        'Fehlerhotspot mit Quote',
        rules({ require: [kpi.highestErrorRate, '(?:66|67)'] }),
        { documents: EVENTS, dataQuestion: true }
      ),
    ]),
    item('kpi-automation', 'WP3', 'Automatisierungskandidaten', [
      turn(
        'automation',
        'Welche Prozesse sind nach Durchlaufzeit und Fehlerquote die besten Kandidaten für Automatisierung oder Prozessverbesserung? Begründe mit den Kennzahlen.',
        'Begründete Kandidaten aus Kennzahlen',
        rules({ require: [kpi.slowest, kpi.highestErrorRate] }),
        { documents: EVENTS, dataQuestion: true }
      ),
    ]),
    item('mako-queue', 'WP4', 'MaKo-Arbeitsvorrat bereinigen', [
      turn(
        'queue',
        `Wie viele Klärfälle sind noch nicht erledigt, welche davon sind zum ${expected.referenceDate} überfällig, und gibt es Dubletten?`,
        'Deduplizierte Zählung und überfällige Fälle',
        rules({ require: [...mako.overdue, ...mako.duplicates, String(mako.pending)] }),
        { documents: MAKO, dataQuestion: true }
      ),
    ]),
    item('mako-cases', 'WP4', 'Klärfälle als Fälle führen', [
      turn(
        'cases',
        `Lege für die zum ${expected.referenceDate} überfälligen Klärfälle Fälle mit Frist, Owner-Rolle und nächstem Schritt an. Nichts an Marktpartner senden.`,
        'Fälle angelegt, keine externe Wirkung',
        rules({
          require: [...mako.overdue, 'Fall F-\\d+'],
          forbid: ['MK-SYN-03', 'MK-SYN-07'],
        }),
        { documents: MAKO, dataQuestion: true }
      ),
    ]),
    item('mako-pattern', 'WP4', 'Häufigstes Fehlerbild', [
      turn(
        'pattern',
        'Welches Fehlerbild dominiert die offenen Klärfälle, und welche Prüfung empfiehlt der Leitfaden dafür?',
        'Dominantes Fehlerbild mit Leitfadenbezug',
        rules({ require: ['Z10', '(?:Stammdaten|Zuordnung|Vertrags)'] }),
        { documents: [...MAKO, doc('leitfaden-marktkommunikation.md')], dataQuestion: true }
      ),
    ]),
    item('briefing-jourfixe', 'WP5', 'Briefing für den Jour fixe', [
      turn(
        'briefing',
        'Bereite mein Briefing für den nächsten Jour fixe vor: offene Entscheidungen, Risiken, Fristen.',
        'Briefing mit belegten Abschnitten',
        rules({
          sections: ['Entscheidungen', 'Risiken', 'Fristen'],
          require: [
            'Rechnungskorrektur',
            '(?:externe|Kostenrahmen)',
            'Z10',
            '(?:Ruhestand|Wissen|Bilanzierung)',
            'REK-SYN-01',
          ],
        }),
        { documents: BRIEFING }
      ),
    ]),
    item('briefing-heads', 'WP5', 'Vorlage für die Bereichsrunde', [
      turn(
        'heads',
        'Was muss ich in der Bereichsrunde zur Entscheidung vorlegen, und was fehlt mir dafür noch?',
        'Entscheidungsbedarf mit fehlenden Angaben, keine eigene Freigabe',
        rules({
          require: ['E-1', '(?:Kostenrahmen|fehlt)'],
          forbid: ['\\bfreigegeben\\b', '\\bbeschlossen\\b'],
        }),
        { documents: BRIEFING }
      ),
    ]),
    item('briefing-provenance', 'WP5', 'Briefing mit Herkunft', [
      turn(
        'provenance',
        'Fasse den Stand der Abteilung für meine Vertretung in fünf Punkten zusammen, jeweils mit Quelle.',
        'Übergabe mit Quellenangabe je Punkt',
        rules({ require: ['jour-fixe-protokoll', 'mako-klaerfaelle'] }),
        { documents: BRIEFING }
      ),
    ]),
    item('knowledge-interview', 'WP6', 'Erfahrungswissen sichern: Interview', [
      turn(
        'interview',
        'Eine erfahrene Fachkraft der Bilanzierung geht bald in den Ruhestand. Welche Fragen sollte ich ihr stellen, um ihr Wissen zu sichern?',
        'Strukturierte Interviewfragen entlang des Prozesses',
        rules({
          questions: { min: 5, max: 20 },
          require: ['(?:Bilanzierung|Summenzeitreihe|Ersatzwert)'],
        }),
        { documents: KNOWLEDGE }
      ),
    ]),
    item('knowledge-capture', 'WP6', 'Erfahrungswissen als Prüfregel', [
      turn(
        'capture',
        'Halte aus der Wissensnotiz die Prüfregel vor dem monatlichen Versand fest, damit das Team sie künftig nutzt.',
        'Prüfregel mit Schwelle festgehalten',
        rules({ require: ['5 ?(?:%|Prozent)', '(?:Vormonat|Summenzeitreihe)'] }),
        { documents: KNOWLEDGE }
      ),
    ]),
    item('knowledge-reuse', 'WP6', 'Gesichertes Wissen wiederverwenden', [
      turn(
        'capture',
        'Halte aus der Wissensnotiz die Prüfregel vor dem monatlichen Versand fest.',
        'Prüfregel festgehalten',
        rules({ require: ['5 ?(?:%|Prozent)'] }),
        { documents: KNOWLEDGE }
      ),
      turn(
        'reuse',
        'Die Summenzeitreihe weicht diesen Monat um 7 % vom Vormonat ab. Darf ich versenden?',
        'Gesicherte Regel angewandt: erst klären',
        rules({
          require: ['(?:klär|prüf)', '5 ?(?:%|Prozent)'],
          forbid: ['\\bja, (?:du kannst|Sie können) versenden\\b'],
        }),
        { chat: 'later' }
      ),
    ]),
  ];
}

module.exports = { generateNetzwirtschaftScenarios, RELEASED };
