'use strict';

// Synthetic department file for the role "Abteilungsleitung Netzwirtschaft" (#986).
// All names, identifiers and amounts are invented; expected answers are derived from the same
// data so fixtures and checks cannot drift apart.
const fs = require('node:fs');
const path = require('node:path');

const TARGET = path.join(__dirname, '../tests/fixtures/netzwirtschaft');
const REFERENCE_DATE = '2026-03-02';
const cents = (value) => Math.round(value * 100) / 100;
const de = (value) =>
  value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csv = (header, rows) =>
  [header.join(';'), ...rows.map((row) => header.map((key) => row[key] ?? '').join(';'))].join(
    '\n'
  ) + '\n';

function invoices() {
  const suppliers = ['Lieferant A', 'Lieferant B', 'Lieferant C'];
  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const id = String(number).padStart(3, '0');
    return {
      Rechnungsnummer: `NNA-SYN-${id}`,
      Marktlokation: `MALO-SYN-${String(1000 + number)}`,
      Lieferant: suppliers[index % suppliers.length],
      Abrechnungszeitraum: `2025-${String((index % 12) + 1).padStart(2, '0')}`,
      Nettobetrag: cents(600 + number * 125),
      Rechnungsdatum: `2026-01-${String(5 + number).padStart(2, '0')}`,
      Faelligkeit: `2026-02-${String(5 + number).padStart(2, '0')}`,
    };
  });
}

// Seeded findings: a short payment, a rejection for an implausible meter reading without
// correction invoice, a rejection that already has its correction, and a missing payment advice.
const SHORT_PAID = 'NNA-SYN-003';
const REJECTED_WITHOUT_CORRECTION = 'NNA-SYN-005';
const REJECTED_WITH_CORRECTION = 'NNA-SYN-008';
const WITHOUT_ADVICE = 'NNA-SYN-011';

function paymentAdvices(bills) {
  return bills
    .filter((bill) => bill.Rechnungsnummer !== WITHOUT_ADVICE)
    .map((bill) => {
      const rejected = [REJECTED_WITHOUT_CORRECTION, REJECTED_WITH_CORRECTION].includes(
        bill.Rechnungsnummer
      );
      const paid =
        bill.Rechnungsnummer === SHORT_PAID
          ? cents(bill.Nettobetrag * 0.4)
          : rejected
            ? 0
            : bill.Nettobetrag;
      return {
        Rechnungsnummer: bill.Rechnungsnummer,
        Avisnummer: bill.Rechnungsnummer.replace('NNA', 'AVIS'),
        Gezahlt: paid,
        Ablehnungsgrund: rejected
          ? 'AG-01 Zählerstand unplausibel'
          : bill.Rechnungsnummer === SHORT_PAID
            ? 'AG-03 Kürzung Zeitraum strittig'
            : '',
      };
    });
}

function meterCorrections() {
  return [
    {
      Korrekturnummer: 'REKO-SYN-01',
      Rechnungsnummer: REJECTED_WITHOUT_CORRECTION,
      Marktlokation: 'MALO-SYN-1005',
      'Zählerstand alt': 48210,
      'Zählerstand neu': 41210,
      Korrekturrechnung: '',
      Status: 'Korrektur erfasst',
    },
    {
      Korrekturnummer: 'REKO-SYN-02',
      Rechnungsnummer: REJECTED_WITH_CORRECTION,
      Marktlokation: 'MALO-SYN-1008',
      'Zählerstand alt': 12950,
      'Zählerstand neu': 12590,
      Korrekturrechnung: 'NNA-SYN-008-K',
      Status: 'Korrekturrechnung versendet',
    },
  ];
}

function complaints() {
  return [
    {
      Reklamation: 'REK-SYN-01',
      Rechnungsnummer: SHORT_PAID,
      Eingang: '2026-02-10',
      Antwortfrist: '2026-02-24',
      Status: 'offen',
    },
    {
      Reklamation: 'REK-SYN-02',
      Rechnungsnummer: REJECTED_WITHOUT_CORRECTION,
      Eingang: '2026-02-12',
      Antwortfrist: '2026-03-12',
      Status: 'in Klärung',
    },
  ];
}

const PROCESSES = [
  { name: 'Lieferantenwechsel', team: 'Netzservice', hours: 20, errors: [3] },
  { name: 'Stammdatenänderung', team: 'Netzservice', hours: 30, errors: [1, 2, 4, 6] },
  { name: 'Rechnungskorrektur', team: 'Netzabrechnung', hours: 160, errors: [2] },
  { name: 'Zählerwechsel', team: 'Gerätemanagement', hours: 50, errors: [5] },
];

