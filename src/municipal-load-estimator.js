'use strict';

/**
 * Municipal load estimator — read-only, derived from population and asset data.
 *
 * Derives a synthetic annual municipal load profile from:
 *   - Destatis EWZ (population) via municipality-resolver
 *   - BDEW SLP H0/G0 proxy families plus a population/density structure proxy
 *   - MaStR-near generation capacities from municipality-resolver ENERGY_OVERLAY
 *
 * No measured smart-meter or EDM data is used. All outputs carry
 * evidenceStatus: 'derived-from-assets' or 'estimated'. No autarky claims.
 *
 * Technology coincidence factors (annual H0+G0 mix proxy):
 *   PV:       0.25 — daytime generation vs morning/evening demand peaks → low overlap
 *   Biomass:  0.62 — baseload generation vs H0/G0 demand → moderate overlap
 *   Wind:     0.46 — seasonal pattern vs H0/G0 demand → moderate overlap
 *
 * Source basis: Fraunhofer ISE Energiesystemanalyse 2023; BDEW SLP-Dokumentation 2024;
 *   BSW-Solar Eigenverbrauchsstudie 2022; DBFZ Bioenergieatlas 2024.
 */

// Annual coincidence factors: fraction of generation likely consumed by local demand
// at the time of production (temporal matching, H0+G0 municipal mix proxy)
const COINCIDENCE_FACTORS = {
  pv: 0.25, // solar peaks midday; H0 troughs midday → low overlap
  biomass: 0.62, // baseload → moderate-high overlap with flat demand share
  wind: 0.46, // slightly winter-heavy wind vs winter H0 demand → moderate
};

function _density(profile, population) {
  const area = Number(profile?.areaSqKm || profile?.area_sq_km || profile?.kfl);
  if (!population || !area || area <= 0) return null;
  return population / area;
}

function _percent(value) {
  return `${Math.round(value * 100)} %`;
}

function sectorFractionsForProfile(profile) {
  const population = Number(profile?.population) || 0;
  const density = _density(profile, population);
  const fallbackEvidence = {
    evidenceStatus: 'heuristic-fallback',
    evidenceKey: 'population_density_sector_proxy',
    evidenceLabel:
      'Fallback-Strukturproxy nach Einwohnerzahl und Dichte; OSM-/MaStR-Sektorevidenz offen',
    nextGateLabel:
      'OSM-Gebäudenutzung, MaStR-Anlagenstandorte und kommunale Liegenschaften für lokalen Lastsplit verbinden.',
  };

  if (population >= 500000) {
    return {
      commercialFraction: 0.75,
      publicFraction: 0.07,
      modelLabel: 'Metropolen-Strukturproxy nach Einwohnerzahl/Dichte',
      ...fallbackEvidence,
    };
  }
  if (population >= 100000) {
    return {
      commercialFraction: 0.55,
      publicFraction: 0.06,
      modelLabel: 'Großstadt-Strukturproxy nach Einwohnerzahl/Dichte',
      ...fallbackEvidence,
    };
  }
  if (population >= 25000) {
    return {
      commercialFraction: density && density > 900 ? 0.34 : 0.3,
      publicFraction: 0.055,
      modelLabel: 'Mittelstadt-Strukturproxy nach Einwohnerzahl/Dichte',
      ...fallbackEvidence,
    };
  }
  if (population >= 10000) {
    return {
      commercialFraction: density && density > 700 ? 0.32 : 0.28,
      publicFraction: 0.05,
      modelLabel: 'Kleinstadt-Strukturproxy nach Einwohnerzahl/Dichte',
      ...fallbackEvidence,
    };
  }
  return {
    commercialFraction: density && density > 400 ? 0.28 : 0.24,
    publicFraction: 0.045,
    modelLabel: 'Gemeinde-Strukturproxy nach Einwohnerzahl/Dichte',
    ...fallbackEvidence,
  };
}

/**
 * Estimate annual municipal load from a resolved municipality profile.
 *
 * Returns null if population is unknown (can't estimate without EWZ).
 */
