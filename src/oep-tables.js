'use strict';

/**
 * CERNION_RELEVANT_OEP_TABLES — Vorkonfigurierte OEP-Tabellen für den VNB/Cernion-Kontext.
 *
 * TRL6: demonstriert in relevantem Energie-Domänen-Umfeld.
 * Kein freies Suchen nötig — direkt verwendbar für EU AI Act Art. 12, MaStR-Vergleich,
 * Residuallast-Validierung und Szenario-Planung.
 *
 * Pflichtfelder pro Eintrag:
 *   schema         — OEP-Datenbankschema
 *   table          — Tabellenname
 *   description    — Kurzbeschreibung der Tabelle
 *   cernionUseCase — Konkreter Anwendungsfall im Cernion/VNB-Kontext
 *   oeoClass       — Primäre OEO-Klasse (oeo:-Präfix)
 */
const CERNION_RELEVANT_OEP_TABLES = Object.freeze([
  {
    schema: 'model_draft',
    table: 'oed_source',
    description: 'OEP Quellenregister — Referenziert Datenprovenienz',
    cernionUseCase: 'EU AI Act Art. 12 Datenherkunft',
    oeoClass: 'oeo:DataSource',
  },
  {
    schema: 'supply',
    table: 'ego_dp_res_powerplant',
    description: 'Erneuerbare Energieanlagen Deutschland',
    cernionUseCase: 'Vergleich mit MaStR-Bestand',
    oeoClass: 'oeo:PowerPlant',
  },
  {
    schema: 'demand',
    table: 'ego_dp_loadarea',
    description: 'Lastgebiete Deutschland',
    cernionUseCase: 'Residuallast-Validierung',
    oeoClass: 'oeo:LoadArea',
  },
  {
    schema: 'model_draft',
    table: 'oed_scenario_bundle',
    description: 'Energie-Szenario-Bündel (NEP, TYNDP, Klimaziele)',
    cernionUseCase: 'Szenario-Planung und NEP-Vergleich',
    oeoClass: 'oeo:EnergyScenario',
  },
  {
    schema: 'grid',
    table: 'ego_dp_ehv_substation',
    description: 'Hochspannungs-Umspannwerke Deutschland',
    cernionUseCase: 'Topologie-Validierung und Netzplanung',
    oeoClass: 'oeo:ElectricitySubstation',
  },
]);

module.exports = { CERNION_RELEVANT_OEP_TABLES };
