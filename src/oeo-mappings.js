'use strict';

/**
 * Open Energy Ontology (OEO) Mappings for Cernion Energy Tools
 *
 * Static lookup table mapping Cernion domain concepts to OEO class IRIs.
 * Generated from the OEO glossary (existing-terms-and-definitions.zip).
 *
 * Ontology repository: @OpenEnergyPlatform/ontology
 *   https://github.com/OpenEnergyPlatform/ontology
 *
 * Re-generate with: npm run sync:oeo
 *
 * @see https://openenergyplatform.org/ontology/oeo/
 */

// --- Pinned source version ---------------------------------------------------
const OEO_VERSION = '2.11.0';
const OEO_BASE_IRI = 'https://openenergyplatform.org/ontology/oeo/';

// --- Helper: build full IRI from local OEO id --------------------------------
function iri(localId) {
  return `${OEO_BASE_IRI}${localId}`;
}

// =============================================================================
// Installation type mappings
// Finer sub-types are included where MaStR bulk data provides distinguishing
// fields. Each entry carries the Cernion enum value it maps from.
// Ontology source: @OpenEnergyPlatform/ontology — oeo-physical.omn
// =============================================================================
const INSTALLATION_TYPES = [
  // --- Solar (no sub-types — MaStR has no explicit rooftop/ground field) ------
  // @OpenEnergyPlatform/ontology OEO_00000034 solar power unit
  {
    id: 'solar',
    iri: iri('OEO_00000034'),
    label: 'solar power unit',
    labelDe: 'Solaranlage',
    cernionType: 'solar',
    cernionSubtype: null,
    psrCode: 'B16',
  },
  // @OpenEnergyPlatform/ontology OEO_00000324 photovoltaic power plant
  {
    id: 'solar-pv-plant',
    iri: iri('OEO_00000324'),
    label: 'photovoltaic power plant',
    labelDe: 'Photovoltaikkraftwerk',
    cernionType: 'solar',
    cernionSubtype: null,
    psrCode: 'B16',
  },

  // --- Wind (onshore/offshore via MaStR Lage field, ENTSO-E B18/B19) ---------
  // @OpenEnergyPlatform/ontology OEO_00000044 wind energy converting unit
  {
    id: 'wind',
    iri: iri('OEO_00000044'),
    label: 'wind energy converting unit',
    labelDe: 'Windenergieanlage',
    cernionType: 'wind',
    cernionSubtype: null,
    psrCode: null,
  },
  // @OpenEnergyPlatform/ontology OEO_00000311 onshore wind farm
  {
    id: 'wind-onshore',
    iri: iri('OEO_00000311'),
    label: 'onshore wind farm',
    labelDe: 'Onshore-Windpark',
    cernionType: 'wind',
    cernionSubtype: 'onshore',
    psrCode: 'B19',
  },
  // @OpenEnergyPlatform/ontology OEO_00000308 offshore wind farm
  {
    id: 'wind-offshore',
    iri: iri('OEO_00000308'),
    label: 'offshore wind farm',
    labelDe: 'Offshore-Windpark',
    cernionType: 'wind',
    cernionSubtype: 'offshore',
    psrCode: 'B18',
  },

  // --- Biomass (solid/biogas/biofuel via MaStR Hauptbrennstoff) --------------
  // @OpenEnergyPlatform/ontology OEO_00010214 biomass
  {
    id: 'biomass',
    iri: iri('OEO_00010214'),
    label: 'biomass',
    labelDe: 'Biomasse',
    cernionType: 'biomass',
    cernionSubtype: null,
    psrCode: 'B01',
  },
  // @OpenEnergyPlatform/ontology OEO_00000074 biogas
  {
    id: 'biomass-biogas',
    iri: iri('OEO_00000074'),
    label: 'biogas',
    labelDe: 'Biogas',
    cernionType: 'biomass',
    cernionSubtype: 'biogas',
    psrCode: 'B01',
  },

  // --- Hydro (run-of-river/pumped/reservoir via MaStR ArtDerWasserkraftanlage)
  // @OpenEnergyPlatform/ontology OEO_00010086 hydro power plant
  {
    id: 'hydro',
    iri: iri('OEO_00010086'),
    label: 'hydro power plant',
    labelDe: 'Wasserkraftwerk',
    cernionType: 'hydro',
    cernionSubtype: null,
    psrCode: null,
  },
  // @OpenEnergyPlatform/ontology OEO_00010087 run of river power plant
  {
    id: 'hydro-run-of-river',
    iri: iri('OEO_00010087'),
    label: 'run of river power plant',
    labelDe: 'Laufwasserkraftwerk',
    cernionType: 'hydro',
    cernionSubtype: 'run-of-river',
    psrCode: 'B11',
  },
  // @OpenEnergyPlatform/ontology OEO_00010089 pumped hydro storage power plant
  {
    id: 'hydro-pumped-storage',
    iri: iri('OEO_00010089'),
    label: 'pumped hydro storage power plant',
    labelDe: 'Pumpspeicherkraftwerk',
    cernionType: 'hydro',
    cernionSubtype: 'pumped-storage',
    psrCode: 'B10',
  },
  // @OpenEnergyPlatform/ontology OEO_00010094 reservoir hydro storage power plant
  {
    id: 'hydro-reservoir',
    iri: iri('OEO_00010094'),
    label: 'reservoir hydro storage power plant',
    labelDe: 'Speicherwasserkraftwerk',
    cernionType: 'hydro',
    cernionSubtype: 'reservoir',
    psrCode: 'B12',
  },

  // --- Storage (battery vs pumped-hydro vs other via MaStR Batterietechnologie)
  // @OpenEnergyPlatform/ontology OEO_00000159 energy storage object
  {
    id: 'storage',
    iri: iri('OEO_00000159'),
    label: 'energy storage object',
    labelDe: 'Energiespeicher',
    cernionType: 'storage',
    cernionSubtype: null,
    psrCode: null,
  },
  // @OpenEnergyPlatform/ontology OEO_00000068 battery
  {
    id: 'storage-battery',
    iri: iri('OEO_00000068'),
    label: 'battery',
    labelDe: 'Batterie',
    cernionType: 'storage',
    cernionSubtype: 'battery',
    psrCode: null,
  },
  // @OpenEnergyPlatform/ontology OEO_00010089 pumped hydro storage power plant (shared with hydro)
  {
    id: 'storage-pumped-hydro',
    iri: iri('OEO_00010089'),
    label: 'pumped hydro storage power plant',
    labelDe: 'Pumpspeicherkraftwerk',
    cernionType: 'storage',
    cernionSubtype: 'pumped-hydro',
    psrCode: 'B10',
  },

  // --- Combustion (gas/hard-coal/lignite/oil via MaStR Hauptbrennstoff) ------
  // @OpenEnergyPlatform/ontology OEO_00140038 combustion
  {
    id: 'combustion',
    iri: iri('OEO_00140038'),
    label: 'combustion',
    labelDe: 'Verbrennung',
    cernionType: 'combustion',
    cernionSubtype: null,
    psrCode: null,
  },
  // @OpenEnergyPlatform/ontology OEO_00000185 gas turbine
  {
    id: 'combustion-gas',
    iri: iri('OEO_00000185'),
    label: 'gas turbine',
    labelDe: 'Gasturbine',
    cernionType: 'combustion',
    cernionSubtype: 'gas',
    psrCode: 'B04',
  },
  // @OpenEnergyPlatform/ontology OEO_00000021 hard coal power unit
  {
    id: 'combustion-hard-coal',
    iri: iri('OEO_00000021'),
    label: 'hard coal power unit',
    labelDe: 'Steinkohlekraftwerk',
    cernionType: 'combustion',
    cernionSubtype: 'hard-coal',
    psrCode: 'B05',
  },
  // @OpenEnergyPlatform/ontology OEO_00000024 lignite power unit
  {
    id: 'combustion-lignite',
    iri: iri('OEO_00000024'),
    label: 'lignite power unit',
    labelDe: 'Braunkohlekraftwerk',
    cernionType: 'combustion',
    cernionSubtype: 'lignite',
    psrCode: 'B02',
  },
  // @OpenEnergyPlatform/ontology OEO_00000030 oil power unit
  {
    id: 'combustion-oil',
    iri: iri('OEO_00000030'),
    label: 'oil power unit',
    labelDe: 'Ölkraftwerk',
    cernionType: 'combustion',
    cernionSubtype: 'oil',
    psrCode: 'B06',
  },

  // --- Nuclear ---------------------------------------------------------------
  // @OpenEnergyPlatform/ontology OEO_00000303 nuclear power plant
  {
    id: 'nuclear',
    iri: iri('OEO_00000303'),
    label: 'nuclear power plant',
    labelDe: 'Kernkraftwerk',
    cernionType: 'nuclear',
    cernionSubtype: null,
    psrCode: 'B14',
  },

  // --- Geothermal ------------------------------------------------------------
  // @OpenEnergyPlatform/ontology OEO_00000192 geothermal power plant
  {
    id: 'geothermal',
    iri: iri('OEO_00000192'),
    label: 'geothermal power plant',
    labelDe: 'Geothermiekraftwerk',
    cernionType: 'geothermal',
    cernionSubtype: null,
    psrCode: 'B09',
  },
];

