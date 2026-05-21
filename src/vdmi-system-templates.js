'use strict';

/**
 * VDMI System Templates - Anonymized Governance Patterns
 *
 * This module exports 5+ pre-defined, anonymized governance templates
 * for systemwide VDMI seeding. All templates are:
 * - Fully anonymized (no real customer/stakeholder data)
 * - Role-based with generic actor categories
 * - Stable across versions (idempotent seeding)
 * - Designed for Option B versioned upsert (templateVersion-aware updates)
 *
 * Use cases:
 * 1. Grid Connection Approval (PV plant, NAV §8)
 * 2. Energy Sharing Collective (neighborhood asset swap)
 * 3. Portfolio Gating Decision (redispatch enrollment)
 * 4. Substation Load Assessment (capacity bottleneck)
 * 5. Redispatch Participation Confirmation (Redispatch 2.0)
 */

const SYSTEM_TEMPLATES = [
  {
    id: 'grid-connection-approval-pv',
    templateVersion: 1,
    isSystem: true,
    originTenant: '*',
    name: 'Grid Connection Approval (PV Plant)',
    scope: '§8 NAV Netzanschlussprozess, anonymisiert',
    processType: 'grid-connection-governance',
    assetCategory: 'solar',
    description:
      'Standardisierte Governance für Netzanschlussbegehren PV-Anlage. Role-basiert, keine Kundendaten.',
    regulatoryBasis: ['§8 NAV', '§11 EnWG'],
    tasks: [
      {
        taskId: 'formal-review',
        taskName: 'Formale Antragsprüfung',
        phase: 'intake',
        assetClass: 'pv_plant',
        assetId: 'PV_Asset_North',
        verantwortlich: [{ actorType: 'role', actorId: 'DSO_GATEKEEPER' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'APPLICATION_ADMIN' }],
        mitwirkend: [{ actorType: 'role', actorId: 'COMPLIANCE_ANALYST' }],
        information: [{ actorType: 'role', actorId: 'APPLICANT_NOTARY' }],
        evidenceRequirements: [
          { id: 'begehren-form', label: 'Formales Begehren § 11 (Vorlage)', type: 'document' },
          { id: 'grid-map', label: 'Netzplan Auszug', type: 'document' },
          { id: 'technical-spec', label: 'Technische Spezifikation', type: 'datasheet' },
        ],
        forbiddenAssumptions: ['Keine Anschlusszusage ohne vollständige formale Dokumentation.'],
        allowedOptions: [
          {
            id: 'approve-standard',
            title: 'Standardprozess bewilligen',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
          {
            id: 'require-investigation',
            title: 'Technische Untersuchung erforderlich',
            impact: { risk: 'medium', cost: 'high', time: 'long' },
          },
        ],
        nextActions: [
          {
            id: 'check-formal-completeness',
            type: 'collect_evidence',
            label: 'Formale Vollständigkeit prüfen',
          },
        ],
      },
      {
        taskId: 'network-operator-decision',
        taskName: 'Verbindliche Anschlusszusage',
        phase: 'decision',
        assetClass: 'pv_plant',
        assetId: 'PV_Asset_North',
        verantwortlich: [{ actorType: 'role', actorId: 'DSO_DECISION_MAKER' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'ASSET_OWNER' }],
        mitwirkend: [{ actorType: 'role', actorId: 'PLANNING_AUTHORITY' }],
        information: [{ actorType: 'role', actorId: 'NEIGHBORS_REGISTRY' }],
        evidenceRequirements: [
          {
            id: 'bkz-bescheid',
            label: 'BKZ-Bescheid / Verbindliche Netzanschlusszusage',
            type: 'bescheid',
          },
        ],
        forbiddenAssumptions: [
          'Keine verbindliche Finanzierungsfreigabe ohne BKZ-Bescheid / Netzanschlusszusage.',
        ],
        allowedOptions: [
          {
            id: 'collect-formal-evidence',
            title: 'Formale Evidenz beschaffen',
            impact: { risk: 'medium', cost: 'low', time: 'short' },
          },
          {
            id: 'escalate-to-dso-board',
            title: 'Eskalation an DSO-Geschäftsführung',
            impact: { risk: 'high', cost: 'low', time: 'long' },
          },
        ],
        nextActions: [
          {
            id: 'collect-bkz-bescheid',
            type: 'collect_evidence',
            label: 'BKZ-Bescheid einholen.',
          },
        ],
      },
    ],
  },
  {
    id: 'energy-sharing-collective-approval',
    templateVersion: 1,
    isSystem: true,
    originTenant: '*',
    name: 'Energy Sharing Collective Approval',
    scope: 'Nachbarschaftliche Strombilanzgruppe, anonymisiert',
    processType: 'energy-sharing-governance',
    assetCategory: 'energy_sharing',
    description:
      'Governance für Energieteile-Vereinbarung innerhalb Quartier/Liegenschaft. Role-basiert, ohne Kundenidentifikation.',
    regulatoryBasis: ['§21 Abs. 2 EnWG', 'MESRL', '§42 EnWG'],
    tasks: [
      {
        taskId: 'collective-design-review',
        taskName: 'ESG-Design-Review',
        phase: 'design',
        assetClass: 'energy_sharing_collective',
        assetId: 'ESG_Quartier_Alpha',
        verantwortlich: [{ actorType: 'role', actorId: 'ESG_OPERATOR' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'METERING_PROVIDER' }],
        mitwirkend: [{ actorType: 'role', actorId: 'BALANCING_AUTHORITY' }],
        information: [{ actorType: 'role', actorId: 'END_USE_CONSUMERS' }],
        evidenceRequirements: [
          {
            id: 'esg-contract-template',
            label: 'ESG-Vertrag (anonymisierte Vorlage)',
            type: 'contract',
          },
          { id: 'meter-config', label: 'Messkonfiguration', type: 'technical_spec' },
          { id: 'billing-rules', label: 'Abrechnungsregeln', type: 'business_rules' },
        ],
        forbiddenAssumptions: [
          'ESG kann nicht ohne vollständige Messkonfiguration starten.',
          'Keine bilanzielle Freigabe vor Validierung der Vertragsausfertigung.',
        ],
        allowedOptions: [
          {
            id: 'deploy-standard-esg',
            title: 'Standard-ESG starten',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
          {
            id: 'pilot-special-rules',
            title: 'Pilotphase mit Custom Rules',
            impact: { risk: 'high', cost: 'high', time: 'long' },
          },
        ],
        nextActions: [
          {
            id: 'validate-meter-config',
            type: 'collect_evidence',
            label: 'Messkonfiguration technisch validieren.',
          },
        ],
      },
      {
        taskId: 'collective-settlement-approval',
        taskName: 'Bilanzielle Freigabe',
        phase: 'settlement',
        assetClass: 'energy_sharing_collective',
        assetId: 'ESG_Quartier_Alpha',
        verantwortlich: [{ actorType: 'role', actorId: 'BALANCING_AUTHORITY' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'ESG_OPERATOR' }],
        mitwirkend: [{ actorType: 'role', actorId: 'CLEARING_HOUSE' }],
        information: [{ actorType: 'role', actorId: 'TSO_MONITOR' }],
        evidenceRequirements: [
          {
            id: 'settlement-report',
            label: 'Abrechnungsbericht (1 Monat Live)',
            type: 'report',
          },
          { id: 'deviation-log', label: 'Abweichungslog', type: 'log' },
        ],
        forbiddenAssumptions: ['Keine dauerhafte Freigabe ohne 1 Monat fehlerfreier Abrechnung.'],
        allowedOptions: [
          {
            id: 'approve-permanent',
            title: 'Permanente Genehmigung erteilen',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
          {
            id: 'extend-pilot',
            title: 'Pilotphase verlängern',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
        ],
        nextActions: [
          {
            id: 'review-settlement-data',
            type: 'collect_evidence',
            label: 'Abrechnungsdaten reviewen.',
          },
        ],
      },
    ],
  },
  {
    id: 'portfolio-gating-redispatch',
    templateVersion: 1,
    isSystem: true,
    originTenant: '*',
    name: 'Portfolio Gating Decision (Redispatch)',
    scope: 'Direktvermarktungs-Portfolio Freigabe, anonymisiert',
    processType: 'portfolio-governance',
    assetCategory: 'renewable_portfolio',
    description:
      'Governance für Aufnahme/Entfernung aus Redispatch 2.0 Portfolio. Role-basiert, keine Kundenidentifikation.',
    regulatoryBasis: ['§4 Abs. 5 AusglMechV', 'Redispatch 2.0 UMsV'],
    tasks: [
      {
        taskId: 'portfolio-capacity-check',
        taskName: 'Kapazitätscheck Portfolio',
        phase: 'intake',
        assetClass: 'renewable_portfolio',
        assetId: 'Portfolio_Mix_East',
        verantwortlich: [{ actorType: 'role', actorId: 'PORTFOLIO_MANAGER' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'DMS_SYSTEM' }],
        mitwirkend: [{ actorType: 'role', actorId: 'TSO_ADVISORY' }],
        information: [{ actorType: 'role', actorId: 'GRID_OPERATOR' }],
        evidenceRequirements: [
          {
            id: 'capacity-report',
            label: 'Kapazitätsnachweis aktuell',
            type: 'report',
          },
          {
            id: 'portfolio-contract',
            label: 'Direktvermarktungsvertrag',
            type: 'contract',
          },
        ],
        forbiddenAssumptions: [
          'Keine neue Aufnahme ohne aktuellen Kapazitätsnachweis.',
          'Portfolio-Aggregation muss auf aktuellen Marktdaten basieren.',
        ],
        allowedOptions: [
          {
            id: 'enroll-portfolio',
            title: 'Portfolio in Redispatch 2.0 aufnehmen',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
          {
            id: 'defer-to-next-round',
            title: 'Auf nächste Ausschreibungsrunde verschieben',
            impact: { risk: 'low', cost: 'low', time: 'medium' },
          },
        ],
        nextActions: [
          {
            id: 'verify-capacity',
            type: 'collect_evidence',
            label: 'Kapazitätsnachweis mit aktuellen Daten verifizieren.',
          },
        ],
      },
      {
        taskId: 'portfolio-settlement-validation',
        taskName: 'Abrechnungsvalidierung',
        phase: 'settlement',
        assetClass: 'renewable_portfolio',
        assetId: 'Portfolio_Mix_East',
        verantwortlich: [{ actorType: 'role', actorId: 'PORTFOLIO_MANAGER' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'DMS_SYSTEM' }],
        mitwirkend: [{ actorType: 'role', actorId: 'MARKET_ANALYST' }],
        information: [{ actorType: 'role', actorId: 'BNETZAGENCY' }],
        evidenceRequirements: [
          {
            id: 'settlement-export',
            label: 'Abrechnung Export (last 3 months)',
            type: 'export',
          },
          {
            id: 'deviation-report',
            label: 'Abweichungsbericht',
            type: 'report',
          },
        ],
        forbiddenAssumptions: ['Keine Auszahlung ohne validierter Abrechnung.'],
        allowedOptions: [
          {
            id: 'approve-settlement',
            title: 'Abrechnung freigeben',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
          {
            id: 'flag-for-audit',
            title: 'Zur Audit-Prüfung markieren',
            impact: { risk: 'medium', cost: 'high', time: 'long' },
          },
        ],
        nextActions: [
          {
            id: 'export-settlement-data',
            type: 'collect_evidence',
            label: 'Abrechnungsdaten exportieren und validieren.',
          },
        ],
      },
    ],
  },
  {
    id: 'substation-load-assessment',
    templateVersion: 1,
    isSystem: true,
    originTenant: '*',
    name: 'Substation Load Assessment',
    scope: 'Kapazitätsengpass-Bewertung, anonymisiert',
    processType: 'grid-capacity-governance',
    assetCategory: 'infrastructure',
    description:
      'Governance für Bewertung von Transformator-Engpässen. Role-basiert, keine Substations-Identifikation.',
    regulatoryBasis: ['TAR Netz', 'Verteilnetzkodex', 'EnWG §14a'],
    tasks: [
      {
        taskId: 'load-data-collection',
        taskName: 'Lastdaten-Sammlung',
        phase: 'assessment',
        assetClass: 'substation_trf',
        assetId: 'Substation_A_TRF_110-30',
        verantwortlich: [{ actorType: 'role', actorId: 'NETWORK_ENGINEER' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'EXPANSION_PLANNING' }],
        mitwirkend: [{ actorType: 'role', actorId: 'REGIONAL_AUTHORITY' }],
        information: [{ actorType: 'role', actorId: 'DISTRIBUTION_CUSTOMERS' }],
        evidenceRequirements: [
          { id: 'load-profile-3m', label: 'Lastprofil letzte 3 Monate', type: 'timeseries' },
          { id: 'forecast-12m', label: '12-Monats-Prognose', type: 'forecast' },
          { id: 'capex-estimate', label: 'CAPEX-Schätzung Netzausbau', type: 'cost_estimate' },
        ],
        forbiddenAssumptions: ['Keine Entlastungsmaßnahmen ohne aktuelles Last-/Prognose-Profil.'],
        allowedOptions: [
          {
            id: 'expand-substation',
            title: 'Transformator-Erweiterung planen',
            impact: { risk: 'low', cost: 'high', time: 'long' },
          },
          {
            id: 'implement-flexibility',
            title: 'Flex-/Speicher-Maßnahmen priorisieren',
            impact: { risk: 'low', cost: 'medium', time: 'short' },
          },
          {
            id: 'defer-decision',
            title: 'Entscheidung verschieben (weitere Daten)',
            impact: { risk: 'medium', cost: 'low', time: 'medium' },
          },
        ],
        nextActions: [
          {
            id: 'collect-load-data',
            type: 'collect_evidence',
            label: 'Aktuelle Lastdaten sammeln und analysieren.',
          },
        ],
      },
      {
        taskId: 'expansion-decision',
        taskName: 'Ausbauentscheidung',
        phase: 'decision',
        assetClass: 'substation_trf',
        assetId: 'Substation_A_TRF_110-30',
        verantwortlich: [{ actorType: 'role', actorId: 'NETWORK_ENGINEER_LEAD' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'PROCUREMENT' }],
        mitwirkend: [{ actorType: 'role', actorId: 'FINANCE' }],
        information: [{ actorType: 'role', actorId: 'REGULATORY_AFFAIRS' }],
        evidenceRequirements: [
          {
            id: 'expansion-plan',
            label: 'Detaillierter Ausbauprojekt-Plan',
            type: 'plan',
          },
          {
            id: 'budget-approval',
            label: 'Budget-Genehmigung',
            type: 'approval',
          },
        ],
        forbiddenAssumptions: ['Keine Ausschreibung ohne Budget-Freigabe.'],
        allowedOptions: [
          {
            id: 'proceed-with-expansion',
            title: 'Ausbau durchführen',
            impact: { risk: 'medium', cost: 'high', time: 'long' },
          },
          {
            id: 'pilot-flex-measures',
            title: 'Flex-Maßnahmen-Pilot starten',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
        ],
        nextActions: [
          {
            id: 'start-tender',
            type: 'collect_evidence',
            label: 'Ausschreibung vorbereiten.',
          },
        ],
      },
    ],
  },
  {
    id: 'redispatch-participation-confirmation',
    templateVersion: 1,
    isSystem: true,
    originTenant: '*',
    name: 'Redispatch Participation Confirmation',
    scope: 'Redispatch 2.0 Teilnahmebestätigung, anonymisiert',
    processType: 'redispatch-enrollment',
    assetCategory: 'renewable_installation',
    description:
      'Governance für Enrollment/Withdrawal aus Redispatch 2.0 Maßnahmenkatalog. Role-basiert, keine Installationsdaten.',
    regulatoryBasis: ['§4 Abs. 3a AusglMechV', 'Redispatch 2.0 UmsV', 'EnLAG'],
    tasks: [
      {
        taskId: 'enrollment-eligibility-check',
        taskName: 'Teilnahmefähigkeit prüfen',
        phase: 'intake',
        assetClass: 'wind_or_pv_plant',
        assetId: 'RD2_Installation_North',
        verantwortlich: [{ actorType: 'role', actorId: 'REDISPATCH_OPERATOR' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'INSTALLATION_OWNER' }],
        mitwirkend: [{ actorType: 'role', actorId: 'MARKET_ANALYST' }],
        information: [{ actorType: 'role', actorId: 'BNETZAGENCY' }],
        evidenceRequirements: [
          {
            id: 'installation-data',
            label: 'Installationsdaten (MaStR-Export)',
            type: 'registry_export',
          },
          {
            id: 'control-capability',
            label: 'Fernsteuerbarkeitsprüfung',
            type: 'technical_assessment',
          },
          { id: 'grid-location', label: 'Netzausstiegsleitung', type: 'technical_spec' },
        ],
        forbiddenAssumptions: [
          'Keine Redispatch-Teilnahme ohne Fernsteuerungsfähigkeit.',
          'Nur Anlagen ≥100 kW sind eligible.',
        ],
        allowedOptions: [
          {
            id: 'approve-enrollment',
            title: 'Zur Redispatch 2.0 anmelden',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
          {
            id: 'defer-for-upgrade',
            title: 'Fernsteuerung aufrüsten, dann anmelden',
            impact: { risk: 'low', cost: 'high', time: 'long' },
          },
          {
            id: 'reject-ineligible',
            title: 'Ablehnung (zu klein / ungeeigent)',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
        ],
        nextActions: [
          {
            id: 'verify-control',
            type: 'collect_evidence',
            label: 'Fernsteuerbarkeitsprüfung durchführen.',
          },
        ],
      },
      {
        taskId: 'redispatch-operational-readiness',
        taskName: 'Operationale Readiness',
        phase: 'readiness',
        assetClass: 'wind_or_pv_plant',
        assetId: 'RD2_Installation_North',
        verantwortlich: [{ actorType: 'role', actorId: 'REDISPATCH_OPERATOR_LEAD' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'INSTALLATION_OWNER' }],
        mitwirkend: [{ actorType: 'role', actorId: 'SYSTEM_OPERATOR' }],
        information: [{ actorType: 'role', actorId: 'TSO_GRID_MONITORING' }],
        evidenceRequirements: [
          { id: 'comm-test', label: 'Kommunikationsprüfung bestanden', type: 'test_result' },
          { id: 'forecast-accuracy', label: 'Prognose-Genauigkeit ≥90%', type: 'metric' },
          {
            id: 'dispatch-test',
            label: 'Abrufe erfolgreich (1 Woche)',
            type: 'operational_proof',
          },
        ],
        forbiddenAssumptions: [
          'Keine produktive Redispatch-Teilnahme ohne bestande Kommunikationsprüfung.',
        ],
        allowedOptions: [
          {
            id: 'go-productive',
            title: 'Produktiv freigeben',
            impact: { risk: 'low', cost: 'low', time: 'short' },
          },
          {
            id: 'extend-test',
            title: 'Testphase verlängern',
            impact: { risk: 'low', cost: 'low', time: 'medium' },
          },
        ],
        nextActions: [
          {
            id: 'run-comm-test',
            type: 'collect_evidence',
            label: 'Kommunikationsprüfung durchführen.',
          },
        ],
      },
    ],
  },
];

module.exports = {
  SYSTEM_TEMPLATES,
  getSystemTemplates: () => SYSTEM_TEMPLATES,
  getSystemTemplateById: (id) => SYSTEM_TEMPLATES.find((t) => t.id === id),
};
