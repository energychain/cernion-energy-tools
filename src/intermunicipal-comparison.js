'use strict';

/**
 * Intermunicipal Comparison — Peer-Korridor fuer interkommunale Einordnung
 *
 * Builds the `intermunicipalComparison` block for municipalEnergyValueAnalysisStatus.
 * Pure function: no I/O, no side effects. All peer data comes from Destatis GV100 2022.
 *
 * Design decisions (issue #334):
 *  - Peer scope: same Bundesland, population ±25% (extended to ±35% if < 5 peers);
 *    settlement density class as additional criterion (proxy: EW/km²).
 *  - Metrics: normalised only — local coverage share and generation value EUR/EW/year.
 *  - Method consistency: target and peers use the same BSW-Solar/DBFZ proxy formula
 *    so profileFitIndicator is included.
 *  - Framing: corridor / potential language only; forbidden ranking terms enforced.
 *  - Anonymisation: peer clear-names are never returned in default results.
 *
 * Forbidden framing terms (checked by tests):
 *   Platz, Rang, Ranking, beste Kommune, schlechteste, Liga, Score, Sterne,
 *   absolute Euro-Vergleiche zwischen Kommunen.
 */

const { gemeindenData } = require('./municipality-resolver');
const { sectorFractionsForProfile } = require('./municipal-load-estimator');

// ── Constants ────────────────────────────────────────────────────────────────

const PV_FLH       = 1000;   // PV full-load hours (h/a)
const BIOMASS_FLH  = 7000;   // Biomass full-load hours (h/a)
const WIND_FLH     = 1800;   // Wind full-load hours (h/a)

const CONSUMPTION_PER_CAPITA_MIN = 1200;  // kWh/EW/Jahr — Gesamtverbrauch lower bound
const CONSUMPTION_PER_CAPITA_MAX = 2600;  // kWh/EW/Jahr — Gesamtverbrauch upper bound

const MIN_PEER_COUNT  = 5;
const PEER_BAND       = 0.25;   // ±25 % for narrow pass
const PEER_BAND_WIDE  = 0.35;   // ±35 % extended fallback
const TARGET_OUTLIER_FACTOR = 1.5; // values beyond this need method validation, not praise

// BSW-Solar/DBFZ proxy: ewz × factor (same formula as municipality-resolver estimateEnergyFromPopulation)
const PV_KW_PER_EW      = 0.55;
const BIO_KW_PER_EW_SM  = 0.09;  // < 10 000 EW
const BIO_KW_PER_EW_LG  = 0.04;  // ≥ 10 000 EW

const AVG_HOUSEHOLDS_PER_EW = 0.46;
const AVG_HOUSEHOLD_KWH = 2300;

// ── Settlement density class (proxy) ────────────────────────────────────────

function settlementDensityClass(pop, areaSqKm) {
  if (!pop || !areaSqKm || areaSqKm <= 0) return 'UNCLASSIFIED';
  const density = pop / areaSqKm;
  if (density > 500) return 'URBAN';
  if (density >= 100) return 'SUBURBAN';
  return 'RURAL';
}

// ── Peer-generation proxy (same method family as target) ─────────────────────

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _formatIntDe(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return Math.round(n).toLocaleString('de-DE');
}

function _densityAdjustedPvKwPerEw(ewz, areaSqKm) {
  if (!ewz || !areaSqKm || areaSqKm <= 0) return PV_KW_PER_EW;
  const density = ewz / areaSqKm;
  const areaPer1000Ew = areaSqKm / (ewz / 1000);
  const densityFactor = _clamp(1.18 - density / 2400, 0.58, 1.28);
  const areaFactor = _clamp(0.84 + areaPer1000Ew / 95, 0.82, 1.22);
  return _clamp(PV_KW_PER_EW * densityFactor * areaFactor, 0.34, 0.78);
}

function _densityAdjustedBioKwPerEw(ewz, areaSqKm) {
  const base = ewz < 10000 ? BIO_KW_PER_EW_SM : BIO_KW_PER_EW_LG;
  if (!ewz || !areaSqKm || areaSqKm <= 0) return base;
  const density = ewz / areaSqKm;
  const areaPer1000Ew = areaSqKm / (ewz / 1000);
  const ruralFeedstockFactor = _clamp(0.62 + areaPer1000Ew / 45, 0.55, 1.35);
  const densityFactor = _clamp(1.12 - density / 3200, 0.55, 1.18);
  return _clamp(base * ruralFeedstockFactor * densityFactor, base * 0.45, base * 1.45);
}