// =============================================================================
// Grid & infrastructure concepts
// Ontology source: @OpenEnergyPlatform/ontology — oeo-physical.omn
// =============================================================================
const GRID_CONCEPTS = [
  // @OpenEnergyPlatform/ontology OEO_00000143 electricity grid
  {
    id: 'electricity-grid',
    iri: iri('OEO_00000143'),
    label: 'electricity grid',
    labelDe: 'Stromnetz',
  },
  // @OpenEnergyPlatform/ontology OEO_00110019 transmission grid
  {
    id: 'transmission-grid',
    iri: iri('OEO_00110019'),
    label: 'transmission grid',
    labelDe: 'Übertragungsnetz',
  },
  // @OpenEnergyPlatform/ontology OEO_00110020 distribution grid
  {
    id: 'distribution-grid',
    iri: iri('OEO_00110020'),
    label: 'distribution grid',
    labelDe: 'Verteilnetz',
  },
  // @OpenEnergyPlatform/ontology OEO_00000144 electricity grid component
  {
    id: 'grid-component',
    iri: iri('OEO_00000144'),
    label: 'electricity grid component',
    labelDe: 'Netzkomponente',
  },
  // @OpenEnergyPlatform/ontology OEO_00410060 electricity grid voltage level
  {
    id: 'voltage-level',
    iri: iri('OEO_00410060'),
    label: 'electricity grid voltage level',
    labelDe: 'Spannungsebene',
  },
  // @OpenEnergyPlatform/ontology OEO_00000031 power plant
  { id: 'power-plant', iri: iri('OEO_00000031'), label: 'power plant', labelDe: 'Kraftwerk' },
  // @OpenEnergyPlatform/ontology OEO_00020107 curtailment
  { id: 'curtailment', iri: iri('OEO_00020107'), label: 'curtailment', labelDe: 'Abregelung' },
  // @OpenEnergyPlatform/ontology OEO_00140136 dispatch assignment
  {
    id: 'dispatch-assignment',
    iri: iri('OEO_00140136'),
    label: 'dispatch assignment',
    labelDe: 'Einsatzplanung',
  },
  // @OpenEnergyPlatform/ontology OEO_00240011 combined heat and power plant
  {
    id: 'chp-plant',
    iri: iri('OEO_00240011'),
    label: 'combined heat and power plant',
    labelDe: 'Kraft-Wärme-Kopplungsanlage',
  },
];

