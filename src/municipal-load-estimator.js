'use strict';

/**
 * Municipal load estimator — read-only, derived from population and asset data.
 *
 * Derives a synthetic annual municipal load profile from:
 *   - Destatis EWZ (population) via municipality-resolver
 *   - BDEW SLP H0/G0 proxy fractions for household/commercial split
 *   - MaStR-near generation capacities from municipality-resolver ENERGY_OVERLAY
 *
 * No measured smart-meter or EDM data is used. All outputs carry
 * evidenceStatus: 'derived-from-assets' or 'estimated'. No autarky claims.
 *
 * Technology coincidence factors (annual H0+G0 mix, 65% H0 / 35% G0):
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
  pv:      0.25,  // solar peaks midday; H0 troughs midday → low overlap
  biomass: 0.62,  // baseload → moderate-high overlap with flat demand share
  wind:    0.46,  // slightly winter-heavy wind vs winter H0 demand → moderate
};

// Commercial/public fractions of household load for a typical German Gemeinde
const COMMERCIAL_FRACTION = 0.40;  // G0-like commercial relative to H0 household
const PUBLIC_FRACTION     = 0.05;  // municipal/public buildings relative to H0

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

  const households = Math.round(pop * hsPerEinwohner);
  const householdKwh = households * avgKwhPerHousehold;
  const commercialKwh = Math.round(householdKwh * COMMERCIAL_FRACTION);
  const publicBuildingKwh = Math.round(householdKwh * PUBLIC_FRACTION);
  const totalAnnualKwh = householdKwh + commercialKwh + publicBuildingKwh;

  return {
    totalAnnualKwh,
    householdKwh,
    commercialKwh,
    publicBuildingKwh,
    households,
    confidence: 'low',
    evidenceStatus: 'derived-from-assets',
    sourceLabel: 'Bevölkerungsbasierte Schätzung (Destatis EWZ 2022); H0/G0-SLP-Proxy (BDEW 2024); kein Messzähler, kein EDM-Abgleich',
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
        bucketLabel: 'G0-Gewerbelast (SLP-Proxy, 40 % von H0)',
        annualKwh: commercialKwh,
        slpProfileId: 'G0',
        basis: 'Strukturanteil Gewerbe/KMU auf Basis BDEW-Sektorsplit 2024',
        evidenceStatus: 'estimated',
        confidence: 'low',
      },
      {
        bucketKey: 'kommunal_gebaeude',
        bucketLabel: 'Kommunale Gebäude (Schätzung, 5 % von H0)',
        annualKwh: publicBuildingKwh,
        slpProfileId: 'G0',
        basis: 'Pauschalansatz öffentliche Gebäude/Straßenbeleuchtung',
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
      localCorrelationValueEur: Math.round(matchedKwh / 1000 * price),
      unmatchedGenerationKwh: unmatchedGenKwh,
      unmatchedGenerationValueEur: Math.round(unmatchedGenKwh / 1000 * price),
    });
  }

  const importDemandKwh = Math.max(0, totalDemandKwh - cumulativeMatchedKwh);
  const importExposureEur = Math.round(importDemandKwh / 1000 * price);

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

module.exports = { estimateMunicipalAnnualLoad, deriveTechnologyCorrelation };
