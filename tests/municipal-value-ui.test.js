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
});