// =============================================================================
// Voltage level mappings (Cernion NS/MS/HS/HöS → OEO classes)
// Ontology source: @OpenEnergyPlatform/ontology — oeo-physical.omn
// =============================================================================
const VOLTAGE_LEVELS = {
  // @OpenEnergyPlatform/ontology OEO_00410051 low electricity grid voltage level
  NS: {
    iri: iri('OEO_00410051'),
    label: 'low electricity grid voltage level',
    labelDe: 'Niederspannung',
  },
  // @OpenEnergyPlatform/ontology OEO_00410052 medium electricity grid voltage level
  MS: {
    iri: iri('OEO_00410052'),
    label: 'medium electricity grid voltage level',
    labelDe: 'Mittelspannung',
  },
  // @OpenEnergyPlatform/ontology OEO_00410053 high electricity grid voltage level
  HS: {
    iri: iri('OEO_00410053'),
    label: 'high electricity grid voltage level',
    labelDe: 'Hochspannung',
  },
  // @OpenEnergyPlatform/ontology OEO_00410054 extra high electricity grid voltage level
  HöS: {
    iri: iri('OEO_00410054'),
    label: 'extra high electricity grid voltage level',
    labelDe: 'Höchstspannung',
  },
};

// =============================================================================
// Market type mappings (Cernion day-ahead/intraday/futures → OEO concepts)
// Ontology source: @OpenEnergyPlatform/ontology — oeo-social.omn
// =============================================================================
const MARKET_TYPES = {
  // @OpenEnergyPlatform/ontology OEO_00020069 market exchange
  'day-ahead': {
    iri: iri('OEO_00020069'),
    label: 'market exchange (day-ahead)',
    labelDe: 'Day-Ahead-Markt',
  },
  // @OpenEnergyPlatform/ontology OEO_00020069 market exchange
  intraday: {
    iri: iri('OEO_00020069'),
    label: 'market exchange (intraday)',
    labelDe: 'Intraday-Markt',
  },
  // @OpenEnergyPlatform/ontology OEO_00010082 trade
  futures: { iri: iri('OEO_00010082'), label: 'trade (futures)', labelDe: 'Terminmarkt' },
};

