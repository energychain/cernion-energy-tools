'use strict';

const POWERPLANT_FIELD_MAPPINGS = Object.freeze([
  {
    field: 'name',
    oeoProperty: 'oeo:hasName',
    type: 'string',
    mastrPaths: ['name', 'anlagenname', 'bezeichnung'],
    oepPaths: ['name', 'plant_name', 'powerplant', 'power_plant'],
  },
  {
    field: 'capacityKw',
    oeoProperty: 'oeo:hasNominalElectricalPower',
    type: 'number',
    mastrPaths: ['bruttoleistung', 'nettoengpassleistung', 'capacityKW', 'capacityKw'],
    oepPaths: [
      'electrical_capacity_mw',
      'capacity_mw',
      'capacity',
      'p_nom',
      'el_capacity',
      'electrical_capacity',
    ],
    mastrScale: 1,
    oepScale: 1000,
    warningPct: 5,
    criticalPct: 20,
  },
  {
    field: 'commissioningYear',
    oeoProperty: 'oeo:hasCommissioningDate',
    type: 'number',
    mastrPaths: ['inbetriebnahmejahr', 'commissioningYear', 'inbetriebnahmedatum'],
    oepPaths: ['commissioning_year', 'year_of_commissioning', 'commissioning_date'],
    warningAbs: 1,
    criticalAbs: 3,
  },
  {
    field: 'postalCode',
    oeoProperty: 'oeo:hasPostalCode',
    type: 'string',
    mastrPaths: ['postleitzahl', 'postalCode', 'plz'],
    oepPaths: ['plz', 'postal_code', 'postcode', 'zip'],
  },
  {
    field: 'city',
    oeoProperty: 'oeo:hasMunicipality',
    type: 'string',
    mastrPaths: ['ort', 'gemeinde', 'location', 'city'],
    oepPaths: ['city', 'municipality', 'gemeinde', 'ort'],
  },
  {
    field: 'latitude',
    oeoProperty: 'oeo:hasLatitude',
    type: 'number',
    mastrPaths: ['latitude', 'breitengrad'],
    oepPaths: ['latitude', 'lat', 'y'],
    warningAbs: 0.01,
    criticalAbs: 0.05,
  },
  {
    field: 'longitude',
    oeoProperty: 'oeo:hasLongitude',
    type: 'number',
    mastrPaths: ['longitude', 'laengengrad'],
    oepPaths: ['longitude', 'lon', 'lng', 'x'],
    warningAbs: 0.01,
    criticalAbs: 0.05,
  },
]);

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
    semanticMapping: {
      entityType: 'powerplant',
      fieldMappings: POWERPLANT_FIELD_MAPPINGS,
    },
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
  {
    schema: 'society',
    table: 'destatis_zensus_population_per_bkg_vg250_6_gem',
    description:
      'Zensus 2011 Bevölkerungsdaten je Gemeinde (census_sum, census_count, census_density), ' +
      'aggregiert über BKG-VG250-Verwaltungsgrenzen und referenziert per Amtlichem ' +
      'Gemeindeschlüssel (Feld ags_0).',
    cernionUseCase: 'OSM-unabhängige Verbrauchsprognose über Gemeindeschlüssel (AGS) statt OSM-Gebäude-Clustering',
    oeoClass: 'oeo:PopulationStatistic',
  },
]);

function getOepTableConfig(schema, table) {
  return CERNION_RELEVANT_OEP_TABLES.find(
    (entry) => entry.schema === schema && entry.table === table
  );
}

function getOepFieldMappings(schema, table) {
  return getOepTableConfig(schema, table)?.semanticMapping?.fieldMappings || [];
}

module.exports = {
  CERNION_RELEVANT_OEP_TABLES,
  POWERPLANT_FIELD_MAPPINGS,
  getOepTableConfig,
  getOepFieldMappings,
};