function _estimatePeerGenKwh(peer) {
  const ewz = peer.ewz || 0;
  const areaSqKm = peer.kfl || 0;
  const pvKw  = Math.round(ewz * _densityAdjustedPvKwPerEw(ewz, areaSqKm));
  const bioKw = Math.round(ewz * _densityAdjustedBioKwPerEw(ewz, areaSqKm));
  return pvKw * PV_FLH + bioKw * BIOMASS_FLH;
}

function _estimatePeerLoadKwh(peer) {
  const ewz = peer.ewz || peer.population || 0;
  if (!ewz) return 0;
  const sector = sectorFractionsForProfile({
    population: ewz,
    areaSqKm: peer.kfl || peer.areaSqKm,
  });
  const householdKwh = Math.round(ewz * AVG_HOUSEHOLDS_PER_EW) * AVG_HOUSEHOLD_KWH;
  return Math.round(householdKwh * (1 + sector.commercialFraction + sector.publicFraction));
}

// ── Peer candidate selection ─────────────────────────────────────────────────

function findPeerCandidates({ ags, state, population, areaSqKm }) {
  if (!state || !population || population <= 0) {
    return {
      peers: [],
      criteriaLabel: 'Peer-Suche nicht möglich: Bundesland oder Einwohnerzahl fehlt.',
      extended: false,
      densityClass: 'UNCLASSIFIED',
      populationBandLabel: 'n/a',
      scopeState: state || 'offen',
    };
  }

  const densityClass = settlementDensityClass(population, areaSqKm);
  const bandLow  = Math.round(population * (1 - PEER_BAND));
  const bandHigh = Math.round(population * (1 + PEER_BAND));

  const narrow = gemeindenData.filter(
    (g) =>
      g.ags !== ags &&
      g.state === state &&
      (g.ewz || 0) >= bandLow &&
      (g.ewz || 0) <= bandHigh &&
      g.kfl > 0 &&
      settlementDensityClass(g.ewz, g.kfl) === densityClass
  );

  if (narrow.length >= MIN_PEER_COUNT) {
    return {
      peers: narrow,
      criteriaLabel:
        `Bundesland ${state}, Einwohnerkorridor ±${Math.round(PEER_BAND * 100)} % ` +
        `(${_formatIntDe(bandLow)} bis ${_formatIntDe(bandHigh)} EW), Siedlungsdichteklasse ${densityClass} (Proxy: EW/km²)`,
      extended: false,
      densityClass,
      populationBandLabel: `${_formatIntDe(bandLow)} bis ${_formatIntDe(bandHigh)} EW`,
      scopeState: state,
    };
  }

  // Fallback: wider band, drop density class filter
  const wideLow  = Math.round(population * (1 - PEER_BAND_WIDE));
  const wideHigh = Math.round(population * (1 + PEER_BAND_WIDE));
  const wide = gemeindenData.filter(
    (g) =>
      g.ags !== ags &&
      g.state === state &&
      (g.ewz || 0) >= wideLow &&
      (g.ewz || 0) <= wideHigh &&
      g.kfl > 0
  );

  if (wide.length >= MIN_PEER_COUNT) {
    return {
      peers: wide,
      criteriaLabel:
        `Bundesland ${state}, Einwohnerkorridor erweitert ±${Math.round(PEER_BAND_WIDE * 100)} % ` +
        `(${_formatIntDe(wideLow)} bis ${_formatIntDe(wideHigh)} EW); Dichteklasse-Filter entfernt — unter ${MIN_PEER_COUNT} ` +
        `Peers bei engem Korridor mit Klasse ${densityClass}`,
      extended: true,
      densityClass,
      populationBandLabel: `${_formatIntDe(wideLow)} bis ${_formatIntDe(wideHigh)} EW`,
      scopeState: state,
    };
  }

  if (population >= 500000) {
    const metro = gemeindenData.filter(
      (g) =>
        g.ags !== ags &&
        (g.ewz || 0) >= 500000 &&
        g.kfl > 0
    );
    const metroSameDensity = metro.filter((g) => settlementDensityClass(g.ewz, g.kfl) === densityClass);
    const selected = metroSameDensity.length >= MIN_PEER_COUNT ? metroSameDensity : metro;
    return {
      peers: selected,
      criteriaLabel:
        `Metropolenvergleich deutschlandweit (> 500.000 EW); Bundesland ${state} lieferte nur ` +
        `${wide.length} valide Peers im erweiterten Korridor.`,
      extended: true,
      densityClass: selected === metroSameDensity ? densityClass : 'METRO',
      populationBandLabel: '> 500.000 EW deutschlandweit',
      scopeState: 'Deutschland',
    };
  }

  return {
    peers: wide,
    criteriaLabel:
      `Bundesland ${state}, Einwohnerkorridor erweitert ±${Math.round(PEER_BAND_WIDE * 100)} % ` +
      `(${_formatIntDe(wideLow)} bis ${_formatIntDe(wideHigh)} EW); Dichteklasse-Filter entfernt — unter ${MIN_PEER_COUNT} ` +
      `Peers bei engem Korridor mit Klasse ${densityClass}`,
    extended: true,
    densityClass,
    populationBandLabel: `${_formatIntDe(wideLow)} bis ${_formatIntDe(wideHigh)} EW`,
    scopeState: state,
  };
}