// =============================================================================
// ENTSO-E PSR code → OEO class mapping
// Ontology source: @OpenEnergyPlatform/ontology — oeo-physical.omn
// =============================================================================
const PSR_MAP = {
  // @OpenEnergyPlatform/ontology OEO_00010214 biomass
  B01: { iri: iri('OEO_00010214'), label: 'biomass' },
  // @OpenEnergyPlatform/ontology OEO_00000024 lignite power unit
  B02: { iri: iri('OEO_00000024'), label: 'lignite power unit' },
  // @OpenEnergyPlatform/ontology OEO_00000185 gas turbine (coal-derived gas)
  B03: { iri: iri('OEO_00000185'), label: 'gas turbine' },
  // @OpenEnergyPlatform/ontology OEO_00000185 gas turbine (fossil gas)
  B04: { iri: iri('OEO_00000185'), label: 'gas turbine' },
  // @OpenEnergyPlatform/ontology OEO_00000021 hard coal power unit
  B05: { iri: iri('OEO_00000021'), label: 'hard coal power unit' },
  // @OpenEnergyPlatform/ontology OEO_00000030 oil power unit
  B06: { iri: iri('OEO_00000030'), label: 'oil power unit' },
  // @OpenEnergyPlatform/ontology OEO_00000192 geothermal power plant
  B09: { iri: iri('OEO_00000192'), label: 'geothermal power plant' },
  // @OpenEnergyPlatform/ontology OEO_00010089 pumped hydro storage power plant
  B10: { iri: iri('OEO_00010089'), label: 'pumped hydro storage power plant' },
  // @OpenEnergyPlatform/ontology OEO_00010087 run of river power plant
  B11: { iri: iri('OEO_00010087'), label: 'run of river power plant' },
  // @OpenEnergyPlatform/ontology OEO_00010094 reservoir hydro storage power plant
  B12: { iri: iri('OEO_00010094'), label: 'reservoir hydro storage power plant' },
  // @OpenEnergyPlatform/ontology OEO_00000029 nuclear power unit
  B14: { iri: iri('OEO_00000029'), label: 'nuclear power unit' },
  // @OpenEnergyPlatform/ontology OEO_00000034 solar power unit
  B16: { iri: iri('OEO_00000034'), label: 'solar power unit' },
  // @OpenEnergyPlatform/ontology OEO_00000308 offshore wind farm
  B18: { iri: iri('OEO_00000308'), label: 'offshore wind farm' },
  // @OpenEnergyPlatform/ontology OEO_00000311 onshore wind farm
  B19: { iri: iri('OEO_00000311'), label: 'onshore wind farm' },
};