function estimateMunicipalAnnualLoad(profile) {
  if (!profile || !profile.found || !profile.population) return null;

  const pop = profile.population;
  const hsPerEinwohner = profile.avgHouseholdsPerEinwohner || 0.44;
  const avgKwhPerHousehold = profile.avgHouseholdConsumptionKwh || 2450;
  const sector = sectorFractionsForProfile(profile);

  const households = Math.round(pop * hsPerEinwohner);
  const householdKwh = households * avgKwhPerHousehold;
  const commercialKwh = Math.round(householdKwh * sector.commercialFraction);
  const publicBuildingKwh = Math.round(householdKwh * sector.publicFraction);
  const totalAnnualKwh = householdKwh + commercialKwh + publicBuildingKwh;

  return {
    totalAnnualKwh,
    householdKwh,
    commercialKwh,
    publicBuildingKwh,
    households,
    confidence: 'low',
    evidenceStatus: 'derived-from-assets',
    sourceLabel: `Bevölkerungsbasierte Schätzung (Destatis EWZ 2022); ${sector.evidenceLabel}; H0/G0-SLP-Proxy (BDEW 2024); kein Messzähler, kein EDM-Abgleich`,
    commercialFraction: sector.commercialFraction,
    publicFraction: sector.publicFraction,
    sectorModelLabel: sector.modelLabel,
    sectorEvidenceStatus: sector.evidenceStatus,
    sectorEvidenceKey: sector.evidenceKey,
    sectorEvidenceLabel: sector.evidenceLabel,
    sectorNextGateLabel: sector.nextGateLabel,
    derivedLoadBuckets: [
      {
        bucketKey: 'h0_haushalt',
        bucketLabel: 'H0-Haushaltslast (SLP-Proxy)',
        annualKwh: householdKwh,
        slpProfileId: 'H0',
        basis: `${households} Haushalte × ${avgKwhPerHousehold} kWh/a`,
        evidenceStatus: 'derived-from-assets',
        confidence: 'medium',
      },
      {
        bucketKey: 'g0_gewerbe',
        bucketLabel: `G0-Gewerbelast (SLP-Strukturproxy, ${_percent(sector.commercialFraction)} von H0)`,
        annualKwh: commercialKwh,
        slpProfileId: 'G0',
        basis: `${sector.modelLabel}; Branchenmix vor Beschluss gegen lokale Verbrauchsdaten prüfen`,
        evidenceStatus: 'estimated',
        confidence: 'low',
      },
      {
        bucketKey: 'kommunal_gebaeude',
        bucketLabel: `Kommunale Gebäude (Strukturproxy, ${_percent(sector.publicFraction)} von H0)`,
        annualKwh: publicBuildingKwh,
        slpProfileId: 'G0',
        basis: `${sector.modelLabel}; kommunale Liegenschaften und Straßenbeleuchtung gegen Ist-Verbrauch prüfen`,
        evidenceStatus: 'estimated',
        confidence: 'low',
      },
    ],
  };
}

/**
 * Derive temporal coincidence between generation rows and the municipal load.
 *
 * Returns correlation result per technology plus aggregate import exposure.
 * Does not claim measured coincidence — uses annual SLP-proxy factors.
 */
function deriveTechnologyCorrelation({ annualLoad, valueRows, assumedMarketPriceEurPerMwh }) {
  if (!annualLoad || !Array.isArray(valueRows) || valueRows.length === 0) return null;

  const totalDemandKwh = annualLoad.totalAnnualKwh;
  const price = assumedMarketPriceEurPerMwh || 70;
  const techResults = [];
  let cumulativeMatchedKwh = 0;

  for (const genRow of valueRows) {
    const tech = genRow.technology;
    if (!COINCIDENCE_FACTORS[tech]) continue;

    const genKwh = genRow.estimatedGenerationKwhPerYear || 0;
    if (genKwh <= 0) continue;

    const cf = COINCIDENCE_FACTORS[tech];
    const candidateMatchedKwh = Math.round(genKwh * cf);
    const remainingDemand = Math.max(0, totalDemandKwh - cumulativeMatchedKwh);
    const matchedKwh = Math.min(candidateMatchedKwh, remainingDemand);
    cumulativeMatchedKwh += matchedKwh;

    const unmatchedGenKwh = genKwh - matchedKwh;

    techResults.push({
      technology: tech,
      generationKwh: genKwh,
      coincidenceFactor: cf,
      matchedKwh,
      localCorrelationValueEur: Math.round((matchedKwh / 1000) * price),
      unmatchedGenerationKwh: unmatchedGenKwh,
      unmatchedGenerationValueEur: Math.round((unmatchedGenKwh / 1000) * price),
    });
  }

  const importDemandKwh = Math.max(0, totalDemandKwh - cumulativeMatchedKwh);
  const importExposureEur = Math.round((importDemandKwh / 1000) * price);

  return {
    techResults,
    totalDemandKwh,
    totalMatchedKwh: cumulativeMatchedKwh,
    importDemandKwh,
    importExposureEur,
    evidenceStatus: 'derived-from-assets',
    sourceLabel: 'Koinzidenzfaktoren: Fraunhofer ISE 2023; BDEW SLP H0/G0-Proxy; nicht gemessen',
  };
}

module.exports = {
  estimateMunicipalAnnualLoad,
  deriveTechnologyCorrelation,
  sectorFractionsForProfile,
};