function workflowEvents() {
  const rows = [];
  for (const [p, process] of PROCESSES.entries()) {
    for (let index = 1; index <= 6; index++) {
      const id = `WF-SYN-${p + 1}${String(index).padStart(2, '0')}`;
      const start = Date.UTC(2026, 0, 5 + index * 3 + p, 8);
      const total = process.hours + index * 2;
      const failed = process.errors.includes(index);
      const steps = [
        ['Eingang', 0, ''],
        ['Prüfung', Math.round(total * 0.25), failed ? `F-${p + 1}${index}` : ''],
        ...(failed ? [['Klärung', Math.round(total * 0.6), '']] : []),
        ['Abschluss', total, ''],
      ];
      for (const [activity, offset, error] of steps)
        rows.push({
          Vorgang: id,
          Prozess: process.name,
          Team: process.team,
          Aktivität: activity,
          Zeitpunkt: new Date(start + offset * 3600000).toISOString().slice(0, 16),
          Status: activity === 'Abschluss' ? 'abgeschlossen' : 'in Arbeit',
          Fehlercode: error,
        });
    }
  }
  return rows;
}

function makoCases() {
  const base = [
    ['MK-SYN-01', 'UTILMD', 'Z10 ID unbekannt', '2026-02-20', '2026-02-27', 'offen'],
    ['MK-SYN-02', 'UTILMD', 'Z10 ID unbekannt', '2026-02-21', '2026-02-28', 'offen'],
    ['MK-SYN-03', 'MSCONS', 'Z29 Wert unplausibel', '2026-02-24', '2026-03-03', 'offen'],
    ['MK-SYN-04', 'INVOIC', 'Z43 Referenz fehlt', '2026-02-18', '2026-02-25', 'in Klärung'],
    ['MK-SYN-05', 'UTILMD', 'Z10 ID unbekannt', '2026-02-26', '2026-03-05', 'offen'],
    ['MK-SYN-06', 'PRICAT', 'Z43 Referenz fehlt', '2026-02-27', '2026-03-06', 'offen'],
    ['MK-SYN-07', 'MSCONS', 'Z29 Wert unplausibel', '2026-02-10', '2026-02-17', 'erledigt'],
    ['MK-SYN-08', 'UTILMD', 'Z35 Frist überschritten', '2026-02-25', '2026-03-04', 'offen'],
  ];
  const rows = base.map(([id, type, code, received, deadline, status], index) => ({
    Vorgang: id,
    Nachrichtentyp: type,
    Fehlercode: code,
    Eingang: received,
    Frist: deadline,
    Status: status,
    Team: index % 2 ? 'Netzabrechnung' : 'Netzservice',
  }));
  // The export contains one case twice, as clearing lists in practice often do.
  return [...rows, { ...rows[1] }];
}

function expectedValues({ bills, advices, corrections, events, cases }) {
  const paid = new Map(advices.map((advice) => [advice.Rechnungsnummer, advice.Gezahlt]));
  const open = bills
    .map((bill) => ({
      id: bill.Rechnungsnummer,
      amount: cents(bill.Nettobetrag - (paid.get(bill.Rechnungsnummer) ?? 0)),
    }))
    .filter((item) => item.amount > 0);
  const missingCorrection = corrections
    .filter((item) => !item.Korrekturrechnung)
    .map((item) => item.Rechnungsnummer);
  const byCase = new Map();
  for (const event of events) {
    const entry = byCase.get(event.Vorgang) || { process: event.Prozess, times: [], error: false };
    entry.times.push(Date.parse(`${event.Zeitpunkt}:00Z`));
    entry.error ||= Boolean(event.Fehlercode);
    byCase.set(event.Vorgang, entry);
  }
  const processes = PROCESSES.map((process) => {
    const entries = [...byCase.values()].filter((entry) => entry.process === process.name);
    const hours = entries.map(
      (entry) => (Math.max(...entry.times) - Math.min(...entry.times)) / 36e5
    );
    return {
      process: process.name,
      cases: entries.length,
      averageHours: cents(hours.reduce((sum, value) => sum + value, 0) / hours.length),
      errorRate:
        Math.round((entries.filter((entry) => entry.error).length / entries.length) * 10000) /
        10000,
    };
  });
  const unique = [...new Map(cases.map((item) => [item.Vorgang, item])).values()];
  const pending = unique.filter((item) => item.Status !== 'erledigt');
  return {
    referenceDate: REFERENCE_DATE,
    nna: {
      openInvoices: open.map((item) => item.id),
      openAmount: cents(open.reduce((sum, item) => sum + item.amount, 0)),
      shortPaid: { id: SHORT_PAID, openAmount: open.find((item) => item.id === SHORT_PAID).amount },
      rejectedWithoutCorrection: missingCorrection,
      withoutPaymentAdvice: [WITHOUT_ADVICE],
      overdueComplaint: 'REK-SYN-01',
    },
    kpi: {
      processes,
      slowest: [...processes].sort((a, b) => b.averageHours - a.averageHours)[0].process,
      highestErrorRate: [...processes].sort((a, b) => b.errorRate - a.errorRate)[0].process,
    },
    mako: {
      rows: cases.length,
      uniqueCases: unique.length,
      duplicates: [...new Set(cases.map((item) => item.Vorgang))].filter(
        (id) => cases.filter((item) => item.Vorgang === id).length > 1
      ),
      pending: pending.length,
      overdue: pending
        .filter((item) => item.Frist < REFERENCE_DATE)
        .map((item) => item.Vorgang)
        .sort((a, b) => a.localeCompare(b)),
      mostFrequentCode: 'Z10 ID unbekannt',
    },
  };
}