// =============================================================================
// Energy & forecasting concepts
// Ontology source: @OpenEnergyPlatform/ontology — oeo-model.omn / oeo-physical.omn
// =============================================================================
const ENERGY_CONCEPTS = [
  // @OpenEnergyPlatform/ontology OEO_00030034 time series
  { id: 'time-series', iri: iri('OEO_00030034'), label: 'time series', labelDe: 'Zeitreihe' },
  // @OpenEnergyPlatform/ontology OEO_00010411 forecast
  { id: 'forecast', iri: iri('OEO_00010411'), label: 'forecast', labelDe: 'Prognose' },
  // @OpenEnergyPlatform/ontology OEO_00010233 forecast error
  {
    id: 'forecast-error',
    iri: iri('OEO_00010233'),
    label: 'forecast error',
    labelDe: 'Prognosefehler',
  },
  // @OpenEnergyPlatform/ontology OEO_00320062 electricity demand
  {
    id: 'electricity-demand',
    iri: iri('OEO_00320062'),
    label: 'electricity demand',
    labelDe: 'Strombedarf',
  },
  // @OpenEnergyPlatform/ontology OEO_00000139 electrical energy
  {
    id: 'electrical-energy',
    iri: iri('OEO_00000139'),
    label: 'electrical energy',
    labelDe: 'Elektrische Energie',
  },
  // @OpenEnergyPlatform/ontology OEO_00000006 carbon dioxide
  { id: 'co2', iri: iri('OEO_00000006'), label: 'carbon dioxide', labelDe: 'Kohlendioxid' },
  // @OpenEnergyPlatform/ontology OEO_00260007 CO2 emission
  { id: 'co2-emission', iri: iri('OEO_00260007'), label: 'CO2 emission', labelDe: 'CO2-Emission' },
  // @OpenEnergyPlatform/ontology OEO_00010082 trade
  { id: 'trade', iri: iri('OEO_00010082'), label: 'trade', labelDe: 'Handel' },
  // @OpenEnergyPlatform/ontology OEO_00360005 bidding zone
  { id: 'bidding-zone', iri: iri('OEO_00360005'), label: 'bidding zone', labelDe: 'Gebotszone' },
  // @OpenEnergyPlatform/ontology OEO_00140040 demand
  { id: 'demand', iri: iri('OEO_00140040'), label: 'demand', labelDe: 'Nachfrage' },
];

// =============================================================================
// Gas storage concepts
// Ontology source: @OpenEnergyPlatform/ontology — oeo-physical.omn
// =============================================================================
const GAS_STORAGE_CONCEPTS = [
  // @OpenEnergyPlatform/ontology OEO_00000159 energy storage object
  {
    id: 'energy-storage',
    iri: iri('OEO_00000159'),
    label: 'energy storage object',
    labelDe: 'Energiespeicher',
  },
  // @OpenEnergyPlatform/ontology OEO_00330013 energy storage level
  {
    id: 'storage-level',
    iri: iri('OEO_00330013'),
    label: 'energy storage level',
    labelDe: 'Speicherstand',
  },
  // @OpenEnergyPlatform/ontology OEO_00230000 energy storage capacity
  {
    id: 'storage-capacity',
    iri: iri('OEO_00230000'),
    label: 'energy storage capacity',
    labelDe: 'Speicherkapazität',
  },
  // @OpenEnergyPlatform/ontology OEO_00000292 natural gas
  { id: 'natural-gas', iri: iri('OEO_00000292'), label: 'natural gas', labelDe: 'Erdgas' },
];

