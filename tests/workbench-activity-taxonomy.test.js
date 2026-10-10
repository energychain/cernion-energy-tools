'use strict';

const {
  ACTIVITY_TAXONOMY_VERSION,
  getWorkbenchActivity,
  listWorkbenchActivities,
  matchWorkbenchActivities,
  domainHintsForText,
} = require('../src/workbench-activity-taxonomy');
const { classifyDomain } = require('../src/domain-router');

describe('Workbench Activity Taxonomy (#634)', () => {
  test('exposes required energy utility activity families', () => {
    const activities = listWorkbenchActivities();
    const domains = new Set(activities.map((activity) => activity.domain));

    expect(ACTIVITY_TAXONOMY_VERSION).toMatch(/activity-taxonomy/);
    expect(domains.has('market_communication')).toBe(true);
    expect(domains.has('edm')).toBe(true);
    expect(domains.has('metering_msb')).toBe(true);
    expect(domains.has('market_master_data')).toBe(true);
    expect(domains.has('grid_connection')).toBe(true);
    expect(domains.has('target_grid_planning')).toBe(true);
    expect(domains.has('asset_grid_planning')).toBe(true);
    expect(domains.has('redispatch')).toBe(true);
    expect(domains.has('regulatory_compliance')).toBe(true);
    expect(domains.has('management')).toBe(true);
    expect(domains.has('it_data_vendor_governance')).toBe(true);
    expect(domains.has('m2c_revenue_assurance')).toBe(true);
  });

  test('each activity carries routing, evidence, action and governance metadata', () => {
    for (const activity of listWorkbenchActivities()) {
      expect(activity.activityId).toBeTruthy();
      expect(activity.domain).toBeTruthy();
      expect(activity.examplePrompts.length).toBeGreaterThan(0);
      expect(activity.keywords.length).toBeGreaterThan(0);
      expect(activity.typicalRoles.length).toBeGreaterThan(0);
      expect(activity.requiredEvidence.length).toBeGreaterThan(0);
      expect(activity.allowedActions).toContain('inspect_evidence');
      expect(activity.blockedActions.length).toBeGreaterThan(0);
      expect(Array.isArray(activity.handoffDomains)).toBe(true);
      expect(Array.isArray(activity.capabilityMappings)).toBe(true);
      expect(Array.isArray(activity.receiptMappings)).toBe(true);
      expect(Array.isArray(activity.openApiOperationCandidates)).toBe(true);
      expect(activity.dossierTemplateHint).toBeTruthy();
    }
  });

  test('matches representative MaKo, grid connection and Zielnetzplanung prompts', () => {
    expect(
      matchWorkbenchActivities('APERAK Z18 nach MSCONS Versand prüfen')[0].activity.domain
    ).toBe('market_communication');
    expect(
      matchWorkbenchActivities(
        'Rechenzentrum Anschlussleistung Mittelspannung oder Hochspannung prüfen'
      )[0].activity.domain
    ).toBe('grid_connection');
    expect(
      matchWorkbenchActivities('Zielnetzplanung Produktionsreife Evidence Gate')[0].activity.domain
    ).toBe('target_grid_planning');
  });

  test('domain hints expose safe capability and evidence mappings', () => {
    const hints = domainHintsForText('Lieferbeginn MaLo MeLo UTILMD Stammdaten prüfen');
    const masterData = hints.find((hint) => hint.domain === 'market_master_data');

    expect(masterData).toBeTruthy();
    expect(masterData.requiredEvidence).toEqual(expect.arrayContaining(['utilmd_master_data']));
    expect(masterData.blockedActions).toEqual(
      expect.arrayContaining(['external_message_send', 'masterdata_write_without_review'])
    );
    expect(masterData.capabilityMappings.length).toBeGreaterThan(0);
  });

  test('specific activity lookup returns a cloned object', () => {
    const activity = getWorkbenchActivity('market_communication_clarification');
    activity.keywords.push('mutated');

    expect(getWorkbenchActivity('market_communication_clarification').keywords).not.toContain(
      'mutated'
    );
  });

  test('Domain Router consumes taxonomy hints without replacing capability broker or receipts', async () => {
    const classification = await classifyDomain({
      userRequest:
        'APERAK Z18 nach MSCONS; Lieferbeginn und MaLo/MeLo Stammdatenhistorie müssen geprüft werden.',
    });

    expect(classification.activityHints.map((hint) => hint.activityId)).toEqual(
      expect.arrayContaining(['market_communication_clarification', 'market_master_data'])
    );
    expect(classification.diagnostics.sources.activityTaxonomy).toBe('consulted');
    expect(classification.primaryDomain).toBe('market_communication');
    expect(classification.alternativeDomains.map((d) => d.domain)).toContain('market_master_data');
    expect(classification.responseGuidance).toMatch(/Routing advice only/i);
  });
});