function documents(expected) {
  return {
    'jour-fixe-protokoll.md': `# Jour fixe Netzwirtschaft – Protokoll (synthetisch)

Datum: 2026-02-26 · Teilnehmende: Abteilungsleitung (Vertretung), Teamleitung Netzservice, Teamleitung Netzabrechnung (kommissarisch)

## Offene Entscheidungen
- E-1: Priorisierung der Rechnungskorrekturen vor dem Quartalsabschluss. Vorlage an die Bereichsrunde bis 2026-03-05.
- E-2: Einsatz einer externen Kraft für den Klärfallrückstau der Marktkommunikation. Entscheidung offen, Kostenrahmen fehlt.

## Risiken
- R-1: Rückstau bei Z10-Klärfällen (ID unbekannt) gefährdet Fristen im Lieferantenwechsel.
- R-2: Wissen zur Bilanzierung liegt bei einer erfahrenen Fachkraft mit absehbarem Ruhestand.

## Fristen
- F-1: Antwort auf Reklamation REK-SYN-01 war bis 2026-02-24 fällig.
- F-2: Rollout-Mengenplanung Gerätewechsel für das 2. Quartal bis 2026-03-15.

## Vereinbarte nächste Schritte
- Teamleitung Netzservice prüft die Z10-Fälle und meldet den Stand im nächsten Jour fixe.
`,
    'team-uebersicht.md': `# Abteilung Netzwirtschaft – Teamübersicht (synthetisch)

| Team | Aufgaben | Leitung |
|---|---|---|
| Netzservice & Marktprozesse | Lieferantenwechsel, Stammdaten, Klärfälle der Marktkommunikation | Teamleitung, neu in der Führungsrolle |
| Netzabrechnung | Netznutzungsabrechnung, Reklamationen, Rechnungskorrekturen | vakant, in Personalunion durch die Abteilungsleitung |
| Energiedatenmanagement | Messwertplausibilisierung, Ersatzwerte, Bilanzierungsdaten | direkt durch die Abteilungsleitung |
| Einspeise- & Gerätemanagement | Anlagenstammdaten, Gerätewechsel, Smart-Meter-Rollout | direkt durch die Abteilungsleitung |

Die Abteilung hat 17 Mitarbeitende, darunter zwei externe Kräfte und viele Quereinsteigende.
`,
    'wissensnotiz-bilanzierung.md': `# Wissensnotiz Bilanzierung (synthetisch)

- Vor dem monatlichen Datenversand werden Summenzeitreihen gegen die Vormonatswerte geprüft. Eine Abweichung über 5 % wird vor dem Versand geklärt.
- Ersatzwerte werden nur mit dokumentierter Bildungsregel übernommen.
- Klärungen mit dem Bilanzkreisverantwortlichen laufen über einen festen Ansprechpartner. Der Name steht im Teamordner, nicht hier.
`,
    'leitfaden-marktkommunikation.md': `# Prozessleitfaden Marktkommunikation (synthetisch, neu formuliert)

1. Eine Ablehnung (APERAK) wird erst nach Prüfung der eigenen Stammdaten beantwortet: Existiert die gemeldete Lokation, und stimmt die Zuordnung?
2. Bei "ID unbekannt" wird zuerst die Vertrags- und Zuordnungsbasis geklärt. Erst danach wird erneut gesendet.
3. Preisblatt-Referenzketten werden vor der Rechnungsstellung geprüft. Eine fehlende Referenz führt sonst zu Ablehnungen in der Abrechnung.
4. Massenkorrekturen werden in Tranchen mit Vorher-/Nachher-Abgleich durchgeführt, nie ungeprüft in einem Zug.
5. Rote Linie: Keine Nachricht an Marktpartner ohne Freigabe der zuständigen Person.
`,
    'leitfaden-infrastruktur.md': `# Prozessleitfaden Netz- und Infrastrukturtransformation (synthetisch, neu formuliert)

1. Steuerungsentscheidungen brauchen eine benannte verantwortliche Person, eine Frist und einen Nachweis.
2. Datenstände werden vor Entscheidungen auf Aktualität und Herkunft geprüft.
3. Übergaben an Nachfolge oder Vertretung enthalten offene Punkte, Risiken und Ansprechpartnerrollen.
4. Rote Linie: Keine Budget- oder Personalentscheidungen ohne das zuständige Gremium.
`,
    'README.md': `# Synthetische Abteilungsakte Netzwirtschaft

Erzeugt durch \`node scripts/generate-netzwirtschaft-fixtures.js\` (Prüfung mit \`--check\`). Alle Namen, Kennungen und Beträge sind erfunden. Stichtag: ${expected.referenceDate}.

## Erwartete Antworten

- Offene Netznutzungsrechnungen: ${expected.nna.openInvoices.join(', ')}. Offener Betrag gesamt ${de(expected.nna.openAmount)} €.
- Kürzung: ${expected.nna.shortPaid.id} mit offenem Rest ${de(expected.nna.shortPaid.openAmount)} €.
- Abgelehnt wegen Zählerstand ohne Korrekturrechnung: ${expected.nna.rejectedWithoutCorrection.join(', ')}.
- Ohne Zahlungsavis: ${expected.nna.withoutPaymentAdvice.join(', ')}. Überfällige Reklamationsantwort: ${expected.nna.overdueComplaint}.
- Längste mittlere Durchlaufzeit: ${expected.kpi.slowest}. Höchste Fehlerquote: ${expected.kpi.highestErrorRate}.
${expected.kpi.processes.map((item) => `  - ${item.process}: ${item.cases} Vorgänge, Ø ${de(item.averageHours)} h, Fehlerquote ${de(item.errorRate * 100)} %`).join('\n')}
- MaKo-Klärfälle: ${expected.mako.rows} Zeilen, ${expected.mako.uniqueCases} eindeutige Vorgänge (Dublette ${expected.mako.duplicates.join(', ')}), ${expected.mako.pending} offen, überfällig zum Stichtag: ${expected.mako.overdue.join(', ')}. Häufigster Fehlercode: ${expected.mako.mostFrequentCode}.
`,
  };
}

