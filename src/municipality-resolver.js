'use strict';

/**
 * Municipality Resolver — read-only
 *
 * Three-layer design:
 *
 * Layer 1 — Authoritative AGS + Population (all of Germany):
 *   gemeinden-2022.json — derived from Destatis Gemeindegrenzen 2022 mit Einwohnerzahl
 *   (ArcGIS Hub Item 60eb682c95f44ba7b10fee66d871859d, GV100 Gebietsstand 2022-12-31)
 *   Covers 10,990 German municipalities with AGS, name, Bezeichnung, Bundesland,
 *   Einwohnerzahl (EWZ), and area (KFL km²).
 *   This is the authoritative source for AGS codes and population figures.
 *
 * Layer 2 — PLZ coverage (all of Germany):
 *   german-zip-codes npm package (19,670 PLZ, ~15,939 Ortsnamen, 16 Bundesländer).
 *   Used to link a 5-digit PLZ to a municipality name, which is then looked up in Layer 1.
 *   Provides no AGS or population on its own.
 *
 * Layer 3 — Energy profile overlay (selected municipalities):
 *   ENERGY_OVERLAY — explicit pvCapacityKw / biomassCapacityKw / windCapacityKw /
 *   optional storagePowerKw / storageCapacityKWh and gridOperatorLabel values keyed by AGS.
 *   For municipalities not in this overlay,
 *   energy capacity is estimated from population (BSW-Solar / DBFZ proxy formulas).
 *   Add or update entries here as verified MaStR data becomes available.
 *
 * Resolution order:
 *   AGS → Layer 1 direct lookup
 *   PLZ → Layer 2 name → Layer 1 name match → full profile
 *   Name → Layer 1 name match → full profile
 *
 * When a municipality is found in Layer 1 (AGS + population known), all calculations
 * (KAV rate, budget impact, energy estimation) can proceed.
 * When only Layer 2 (PLZ→name) resolves without a Layer 1 match: name and state known,
 * AGS and population null — downstream calculations must handle this gracefully.
 */

const { data: rawPlzData } = require('german-zip-codes/data/data');
const gemeindenData = require('./data/gemeinden-2022.json');

// ── KAV rates by population bracket (KAV § 2 Abs. 2, 1992) ───────────────────

function kavRateForPopulation(population) {
  if (!population) return null;
  if (population > 500000) return 2.39;
  if (population > 100000) return 1.99;
  if (population > 25000) return 1.59;
  return 1.32;
}

function kavKategorieForPopulation(population) {
  if (!population) return 'unbekannt';
  if (population > 500000) return 'Großstadt über 500.000 Einwohner';
  if (population > 100000) return 'Stadt mehr als 100.000 Einwohner';
  if (population > 25000) return 'Gemeinde über 25.000 bis 100.000 Einwohner';
  return 'Gemeinde bis 25.000 Einwohner';
}

// ── Energy profile overlay (selected municipalities) ─────────────────────────
// Keyed by AGS (authoritative from Destatis Layer 1).
// pvCapacityKw / biomassCapacityKw / windCapacityKw from MaStR-near data.
// gridOperatorLabel / gridOperatorBdewHint from known VNB mapping.

const ENERGY_OVERLAY = {
  '08226048': {
    pvCapacityKw: 2650,
    biomassCapacityKw: 500,
    windCapacityKw: 0,
    gridOperatorLabel: 'Stadtwerk Mauer GmbH',
    gridOperatorBdewHint: 'local-bw-vnb',
  }, // Mauer
  '08221000': {
    pvCapacityKw: 48000,
    biomassCapacityKw: 8000,
    windCapacityKw: 2000,
    gridOperatorLabel: 'Stadtwerke Heidelberg Netze GmbH',
    gridOperatorBdewHint: 'missing-evidence',
  }, // Heidelberg
  '08226098': {
    pvCapacityKw: 7200,
    biomassCapacityKw: 800,
    windCapacityKw: 0,
    gridOperatorLabel: 'Stadtwerke Wiesloch GmbH',
    gridOperatorBdewHint: 'local-bw-vnb',
  }, // Wiesloch
  '08226095': {
    pvCapacityKw: 5800,
    biomassCapacityKw: 200,
    windCapacityKw: 0,
    gridOperatorLabel: 'Stadtwerke Walldorf',
    gridOperatorBdewHint: 'missing-evidence',
  }, // Walldorf
  '08226076': {
    pvCapacityKw: 3900,
    biomassCapacityKw: 0,
    windCapacityKw: 0,
    gridOperatorLabel: 'Gemeindewerke Sandhausen',
    gridOperatorBdewHint: 'missing-evidence',
  }, // Sandhausen
};