// =============================================================================
// Unit mappings
// Ontology source: @OpenEnergyPlatform/ontology — oeo-shared.omn
// =============================================================================
const UNITS = {
  // @OpenEnergyPlatform/ontology OEO_00390000 kilowatt
  kW: { iri: iri('OEO_00390000'), label: 'kilowatt' },
  // @OpenEnergyPlatform/ontology OEO_00390001 megawatt
  MW: { iri: iri('OEO_00390001'), label: 'megawatt' },
  // @OpenEnergyPlatform/ontology OEO_00050008 megawatt-hour
  MWh: { iri: iri('OEO_00050008'), label: 'megawatt-hour' },
  // @OpenEnergyPlatform/ontology OEO_00050011 gigawatt-hour
  GWh: { iri: iri('OEO_00050011'), label: 'gigawatt-hour' },
};

// =============================================================================
// Semantic-domain → OEO class mappings
// Each key is a Cernion semantic domain id; values are arrays of OEO IRIs
// that describe the domain's primary concepts.
// =============================================================================
const DOMAIN_OEO_MAPPINGS = {
  // @OpenEnergyPlatform/ontology OEO_00030034, OEO_00000139
  metering: [iri('OEO_00030034'), iri('OEO_00000139')],
  // @OpenEnergyPlatform/ontology OEO_00000143, OEO_00000144, OEO_00410060, OEO_00000031
  'grid-assets': [
    iri('OEO_00000143'),
    iri('OEO_00000144'),
    iri('OEO_00410060'),
    iri('OEO_00000031'),
  ],
  // @OpenEnergyPlatform/ontology OEO_00020107, OEO_00000143
  'grid-incidents': [iri('OEO_00020107'), iri('OEO_00000143')],
  // @OpenEnergyPlatform/ontology OEO_00140136, OEO_00020107
  'redispatch-queue': [iri('OEO_00140136'), iri('OEO_00020107')],
  // @OpenEnergyPlatform/ontology OEO_00000031, OEO_00000034, OEO_00000044
  'mastr-local': [
    iri('OEO_00000031'),
    iri('OEO_00000034'),
    iri('OEO_00000044'),
    iri('OEO_00000159'),
  ],
  // @OpenEnergyPlatform/ontology OEO_00010082, OEO_00020069
  procurement: [iri('OEO_00010082'), iri('OEO_00020069')],
  // @OpenEnergyPlatform/ontology OEO_00010411, OEO_00010233, OEO_00030034
  'forecast-vs-actual': [iri('OEO_00010411'), iri('OEO_00010233'), iri('OEO_00030034')],
  // @OpenEnergyPlatform/ontology OEO_00010082
  'billing-overview': [iri('OEO_00010082')],
  // @OpenEnergyPlatform/ontology OEO_00010082
  receivables: [iri('OEO_00010082')],
  // @OpenEnergyPlatform/ontology OEO_00010082 (market communication as trade process)
  'mako-process-log': [iri('OEO_00010082')],
  // @OpenEnergyPlatform/ontology OEO_00000034, OEO_00000068, OEO_00000031
  'customer-projects': [iri('OEO_00000034'), iri('OEO_00000068'), iri('OEO_00000031')],
  other: [],
  // @OpenEnergyPlatform/ontology OEO_00000143, OEO_00410060
  'metering-point-master': [iri('OEO_00000143'), iri('OEO_00410060')],
};

// =============================================================================
// Lookup helpers
// =============================================================================

/** All entries from all mapping tables, indexed by id */
const _allEntries = new Map();
[...INSTALLATION_TYPES, ...GRID_CONCEPTS, ...ENERGY_CONCEPTS, ...GAS_STORAGE_CONCEPTS].forEach(
  (entry) => {
    _allEntries.set(entry.id, entry);
  }
);

