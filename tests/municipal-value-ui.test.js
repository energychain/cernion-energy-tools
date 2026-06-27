'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'municipal-value.html'), 'utf8');

describe('municipal-value public UI decision framing', () => {
  it('puts the Stadtrat decision layer before technical analysis', () => {
    expect(html).toContain('Das Wichtigste in 30 Sekunden');
    expect(html).toContain('renderExecutiveDecision(data');
    expect(html).toContain('renderLocationIdentity(data)');
    expect(html).toContain('renderLocalValueStory(data');
    expect(html).toContain('renderActionEvidence(data)');
    expect(html).toContain('Analyse und Referenz öffnen');

    const renderStart = html.indexOf('results.innerHTML = `');
    const renderBlock = html.slice(renderStart);
    const executive = renderBlock.indexOf('renderExecutiveDecision(data');
    const story = renderBlock.indexOf('renderLocalValueStory(data');
    const energySharing = renderBlock.indexOf('renderEnergySharingCommunities(data)');
    const actionOffer = renderBlock.indexOf('renderActionEvidence(data)');
    const appendix = renderBlock.indexOf('Analyse und Referenz öffnen');
    const loadProfile = renderBlock.indexOf('renderTimeSeriesInsight(data)');
    const flex = renderBlock.indexOf('renderFlexibilityScenarios(data)');
    const intermunicipal = renderBlock.indexOf('renderIntermunicipalComparison(data)');

    expect(executive).toBeGreaterThan(-1);
    expect(story).toBeGreaterThan(executive);
    expect(energySharing).toBeGreaterThan(story);
    expect(actionOffer).toBeGreaterThan(energySharing);
    expect(appendix).toBeGreaterThan(actionOffer);
    expect(intermunicipal).toBeGreaterThan(appendix);
    expect(intermunicipal).toBeLessThan(loadProfile);
    expect(loadProfile).toBeGreaterThan(appendix);
    expect(flex).toBeGreaterThan(appendix);
  });

  it('frames evidence gaps as assignable next proofs, not as a deficit counter', () => {
    expect(html).toContain('Was die Verwaltung jetzt beauftragen kann');
    expect(html).toContain('Diese Liste ist kein Defizitbericht');
    expect(html).toContain('Sinkende Nachweiszahl');
    expect(html).toContain('beauftragbare Nachweise sind noch offen');
    expect(html).not.toContain('${(data.sourceRows || []).length} Quellen / ${(data.missingEvidence || []).length} offene Punkte');
  });

  it('keeps the executive layer clear and resolves the PV/biomass priority tension', () => {
    expect(html).toContain('Lokale Strom-Teilung prüfen');
    expect(html).toContain('Energy Sharing (§42c)');
    expect(html).not.toContain('§42c-Liegenschaftspilot');
    expect(html).toContain('location-identity');
    expect(html).toContain('Ausgewerteter Ort');
    expect(html).toContain('["PLZ", data.postalCode || (data.postalCodes || [])[0]]');
    expect(html).toContain('["Bundesland", data.state]');
    expect(html).toContain('["AGS", data.ags]');
    expect(html).toContain('Warum PV trotz Biomasse-Signal priorisiert wird');
    expect(html).toContain('PV wird priorisiert, weil absoluter Wert, Dachflächenlogik und politische Umsetzbarkeit am höchsten sind');
    expect(html).toContain('Biomasse passt zeitlich besser zum Verbrauch');
    expect(html).toContain('mit derselben Marktwertannahme wie Tabelle und Diagramm');
    expect(html).toContain('Erzeugungswert EUR/Jahr');
  });

  it('keeps storage/flex as proof paths instead of speculative euro scenario tables', () => {
    expect(html).toContain('keine Euro-Szenarien');
    expect(html).toContain('Solange der Speicherbestand nicht belegt ist');
    expect(html).toContain('scenario-card');
    expect(html).not.toContain('des nicht zeitgleichen Werts</td>');
  });

  it('keeps timing and rounded-number source notes attached to repeated claims', () => {
    expect(html).toContain('Seit 01.06.2026 im VNB-Gebiet möglich');
    expect(html).toContain('Herkunft: gerundete Marktpreisannahme plus KAV-Mischwert');
    expect(html).toContain('Erzeugungswert plus rund');
    expect(html).toContain('Höchster Risikoscore: ${escapeHtml(maxRisk)}/100, aktuell ${escapeHtml(riskLevelText(maxRisk))}');
    expect(html).toContain('if (value >= 70) return "hohes Gesamtrisiko"');
    expect(html).toContain('Handlungsoption statt Ohnmacht');
    expect(html).toContain('Übersetzerrolle zum Netzbetreiber');
    expect(html).toContain('Eine fachliche Prozessbegleitung bereitet Anschlussfälle');
    expect(html).not.toContain('STROMDAO GmbH als Übersetzer zum Netzbetreiber');
    expect(html).toContain('function renderGridOperatorBridge(data, riskRows)');
    expect(html).toContain('@media print');
    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('.visual-panel');
    expect(html).toContain('Dieser Wert ist nicht als direkte Haushaltseinnahme zu lesen.');
    expect(html).toContain('function householdTranslationText()');
    expect(html).toContain('Die Spanne ist kein frei verfügbares Haushaltsgeld');
    expect(html).toContain('Stromkostenentlastung kommunaler Liegenschaften; standortpolitisch über Pacht, Gewerbesteuerlokalität und lokale Aufträge');
    expect(html).toContain('<strong>Haushaltsklarheit:</strong>');
    expect(html).not.toContain('€,\\n              nicht als direkte Haushaltseinnahme');
    expect(html).toContain('Welche Erzeugung bringt den größten lokalen Wert?');
    expect(html).not.toContain('Welche Erzeugung erzeugt Erzeugungswert?');
  });

  it('keeps generation integrity warning consolidated instead of repeating defensive copy', () => {
    expect(html).toContain('function generationIntegrityWarning(data)');
    expect(html).toContain('function renderGenerationIntegrityNotice(data, compact = false)');
    expect(html).toContain('Erzeugungswerte vor politischer Nutzung prüfen');
    expect(html).toContain('Die erzeugungsabhängigen Euro-Spannen bleiben sichtbar');
    expect(html).toContain('key.includes("integrity") || key.includes("review")');
    expect(html).toContain('Gegenprüfung offen');
    expect(html).not.toContain('methodischer Erzeugungswert');
    expect(html).not.toContain('methodischer Prüfwert');
    expect(html).not.toContain('methodische Prüfwerte');
    expect(html).toContain('ca. ${euro(low)} bis ${euro(high)}');
    expect(html).toContain('function budgetRangeFromRows(rows, row)');
  });

  it('shows the sector split as a single OSM/MaStR backend evidence path', () => {
    expect(html).toContain('const sectorEvidence = (data.sectorEvidenceRows || []).find');
    expect(html).toContain('Sektor-Split:</strong>');
    expect(html).toContain('kein OSM-/MaStR-verifizierter Ortsmix');
    expect(html).toContain('Nächster Backend-Nachweis');
  });

  it('uses print-stable disclosure cards and compact budget rows for PDF export', () => {
    expect(html).toContain('<span>§42c-Szenario</span>');
    expect(html).toContain('<span>Erzeugung</span>');
    expect(html).toContain('<b>Zeitgleicher Beitrag:</b>');
    expect(html).toContain('scenario-meta');
    expect(html).toContain('budget-main-row');
    expect(html).toContain('budget-assumption-row');
    expect(html).not.toContain('<th>Kommunaler Use Case</th>');
    expect(html).not.toContain('<th>Annahme</th>');
    expect(html).not.toContain('<th>Zeitgleicher Euro-Beitrag</th>');
  });

  it('renders intermunicipal comparison once in the reference layer with guardrail fallback', () => {
    expect(html).toContain('function renderIntermunicipalComparison(data)');
    expect(html).toContain('data-section="intermunicipal-comparison"');
    expect(html).toContain('comparison.status !== "available"');
    expect(html).toContain('Der Vergleich wird erst gezeigt, wenn AGS, Einwohner, Haushalte');
    expect(html).toContain('Einwohnerkorridor:');
    expect(html).toContain('Siedlungsstruktur:');
    expect(html).toContain('n =');
    expect(html).toContain('Die Vergleichsorte bleiben im Standard anonymisiert');
    expect(html).toContain('function comparisonAxis(row)');
    expect(html).toContain('function comparisonBandStyle(row)');
    expect(html).toContain('comparison-peer-band');
    expect(html).toContain('data-label="${escapeHtml(data.municipality || "Ort")}"');

    const renderStart = html.indexOf('results.innerHTML = `');
    const renderBlock = html.slice(renderStart);
    const calls = renderBlock.match(/renderIntermunicipalComparison\(data\)/g) || [];
    expect(calls).toHaveLength(1);

    const executive = renderBlock.indexOf('renderExecutiveDecision(data');
    const intermunicipal = renderBlock.indexOf('renderIntermunicipalComparison(data)');
    expect(intermunicipal).toBeGreaterThan(executive);
  });
});
