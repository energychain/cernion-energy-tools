/**
 * VNB Monitor — Default Alert Thresholds
 *
 * These thresholds define when alerts are triggered in the vnb-monitor service.
 * Can be overridden per deployment via vnb-monitor-alerts.config.json
 *
 * Threshold structure:
 *   - warning: Alert triggers when value exceeds this (or falls below for %)
 *   - critical: Alert triggers when value exceeds this (or falls below for %)
 *
 * For percentages, lower values are worse, so logic is inverted:
 *   - warning: currentValue < warningThreshold → warning
 *   - critical: currentValue < criticalThreshold → critical
 *
 * For weeks/MW, higher values are worse:
 *   - warning: currentValue > warningThreshold → warning
 *   - critical: currentValue > criticalThreshold → critical
 */

module.exports = {
  thresholds: {
    // EWK — Anschlussdauer (weeks)
    'ewk.anschlussdauer.eeNS_weeks': {
      warning: 60,
      critical: 90,
      fieldType: 'weeks',
      inverse: false, // higher = worse
      description: 'Connection time for EE NS (weeks)',
    },
    'ewk.anschlussdauer.verbrauchNS_weeks': {
      warning: 60,
      critical: 100,
      fieldType: 'weeks',
      inverse: false,
      description: 'Connection time for consumption NS (weeks)',
    },
    'ewk.anschlussdauer.eeMS_weeks': {
      warning: 80,
      critical: 120,
      fieldType: 'weeks',
      inverse: false,
      description: 'Connection time for EE MS (weeks)',
    },

    // EWK — Umsetzungsquote (percentages, lower = worse)
    'ewk.umsetzungsquote.eeNS_percent': {
      warning: 60,
      critical: 40,
      fieldType: 'percent',
      inverse: true, // lower = worse
      description: 'EE NS realisation rate (%)',
    },
    'ewk.umsetzungsquote.verbrauchNS_percent': {
      warning: 40,
      critical: 20,
      fieldType: 'percent',
      inverse: true,
      description: 'Consumption NS realisation rate (%)',
    },
    'ewk.umsetzungsquote.verbrauchMS_percent': {
      warning: 95,
      critical: 90,
      fieldType: 'percent',
      inverse: true,
      description: 'Consumption MS realisation rate (%)',
    },

    // EWK — Digitalisierungsindex (percentages, lower = worse)
    'ewk.digitalisierungsindex.gesamt_percent': {
      warning: 25,
      critical: 15,
      fieldType: 'percent',
      inverse: true,
      description: 'Overall digitalization index (%)',
    },
    'ewk.digitalisierungsindex.smartGrids_percent': {
      warning: 10,
      critical: 5,
      fieldType: 'percent',
      inverse: true,
      description: 'Smart grids digitalization (%)',
    },
    'ewk.digitalisierungsindex.kundenportal_percent': {
      warning: 70,
      critical: 50,
      fieldType: 'percent',
      inverse: true,
      description: 'Customer portal digitalization (%)',
    },
    'ewk.digitalisierungsindex.datenmanagement_percent': {
      warning: 50,
      critical: 30,
      fieldType: 'percent',
      inverse: true,
      description: 'Data management digitalization (%)',
    },

    // MaStR — Netzbetreiberprüfung Queue (MW)
    'mastr.netzbetreiberPruefung.leistungMW': {
      warning: 50,
      critical: 100,
      fieldType: 'MW',
      inverse: false,
      description: 'Grid operator verification queue (MW)',
    },

    // MaStR — Planned Capacity Ratio (%)
    'mastr.inPlanung.percentOfInstalledCapacity': {
      warning: 50,
      critical: 100,
      fieldType: 'percent',
      inverse: false,
      description: 'Planned capacity vs. installed (%)',
    },

    // Market — Gas Storage (%)
    'market.gasStorageDE_percent': {
      warning: 30,
      critical: 20,
      fieldType: 'percent',
      inverse: true,
      description: 'German gas storage fill level (%)',
    },
  },

  /**
   * Alert code definitions for message templates and recommendations
   */
  alertCodeDefinitions: {
    ANSCHLUSSDAUER_EE_NS_CRITICAL: {
      severity: 'critical',
      ewkImpact: true,
      recommendation_de:
        'Prozessoptimierung Phase 1 EE-Anschlüsse priorisieren — §118 EnWG Fristen kritisch',
      recommendation_en:
        'Prioritize Phase 1 EE process optimization — §118 EnWG deadlines critical',
    },
    ANSCHLUSSDAUER_EE_NS_WARNING: {
      severity: 'warning',
      ewkImpact: true,
      recommendation_de: 'Anschlussdauer EE NS beobachten — Prozessoptimierung erwägen',
      recommendation_en: 'Monitor EE NS connection time — consider process optimization',
    },
    ANSCHLUSSDAUER_VERBRAUCH_CRITICAL: {
      severity: 'critical',
      ewkImpact: true,
      recommendation_de: 'Prozessanalyse Phase 2 Verbrauchsanschlüsse priorisieren',
      recommendation_en: 'Process analysis: prioritize Phase 2 consumption connection time',
    },
    ANSCHLUSSDAUER_VERBRAUCH_WARNING: {
      severity: 'warning',
      ewkImpact: true,
      recommendation_de: 'Verbrauchsanschlussdauer beobachten — Kapazitäten überprüfen',
      recommendation_en: 'Monitor consumption connection time — review capacity planning',
    },
    UMSETZUNGSQUOTE_EE_NS_CRITICAL: {
      severity: 'critical',
      ewkImpact: true,
      recommendation_de: 'NetzbetreiberPrüfungs-Stau abbauen — §118 EnWG Fristdruck beachten',
      recommendation_en:
        'Reduce grid operator verification backlog — note §118 EnWG deadline pressure',
    },
    UMSETZUNGSQUOTE_EE_NS_WARNING: {
      severity: 'warning',
      ewkImpact: true,
      recommendation_de: 'Umsetzungsquote EE NS überwachen — Prüfungsprozess optimieren',
      recommendation_en: 'Monitor EE NS realisation rate — optimize verification process',
    },
    UMSETZUNGSQUOTE_VERBRAUCH_CRITICAL: {
      severity: 'critical',
      ewkImpact: true,
      recommendation_de: 'Verbrauchsprüfungs-Rückstände abbauen — Kapazitäten ausbauen',
      recommendation_en: 'Clear consumption verification backlog — expand capacity',
    },
    DIGITALISIERUNGSINDEX_CRITICAL: {
      severity: 'critical',
      ewkImpact: true,
      recommendation_de:
        'Digitalisierungsstrategie überarbeiten — Smart-Grid-Investitionen erhöhen',
      recommendation_en: 'Revise digitalization strategy — increase Smart Grid investments',
    },
    PRÜFUNG_QUEUE_CRITICAL: {
      severity: 'critical',
      ewkImpact: false,
      recommendation_de:
        'NetzbetreiberPrüfungs-Backlog reduzieren — Ressourcen allocation überprüfen',
      recommendation_en: 'Reduce grid operator verification backlog — review resource allocation',
    },
    GAS_STORAGE_CRITICAL: {
      severity: 'critical',
      ewkImpact: false,
      recommendation_de: 'Einkaufsstrategie überprüfen — Gasimport-Diversifizierung prüfen',
      recommendation_en: 'Review procurement strategy — assess gas import diversification',
    },
    GAS_STORAGE_WARNING: {
      severity: 'warning',
      ewkImpact: false,
      recommendation_de: 'Gasspeicher-Lage beobachten — Vorbereitungsmaßnahmen einleiten',
      recommendation_en: 'Monitor gas storage situation — initiate preparatory measures',
    },
  },
};