// ── Energy profile estimation from population ─────────────────────────────────
// Applied only when population (ewz) is known.
// Source: BSW-Solar Marktdaten 2024, DBFZ Bioenergie-Report 2024.
// All estimated values must be marked sourceStatus:'estimated' by callers.

function estimateEnergyFromPopulation(pop, overlay) {
  return {
    pvCapacityKw:
      overlay && overlay.pvCapacityKw != null ? overlay.pvCapacityKw : Math.round(pop * 0.55),
    biomassCapacityKw:
      overlay && overlay.biomassCapacityKw != null
        ? overlay.biomassCapacityKw
        : pop < 10000
          ? Math.round(pop * 0.09)
          : Math.round(pop * 0.04),
    windCapacityKw: overlay && overlay.windCapacityKw != null ? overlay.windCapacityKw : 0,
    storagePowerKw: overlay && overlay.storagePowerKw != null ? overlay.storagePowerKw : 0,
    storageCapacityKWh:
      overlay && overlay.storageCapacityKWh != null ? overlay.storageCapacityKWh : null,
  };
}

// ── Build Layer 1 indexes (Destatis, by AGS and by normalized name) ───────────

const l1ByAgs = new Map(); // '05162028' → entry
const l1ByName = new Map(); // 'rommerskirchen' → entry  (largest match per normalized name)
const l1ByNameAll = new Map(); // 'leimen' → [entry Rheinland-Pfalz, entry Baden-Württemberg]

for (const entry of gemeindenData) {
  if (!entry.ags) continue;
  l1ByAgs.set(entry.ags, entry);
  const key = entry.name.toLowerCase().trim();
  if (!l1ByNameAll.has(key)) l1ByNameAll.set(key, []);
  l1ByNameAll.get(key).push(entry);
  const previous = l1ByName.get(key);
  if (!previous || (Number(entry.ewz) || 0) > (Number(previous.ewz) || 0)) {
    l1ByName.set(key, entry);
  }
}

function selectLayer1ByName(key, stateHint) {
  const matches = l1ByNameAll.get(key) || [];
  if (!matches.length) return null;
  if (stateHint) {
    const byState = matches.find((entry) => entry.state === stateHint);
    if (byState) return byState;
  }
  return [...matches].sort((a, b) => (Number(b.ewz) || 0) - (Number(a.ewz) || 0))[0];
}

// ── Build Layer 2 indexes (PLZ → name+state, name → all matching PLZ) ────────
//
// A municipality name maps to *every* PLZ row that names it (a city the size
// of Mannheim has 14+), not just the first one encountered — collected here
// so buildFullProfile() can return a complete postalCodes[] instead of a
// single-element array wrapping one arbitrary PLZ (the previous behaviour,
// which silently discarded every PLZ after the first for any multi-PLZ
// municipality).

const l2PlzToOrt = new Map(); // '41569' → { name:'Rommerskirchen', state:'Nordrhein-Westfalen' }
const l2NameToPlzList = new Map(); // 'mannheim' → ['68159', '68161', ...] (all PLZ for this name, any state)
const l2NameStatePlzList = new Map(); // 'leimen|Baden-Württemberg' → ['69181', ...] (state-scoped subset)

for (const row of rawPlzData) {
  const plzStr = String(row.plz).padStart(5, '0');
  const name = row.ort;
  if (!plzStr || !name) continue;
  if (!l2PlzToOrt.has(plzStr)) l2PlzToOrt.set(plzStr, { name, state: row.bundesland });
  const key = name.toLowerCase().trim();
  if (!l2NameToPlzList.has(key)) l2NameToPlzList.set(key, []);
  l2NameToPlzList.get(key).push(plzStr);
  const stateKey = `${key}|${row.bundesland || ''}`;
  if (!l2NameStatePlzList.has(stateKey)) l2NameStatePlzList.set(stateKey, []);
  l2NameStatePlzList.get(stateKey).push(plzStr);
}

