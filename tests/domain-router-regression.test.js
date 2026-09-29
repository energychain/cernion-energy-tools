'use strict';

const { classifyDomain } = require('../src/domain-router');

const domains = (classification) => [
  classification.primaryDomain,
  ...classification.alternativeDomains.map((d) => d.domain),
];

const expectEvidenceRequiredBoundary = (classification) => {
  expect(classification.readinessState).toBe('evidence_required');
  expect(classification.responseGuidance).toMatch(/never claim approval|binding regulatory/i);
  expect(classification.noCallGuards).toEqual(
    expect.arrayContaining(['approve', 'freigabe', 'buchung', 'binding_regulatory_claim'])
  );
  expect(classification.missingEvidence).toContain('validated_process_evidence');
};

describe('Domain Router utility workflow regression pack (#631)', () => {
  test('MSCONS missing stays an EDM/MaKo/MSB ambiguity with evidence required', async () => {
    const c = await classifyDomain({
      userRequest:
        'Lieferant reklamiert fehlende MSCONS-Zeitreihe; unklar ob EDM-Datenqualität, MaKo-Nachricht oder MSB-Wertelieferung betroffen ist.',
    });

    expect(domains(c)).toEqual(
      expect.arrayContaining(['market_communication', 'edm', 'metering_msb'])
    );
    expect(c.ambiguityFlags).toContain('multiple_strong_domains');
    expect(c.requiredClarifications.join(' ')).toMatch(/fachlichen Fokus klären/i);
    expectEvidenceRequiredBoundary(c);
  });

  test('APERAK Z18 after MSCONS strengthens MaKo and master-data alternatives', async () => {
    const c = await classifyDomain({
      userRequest:
        'EDM-Werte sind vollständig plausibilisiert, MSCONS-Versandjob lief, aber APERAK Z18 liegt vor; am Vortag wurde Lieferbeginn verarbeitet und MaLo/MeLo-Zuordnung geändert.',
    });

    expect(c.primaryDomain).toBe('market_communication');
    expect(domains(c)).toEqual(
      expect.arrayContaining(['market_communication', 'market_master_data', 'edm'])
    );
    expect(c.ambiguityFlags).toContain('multiple_strong_domains');
    expect(c.requiredClarifications.join(' ')).toMatch(/Evidenz|Prozess|Fokus/i);
    expectEvidenceRequiredBoundary(c);
  });

  test('MaLo/MeLo supplier-start master data does not fall into grid asset planning', async () => {
    const c = await classifyDomain({
      userRequest:
        'MaLo MeLo Lieferbeginn Stammdatenänderung UTILMD Zuordnung prüfen, Lieferant reklamiert falsche Zuordnung.',
    });

    expect(domains(c)).toEqual(
      expect.arrayContaining(['market_communication', 'market_master_data'])
    );
    expect(domains(c)).not.toContain('asset_grid_planning');
    expectEvidenceRequiredBoundary(c);
  });

  test('data center regional renewable supply switches to grid connection once connection decision is requested', async () => {
    const c = await classifyDomain({
      userRequest:
        'Rechenzentrum 69256 Mauer: nach regionaler EE-Machbarkeit soll entschieden werden, ob Netzanschluss über Niederspannung, Mittelspannung oder Hochspannung anhand Anschlussleistung erfolgen soll.',
    });

    expect(c.primaryDomain).toBe('grid_connection');
    expect(domains(c)).toContain('grid_connection');
    expectEvidenceRequiredBoundary(c);
  });

  test('target-grid production readiness outranks generic VDMI or asset governance', async () => {
    const c = await classifyDomain({
      userRequest:
        'Zielnetzplanung Produktionsreife Evidence Gate für Ausbaupfad prüfen, keine generische VDMI Asset Validation.',
    });

    expect(c.primaryDomain).toBe('target_grid_planning');
    expect(domains(c)).toContain('target_grid_planning');
    expectEvidenceRequiredBoundary(c);
  });

  test('Redispatch missing call data remains Redispatch/EDM ambiguous without fake resolution', async () => {
    const c = await classifyDomain({
      userRequest:
        'Redispatch Abrufdaten fehlen; EDM-Zeitreihe und Lastgang müssen geprüft werden.',
    });

    expect(domains(c)).toEqual(expect.arrayContaining(['redispatch', 'edm']));
    expect(c.ambiguityFlags).toContain('multiple_strong_domains');
    expect(c.requiredClarifications.length).toBeGreaterThan(0);
    expectEvidenceRequiredBoundary(c);
  });

  test('grid connection vs asset planning boundary keeps connection as leading domain for voltage checks', async () => {
    const c = await classifyDomain({
      userRequest:
        '17 MW Anschlussleistung: Mittelspannung oder Hochspannung als Netzanschluss prüfen, Asset Planung nur als nachgelagerter Kontext.',
    });

    expect(c.primaryDomain).toBe('grid_connection');
    expect(domains(c)).toEqual(expect.arrayContaining(['grid_connection', 'asset_grid_planning']));
    expect(c.ambiguityFlags).toContain('multiple_strong_domains');
    expectEvidenceRequiredBoundary(c);
  });

  test('management governance dossier remains evidence-required and non-binding', async () => {
    const c = await classifyDomain({
      userRequest:
        'Management Lage Dossier für Governance vorbereiten, aber ohne validierte Evidenz keine Freigabe oder Beschluss behaupten.',
    });

    expect(c.primaryDomain).toBe('management');
    expectEvidenceRequiredBoundary(c);
  });
});
