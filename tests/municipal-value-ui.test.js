'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'municipal-value.html'), 'utf8');

describe('municipal-value public UI decision framing', () => {
  it('puts the Stadtrat decision layer before technical analysis', () => {
    expect(html).toContain('Das Wichtigste in 30 Sekunden');
    expect(html).toContain('renderExecutiveDecision(data');
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

    expect(executive).toBeGreaterThan(-1);
    expect(story).toBeGreaterThan(executive);
    expect(energySharing).toBeGreaterThan(story);
    expect(actionOffer).toBeGreaterThan(energySharing);
    expect(appendix).toBeGreaterThan(actionOffer);
    expect(loadProfile).toBeGreaterThan(appendix);
    expect(flex).toBeGreaterThan(appendix);
  });

  it('frames evidence gaps as assignable next proofs, not as a deficit counter', () => {
    expect(html).toContain('Was die Verwaltung jetzt beauftragen kann');
    expect(html).toContain('Diese Liste ist kein Defizitbericht');
    expect(html).toContain('Sinkende Nachweiszahl');
    expect(html).not.toContain('${(data.sourceRows || []).length} Quellen / ${(data.missingEvidence || []).length} offene Punkte');
  });

  it('keeps the executive layer clear and resolves the PV/biomass priority tension', () => {
    expect(html).toContain('Lokale Strom-Teilung prüfen');
    expect(html).toContain('Energy Sharing (§42c)');
    expect(html).not.toContain('§42c-Liegenschaftspilot');
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
    expect(html).toContain('Herkunft: gerundete Marktpreisannahme plus KAV-Proxy');
    expect(html).toContain('Erzeugungswert plus rund');
    expect(html).toContain('Höchster Risikoscore: ${escapeHtml(maxRisk)}/100');
    expect(html).toContain('@media print');
    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('.visual-panel');
  });

  it('uses print-stable disclosure cards and compact budget rows for PDF export', () => {
    expect(html).toContain('<span>§42c-Szenario</span>');
    expect(html).toContain('scenario-meta');
    expect(html).toContain('budget-main-row');
    expect(html).toContain('budget-assumption-row');
    expect(html).not.toContain('<th>Kommunaler Use Case</th>');
    expect(html).not.toContain('<th>Annahme</th>');
  });
});