/**
 * All known PLZ for a municipality name, preferring the state-scoped set
 * (avoids mixing in PLZ from a different, identically-named municipality in
 * another Bundesland) and falling back to the name-only set otherwise.
 * @param {string} nameKey  Lowercased, trimmed municipality name.
 * @param {string} [state]
 * @returns {string[]} deduplicated, numerically sorted PLZ list
 */
function allPostalCodesForName(nameKey, state) {
  const stateList = l2NameStatePlzList.get(`${nameKey}|${state || ''}`);
  const list = stateList && stateList.length ? stateList : l2NameToPlzList.get(nameKey) || [];
  return [...new Set(list)].sort();
}

// ── Helper: build a full return profile from a Layer 1 entry ─────────────────

function buildFullProfile(l1Entry, resolvedPlz, fallbackName) {
  const overlay = ENERGY_OVERLAY[l1Entry.ags] || null;
  const pop = l1Entry.ewz || 0;
  const energy =
    pop > 0
      ? estimateEnergyFromPopulation(pop, overlay)
      : {
          pvCapacityKw: 0,
          biomassCapacityKw: 0,
          windCapacityKw: 0,
          storagePowerKw: 0,
          storageCapacityKWh: null,
        };
  const hasExplicitEnergy = overlay && overlay.pvCapacityKw != null;
  const nameKey = String(l1Entry.name || fallbackName || '')
    .toLowerCase()
    .trim();
  const postalCodes = allPostalCodesForName(nameKey, l1Entry.state);
  if (resolvedPlz && !postalCodes.includes(resolvedPlz)) postalCodes.unshift(resolvedPlz);
  const postalCode = resolvedPlz || postalCodes[0] || null;

  return {
    found: true,
    name: l1Entry.name,
    bez: l1Entry.bez || null,
    ags: l1Entry.ags,
    postalCode,
    postalCodes,
    state: l1Entry.state || null,
    district: null,
    population: pop || null,
    areaSqKm: l1Entry.kfl || null,
    pvCapacityKw: energy.pvCapacityKw,
    biomassCapacityKw: energy.biomassCapacityKw,
    windCapacityKw: energy.windCapacityKw,
    storagePowerKw: energy.storagePowerKw,
    storageCapacityKWh: energy.storageCapacityKWh,
    storageEvidenceStatus: energy.storagePowerKw > 0 ? 'assumption-backed' : 'missing-evidence',
    gridOperatorLabel:
      (overlay && overlay.gridOperatorLabel) ||
      `${l1Entry.state || 'lokaler'} Netzbetreiber (aufgeloest)`,
    gridOperatorBdewHint: (overlay && overlay.gridOperatorBdewHint) || 'missing-evidence',
    konzessionsabgabeKategorie: kavKategorieForPopulation(pop),
    kavRateNsCtPerKwh: kavRateForPopulation(pop),
    avgHouseholdConsumptionKwh: pop > 100000 ? 2200 : pop > 25000 ? 2300 : 2450,
    avgHouseholdsPerEinwohner: pop > 100000 ? 0.5 : pop > 25000 ? 0.46 : 0.44,
    sourceLabel: `Destatis Gemeindegrenzen 2022 (GV100)${hasExplicitEnergy ? '; MaStR-nahe Erzeugungsdaten' : '; Erzeugungsprofil bevoelkerungsbasiert geschaetzt (BSW-Solar/DBFZ 2024)'}`,
    sourceStatus: hasExplicitEnergy ? 'assumption-backed' : 'estimated',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a municipality profile from name, PLZ, or AGS.
 *
 * Return states:
 *  found:true  + population != null  → AGS + Einwohner known; full calculations enabled
 *  found:true  + population = null   → name+state identified via PLZ (no AGS/Einwohner);
 *                                       KAV/budget/energy calculations not possible;
 *                                       sourceStatus:'plz-lookup-only'
 *  found:false                       → completely unresolved
 */
function resolveMunicipalityProfile({ municipality, ags } = {}) {
  const raw = String(municipality || '').trim();
  const agsIn = String(ags || '').trim();

  let l1Entry = null;
  let resolvedPlz = null;
  let l2Result = null;

  // ─ 1. AGS → Layer 1 direct ────────────────────────────────────────────────
  if (agsIn && l1ByAgs.has(agsIn)) {
    l1Entry = l1ByAgs.get(agsIn);
  }

  // ─ 2. PLZ input ───────────────────────────────────────────────────────────
  else if (/^\d{5}$/.test(raw)) {
    resolvedPlz = raw;
    const plzOrt = l2PlzToOrt.get(raw);
    if (plzOrt) {
      const key = plzOrt.name.toLowerCase().trim();
      l1Entry = selectLayer1ByName(key, plzOrt.state) || null;
      if (!l1Entry) l2Result = plzOrt;
    }
  }

  // ─ 3. Name input ──────────────────────────────────────────────────────────
  else if (raw) {
    const key = raw
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, '')
      .trim();
    l1Entry = selectLayer1ByName(key) || null;

    if (!l1Entry) {
      const candidates = [];
      for (const [k, entries] of l1ByNameAll) {
        if (k.startsWith(key) || key.startsWith(k)) candidates.push(...entries);
      }
      if (candidates.length) {
        l1Entry = candidates.sort((a, b) => (Number(b.ewz) || 0) - (Number(a.ewz) || 0))[0];
      }
    }

    if (!l1Entry) {
      const plzStr = (l2NameToPlzList.get(key) || [])[0] || null;
      if (plzStr) {
        resolvedPlz = plzStr;
        l2Result = l2PlzToOrt.get(plzStr) || null;
      }
    }
  }

  // ─ Full Layer 1 match ─────────────────────────────────────────────────────
  if (l1Entry) {
    return buildFullProfile(l1Entry, resolvedPlz, raw);
  }

  // ─ Layer 2 only (PLZ→name resolved; no AGS/population) ───────────────────
  if (l2Result) {
    const postalCodes = allPostalCodesForName(l2Result.name.toLowerCase().trim(), l2Result.state);
    if (resolvedPlz && !postalCodes.includes(resolvedPlz)) postalCodes.unshift(resolvedPlz);
    return {
      found: true,
      name: l2Result.name,
      bez: null,
      ags: null,
      postalCode: resolvedPlz || postalCodes[0] || null,
      postalCodes,
      state: l2Result.state || null,
      district: null,
      population: null,
      areaSqKm: null,
      pvCapacityKw: 0,
      biomassCapacityKw: 0,
      windCapacityKw: 0,
      gridOperatorLabel: 'Netzbetreiber nicht aufgeloest',
      gridOperatorBdewHint: 'missing-evidence',
      konzessionsabgabeKategorie: 'unbekannt',
      kavRateNsCtPerKwh: null,
      avgHouseholdConsumptionKwh: 2400,
      avgHouseholdsPerEinwohner: 0.45,
      sourceLabel:
        'PLZ-Lookup (OpenPLZ via german-zip-codes); AGS und Einwohnerzahl fehlen — kein Destatis-GV100-Treffer; KAV/Budgetberechnung nicht moeglich',
      sourceStatus: 'plz-lookup-only',
    };
  }

  // ─ Completely unresolved ──────────────────────────────────────────────────
  return {
    found: false,
    name: raw || null,
    bez: null,
    ags: agsIn || null,
    postalCode: null,
    postalCodes: [],
    state: null,
    district: null,
    population: null,
    areaSqKm: null,
    pvCapacityKw: 0,
    biomassCapacityKw: 0,
    windCapacityKw: 0,
    gridOperatorLabel: 'Netzbetreiber nicht aufgeloest',
    gridOperatorBdewHint: 'missing-evidence',
    konzessionsabgabeKategorie: 'unbekannt',
    kavRateNsCtPerKwh: null,
    avgHouseholdConsumptionKwh: 2400,
    avgHouseholdsPerEinwohner: 0.45,
    sourceLabel: 'Gemeinde nicht aufgeloest (weder in Destatis GV100 2022 noch in PLZ-Lookup)',
    sourceStatus: 'missing-evidence',
  };
}

module.exports = { resolveMunicipalityProfile, gemeindenData };