function generateNetzwirtschaftFixtures() {
  const bills = invoices();
  const advices = paymentAdvices(bills);
  const corrections = meterCorrections();
  const events = workflowEvents();
  const cases = makoCases();
  const expected = expectedValues({ bills, advices, corrections, events, cases });
  return {
    expected,
    files: {
      'nna-rechnungen.csv': csv(Object.keys(bills[0]), bills),
      'nna-zahlungsavise.csv': csv(Object.keys(advices[0]), advices),
      'nna-reklamationen.csv': csv(Object.keys(complaints()[0]), complaints()),
      'zaehlerstandskorrekturen.csv': csv(Object.keys(corrections[0]), corrections),
      'workflow-ereignisse.csv': csv(Object.keys(events[0]), events),
      'mako-klaerfaelle.csv': csv(Object.keys(cases[0]), cases),
      ...documents(expected),
      'expected.json': JSON.stringify(expected, null, 2) + '\n',
    },
  };
}

function writeNetzwirtschaftFixtures({ check = false } = {}) {
  const { files } = generateNetzwirtschaftFixtures();
  if (!check) fs.mkdirSync(TARGET, { recursive: true });
  const stale = Object.entries(files).filter(([name, content]) => {
    const target = path.join(TARGET, name);
    if (check) return !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content;
    fs.writeFileSync(target, content);
    return false;
  });
  return stale.map(([name]) => name);
}

function netzwirtschaftDocument(name) {
  const content = generateNetzwirtschaftFixtures().files[name];
  if (content === undefined) throw new Error(`Unknown department fixture ${name}`);
  return content;
}

if (require.main === module) {
  const stale = writeNetzwirtschaftFixtures({ check: process.argv.includes('--check') });
  if (stale.length) {
    console.error(`Department fixtures stale: ${stale.join(', ')}`);
    process.exitCode = 1;
  }
}

module.exports = {
  REFERENCE_DATE,
  generateNetzwirtschaftFixtures,
  writeNetzwirtschaftFixtures,
  netzwirtschaftDocument,
};
