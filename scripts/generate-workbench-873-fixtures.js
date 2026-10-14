'use strict';

// No source scenarios, customers, people or locations: abstract generated work objects only.
function generateAcceptanceFixture(seed = '873') {
  const suffix = String(seed).replace(/[^a-z\d]/giu, '');
  const system = `Prüfsystem${suffix}`;
  const topic = `Prüfmandat${suffix}`;
  const tenantId = `synthetic-873-${suffix}`;
  const actorId = `synthetic-author-${suffix}`;
  const foreignActor = `synthetic-other-${suffix}`;
  const filename = `Prüftabelle${suffix}.csv`;
  const claim = (text, evidenceIds = []) => ({
    text,
    origin: evidenceIds.length ? 'evidence' : 'input',
    supported: evidenceIds.length ? 'evidence' : 'model',
    completedAction: false,
    specific: false,
    evidenceIds,
  });
  const output = (kind, parts, constraints = []) => ({
    requested: true,
    kind,
    basis: '',
    parts,
    constraints,
    forbiddenTerms: [],
    subjects: [system],
  });
  const parts = (title, sections = [], columns = []) => [
    {
      title,
      sections,
      columns,
      layout: columns.length ? 'table' : sections.length ? 'sections' : 'paragraphs',
    },
  ];
  const scenarios = [
    {
      number: 1,
      message: `Schreibe einen internen Arbeitsauftrag für ${system}. Nummerierte Schritte mit Objekten und Reihenfolge.`,
      output: output('internal', parts('Arbeitsauftrag')),
      content: `1. Öffne den betroffenen Zuordnungsdatensatz in ${system}.\n2. Vergleiche die berichtete Kennung mit der Zuordnung.\n3. Dokumentiere den Unterschied und den offenen Prüfpunkt.`,
    },
    {
      number: 2,
      message:
        'Formuliere zwei Fassungen: Interne Arbeitsdiagnose und Fassung für Geschäftsführung und Linie. Keine Beschluss-/Freigabesprache; die Wörter Beschluss, Freigabe, beschließen, freigeben dürfen nicht vorkommen.',
      output: output(
        'internal',
        [...parts('Interne Arbeitsdiagnose'), ...parts('Fassung für Geschäftsführung und Linie')],
        ['Keine Beschluss-/Freigabesprache']
      ),
      content: `Die berichtete Zuordnung im ${system} ist offen. Als Arbeitsannahme dient ein Unterschied zwischen Eingabe und gespeichertem Objekt. Nächster Schritt ist der Vergleich der beiden Zuordnungen.`,
    },
    {
      number: 3,
      message: 'Fasse das als wiederverwendbares Muster zusammen: Auslöser, Prüfpfad, Grenzen.',
      output: output('internal', parts('Muster', ['Auslöser', 'Prüfpfad', 'Grenzen'])),
      content: `### Auslöser\nEine berichtete Zuordnung im ${system} fehlt.\n\n### Prüfpfad\nEingabe und gespeichertes Objekt vergleichen.\n\n### Grenzen\nDer tatsächliche Bearbeitungsstand bleibt offen.`,
    },
    {
      number: 4,
      message:
        'Erstelle eine Matrix mit Spalten Ergebnis, Annahme, Grenze, offener Punkt, Owner, Frist, nächste Befassung.',
      output: output(
        'table',
        parts(
          'Matrix',
          [],
          ['Ergebnis', 'Annahme', 'Grenze', 'offener Punkt', 'Owner', 'Frist', 'nächste Befassung']
        )
      ),
      content:
        '| Ergebnis | Annahme | Grenze | offener Punkt | Owner | Frist | nächste Befassung |\n| --- | --- | --- | --- | --- | --- | --- |\n| Zuordnung offen | Eingabe weicht ab | Status unbekannt | Vergleich | offen | offen | nach Vergleich |',
    },
    {
      number: 5,
      message: `Wie lässt sich die Verantwortung für ${topic} zwischen Linie und Projekt sinnvoll abgrenzen?`,
    },
    {
      number: 6,
      message: `Ordne die fachliche Antwortpflicht beim Zuordnungsfehler in ${system} ein, ohne Daten abzufragen.`,
    },
    { number: 7, message: `Wie viele Zeilen hat ${filename}?` },
    { number: 8, message: 'Was bedeutet eine Arbeitsannahme bei einer noch offenen Prüfung?' },
    { number: 9, message: 'Welche Rolle hat eine noch offene Annahme?' },
    {
      number: 10,
      message: `Was wissen wir inzwischen zu dem ${topic}-Vorgang? Nenne Stand, offene Punkte, Annahmen, Risiken und nächste Schritte.`,
    },
  ];
  scenarios[0].output.parts[0].layout = 'steps';
  scenarios[1].output.forbiddenTerms = ['Beschluss', 'Freigabe', 'beschließen', 'freigeben'];
  for (const scenario of scenarios) if (scenario.output) scenario.output.basis = scenario.message;
  const workTurns = [
    `Beim manuellen Anlegen im ${system} ist die Prüfkennung unbekannt. Es geht nur um diesen einzelnen Vorgang.`,
    'Die Eingabe wurde manuell übertragen; der genaue Bearbeitungsstand ist unbekannt.',
    'Das betroffene Objekt ist der Zuordnungsdatensatz, kein Kommunikationspartner.',
    'Der Vergleich von Eingabe und gespeichertem Objekt steht noch aus.',
    'Die interne Bearbeitung soll zuerst die Objektzuordnung nachvollziehen und dann den Unterschied dokumentieren.',
  ];
  const caseTurns = [
    `Lege einen Fall zum ${topic} an. Es geht um den Abschluss einer einzelnen Prüfaufgabe und die Abgrenzung der Verantwortung.`,
    'Stand des Vorgangs: Die fachliche Prüfung ist vorbereitet, die Zuständigkeit ist noch offen.',
    'Offener Punkt ist die Zuordnung zwischen Linie und Projekt.',
    'Arbeitsannahme für diesen Vorgang: Das Projekt sammelt den Sachstand, die Linie bewertet die Zuständigkeit.',
    'Risiko dieses Vorgangs: Ohne Zuständigkeit bleibt der nächste Prüfschritt offen.',
    'Nächster Schritt ist ein Vergleich der Aufgabenbeschreibung mit der Rollenbeschreibung.',
    'Ein Ergebnis dieser Gegenüberstellung liegt noch nicht vor.',
    `Fasse den Sachstand des ${topic} kurz zusammen und benenne den nächsten Schritt.`,
  ];
  const noisyLines = [
    'Die vorhandene Abfrage enthält 1 Datensätze.',
    'Die Abfrage umfasst 4 Zeilen. 0 fehlende Zeitintervalle.',
    'Die vorhandene Abfrage enthält 4 Datensätze. Der größte erfasste Wert beträgt 42 kW.',
    'Herkunft: Abgefragte Datenquelle; Abruf 14.10.2026, 12:00.\n\nHerkunft: Abgefragte Datenquelle; Abruf 14.10.2026, 12:00.',
  ];
  const records = [
    {
      id: `ds-${suffix}`,
      tenantId,
      title: `Prüftabelle${suffix}`,
      sourceName: filename,
      current: true,
      semantic: { description: topic, anchors: [topic], units: { value: 'kW' } },
      provenance: { conversationId: `foreign-chat-${suffix}`, actorId: foreignActor },
      period: {},
    },
  ];
  const fact = (index) => ({
    id: `fact-${suffix}-${index}`,
    type: 'tenant_memory_fact',
    tenantId,
    text: `Prüfobjekt${suffix}${index} beeinflusst weitere Arbeiten.`,
    basis: `Prüfobjekt${suffix}${index} beeinflusst weitere Arbeiten.`,
    status: 'valid',
    checking: 'complete',
    anchors: [],
    anchorKeys: [],
    relationIds: [],
    person: { actorId, name: `Prüfperson${suffix}`, functionLabel: 'Prüfung' },
    createdAt: '2026-10-14T10:00:00.000Z',
    sensitivityFlags: [],
    audit: [],
  });
  return {
    system,
    topic,
    tenantId,
    actorId,
    foreignActor,
    filename,
    claim,
    scenarios,
    workTurns,
    caseTurns,
    noisyLines,
    records,
    fact,
    caseSummaryOutput: output(
      'summary',
      parts('Sachstand', ['Stand', 'offene Punkte', 'Annahmen', 'Risiken', 'nächste Schritte'])
    ),
    artifactQuestion: 'Welche Zuordnung liegt vor?',
    shortDraftRequest: 'Entwurf',
    statusQuestion: `Wie ist der Stand bei ${topic}?`,
    resolvedMessage: 'Die Zuordnung zwischen Linie und Projekt ist jetzt geklärt.',
    caseMemory: {
      topic,
      situation: 'Prüfung vorbereitet; Zuständigkeit offen.',
      openQuestions: ['Zuordnung Linie oder Projekt?'],
      workingAssumptions: ['Projekt sammelt Sachstand.'],
      risks: ['Prüfschritt bleibt offen.'],
      nextSteps: ['Aufgaben- und Rollenbeschreibung vergleichen.'],
    },
  };
}