/**
 * Look up an OEO mapping entry by its Cernion slug id.
 * @param {string} id - e.g. 'solar', 'wind-onshore', 'electricity-grid'
 * @returns {object|null}
 */
function byId(id) {
  return _allEntries.get(id) || null;
}

/**
 * Look up an entry by its full OEO IRI.
 * @param {string} fullIri
 * @returns {object|null}
 */
function byIri(fullIri) {
  for (const entry of _allEntries.values()) {
    if (entry.iri === fullIri) return entry;
  }
  return null;
}

/**
 * Find OEO mapping(s) for a Cernion installation type and optional sub-type.
 * @param {string} type - e.g. 'solar', 'wind', 'biomass', 'storage', 'combustion', 'hydro'
 * @param {string|null} [subtype] - e.g. 'onshore', 'biogas', 'battery'
 * @returns {object|null} Best matching entry (sub-type preferred) or generic type
 */
function byCernionType(type, subtype) {
  if (subtype) {
    const specific = INSTALLATION_TYPES.find(
      (entry) => entry.cernionType === type && entry.cernionSubtype === subtype
    );
    if (specific) return specific;
  }
  return (
    INSTALLATION_TYPES.find(
      (entry) => entry.cernionType === type && entry.cernionSubtype === null
    ) || null
  );
}

/**
 * Find OEO mapping for an ENTSO-E PSR code.
 * @param {string} psrCode - e.g. 'B16', 'B19'
 * @returns {object|null}
 */
function byPsrCode(psrCode) {
  return PSR_MAP[psrCode] || null;
}

/**
 * Get OEO class IRIs for a Cernion semantic domain.
 * @param {string} domainId - e.g. 'metering', 'grid-assets'
 * @returns {string[]} Array of OEO class IRIs
 */
function forDomain(domainId) {
  return DOMAIN_OEO_MAPPINGS[domainId] || [];
}

/**
 * Get OEO class IRIs for a domain, resolved to full entry objects.
 * @param {string} domainId
 * @returns {Array<{iri: string, label: string}>}
 */
function forDomainResolved(domainId) {
  const iris = forDomain(domainId);
  return iris.map((classIri) => {
    const entry = byIri(classIri);
    return entry
      ? { iri: entry.iri, label: entry.label }
      : { iri: classIri, label: classIri.split('/').pop() };
  });
}

/**
 * Collect all German labels from all mapping tables.
 * Useful for enriching classifier keyword scoring.
 * @returns {string[]}
 */
function allGermanLabels() {
  const labels = new Set();
  for (const entry of _allEntries.values()) {
    if (entry.labelDe) labels.add(entry.labelDe.toLowerCase());
  }
  // Also add voltage level German labels
  for (const vl of Object.values(VOLTAGE_LEVELS)) {
    if (vl.labelDe) labels.add(vl.labelDe.toLowerCase());
  }
  return [...labels];
}

/**
 * Get German labels associated with a specific domain's OEO mapping.
 * @param {string} domainId
 * @returns {string[]}
 */
function germanLabelsForDomain(domainId) {
  const iris = forDomain(domainId);
  const labels = [];
  for (const classIri of iris) {
    const entry = byIri(classIri);
    if (entry?.labelDe) labels.push(entry.labelDe.toLowerCase());
  }
  return labels;
}

module.exports = {
  OEO_VERSION,
  OEO_BASE_IRI,
  INSTALLATION_TYPES,
  GRID_CONCEPTS,
  VOLTAGE_LEVELS,
  MARKET_TYPES,
  PSR_MAP,
  ENERGY_CONCEPTS,
  GAS_STORAGE_CONCEPTS,
  UNITS,
  DOMAIN_OEO_MAPPINGS,
  byId,
  byIri,
  byCernionType,
  byPsrCode,
  forDomain,
  forDomainResolved,
  allGermanLabels,
  germanLabelsForDomain,
};