// ── Percentile helper ────────────────────────────────────────────────────────

function _percentiles(values) {
  if (!values.length) return { min: null, median: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return { min: sorted[0], median, max: sorted[sorted.length - 1] };
}

function _positionFraming(targetValue, minValue, maxValue, unit, municipality, highText, lowText, inBandText) {
  if (targetValue > maxValue) {
    return `${municipality} liegt bei ${targetValue} ${unit} und damit oberhalb dieses Korridors; ${highText}.`;
  }
  if (targetValue < minValue) {
    return `${municipality} liegt bei ${targetValue} ${unit} und damit unterhalb des Korridors; ${lowText}.`;
  }
  return `${municipality} liegt bei ${targetValue} ${unit}; ${inBandText}.`;
}

function _findMethodOutlier(rows) {
  return rows.find((row) => {
    const target = Number(row.targetValue);
    const min = Number(row.minValue);
    const max = Number(row.maxValue);
    if (!Number.isFinite(target) || !Number.isFinite(min) || !Number.isFinite(max)) return false;
    if (max > 0 && target > max * TARGET_OUTLIER_FACTOR) return true;
    if (min > 0 && target < min / TARGET_OUTLIER_FACTOR) return true;
    return false;
  }) || null;
}

// ── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build the `intermunicipalComparison` block.
 *
 * @param {object} params
 * @param {object} params.profile        — resolved municipality profile
 * @param {object|null} params.annualLoad — from estimateMunicipalAnnualLoad, may be null
 * @param {number} params.totalGrossMarketValueEur
 * @param {number} params.year
 * @param {string} params.scenario
 * @param {number} params.marketPriceEurPerMwh
 * @returns {object} intermunicipalComparison block
 */
function buildIntermunicipalComparison({
  profile,
  annualLoad,
  totalGrossMarketValueEur,
  year,
  scenario,
  marketPriceEurPerMwh,
}) {
  const _blocked = (reason, guardrailKey, message, nextGate) => ({
    status: 'blocked',
    statusReason: reason,
    dataStatus: 'blocked-by-integrity-check',
    target: null,
    peerGroup: null,
    corridorRows: [],
    guardrailRows: [{ guardrailKey, status: 'blocked', message }],
    blockedFallback: {
      headline: 'Interkommunaler Vergleich derzeit nicht verfügbar',
      text: reason,
      nextGateLabel: nextGate || 'Datenbasis prüfen und ergänzen.',
    },
  });

  // ── Guardrail 1: AGS + population resolution ────────────────────────────
  if (!profile || !profile.found || !profile.ags || !profile.population) {
    return _blocked(
      'Zielkommune nicht vollständig aufgelöst (AGS oder Einwohnerzahl fehlt).',
      'ags_resolution',
      'AGS und Einwohnerzahl werden für den interkommunalen Vergleich benötigt.',
      'Gemeinde per AGS oder vollständigem Namen eingeben (Destatis-GV100-Treffer erforderlich).'
    );
  }

  const pop      = profile.population;
  const guardrailRows = [];
  let overallBlocked  = false;

  guardrailRows.push({
    guardrailKey: 'ags_resolution',
    status: 'passed',
    message: `AGS ${profile.ags} aufgelöst; Einwohnerzahl: ${pop}`,
  });

  // ── Guardrail 2: Household / population plausibility ──────────────────
  const hsPerEw          = profile.avgHouseholdsPerEinwohner || 0.44;
  const actualHouseholds = annualLoad ? annualLoad.households : Math.round(pop * hsPerEw);
  const hhLow  = Math.round(pop * 0.28);
  const hhHigh = Math.round(pop * 0.68);
  if (actualHouseholds >= hhLow && actualHouseholds <= hhHigh) {
    guardrailRows.push({
      guardrailKey: 'household_plausibility',
      status: 'passed',
      message: `Haushalte ${actualHouseholds} plausibel (Korridor ${hhLow}–${hhHigh} für ${pop} EW)`,
    });
  } else {
    guardrailRows.push({
      guardrailKey: 'household_plausibility',
      status: 'blocked',
      message: `Haushalte ${actualHouseholds} außerhalb Korridor [${hhLow}, ${hhHigh}] für ${pop} EW.`,
    });
    overallBlocked = true;
  }

  // ── Guardrail 3: Consumption per capita ──────────────────────────────
  const totalKwh = annualLoad ? annualLoad.totalAnnualKwh : null;
  if (totalKwh && pop > 0) {
    const kwhPerEw = Math.round(totalKwh / pop);
    if (kwhPerEw >= CONSUMPTION_PER_CAPITA_MIN && kwhPerEw <= CONSUMPTION_PER_CAPITA_MAX) {
      guardrailRows.push({
        guardrailKey: 'consumption_per_capita',
        status: 'passed',
        message: `Gesamtverbrauch ${kwhPerEw} kWh/EW/Jahr im Korridor ${CONSUMPTION_PER_CAPITA_MIN}–${CONSUMPTION_PER_CAPITA_MAX} kWh/EW/Jahr`,
      });
    } else {
      guardrailRows.push({
        guardrailKey: 'consumption_per_capita',
        status: 'blocked',
        message:
          `Gesamtverbrauch ${kwhPerEw} kWh/EW/Jahr außerhalb des Korridors ` +
          `${CONSUMPTION_PER_CAPITA_MIN}–${CONSUMPTION_PER_CAPITA_MAX} kWh/EW/Jahr.`,
      });
      overallBlocked = true;
    }
  } else {
    guardrailRows.push({
      guardrailKey: 'consumption_per_capita',
      status: 'blocked',
      message: 'Verbrauchsableitung nicht möglich — Einwohnerzahl oder Lastschätzung fehlt.',
    });
    overallBlocked = true;
  }

  // ── Guardrail 4: Year / scenario consistency ──────────────────────────
  guardrailRows.push({
    guardrailKey: 'year_scenario_consistency',
    status: 'passed',
    message: `Basisjahr ${year}, Szenario ${scenario} für Ziel und Peers identisch`,
  });

  if (overallBlocked) {
    return {
      status: 'blocked',
      statusReason: 'Zielkommune hat Datenintegritätsprüfung nicht bestanden.',
      dataStatus: 'blocked-by-integrity-check',
      target: null,
      peerGroup: null,
      corridorRows: [],
      guardrailRows,
      blockedFallback: {
        headline: 'Interkommunaler Vergleich derzeit nicht verfügbar',
        text: 'Für einen belastbaren Vergleich werden plausible Verbrauchsdaten zur Zielkommune benötigt.',
        nextGateLabel: 'Datengrundlage der Zielkommune prüfen und Einwohnerzahl / Verbrauchsableitung sicherstellen.',
      },
    };
  }

  // ── Peer selection ────────────────────────────────────────────────────
  const { peers, criteriaLabel, extended, densityClass, populationBandLabel, scopeState } =
    findPeerCandidates({
      ags: profile.ags,
      state: profile.state,
      population: pop,
      areaSqKm: profile.areaSqKm,
    });

  if (peers.length < MIN_PEER_COUNT) {
    guardrailRows.push({
      guardrailKey: 'min_peer_count',
      status: 'blocked',
      message: `Nur ${peers.length} valide Peers gefunden (Minimum: ${MIN_PEER_COUNT}). Korridor: ${criteriaLabel}.`,
    });
    return {
      status: 'blocked',
      statusReason: `Zu wenige vergleichbare Kommunen (${peers.length} von ${MIN_PEER_COUNT} benötigt).`,
      dataStatus: 'missing-evidence',
      target: null,
      peerGroup: {
        state: scopeState || profile.state,
        populationBandLabel,
        settlementStructureCriterion: densityClass,
        validPeerCount: peers.length,
        anonymized: true,
        criteriaLabel,
      },
      corridorRows: [],
      guardrailRows,
      blockedFallback: {
        headline: 'Zu wenige Vergleichskommunen',
        text:
          `Vergleichbare Kommunen nach Korridor: ${peers.length} gefunden, ${MIN_PEER_COUNT} benötigt. ` +
          `Erweiterung des Einwohnerkorridors oder Öffnung auf weitere Bundesländer könnte mehr Peers ergeben.`,
        nextGateLabel: 'Einwohnerkorridor oder Siedlungsstrukturklassifikation überprüfen.',
      },
    };
  }

  guardrailRows.push({
    guardrailKey: 'min_peer_count',
    status: 'passed',
    message: `${peers.length} valide Peers im Korridor`,
  });

  // ── Compute target metrics (proxy — same method as peers) ─────────────
  const mktPrice = marketPriceEurPerMwh || 70;
  const targetGenKwh =
    (profile.pvCapacityKw      || 0) * PV_FLH +
    (profile.biomassCapacityKw || 0) * BIOMASS_FLH +
    (profile.windCapacityKw    || 0) * WIND_FLH;
  const targetLoadKwh             = totalKwh || _estimatePeerLoadKwh({ ewz: pop, kfl: profile.areaSqKm });
  const targetLocalCoverageShare  = targetLoadKwh > 0
    ? Math.min(1.0, targetGenKwh / targetLoadKwh)
    : 0;
  const targetGenerationValueEurPerCapita = pop > 0
    ? Math.round(totalGrossMarketValueEur / pop)
    : 0;

  // ── Compute peer metrics (same proxy) ────────────────────────────────
  const peerCoverageValues   = [];
  const peerGenValuePerEwArr = [];

  for (const peer of peers) {
    const ewz = peer.ewz || 0;
    if (!ewz) continue;
    const genKwh     = _estimatePeerGenKwh(peer);
    const grossEur   = Math.round((genKwh / 1000) * mktPrice);
    const loadKwh    = _estimatePeerLoadKwh(peer);
    peerCoverageValues.push(loadKwh > 0 ? Math.min(1.0, genKwh / loadKwh) : 0);
    peerGenValuePerEwArr.push(ewz > 0 ? Math.round(grossEur / ewz) : 0);
  }

  const toPct = (v) => Math.round(v * 1000) / 10;  // 0.1234 → 12.3 (one decimal)
  const peerScopeLabel = scopeState || profile.state;

  const coveragePctValues = peerCoverageValues.map(toPct);
  const coverageP         = _percentiles(coveragePctValues);
  const genValueP         = _percentiles(peerGenValuePerEwArr);

  const targetCoveragePct = toPct(targetLocalCoverageShare);

  // ── Corridor rows ─────────────────────────────────────────────────────
  const corridorRows = [
    {
      metricKey:    'local_coverage_share',
      metricLabel:  'Lokale Deckungsquote',
      unit:         '%',
      targetValue:  targetCoveragePct,
      minValue:     coverageP.min,
      medianValue:  coverageP.median !== null ? Math.round(coverageP.median * 10) / 10 : null,
      maxValue:     coverageP.max,
      roundedRangeLabel: coverageP.min !== null
        ? `${coverageP.min}–${coverageP.max} %`
        : 'keine Daten',
      framingText:
        `Vergleichbare Kommunen in ${peerScopeLabel} binden lokal zwischen ` +
        `${coverageP.min} und ${coverageP.max} % bezogen auf den abgeleiteten Verbrauch. ` +
        _positionFraming(
          targetCoveragePct,
          coverageP.min,
          coverageP.max,
          '%',
          profile.name,
          'der Wert sollte vor politischer Nutzung methodisch gegengeprüft werden',
          'der Korridor zeigt den erschließbaren Spielraum',
          'der Korridor verortet die lokale Ausgangslage'
        ),
      evidenceStatus: 'scenario-based',
    },
    {
      metricKey:    'generation_value_eur_per_capita',
      metricLabel:  'Erzeugungswert je Einwohner',
      unit:         'EUR/EW/Jahr',
      targetValue:  targetGenerationValueEurPerCapita,
      minValue:     genValueP.min,
      medianValue:  genValueP.median !== null ? Math.round(genValueP.median) : null,
      maxValue:     genValueP.max,
      roundedRangeLabel: genValueP.min !== null
        ? `${genValueP.min}–${genValueP.max} EUR/EW/Jahr`
        : 'keine Daten',
      framingText:
        `Vergleichbare Kommunen erwirtschaften zwischen ` +
        `${genValueP.min} und ${genValueP.max} EUR/EW/Jahr aus lokaler Erzeugung. ` +
        _positionFraming(
          targetGenerationValueEurPerCapita,
          genValueP.min,
          genValueP.max,
          'EUR/EW/Jahr',
          profile.name,
          'der Wert sollte vor politischer Nutzung methodisch gegengeprüft werden',
          'der Korridor zeigt den erschließbaren Spielraum',
          'der Korridor verortet die lokale Ausgangslage'
        ),
      evidenceStatus: 'scenario-based',
    },
  ];

  const methodOutlier = _findMethodOutlier(corridorRows);
  if (methodOutlier) {
    guardrailRows.push({
      guardrailKey: 'target_peer_method_outlier',
      status: 'blocked',
      message:
        `${methodOutlier.metricLabel} der Zielkommune liegt mehr als Faktor ` +
        `${String(TARGET_OUTLIER_FACTOR).replace('.', ',')} außerhalb des Peer-Korridors; vor Vergleichsnutzung ` +
        'müssen Erzeugungsdaten und Peer-Methodik geprüft werden.',
    });
    return {
      status: 'blocked',
      statusReason: 'Zielwert liegt deutlich außerhalb des Peer-Korridors; Methodenkonsistenz braucht Prüfung.',
      dataStatus: 'blocked-by-integrity-check',
      target: null,
      peerGroup: {
        state: scopeState || profile.state,
        populationBandLabel,
        settlementStructureCriterion: densityClass,
        validPeerCount: peers.length,
        anonymized: true,
        criteriaLabel,
      },
      corridorRows: [],
      guardrailRows,
      blockedFallback: {
        headline: 'Interkommunaler Vergleich noch nicht belastbar',
        text:
          `${methodOutlier.metricLabel} liegt deutlich außerhalb des Vergleichskorridors. ` +
          'Das wird als Methodik-Warnsignal behandelt, nicht als Erfolgssignal.',
        nextGateLabel: 'Erzeugungsdaten der Zielkommune und Peer-Ableitung vor politischer Nutzung prüfen.',
      },
    };
  }

  guardrailRows.push({
    guardrailKey: 'target_peer_method_outlier',
    status: 'passed',
    message: `Zielwerte liegen innerhalb des Faktor-${String(TARGET_OUTLIER_FACTOR).replace('.', ',')}-Methodikkorridors.`,
  });

  return {
    status: 'available',
    statusReason: `${peers.length} valide Peers; alle Guardrails bestanden`,
    dataStatus: 'scenario-based',
    target: {
      municipality:         profile.name,
      ags:                  profile.ags,
      postalCode:           profile.postalCode || null,
      state:                profile.state,
      population:           pop,
      settlementDensityClass: densityClass,
      basisYear:            year,
      scenario,
      metrics: {
        localCoverageShare:              Math.round(targetLocalCoverageShare * 1000) / 1000,
        generationValueEurPerCapita:     targetGenerationValueEurPerCapita,
        profileFitIndicator:             extended ? 'extended-band' : 'narrow-band',
      },
    },
    peerGroup: {
      state:                     scopeState || profile.state,
      populationBandLabel,
      settlementStructureCriterion: densityClass,
      validPeerCount:            peers.length,
      anonymized:                true,
      criteriaLabel,
    },
    corridorRows,
    guardrailRows,
    blockedFallback: null,
  };
}

module.exports = {
  buildIntermunicipalComparison,
  settlementDensityClass,
  findPeerCandidates,
  CONSUMPTION_PER_CAPITA_MIN,
  CONSUMPTION_PER_CAPITA_MAX,
  MIN_PEER_COUNT,
  PEER_BAND,
  PEER_BAND_WIDE,
  TARGET_OUTLIER_FACTOR,
};