function fixtureSituation(fixture, scenario) {
  return {
    concern: fixture.topic,
    situation: 'Die Zuordnung ist laut Eingabe offen.',
    participants: [],
    identifiers: [],
    deadlines: [],
    hypotheses: [],
    missingInformation: [],
    retrievalTerms: [fixture.topic],
    requestedAction: {
      description: scenario.message,
      externalEffect: false,
      draftRequested: false,
    },
    turnKind: 'work',
    conversationShape: 'task',
    dataNeeds: scenario.number === 7 ? scenario.message : '',
    dataQuestion: {
      requested: scenario.number === 7,
      basis: scenario.number === 7 ? scenario.message : '',
    },
    ...(scenario.output ? { requestedOutput: scenario.output } : {}),
  };
}

function artifactReply(fixture, scenario) {
  return {
    expectation: [],
    interpretation: [],
    nextSteps: [],
    assumptions: [],
    draft: [],
    artifact: scenario.output.parts.map((part) => ({
      title: part.title,
      content: [fixture.claim(scenario.content)],
    })),
  };
}

function acceptanceChecks(scenario, response, fixture) {
  const text = response.responseText || '';
  const checks = {
    nonEmpty: Boolean(text.trim()),
    noFallback: response.answerStatus !== 'fallback' && !response.metadata?.degraded,
  };
  if (scenario.number !== 7)
    checks.noDatasetNoise =
      !/Die vorhandene Abfrage enthält|Die Abfrage umfasst|Der größte erfasste Wert|Herkunft: Abgefragte Datenquelle/iu.test(
        text
      );
  if ([1, 2, 3, 4].includes(scenario.number))
    checks.noLetter =
      !/Guten Tag|Sehr geehrte|Viele Grüße|Mit freundlichen Grüßen|Empfänger\s*:/iu.test(text);
  if (scenario.number === 1)
    Object.assign(checks, {
      numbered: /(?:^|\n)1\.\s/.test(text) && /(?:^|\n)2\.\s/.test(text),
      systemSubject: text.includes(fixture.system),
    });
  if (scenario.number === 2)
    Object.assign(checks, {
      bothVersions:
        /(?:^|\n)#{1,6}\s+Interne Arbeitsdiagnose(?:\n|$)/u.test(text) &&
        /(?:^|\n)#{1,6}\s+(?:Fassung für )?Geschäftsführung und Linie(?:\n|$)/u.test(text),
      noBindingLanguage: !/\b(?:Beschluss|Freigabe|beschließen|freigeben)\b/iu.test(text),
    });
  if (scenario.number === 3)
    checks.exactSections = ['Auslöser', 'Prüfpfad', 'Grenzen'].every((heading) =>
      text.includes(`### ${heading}`)
    );
  if (scenario.number === 4)
    checks.exactColumns = text.includes(
      '| Ergebnis | Annahme | Grenze | offener Punkt | Owner | Frist | nächste Befassung |'
    );
  if ([8, 9].includes(scenario.number)) checks.noNotice = !text.includes('Hinweise für dich:');
  if (scenario.number === 10)
    Object.assign(checks, {
      foundCase: /Fall F-\d+/.test(text),
      topic: text.includes(fixture.topic),
      substantiveMemory: !/nicht hinterlegt/iu.test(text),
      memoryFields: ['Stand', 'Offene Punkte', 'Annahmen', 'Risiken', 'Nächste Schritte'].every(
        (label) => text.toLocaleLowerCase().includes(label.toLocaleLowerCase())
      ),
    });
  return checks;
}

if (require.main === module) {
  const fs = require('node:fs'),
    path = require('node:path');
  const fixture = generateAcceptanceFixture();
  fs.writeFileSync(
    path.join(__dirname, '../tests/fixtures/workbench-873.generated.json'),
    JSON.stringify(
      {
        synthetic: true,
        generator: 'scripts/generate-workbench-873-fixtures.js',
        scenarios: fixture.scenarios,
        workTurns: fixture.workTurns,
        caseTurns: fixture.caseTurns,
        noisyLines: fixture.noisyLines,
      },
      null,
      2
    ) + '\n'
  );
}
module.exports = { generateAcceptanceFixture, fixtureSituation, artifactReply, acceptanceChecks };
