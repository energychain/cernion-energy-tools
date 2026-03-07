/**
 * Utility Report Service
 *
 * Generates comprehensive 360° Management Reports for German energy utility
 * decision-makers (Stadtwerke, Energieversorger).
 *
 * Features:
 *  - Sequential 4-phase pipeline covering 8 KPI sections
 *  - 7-day disk cache with UUID filenames (.reports/UUID.html)
 *  - Per-phase progress tracking for resumability (.reports/UUID.progress.json)
 *  - Graceful degradation: unavailable/unknown MCP tools return { available: false }
 *  - cernion_discover preflight to verify live tool availability
 *  - Gemini narrative for management summary (optional – falls back to static template)
 *  - Pure-HTML output designed for browser print-to-PDF
 *
 * Endpoints:
 *  POST   /api/utility-report/generate          – start or resume report generation
 *  GET    /api/utility-report/status/:reportId  – poll generation progress
 *  GET    /api/utility-report/download/:reportId – download completed HTML report
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { GoogleGenerativeAI } = require('@google/generative-ai');

const CernionMCPClient = require('../src/mcp-client');
const { buildHtmlReport, summarizeForReport } = require('../src/report-builder');
const { DataStatus, ds } = require('../src/data-status');

// ─── Constants ─────────────────────────────────────────────────────────────────

const REPORTS_DIR = path.join(__dirname, '..', '.reports');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Directory helpers ─────────────────────────────────────────────────────────

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function reportPath(reportId) {
  return path.join(REPORTS_DIR, `${reportId}.html`);
}

function progressPath(reportId) {
  return path.join(REPORTS_DIR, `${reportId}.progress.json`);
}

function loadProgress(reportId) {
  const file = progressPath(reportId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function saveProgress(progress) {
  ensureReportsDir();
  fs.writeFileSync(progressPath(progress.reportId), JSON.stringify(progress, null, 2));
}

function reportExists(reportId) {
  const file = reportPath(reportId);
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
}

// ─── Cache key ─────────────────────────────────────────────────────────────────

function buildCacheKey(utilityName, date) {
  const normalized = utilityName.toLowerCase().trim();
  return crypto.createHash('sha256').update(JSON.stringify({ utilityName: normalized, date })).digest('hex');
}

function findCachedReport(utilityName, date) {
  ensureReportsDir();
  const key = buildCacheKey(utilityName, date);
  const indexFile = path.join(REPORTS_DIR, 'index.json');
  if (!fs.existsSync(indexFile)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    const entry = index[key];
    if (!entry) return null;
    if (reportExists(entry.reportId)) return entry.reportId;
    // Expired – remove index entry
    delete index[key];
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    return null;
  } catch {
    return null;
  }
}

function indexReport(utilityName, date, reportId) {
  ensureReportsDir();
  const key = buildCacheKey(utilityName, date);
  const indexFile = path.join(REPORTS_DIR, 'index.json');
  let index = {};
  if (fs.existsSync(indexFile)) {
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf-8')); } catch { /* ignore */ }
  }
  index[key] = { reportId, createdAt: new Date().toISOString() };
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
}

// ─── Graceful MCP call ─────────────────────────────────────────────────────────

/**
 * Call a Cernion MCP tool directly (not via a wrapped Moleculer service).
 * Used for tools that are not yet wrapped as services, or for the discover preflight.
 * Never throws – returns { available: false, error } on any failure.
 */
async function callMcpDirect(toolName, params, token) {
  const TIMEOUT_MS = 30_000;
  try {
    const callPromise = CernionMCPClient.callWithNewSession(toolName, params, token || null);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
    );
    const result = await Promise.race([callPromise, timeoutPromise]);
    if (!result || result.success === false) {
      return { available: false, error: result?.error?.message || 'Tool returned error' };
    }
    return { available: true, data: result.data ?? result };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/**
 * Safely call a Moleculer broker service action.
 * Never throws – returns { available: false } on any failure.
 */
async function callBroker(ctx, action, params) {
  try {
    const result = await ctx.broker.call(action, params, {
      meta: ctx.meta,
      timeout: 30_000, // 30 s – never block the report pipeline longer than this
    });
    return { available: true, data: result };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

// ─── Discover preflight ────────────────────────────────────────────────────────

/**
 * Call cernion_discover to get live tool list.
 * Returns a Set of tool names.
 */
async function discoverAvailableTools(token) {
  try {
    const result = await CernionMCPClient.callWithNewSession('cernion_discover', {}, token || null);
    if (!result || result.success === false) return new Set();

    // Try to extract tool names from response
    const toolNames = [];
    const data = result.data ?? result;

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item?.name) toolNames.push(item.name);
        if (typeof item === 'string') toolNames.push(item);
      }
    } else if (data?.tools && Array.isArray(data.tools)) {
      for (const t of data.tools) {
        if (t?.name) toolNames.push(t.name);
        else if (typeof t === 'string') toolNames.push(t);
      }
    } else if (data?.content && Array.isArray(data.content)) {
      // Content may contain a JSON string
      const text = data.content[0]?.text ?? '';
      try {
        const parsed = JSON.parse(text);
        const tools = parsed.tools ?? parsed;
        if (Array.isArray(tools)) {
          tools.forEach((t) => t?.name && toolNames.push(t.name));
        }
      } catch { /* ignore */ }
    }

    return new Set(toolNames);
  } catch {
    return new Set();
  }
}

// ─── Gemini narrative ──────────────────────────────────────────────────────────

async function generateNarrative(utilityName, kpiSummary) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildStaticNarrative(utilityName, kpiSummary);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // CR-30: Strip internal camelCase field names (warnings, flags, status enums)
    //         from the LLM context so they cannot be echoed into customer-facing text.
    const INTERNAL_KEY_RE = /(Warning|Error|Fallback|Flag|Raw|isError|DataStatus|_count$)/;
    const cleanedSummary = Object.fromEntries(
      Object.entries(kpiSummary)
        .map(([k, v]) => [
          k,
          v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v).filter(([ik]) => !INTERNAL_KEY_RE.test(ik))
              )
            : v,
        ])
        .filter(([k]) => !INTERNAL_KEY_RE.test(k))
    );
    const summaryJson = JSON.stringify(cleanedSummary, null, 2).slice(0, 4000);
    const prompt = `Du bist ein Energieberater für integrierte Stadtwerke und erstellst eine Management Summary für "${utilityName}".

Basierend auf diesen KPI-Daten:
${summaryJson}

Erstelle 5 prägnante, handlungsorientierte Erkenntnisse auf Deutsch (jeweils 1–2 Sätze).
Format: Eine Erkenntnis pro Zeile, beginnend mit Emoji und Stichwort.

Priorisierungsregel (IMMER in dieser Reihenfolge einhalten):
1. Compliance-Risiken mit Frist (§11 EnWG Engpassmeldung, §118 EnWG Prüffristen, §12 StromNZV MeLo-Pflicht) – IMMER zuerst
2. Finanzielle Hebel >10.000 €/Jahr (Residuallast × Day-Ahead-Preis, MeLo-Fehler × ~3.000 €/Anlage/Jahr Redispatch-Abrechnung)
3. Strategische Chancen (Top-Quartil EWK-Rang = NEST-Vorteil, 100 % Umsetzungsquote = Wettbewerbsvorteil, Prosumer-Leads)
4. Monitoring-Hinweise (grüne Kennzahlen, EU-Gasfüllstand, CO₂-Intensität)

Kontext-Regeln (IMMER anwenden):
- EWK-Rang als Quartil + NEST-Konsequenz: Top-25 % = finanzieller NEST-Vorteil; Bottom-25 % = regulatorischer EO-Nachteil. Nie nur "Rang X von Y" ohne Interpretation.
- Anschlussdauer: Delta zum Bundesmedian benennen (X Wo. über/unter Median N Wo.)
- MeLo-Lücken + Fotojahr 2026: auf 60 Monate Wirkung auf Erlösobergrenze hinweisen
- 1 MW Residuallast ≈ 1,05 Mio. €/Jahr – monetarisieren wenn Residuallast-Daten vorhanden
- Umsetzungsquote 100 % = echter Wettbewerbsvorteil im EWK-Benchmarking, aktiv kommunizieren

Verboten (NIE ausgeben):
- camelCase-Variablennamen oder technische Feldnamen
- Generische Phrasen ohne Zahlenbasis ("gute Netzstabilität", "effizientes Management")
- Sätze ohne konkreten Handlungsauftrag oder numerische Grundlage
Keine Überschriften, keine Nummerierung, nur die 5 Erkenntnisse.`;

    const result = await model.generateContent(prompt);
    const text = result.response?.text?.() ?? '';
    return text.trim().length > 50 ? text.trim() : buildStaticNarrative(utilityName, kpiSummary);
  } catch {
    return buildStaticNarrative(utilityName, kpiSummary);
  }
}

function buildStaticNarrative(utilityName, kpiSummary) {
  // CR-09/CR-16: Data-driven findings, typed by criticality, max 5 total, max 2 opportunities
  const summaryItems = [];

  // ── Anschlussdauer vs. Bundesmedian (Section 5, with quartile + NEST consequence) ──
  const vnbAd = kpiSummary?.anschlussdauer?.['rows.0.ee_ns_gesamt_wochen'] ?? null;
  const medianAd = kpiSummary?.anschlussdauer?.['stats.ee_ns_gesamt.median'] ?? null;
  const adRankSt = kpiSummary?.anschlussdauer?.['rankings.anschlussdauer_ee_ns_rank'] ?? null;
  const adTotalSt = kpiSummary?.anschlussdauer?.['rankings.anschlussdauer_ee_ns_total'] ?? null;
  const adQuartilSt = (() => {
    if (adRankSt === null || adTotalSt === null || adTotalSt === 0) return null;
    const pct = adRankSt / adTotalSt;
    if (pct <= 0.25) return { label: 'Top-25 %', nest: 'finanzieller NEST-Vorteil' };
    if (pct <= 0.50) return { label: '25–50 %', nest: 'kein Risiko' };
    if (pct <= 0.75) return { label: '50–75 %', nest: 'EO-Druck möglich (Fotojahr-Logik)' };
    return { label: 'Bottom-25 %', nest: 'regulatorischer EO-Nachteil' };
  })();
  if (vnbAd !== null && medianAd !== null) {
    const delta = Number(vnbAd) - Number(medianAd);
    const quartilCtx = adQuartilSt ? ` (${adQuartilSt.label} – ${adQuartilSt.nest})` : '';
    if (delta > 13) {
      summaryItems.push({
        prio: 1, type: 'critical', icon: '🚨',
        text: `Anschlussdauer ${Number(vnbAd).toFixed(0)} Wo. – ${Math.round(delta)} Wo. über Bundesmedian (${Number(medianAd).toFixed(0)} Wo.)${quartilCtx}. Sofortiger Handlungsbedarf – BNetzA-Beschwerderisiko bei >13 Wochen.`,
      });
    } else if (delta > 0) {
      summaryItems.push({
        prio: 2, type: 'warning', icon: '⚠️',
        text: `Anschlussdauer ${Number(vnbAd).toFixed(0)} Wo. – ${Math.round(delta)} Wo. über Bundesmedian (${Number(medianAd).toFixed(0)} Wo.)${quartilCtx}. Phase 1 und Phase 2 optimieren.`,
      });
    } else {
      summaryItems.push({
        prio: 4, type: 'opportunity', icon: '✅',
        text: `Anschlussdauer ${Number(vnbAd).toFixed(0)} Wo. – ${Math.abs(Math.round(delta))} Wo. unter Bundesmedian (${Number(medianAd).toFixed(0)} Wo.)${quartilCtx}. Als Wettbewerbsvorteil aktiv kommunizieren.`,
      });
    }
  }

  // ── MeLo-Lücken + Fotojahr 2026 (Section 1) ──────────────────────────────
  const ohneMeloCount = kpiSummary?.meloCheck?.anlagen_ohne_melo ?? null;
  if (ohneMeloCount !== null && ohneMeloCount > 0) {
    const totalGe100 = kpiSummary?.meloCheck?.anlagen_gesamt_ge100kw ?? '?';
    summaryItems.push({
      prio: 1, type: 'critical', icon: '🔗',
      text: `Redispatch-Anlagen ohne MeLo: ${ohneMeloCount} von ${totalGe100} ≥100-kW-Anlagen – ohne Messlokation sind Redispatch-Kosten nicht abrechnebar (~3.000 €/Anlage/Jahr, §12 StromNZV). MaStR-Stammdaten bis Fotojahr 2026 (Q1) korrigieren – Fehler wirken 60 Monate auf Erlösobergrenze.`,
    });
  }

  // ── Gas fill level (Section 4) ────────────────────────────────────────────
  const gasFillPct =
    kpiSummary?.countryStorage?.['storage.fillPercentage'] ??
    kpiSummary?.countryStorage?.['storage.full'] ??
    null;
  if (gasFillPct !== null) {
    if (gasFillPct < 25) {
      summaryItems.push({
        prio: 1, type: 'critical', icon: '⛽',
        text: `Gasfüllstand DE ${Number(gasFillPct).toFixed(1)} % – kritisch unter EU-Mandat. Krisenplan aktivieren und Einspeisung sofort priorisieren (VO 2022/1032).`,
      });
    } else if (gasFillPct < 70) {
      summaryItems.push({
        prio: 2, type: 'warning', icon: '⛽',
        text: `Gasfüllstand DE ${Number(gasFillPct).toFixed(1)} % – unter EU-90%-Mandat. Einspeisung priorisieren, Lieferverträge auf Abrufoptionen prüfen.`,
      });
    } else {
      summaryItems.push({
        prio: 4, type: 'opportunity', icon: '✅',
        text: `Gasfüllstand DE ${Number(gasFillPct).toFixed(1)} % – EU-Mandat-compliant (≥90 %: ${gasFillPct >= 90 ? 'erfüllt' : 'im Plan'}). Versorgungssicherheit gewährleistet.`,
      });
    }
  }

  // ── Redispatch Anlagen (Section 1) ───────────────────────────────────────
  const rdTotal =
    kpiSummary?.redispatchExport?.totalCount ??
    kpiSummary?.redispatchExport?.count ??
    null;
  if (rdTotal !== null) {
    summaryItems.push({
      prio: 2, type: 'warning', icon: '⚡',
      text: `Netzbetrieb: ${rdTotal} Redispatch-Anlagen ≥100 kW identifiziert – §12 StromNZV-Meldefrist und Redispatch-2.0-Einbindung sicherstellen.`,
    });
  }

  // ── EE-Portfolio (Section 2) ──────────────────────────────────────────────
  const pvKw =
    kpiSummary?.solar?.totalCapacityKw ??
    kpiSummary?.pvLocal?.['stats.totalCapacityKW'] ??
    null;
  const pvCount =
    kpiSummary?.solar?.totalCount ??
    kpiSummary?.pvLocal?.['stats.total'] ??
    null;
  if (pvKw !== null) {
    const pvMw = (Number(pvKw) / 1000).toFixed(1);
    const countPart = pvCount !== null ? `, ${pvCount} Anlagen` : '';
    summaryItems.push({
      prio: 3, type: 'opportunity', icon: '🌱',
      text: `EE-Portfolio: ${pvMw} MW installierte PV-Leistung${countPart} im Netzgebiet (MaStR). Direktvermarktung und Redispatch-Pool weiter ausbauen.`,
    });
  }

  // ── CO₂ intensity (Section 1) ─────────────────────────────────────────────
  const co2Val =
    kpiSummary?.co2Intensity?.co2_intensity_gco2eq_kwh ??
    kpiSummary?.co2Intensity?.average_today_gco2eq_kwh ??
    null;
  if (co2Val !== null) {
    summaryItems.push({
      prio: 3, type: 'opportunity', icon: '💡',
      text: `CO₂-Intensität ${Math.round(Number(co2Val))} gCO₂eq/kWh – Grünstromzeiten für §14a-Steuerung und Kundenmarketing-Fenster nutzen.`,
    });
  }

  // ── Day-ahead price (Section 3) ───────────────────────────────────────────
  const latestDaPrice =
    kpiSummary?.prices?.latestPrice ??
    kpiSummary?.prices?.currentPrice ??
    null;
  if (latestDaPrice !== null) {
    summaryItems.push({
      prio: 3, type: 'opportunity', icon: '📈',
      text: `Energiemarkt: Day-Ahead-Preis ${Number(latestDaPrice).toFixed(2)} €/MWh – Beschaffungsoptimierung und Tarifanpassung quartalsweise prüfen.`,
    });
  }

  // ── CR-16: Limit to max 5 points; critical/warning always first, max 2 opportunities ──
  const criticals = summaryItems.filter((i) => i.type !== 'opportunity');
  const opportunities = summaryItems.filter((i) => i.type === 'opportunity').slice(0, 2);
  const sorted = [...criticals, ...opportunities].sort((a, b) => a.prio - b.prio).slice(0, 5);

  // Fallback: ensure at least 3 items when data is sparse
  if (sorted.length < 3) {
    if (!sorted.some((s) => s.icon === '🏛️')) {
      sorted.push({
        prio: 5, type: 'opportunity', icon: '🏛️',
        text: 'BNetzA EWK-Benchmarkdaten (Anschlussdauer, Digitalisierungsindex, Umsetzungsquote) wurden ausgewertet.',
      });
    }
    if (!sorted.some((s) => s.icon === '👥')) {
      sorted.push({
        prio: 5, type: 'opportunity', icon: '👥',
        text: 'Kunden & Vertrieb: Churn-Risiken und Neukundenpotenziale aus dem Netzgebiet wurden identifiziert.',
      });
    }
  }

  const result = sorted.slice(0, 5).map((s) => `${s.icon} ${s.text}`).join('\n');
  if (!process.env.GEMINI_API_KEY) {
    return result + '\n📋 Hinweis: Für eine KI-gestützte Analyse aktivieren Sie GEMINI_API_KEY in der .env-Konfiguration.';
  }
  return result;
}

// ─── Pipeline phase helper ─────────────────────────────────────────────────────

/**
 * Run a collection step only if its tool is in the available tools set
 * (or if availableTools is empty, meaning discover failed).
 *
 * @param {Set}      availableTools  - from discover preflight (empty = unknown)
 * @param {string[]} toolNames       - MCP tool names required by this step
 * @param {Function} fn              - async () => callBroker / callMcpDirect
 * @returns {Promise<object>} { available, data?, error? }
 */
async function gated(availableTools, toolNames, fn) {
  // If discover returned data, check gating; if empty set (preflight failed), allow all
  const allKnown =
    availableTools.size === 0 ||
    toolNames.every((t) => availableTools.has(t));

  if (!allKnown) {
    return { available: false, error: 'Tool not available at live backend' };
  }
  return fn();
}

// ─── VNB resolution helpers (CR-18) ──────────────────────────────────────────

/**
 * Build a ranked list of search queries for a utility name.
 * Tries the original input first, then a stripped city-only variant,
 * then a "Stadtwerke <city>" variant if the input looks like a bare city name.
 *
 * Examples:
 *   "Stadtwerke Eberbach"     → ["Stadtwerke Eberbach", "Eberbach"]
 *   "Eberbach"                → ["Eberbach", "Stadtwerke Eberbach"]
 *   "TWL Netz GmbH"           → ["TWL Netz GmbH", "TWL"]
 */
function buildVnbSearchQueries(name) {
  const queries = [name];
  const stripped = name
    .replace(/\b(Stadtwerke|Stadtwerk|Gemeindewerk|Gemeindewerke|Energieversorgung|EVN|Netz\s+GmbH|Netz\s+AG|Netze\s+GmbH|Netze\s+AG|GmbH\s+&\s+Co\.\s+KG|GmbH|AG|mbH|KG)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // cityStripped: the bare city/company token after removing all org suffixes
  const cityStripped = stripped && stripped !== name && stripped.length > 2 ? stripped : null;
  if (cityStripped) {
    queries.push(cityStripped);
  }
  const hasOrgPrefix = /\b(Stadtwerke|Stadtwerk|Netz|Gemeindewerk|EVN|Energieversorgung)\b/i.test(name);
  // For bare city/short names: try BOTH plural and singular Stadtwerk variants.
  // e.g. "Eberbach" → "Stadtwerke Eberbach" AND "Stadtwerk Eberbach"
  if (!hasOrgPrefix && name.split(/\s+/).length <= 2) {
    queries.push(`Stadtwerke ${name}`); // plural
    queries.push(`Stadtwerk ${name}`);  // singular – actual entity may use either form
  }
  // Cross-variant: "Stadtwerke" (plural) → also try "Stadtwerk" (singular) with stripped city.
  // e.g. "Stadtwerke Eberbach" → "Stadtwerk Eberbach"
  if (cityStripped && /\bStadtwerke\b/i.test(name)) {
    queries.push(`Stadtwerk ${cityStripped}`);
  }
  // Cross-variant: "Stadtwerk" (singular, not plural) → also try "Stadtwerke" (plural).
  // e.g. "Stadtwerk Eberbach GmbH" → "Stadtwerke Eberbach"
  if (cityStripped && /\bStadtwerk\b/i.test(name) && !/\bStadtwerke\b/i.test(name)) {
    queries.push(`Stadtwerke ${cityStripped}`);
  }
  return [...new Set(queries)];
}

/**
 * Among market-partner candidates, prefer the one with a VNB/Netzbetreiber role
 * (a Stadtwerk may appear with multiple BDEW codes for different market roles).
 * Falls back to the first result when no VNB role is found.
 * Also normalises the BDEW and MaStR-ID into predictable field names.
 */
function pickBestVnbPartner(marketPartnersResult) {
  const candidates =
    marketPartnersResult?.data?.results ||
    marketPartnersResult?.results ||             // CR-23: sync MCP path (results at top level)
    marketPartnersResult?.data?.data?.results ||
    marketPartnersResult?.data?.partners ||
    [];
  if (!candidates.length) return null;

  /**
   * Normalise mastrIds object ({ SNB: 'SNB…', GNB: 'GNB…' }) to a single mastrId field.
   * Mutates the candidate in place (candidates are plain objects from mock/API).
   */
  function normaliseMastrIds(p) {
    if (!p.mastrId && !p.gridOperatorMastrId && p.mastrIds && typeof p.mastrIds === 'object') {
      p.mastrId = p.mastrIds.SNB || p.mastrIds.GNB || Object.values(p.mastrIds)[0] || null;
    }
    return p;
  }

  // 1. Prefer explicit VNB / Netzbetreiber role
  const vnbPartner = candidates.find((p) => {
    const roles = p.roles ?? p.marketRoles ?? [];
    return roles.some((r) => /VNB|Verteilnetz|Netzbetreiber/i.test(r));
  });
  if (vnbPartner) return normaliseMastrIds(vnbPartner);

  // CR-23: 2. Prefer company name containing "Netz" – strong indicator of German grid operator
  // (e.g. "Stadtwerke Heidelberg Netze GmbH" over "Stadtwerke Heidelberg Energie GmbH")
  const netzPartner = candidates.find((p) => {
    const name = p.companyName || p.name || p.displayName || '';
    return /\bNetz(e)?\b/i.test(name);
  });
  if (netzPartner) return normaliseMastrIds(netzPartner);

  // 3. Fallback: first result
  return normaliseMastrIds(candidates[0]);
}

function normalizeLookupText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeLookupText(value) {
  return normalizeLookupText(value)
    .split(' ')
    .filter((t) => t.length > 1 && !/^(gmbh|ag|mbh|kg|co|und|stadtwerke|stadtwerk|netze|netz|energie|gmbhco)$/.test(t));
}

function scoreVnbCandidate(candidate, query, region = '', explicitBdew = '') {
  const name = candidate?.name || '';
  const city = candidate?.city || '';
  const bdewCode = candidate?.bdew || candidate?.bdewCode || '';
  const roles = candidate?.roles || [];

  const queryTokens = tokenizeLookupText(query);
  const nameTokens = tokenizeLookupText(name);
  const regionTokens = tokenizeLookupText(region);

  const overlap = queryTokens.filter((t) => nameTokens.includes(t)).length;
  const overlapScore = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
  const nameNorm = normalizeLookupText(name);
  const queryNorm = normalizeLookupText(query);
  const cityNorm = normalizeLookupText(city);
  const hasSubstring = queryNorm && (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm));
  const regionBoost = regionTokens.some((t) => nameTokens.includes(t) || cityNorm.includes(t)) ? 0.12 : 0;
  const roleBoost = roles.some((r) => /VNB|Verteilnetz|Netzbetreiber/i.test(r)) ? 0.15 : 0;
  const prefixBoost = String(bdewCode).startsWith('990') ? 0.08 : 0;
  const bdewBoost = explicitBdew && bdewCode === explicitBdew ? 1 : 0;

  const score = Math.min(1, bdewBoost || (overlapScore * 0.65 + (hasSubstring ? 0.15 : 0) + regionBoost + roleBoost + prefixBoost));
  return { score, name, city, bdew: bdewCode, mastrId: candidate?.mastrId || null, roles };
}

function resolveVnbCandidate(candidates, utilityName, region = '', explicitBdew = '') {
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map((c) => ({
      ...c,
      bdew: c?.bdew || c?.bdewCode || null,
      mastrId: c?.mastrId || c?.gridOperatorMastrId || null,
    }));

  if (!normalized.length) {
    return { selected: null, ambiguous: false, reason: 'no-candidates', ranking: [] };
  }

  const ranking = normalized
    .map((c) => ({ candidate: c, ...scoreVnbCandidate(c, utilityName, region, explicitBdew) }))
    .sort((a, b) => b.score - a.score);

  if (explicitBdew) {
    const byBdew = ranking.find((r) => r.bdew === explicitBdew);
    if (byBdew) {
      return {
        selected: byBdew.candidate,
        ambiguous: false,
        reason: 'explicit-bdew-match',
        ranking,
      };
    }
  }

  const top = ranking[0];
  const second = ranking[1] || null;
  const confidence = top?.score ?? 0;
  const margin = second ? confidence - second.score : confidence;
  const ambiguous = ranking.length > 1 && (confidence < 0.9 || margin < 0.08);

  return {
    selected: ambiguous ? null : top?.candidate ?? null,
    ambiguous,
    reason: ambiguous ? 'low-confidence-or-close-match' : 'high-confidence-match',
    ranking,
  };
}

function findPartnerByBdew(partners, bdewCode) {
  if (!Array.isArray(partners) || !bdewCode) return null;
  return partners.find((p) => (p?.bdew || p?.bdewCode) === bdewCode) || null;
}

// ─── VNB fingerprint check (CR-15) ───────────────────────────────────────────

/**
 * Fields that MUST differ between VNBs. Identical values across VNBs indicate
 * hardcoded fallback/dummy values slipping through as real data.
 */
const VNB_SPECIFIC_FIELDS = [
  'churnScore',
  'gefaehrdeteKunden',
  'residuallastRegional',
  'installierte_pv_leistung',
  'anzahl_pv_anlagen',
  'anschlussdauer_ee_ns',
  'digitalisierungsindex',
];

/**
 * Compare kpiSummary fields against previously generated reports stored in .reports/.
 * Logs a warning for any field that carries an identical value across reports.
 * Marks such fields as DataStatus.FALLBACK in the returned warnings list.
 *
 * @param {object} currentKpi    - Flat kpi summary for the report being built
 * @param {string} currentReportId
 * @param {object} logger        - Moleculer logger
 * @returns {string[]}           - List of warning message strings
 */
function validateVnbUniqueness(currentKpi, currentReportId, logger) {
  const warnings = [];
  try {
    ensureReportsDir();
    const indexFile = path.join(REPORTS_DIR, 'index.json');
    if (!fs.existsSync(indexFile)) return warnings;
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));

    for (const entry of Object.values(index)) {
      if (!entry.reportId || entry.reportId === currentReportId) continue;
      const progressFile = progressPath(entry.reportId);
      if (!fs.existsSync(progressFile)) continue;
      let refProg;
      try { refProg = JSON.parse(fs.readFileSync(progressFile, 'utf-8')); } catch { continue; }
      if (refProg.status !== 'completed' || !refProg.kpiSummaryFlat) continue;

      const refKpi = refProg.kpiSummaryFlat;
      for (const field of VNB_SPECIFIC_FIELDS) {
        const cur = currentKpi?.[field];
        const ref = refKpi?.[field];
        if (cur === null || cur === undefined || ref === null || ref === undefined) continue;
        if (cur === ref) {
          const msg = `[QA/CR-15] Field "${field}" = "${cur}" identisch mit Report ${entry.reportId} (${refProg.utilityName ?? 'unknown VNB'}) – möglicher Dummy-Wert`;
          warnings.push(msg);
          logger.warn(msg);
        }
      }
    }
  } catch (err) {
    logger.warn(`[QA/CR-15] validateVnbUniqueness failed: ${err.message}`);
  }
  return warnings;
}

// ─── Service definition ────────────────────────────────────────────────────────

module.exports = {
  name: 'utility-report',

  settings: {
    defaultTimeout: 10 * 60 * 1000, // 10 minutes
  },

  actions: {
    /**
     * Generate (or resume) a 360° utility management report.
     * Responds immediately with reportId; use /status/:reportId to poll.
     *
     * Tool: internal pipeline (no direct MCP call)
     */
    generate: {
      rest: 'POST /generate',
      params: {
        utilityName: { type: 'string', min: 1 },
        region: { type: 'string', optional: true },
        bdew: { type: 'string', optional: true },
        confirmAmbiguousVnb: { type: 'boolean', optional: true, default: false },
        allowIdentityMismatch: { type: 'boolean', optional: true, default: false },
        forceRefresh: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Generate a 360° Management Report for an energy utility (Stadtwerk)',
        tags: ['Utility Report'],
        description: `Starts (or resumes) the generation of a comprehensive ~50-section HTML management report for German energy utilities.

**Report sections:**
1. Netzbetrieb & Netzplanung (capacity utilization, redispatch, residual load, CO₂)
2. Erneuerbare Energien & Einspeiser (PV, Wind, Storage from MaStR)
3. Energiemarkt & Preise (EPEX, ENTSO-E, SMARD)
4. Gasinfrastruktur & Versorgungssicherheit (AGSI/GIE)
5. Regulierung, Compliance & Marktprozesse (BNetzA EWK)
6. Kundenmanagement, Vertrieb & Prosumer (churn, leads)
7. Investitionsplanung & Business Cases
8. Digitalisierung & Systemübersicht

**Caching:** Reports are cached for 7 days (UUID filename). Identical requests return the cached report.
**Resumability:** Generation progress is saved after each phase. If generation is interrupted, retry the same request to resume.
**PDF:** Open the downloaded HTML in a browser and use Print → Save as PDF.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['utilityName'],
                properties: {
                  utilityName: {
                    type: 'string',
                    description: 'Name of the energy utility',
                    example: 'Stadtwerke Heidelberg GmbH',
                  },
                  region: {
                    type: 'string',
                    description: 'Region, city or postal code for context',
                    example: 'Heidelberg',
                  },
                  bdew: {
                    type: 'string',
                    description: 'BDEW code of the grid operator (optional, improves data quality)',
                    example: '9907462000006',
                  },
                  forceRefresh: {
                    type: 'boolean',
                    description: 'Force regeneration even if a cached report exists',
                    default: false,
                  },
                },
              },
              examples: {
                stadtwerkeHeidelberg: {
                  summary: 'Stadtwerke Heidelberg',
                  value: { utilityName: 'Stadtwerke Heidelberg GmbH', region: 'Heidelberg', bdew: '9907462000006' },
                },
                twlNetze: {
                  summary: 'TWL Netze GmbH',
                  value: { utilityName: 'TWL Netze GmbH', region: 'Ludwigshafen', bdew: '9907462000013' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Report generation started or resumed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    reportId: { type: 'string' },
                    status: { type: 'string', enum: ['generating', 'completed', 'cached'] },
                    message: { type: 'string' },
                    downloadUrl: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },

      async handler(ctx) {
        const {
          utilityName,
          region = '',
          bdew = '',
          confirmAmbiguousVnb = false,
          allowIdentityMismatch = false,
          forceRefresh = false,
        } = ctx.params;
        const cernionToken = ctx.meta?.cernionToken || process.env.CERNION_TOKEN;
        const today = new Date().toISOString().slice(0, 10);

        // ── Check cache ──────────────────────────────────────────────────────
        if (!forceRefresh) {
          const cachedId = findCachedReport(utilityName, today);
          if (cachedId && reportExists(cachedId)) {
            return {
              success: true,
              reportId: cachedId,
              status: 'cached',
              message: 'Cached report returned (7-day TTL). Use forceRefresh:true to regenerate.',
              downloadUrl: `/api/utility-report/download/${cachedId}`,
            };
          }
        }

        // ── Generate new report ID ────────────────────────────────────────────
        const reportId = crypto.randomUUID();
        const progress = {
          reportId,
          utilityName,
          region,
          bdew,
          confirmAmbiguousVnb,
          allowIdentityMismatch,
          status: 'generating',
          phase: 0,
          startedAt: new Date().toISOString(),
          completedAt: null,
          error: null,
          results: {},
          meta: {},
        };
        saveProgress(progress);

        // ── Run pipeline asynchronously (do not await) ───────────────────────
        this._runPipeline(ctx, progress, cernionToken, today).catch((err) => {
          this.logger.error(`[UtilityReport] Pipeline error for ${reportId}: ${err.message}`);
          const p = loadProgress(reportId) || progress;
          p.status = 'error';
          p.error = err.message;
          saveProgress(p);
        });

        return {
          success: true,
          reportId,
          status: 'generating',
          message: 'Report generation started. Poll /status/:reportId for progress.',
          downloadUrl: `/api/utility-report/download/${reportId}`,
        };
      },
    },

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Poll generation status
     */
    status: {
      rest: 'GET /status/:reportId',
      params: {
        reportId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Poll generation status of a utility report',
        tags: ['Utility Report'],
        description: 'Returns current phase, completion percentage and any errors.',
        responses: {
          200: {
            description: 'Report status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    reportId: { type: 'string' },
                    status: { type: 'string', enum: ['generating', 'completed', 'error'] },
                    phase: { type: 'number' },
                    phaseName: { type: 'string' },
                    progress: { type: 'number', description: '0–100 completion percentage' },
                    error: { type: 'string', nullable: true },
                    downloadUrl: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { reportId } = ctx.params;
        const prog = loadProgress(reportId);

        if (!prog) {
          return { success: false, error: 'Report not found', reportId };
        }

        const phaseNames = [
          'Initialisierung',
          'Identifikation (VNB/BDEW-Lookup)',
          'Metadaten & Stammdaten',
          'Datenabruf (8 Abschnitte)',
          'Kontext & Rendering',
        ];

        const progressPct = Math.min(100, Math.round((prog.phase / 4) * 100));

        return {
          success: true,
          reportId,
          status: prog.status,
          phase: prog.phase,
          phaseName: phaseNames[prog.phase] ?? 'Unbekannt',
          progress: progressPct,
          error: prog.error ?? null,
          downloadUrl: prog.status === 'completed' ? `/api/utility-report/download/${reportId}` : null,
          vnbIdentification: prog.meta?.vnbIdentification ?? null, // CR-24: transparent VNB selection
          identityMismatch: prog.meta?.identityMismatch ?? null,
        };
      },
    },

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Check MCP connection health and token validity (CR-24).
     */
    health: {
      rest: 'GET /health',
      openapi: {
        summary: 'Check MCP connection health and token validity',
        tags: ['Utility Report'],
        description:
          'Tests the Cernion MCP connection using the configured token. ' +
          'Returns `status: "ok"` only when the token is present and the MCP server responds successfully. ' +
          'Use this endpoint to diagnose why report generation fails with MCP_CONNECTION_ERROR.',
        responses: {
          200: {
            description: 'Health check result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success:      { type: 'boolean' },
                    status:       { type: 'string', enum: ['ok', 'error'] },
                    tokenPresent: { type: 'boolean' },
                    mcpReachable: { type: 'boolean' },
                    toolCount:    { type: 'number' },
                    latencyMs:    { type: 'number' },
                    error:        { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const cernionToken = ctx.meta?.cernionToken || process.env.CERNION_TOKEN;
        const tokenPresent = !!cernionToken;
        const t0 = Date.now();
        let mcpReachable = false;
        let mcpError = null;
        let toolCount = 0;

        if (tokenPresent) {
          const result = await callMcpDirect('cernion_discover', { scope: 'tools' }, cernionToken);
          if (result.available) {
            mcpReachable = true;
            const tools = result.data?.tools ?? result.data?.data?.tools ?? [];
            toolCount = Array.isArray(tools) ? tools.length : 0;
          } else {
            mcpError = result.error || 'MCP-Verbindung fehlgeschlagen';
          }
        }

        return {
          success: tokenPresent && mcpReachable,
          status: tokenPresent && mcpReachable ? 'ok' : 'error',
          tokenPresent,
          mcpReachable,
          toolCount,
          latencyMs: Date.now() - t0,
          error: !tokenPresent
            ? 'CERNION_TOKEN nicht konfiguriert (weder im Request noch als Umgebungsvariable)'
            : mcpError,
        };
      },
    },

    /**
     * Re-render HTML from stored progress data (no MCP calls, instant).
     * Use this to refresh the HTML of an existing completed report after a
     * report-builder code update without re-running the expensive 4-phase pipeline.
     */
    rebuild: {
      rest: 'POST /rebuild/:reportId',
      params: {
        reportId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Re-render an existing report from cached data',
        tags: ['Utility Report'],
        description:
          'Reads the stored `.progress.json` for the given reportId and re-runs ' +
          '`buildHtmlReport()` to overwrite the `.html` file. Instant – no MCP calls needed. ' +
          'Useful after a report-builder bug fix to refresh already-generated reports.',
        responses: {
          200: { description: 'Report re-rendered successfully' },
          404: { description: 'No progress data found for reportId' },
          409: { description: 'Report pipeline has not completed yet' },
        },
      },
      async handler(ctx) {
        const { reportId } = ctx.params;
        const prog = loadProgress(reportId);

        if (!prog) {
          ctx.meta.$statusCode = 404;
          return { success: false, error: 'No progress data found for this reportId', reportId };
        }
        if (prog.status !== 'completed' || !prog.results) {
          ctx.meta.$statusCode = 409;
          return { success: false, error: 'Report is not yet completed; re-run generate instead', reportId, status: prog.status };
        }

        const utilityName = prog.utilityName ?? '';
        const region = prog.region ?? '';
        const resolvedVnbName = prog.meta?.resolvedVnbName ?? null;
        const resolvedBdew = prog.meta?.resolvedBdew ?? prog.bdew ?? null;
        const resolvedMastrId = prog.meta?.resolvedMastrId ?? null;
        // Reuse stored narrative if available (saved by pipeline since v0.8.2)
        const managementSummary = prog.managementSummary ?? '';
        const webSearchResults = prog.webSearchResults ?? [];

        const html = buildHtmlReport({
          meta: {
            utilityName,
            vnbName: resolvedVnbName,
            region,
            bdew: resolvedBdew,
            mastrId: resolvedMastrId,
            identityMismatch: prog.meta?.identityMismatch ?? null,
            reportId,
            allPartners: prog.meta?.allPartners ?? [], // CR-19
            vnbIdentification: prog.meta?.vnbIdentification ?? null,
          },
          section1: prog.results.section1,
          section2: prog.results.section2,
          section3: prog.results.section3,
          section4: prog.results.section4,
          section5: prog.results.section5,
          section6: prog.results.section6,
          section7: prog.results.section7,
          section8: prog.results.section8,
          managementSummary,
          webSearchResults,
          generatedAt: new Date().toISOString(),
        });

        ensureReportsDir();
        fs.writeFileSync(reportPath(reportId), html, 'utf-8');

        return {
          success: true,
          reportId,
          message: 'Report HTML re-rendered from cached data',
          downloadUrl: `/api/utility-report/download/${reportId}`,
        };
      },
    },

    /**
     * Re-render ALL completed reports from stored progress data (batch rebuild).
     */
    rebuildAll: {
      rest: 'POST /rebuild-all',
      openapi: {
        summary: 'Re-render all completed reports from cached data',
        tags: ['Utility Report'],
        description:
          'Iterates every `.progress.json` in the reports directory and re-renders the HTML ' +
          'for every completed report. Returns a summary with counts of rebuilt/skipped/failed entries.',
        responses: {
          200: { description: 'Batch rebuild summary' },
        },
      },
      async handler(ctx) {
        ensureReportsDir();
        const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.progress.json'));
        const results = { rebuilt: [], skipped: [], failed: [] };

        for (const file of files) {
          const reportId = file.replace('.progress.json', '');
          try {
            const result = await ctx.call('utility-report.rebuild', { reportId });
            if (result.success) {
              results.rebuilt.push(reportId);
            } else {
              results.skipped.push({ reportId, reason: result.error });
            }
          } catch (err) {
            results.failed.push({ reportId, error: err.message });
          }
        }

        return {
          success: true,
          total: files.length,
          rebuilt: results.rebuilt.length,
          skipped: results.skipped.length,
          failed: results.failed.length,
          details: results,
        };
      },
    },

    /**
     * Download completed HTML report
     */
    download: {
      rest: 'GET /download/:reportId',
      params: {
        reportId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Download a completed HTML report',
        tags: ['Utility Report'],
        description: 'Returns the raw HTML document. Open in a browser and use Print → Save as PDF.',
        responses: {
          200: { description: 'HTML report document' },
          404: { description: 'Report not found or not yet complete' },
        },
      },
      handler(ctx) {
        const { reportId } = ctx.params;
        const file = reportPath(reportId);

        if (!fs.existsSync(file)) {
          const prog = loadProgress(reportId);
          if (prog && prog.status === 'generating') {
            ctx.meta.$statusCode = 202;
            return { success: false, message: 'Report still generating', status: 'generating', reportId };
          }
          if (prog && prog.status === 'error') {
            ctx.meta.$statusCode = 422;
            return {
              success: false,
              status: 'error',
              error: prog.error || 'Report generation failed',
              reportId,
            };
          }
          ctx.meta.$statusCode = 404;
          return { success: false, error: 'Report not found', reportId };
        }

        const html = fs.readFileSync(file, 'utf-8');
        // Moleculer Web 0.10 reads response meta from ctx.meta.$responseType / ctx.meta.$responseHeaders.
        // 'inline' disposition tells the browser to render in-tab rather than trigger a download.
        ctx.meta.$responseType = 'text/html; charset=utf-8';
        ctx.meta.$responseHeaders = {
          'Content-Disposition': `inline; filename="360-report-${reportId}.html"`,
          'X-Content-Type-Options': 'nosniff',
        };
        return Buffer.from(html, 'utf-8');
      },
    },
  },

  // ─── Methods ─────────────────────────────────────────────────────────────────

  methods: {

  // ─── Pipeline ───────────────────────────────────────────────────────────────

  /**
   * Sequential 4-phase pipeline. Saves progress after each phase for resumability.
   */
  async _runPipeline(ctx, progress, cernionToken, today) {
    const { utilityName, region, bdew } = progress;
    const p = progress;

    // CR-22: ensure the resolved token (which may have come from process.env as fallback)
    // is always present in ctx.meta so every callBroker() call propagates it to downstream
    // services (e.g. grid-operations.marketPartners reads ctx.meta.cernionToken for MCP auth).
    if (cernionToken) ctx.meta.cernionToken = cernionToken;

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 0: Discover available tools
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 0) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 0: Discover tools`);
      const availableTools = await discoverAvailableTools(cernionToken);
      p.meta.availableTools = Array.from(availableTools);
      p.phase = 1;
      saveProgress(p);
    }

    const availableTools = new Set(p.meta.availableTools || []);

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 1: Identification – resolve VNB from name/BDEW (CR-18: tolerant)
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 1) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 1: Identification`);

      // If BDEW provided directly, skip the search step entirely.
      let firstPartner = null;
      if (!bdew) {
        // Step 1a: try cernion_market_partners with each alternative query variant.
        // buildVnbSearchQueries generates: original + stripped city + "Stadtwerke <city>".
        const searchQueries = buildVnbSearchQueries(utilityName);
        // CR-19: accumulate ALL market-partner candidates across query variants (keyed by BDEW code)
        const allCandidatesMap = new Map();
        for (const query of searchQueries) {
          // CR-23: run all queries (no early break) to build the richest candidate pool
          const mp = await callBroker(ctx, 'grid-operations.marketPartners', { query, limit: 10 });
          // CR-24: detect MCP connection failure (callBroker never throws – returns { available: false })
          // This distinguishes "MCP rejected / 403 token" from "no partners found for this name".
          if (mp?.available === false) {
            const errMsg = mp.error || 'MCP-Verbindungsfehler';
            this.logger.warn(`[UtilityReport] marketPartners MCP error for query "${query}": ${errMsg}`);
            if (!p.meta.mcpError) p.meta.mcpError = errMsg; // save first error for user message
            continue;
          }
          // CR-23: handle both async path (mp.data.results) and sync path (mp.results)
          const rawCandidates =
            mp?.data?.results ||
            mp?.results ||                        // CR-23: sync MCP path
            mp?.data?.data?.results ||
            mp?.data?.partners ||
            [];
          for (const c of rawCandidates) {
            let mastrId = c.mastrId || c.gridOperatorMastrId || null;
            if (!mastrId && c.mastrIds && typeof c.mastrIds === 'object') {
              mastrId = c.mastrIds.SNB || c.mastrIds.GNB || Object.values(c.mastrIds)[0] || null;
            }
            const key = c.bdewCode || c.bdew || c.name || c.companyName || `anon-${allCandidatesMap.size}`; // CR-23: +companyName
            if (!allCandidatesMap.has(key)) {
              allCandidatesMap.set(key, {
                name: c.name || c.companyName || c.displayName || '', // CR-23: +companyName
                bdew: c.bdewCode || c.bdew || null,
                roles: Array.isArray(c.roles) ? c.roles : (Array.isArray(c.marketRoles) ? c.marketRoles : []),
                mastrId,
                city: c.city || c.contacts?.[0]?.city || '', // CR-23: extract city from contacts array
              });
            }
          }
        }
        // CR-19: persist all candidates so they can be shown in the report
        p.meta.allPartners = Array.from(allCandidatesMap.values());

        // CR-37: Classify all found partners by market role.
        // Primary: explicit roles[] array; secondary: BDEW prefix heuristic
        //   990x → VNB (Verteilnetzbetreiber)
        //   991x → Lieferant / Vertrieb
        //   992x → MSB (Messstellenbetreiber)
        //   993x → BKV (Bilanzkreisverantwortlicher)
        //   994x → Direktvermarkter
        // Using .find() keeps only the first (best-matching) entry per role.
        const classifyPartner = (rolePattern, bdewPrefix) =>
          p.meta.allPartners.find((c) => {
            const roles = c.roles ?? [];
            if (roles.some((r) => rolePattern.test(r))) return true;
            return !roles.length && !!c.bdew?.startsWith(bdewPrefix);
          });
        p.meta.marktRollenProfile = {
          vnb:              classifyPartner(/VNB|Verteilnetz|Netzbetreiber/i, '990'),
          lieferant:        classifyPartner(/Lieferant|Vertrieb/i, '991'),
          msb:              classifyPartner(/MSB|Messtellen/i, '992'),
          bkv:              classifyPartner(/BKV|Bilanzkreis/i, '993'),
          direktvermarkter: classifyPartner(/Direktvermarkt|DV\b/i, '994'),
        };

        // BUG-CERNION-042: score candidates and detect ambiguous selection before choosing one.
        if (allCandidatesMap.size > 0) {
          const resolution = resolveVnbCandidate(p.meta.allPartners, utilityName, region, bdew);
          const rankingPreview = resolution.ranking.slice(0, 5).map((r) => ({
            name: r.name,
            bdew: r.bdew,
            city: r.city,
            score: Number(r.score.toFixed(3)),
          }));

          if (resolution.ambiguous && !p.confirmAmbiguousVnb) {
            p.meta.vnbIdentification = {
              queriesTried: searchQueries,
              candidatesFound: allCandidatesMap.size,
              mcpFailed: !!p.meta.mcpError,
              ambiguous: true,
              reason: resolution.reason,
              topCandidates: rankingPreview,
              selected: null,
            };
            saveProgress(p);
            const options = rankingPreview
              .map((r) => `${r.name || 'n/v'} · BDEW ${r.bdew || 'n/v'}${r.city ? ` · ${r.city}` : ''} · Score ${r.score}`)
              .join('\n');
            const err = new Error(
              `Mehrdeutige VNB-Suche für „${utilityName}".\n` +
              `Bitte Auswahl bestätigen (confirmAmbiguousVnb=true) oder BDEW-Code explizit übergeben.\n` +
              `Kandidaten:\n${options}`
            );
            err.code = 'VNB_AMBIGUOUS';
            throw err;
          }

          const selected = resolution.selected || resolution.ranking?.[0]?.candidate || null;
          if (selected?.bdew || selected?.bdewCode || selected?.mastrId || selected?.gridOperatorMastrId) {
            firstPartner = selected;
            this.logger.info(`[UtilityReport] VNB resolved: ${firstPartner.name || utilityName}`);
          }

          // CR-24 + BUG-CERNION-042: record transparent ranking/selection details.
          p.meta.vnbIdentification = {
            queriesTried: searchQueries,
            candidatesFound: allCandidatesMap.size,
            mcpFailed: !!p.meta.mcpError,
            ambiguous: resolution.ambiguous,
            reason: resolution.reason,
            topCandidates: rankingPreview,
            selected: firstPartner ? {
              name: firstPartner.name,
              bdew: firstPartner.bdew,
              mastrId: firstPartner.mastrId || firstPartner.gridOperatorMastrId || null,
              selectionReason: resolution.reason,
            } : null,
          };
        }

        // Step 1b: still nothing → derive city name and try a local installations lookup
        // to extract the SNB directly from NAP data of any installation in that city.
        if (!firstPartner) {
          const cityGuess = utilityName
            .replace(/\b(Stadtwerke|Stadtwerk|Gemeindewerk|Gemeindewerke|Energieversorgung|EVN|Netz\s+GmbH|Netz\s+AG|Netze\s+GmbH|Netze\s+AG|GmbH\s+&\s+Co\.\s+KG|GmbH|AG|mbH|KG)\b/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .split(/\s+/)[0];
          if (cityGuess && cityGuess.length > 2) {
            this.logger.info(`[UtilityReport] Trying city-SNB fallback for: ${cityGuess}`);
            try {
              const localInst = await callMcpDirect(
                'cernion_installations_local',
                // CR-20: use type:'all' – small VNBs may have no solar with NAP data
                { type: 'all', gemeinde: cityGuess, limit: 1, includeStats: false, format: 'detailed' },
                cernionToken
              );
              const inst0 =
                localInst?.data?.installations?.[0] ??
                localInst?.installations?.[0] ??
                null;
              const snb =
                inst0?.napData?.netzbetreiberMastrNummer ??
                inst0?.nap?.netzbetreiberMaStRNummer ??
                null;
              if (snb) {
                p.meta.resolvedMastrId = snb;
                p.meta.resolvedBdew = null;
                p.meta.resolvedVnbName = utilityName;
                this.logger.info(`[UtilityReport] SNB resolved via city fallback: ${snb} (${cityGuess})`);
              }
            } catch (e) {
              this.logger.warn(`[UtilityReport] City-SNB fallback failed: ${e.message}`);
            }
          }
        }
      }

      // BUG-CERNION-042: Even with explicit BDEW, collect partner candidates for
      // identity consistency checks (BDEW ↔ MaStR) and transparent metadata.
      if (bdew) {
        const searchQueries = buildVnbSearchQueries(utilityName);
        const allCandidatesMap = new Map();

        for (const query of searchQueries) {
          const mp = await callBroker(ctx, 'grid-operations.marketPartners', { query, limit: 10 });
          if (mp?.available === false) {
            const errMsg = mp.error || 'MCP-Verbindungsfehler';
            this.logger.warn(`[UtilityReport] marketPartners MCP error for query "${query}": ${errMsg}`);
            if (!p.meta.mcpError) p.meta.mcpError = errMsg;
            continue;
          }

          const rawCandidates =
            mp?.data?.results ||
            mp?.results ||
            mp?.data?.data?.results ||
            mp?.data?.partners ||
            [];

          for (const c of rawCandidates) {
            let mastrId = c.mastrId || c.gridOperatorMastrId || null;
            if (!mastrId && c.mastrIds && typeof c.mastrIds === 'object') {
              mastrId = c.mastrIds.SNB || c.mastrIds.GNB || Object.values(c.mastrIds)[0] || null;
            }

            const key = c.bdewCode || c.bdew || c.name || c.companyName || `anon-${allCandidatesMap.size}`;
            if (!allCandidatesMap.has(key)) {
              allCandidatesMap.set(key, {
                name: c.name || c.companyName || c.displayName || '',
                bdew: c.bdewCode || c.bdew || null,
                roles: Array.isArray(c.roles) ? c.roles : (Array.isArray(c.marketRoles) ? c.marketRoles : []),
                mastrId,
                city: c.city || c.contacts?.[0]?.city || '',
              });
            }
          }
        }

        // Keep earlier candidate pool when it already exists; otherwise use explicit-BDEW search results.
        if (!Array.isArray(p.meta.allPartners) || p.meta.allPartners.length === 0) {
          p.meta.allPartners = Array.from(allCandidatesMap.values());
        }

        const explicitPartner = findPartnerByBdew(p.meta.allPartners, bdew);
        if (explicitPartner) {
          firstPartner = explicitPartner;
          p.meta.vnbIdentification = {
            ...(p.meta.vnbIdentification || {}),
            ambiguous: false,
            reason: 'explicit-bdew',
            selected: {
              name: explicitPartner.name,
              bdew: explicitPartner.bdew,
              mastrId: explicitPartner.mastrId || explicitPartner.gridOperatorMastrId || null,
              selectionReason: 'explicit-bdew',
            },
          };
          this.logger.info(`[UtilityReport] VNB resolved via explicit BDEW match: ${explicitPartner.name || utilityName}`);
        }
      }

      // Merge partner fields (when partner was found via market-partners)
      if (firstPartner) {
        p.meta.resolvedBdew = bdew || firstPartner?.bdewCode || firstPartner?.bdew || null;
        p.meta.resolvedMastrId = firstPartner?.mastrId || firstPartner?.gridOperatorMastrId || null;
        p.meta.resolvedVnbName = firstPartner?.name || firstPartner?.displayName || utilityName;
      } else if (bdew) {
        p.meta.resolvedBdew = bdew;
        p.meta.resolvedVnbName = utilityName;
      }
      // resolvedVnbName fallback
      if (!p.meta.resolvedVnbName) p.meta.resolvedVnbName = utilityName;

      // CR-37: Guarantee resolvedBdew is the VNB (Verteilnetzbetreiber) code.
      // pickBestVnbPartner already prefers the VNB role entry; this override is a
      // safety net for cases where roles[] is empty and only the BDEW prefix
      // distinguishes the Netzbetreiber entry from a Lieferant / MSB entry.
      const _vnbProfile = p.meta.marktRollenProfile?.vnb;
      if (_vnbProfile?.bdew && p.meta.resolvedBdew !== _vnbProfile.bdew) {
        this.logger.info(
          `[UtilityReport] CR-37: resolvedBdew corrected to VNB code ${_vnbProfile.bdew}` +
          ` (was: ${p.meta.resolvedBdew})`
        );
        p.meta.resolvedBdew = _vnbProfile.bdew;
        if (_vnbProfile.name) p.meta.resolvedVnbName = _vnbProfile.name;
        if (_vnbProfile.mastrId && !p.meta.resolvedMastrId) {
          p.meta.resolvedMastrId = _vnbProfile.mastrId;
        }
      }

      // Step 2: resolve MaStR-ID from BDEW via vnbLookup (if BDEW found but no MaStR-ID yet).
      // CR-39: With CR-37 guaranteeing resolvedBdew is the VNB code (990x), this lookup
      // now reliably targets the Verteilnetz entry in the VNB registry — not a Lieferant.
      if (p.meta.resolvedBdew) {
        const previousMastr = p.meta.resolvedMastrId;
        const vnbLookup = await callBroker(ctx, 'grid-operations.vnbLookup', {
          bdew: p.meta.resolvedBdew,
          limit: 1,
        });
        p.meta.vnbLookup = vnbLookup.data ?? null;
        const vnbData = vnbLookup.data?.data ?? vnbLookup.data;
        const mastrFromLookup =
          vnbData?.mastrId ||
          vnbData?.data?.mastrId ||
          vnbData?.mastrIds?.[0] ||
          vnbData?.data?.mastrIds?.[0] ||
          null;
        if (mastrFromLookup) {
          p.meta.resolvedMastrId = mastrFromLookup;
          this.logger.info(`[UtilityReport] resolvedMastrId via vnbLookup: ${mastrFromLookup}`);
          if (previousMastr && previousMastr !== mastrFromLookup) {
            p.meta.identityMismatch = {
              type: 'MAStrConflict',
              bdew: p.meta.resolvedBdew,
              selectedMastr: previousMastr,
              bdewLookupMastr: mastrFromLookup,
              message: `MaStR-ID-Konflikt erkannt: Kandidat=${previousMastr}, BDEW-Lookup=${mastrFromLookup}`,
            };
            if (!p.allowIdentityMismatch) {
              saveProgress(p);
              const err = new Error(
                `VNB-Identitätskonflikt erkannt.\n` +
                `Datengrundlage: BDEW ${p.meta.resolvedBdew || 'n/v'} · MaStR ${mastrFromLookup}\n` +
                `${p.meta.identityMismatch.message}\n` +
                `Report-Generierung gestoppt. Für Fortsetzung explizit bestätigen: allowIdentityMismatch=true.`
              );
              err.code = 'VNB_IDENTITY_MISMATCH';
              throw err;
            }
          }

          const selectedMastrFromPhase1 = p.meta?.vnbIdentification?.selected?.mastrId || null;
          if (selectedMastrFromPhase1 && selectedMastrFromPhase1 !== mastrFromLookup) {
            p.meta.identityMismatch = {
              type: 'BDEW_LOOKUP_CONFLICT',
              bdew: p.meta.resolvedBdew,
              selectedMastr: selectedMastrFromPhase1,
              bdewLookupMastr: mastrFromLookup,
              message: `MaStR-ID-Konflikt erkannt: Phase-1-Auswahl=${selectedMastrFromPhase1}, BDEW-Lookup=${mastrFromLookup}`,
            };
            if (!p.allowIdentityMismatch) {
              saveProgress(p);
              const err = new Error(
                `VNB-Identitätskonflikt erkannt.\n` +
                `Datengrundlage: BDEW ${p.meta.resolvedBdew || 'n/v'} · MaStR ${mastrFromLookup}\n` +
                `${p.meta.identityMismatch.message}\n` +
                `Report-Generierung gestoppt. Für Fortsetzung explizit bestätigen: allowIdentityMismatch=true.`
              );
              err.code = 'VNB_IDENTITY_MISMATCH';
              throw err;
            }
          }
        }
      }

      // BUG-CERNION-042: Final consistency check between resolved BDEW and resolved MaStR
      // against the market-partner candidate set. If the pair points to different companies,
      // block report generation unless explicitly confirmed.
      const partnerForResolvedBdew = findPartnerByBdew(p.meta.allPartners, p.meta.resolvedBdew);
      const partnerMastr = partnerForResolvedBdew?.mastrId || null;
      if (partnerForResolvedBdew && partnerMastr && p.meta.resolvedMastrId && partnerMastr !== p.meta.resolvedMastrId) {
        p.meta.identityMismatch = {
          type: 'BDEW_MASTR_MISMATCH',
          bdew: p.meta.resolvedBdew,
          mastrId: p.meta.resolvedMastrId,
          expectedMastrId: partnerMastr,
          bdewName: partnerForResolvedBdew?.name || null,
          message: `BDEW ${p.meta.resolvedBdew} und MaStR ${p.meta.resolvedMastrId} zeigen auf unterschiedliche VNBs.`,
        };
      }

      if (p.meta.identityMismatch && !p.allowIdentityMismatch) {
        saveProgress(p);
        const m = p.meta.identityMismatch;
        const err = new Error(
          `VNB-Identitätskonflikt erkannt.\n` +
          `Datengrundlage: BDEW ${m.bdew || p.meta.resolvedBdew || 'n/v'} · MaStR ${m.mastrId || p.meta.resolvedMastrId || 'n/v'}\n` +
          `${m.message || 'BDEW und MaStR gehören nicht eindeutig zum selben Unternehmen.'}\n` +
          `Report-Generierung gestoppt. Für Fortsetzung explizit bestätigen: allowIdentityMismatch=true.`
        );
        err.code = 'VNB_IDENTITY_MISMATCH';
        throw err;
      }

      p.phase = 2;
      saveProgress(p);
    }

    const { resolvedBdew, resolvedMastrId, resolvedVnbName } = p.meta;

    // Guard: abort pipeline when the VNB could not be identified after all fallbacks.
    if (!resolvedBdew && !resolvedMastrId) {
      // CR-24: if MCP calls failed (bad token / network), tell the user THAT – not "VNB not found"
      if (p.meta.mcpError) {
        const err = new Error(
          `MCP-Verbindungsfehler: Die Cernion-API hat alle Marktpartner-Abfragen abgewiesen.\n` +
          `Ursache: ${p.meta.mcpError}\n` +
          `Mögliche Gründe: Ungültiger oder abgelaufener CERNION_TOKEN, keine Netzwerkverbindung.\n` +
          `Tipp: Prüfen Sie GET /api/utility-report/health auf den aktuellen Verbindungsstatus.\n` +
          `Alternativ: Übergeben Sie den BDEW-Code direkt (Parameter: bdew, z. B. "9900277000000").`
        );
        err.code = 'MCP_CONNECTION_ERROR';
        throw err;
      }
      // Build a context-aware error: list what was tried and suggest concrete next steps.
      const triedQueries = buildVnbSearchQueries(utilityName);
      const triedList = triedQueries.map((q) => `„${q}"`).join(', ');

      // Derive actionable suggestions based on the input:
      // - If no org prefix: suggest both Stadtwerk and Stadtwerke plus full legal suffix forms
      // - If already has prefix: suggest trying with/without "Netz GmbH" suffix
      const hasOrgPrefix = /\b(Stadtwerke|Stadtwerk|Netz|Gemeindewerk|EVN|Energieversorgung)\b/i.test(utilityName);
      const cityBase = utilityName
        .replace(/\b(Stadtwerke|Stadtwerk|Gemeindewerk|Gemeindewerke|Energieversorgung|EVN|Netz\s+GmbH|Netz\s+AG|Netze\s+GmbH|Netze\s+AG|GmbH\s+&\s+Co\.\s+KG|GmbH|AG|mbH|KG)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || utilityName.split(/\s+/)[0];

      const suggestions = hasOrgPrefix
        ? [
            `„${cityBase} Netz GmbH"`,
            `„Stadtwerke ${cityBase} Netz GmbH"`,
            `„Stadtwerk ${cityBase} GmbH"`,
          ]
        : [
            `„Stadtwerk ${utilityName} GmbH"`,
            `„Stadtwerke ${utilityName} Netz GmbH"`,
            `„${utilityName} Netz GmbH"`,
          ];

      const err = new Error(
        `VNB nicht erkannt: Für „${utilityName}" konnte weder ein BDEW-Code noch eine MaStR-ID ermittelt werden.\n` +
        `Gesucht wurde nach: ${triedList}.\n` +
        `Mögliche Ursachen: Der Marktpartner ist unter einem anderen Namen eingetragen oder besitzt keine VNB-Rolle.\n` +
        `Versuchen Sie eine der folgenden Schreibweisen: ${suggestions.join(', ')}.\n` +
        `Alternativ: Übergeben Sie den BDEW-Code direkt (Parameter: bdew, z. B. \"9900123456789\").`
      );
      err.code = 'VNB_NOT_IDENTIFIED';
      throw err;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 2: Metadata & Stammdaten
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 2) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 2: Metadata`);

      // CR-44: Use the VNB-specific BDEW code (990x) for the EWK/DI benchmark.
      // resolvedBdew is already guaranteed to be the VNB code by CR-37; but fall
      // back to the marktRollenProfile VNB entry as a secondary safety net.
      const vnbBdewForEwk = p.meta.marktRollenProfile?.vnb?.bdew ?? resolvedBdew;

      const [eicSearch, ewkBenchmark] = await Promise.all([
        callBroker(ctx, 'eic-codes.search', { query: resolvedVnbName, limit: 3 }),
        callBroker(ctx, 'ewk-monitoring.benchmarkVnb', {
          vnbName: resolvedVnbName,
          ...(vnbBdewForEwk ? { bnr: vnbBdewForEwk } : {}),
        }),
      ]);

      p.results.phase2 = { eicSearch, ewkBenchmark };
      p.phase = 3;
      saveProgress(p);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 3: Data collection – 8 sections, fully sequential
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 3) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 3: Data collection`);

      const gridOpParams = resolvedMastrId
        ? { gridOperatorId: resolvedMastrId }
        : resolvedBdew
        ? { bdewCode: resolvedBdew }
        : {};
      const gridOpIdParams = resolvedBdew
        ? { gridOperatorBdewCode: resolvedBdew }
        : resolvedMastrId
        ? { gridOperatorId: resolvedMastrId }
        : {};

      // ── Section 1: Netzbetrieb ────────────────────────────────────────────
      const capacityUtilization = await callBroker(
        ctx, 'grid-operations.capacityUtilization', { ...gridOpIdParams }
      );

      const redispatchExport = await gated(
        availableTools, ['cernion_redispatch_export'],
        () => callBroker(ctx, 'grid-operations.redispatchExport', {
          ...(resolvedMastrId
            ? { gridOperatorId: resolvedMastrId }
            : resolvedBdew
            ? { gridOperatorBdewCode: resolvedBdew }
            : {}),
        })
      );

      const residualLoad = await callBroker(ctx, 'residual-load.netResidualLoad', {
        // CR-48: gridOperatorMastrId (SNB...) enables MaStR-anchored EE capacity lookup;
        //        fetch 2 days (today + tomorrow) so the 48h chart in Section 1 has data.
        ...(resolvedMastrId ? { gridOperatorMastrId: resolvedMastrId } : {}),
        region: region || resolvedVnbName,
        forecastDays: 2,
        resolution: 'hourly',
      });

      const co2Intensity = await callBroker(ctx, 'energy-market.co2Intensity', {
        region: region || 'DE',
      });

      const operatorAnalysis = await callBroker(ctx, 'grid-operations.operatorAnalysis', {
        ...gridOpIdParams,
      });

      const emobilityImpact = await gated(
        availableTools, ['cernion_emobility_impact_analysis'],
        () => callMcpDirect('cernion_emobility_impact_analysis', {
          gridOperator: resolvedVnbName,
          location: region || resolvedVnbName,
        }, cernionToken)
      );

      const gridLossAnalysis = await gated(
        availableTools, ['cernion_grid_loss_analysis'],
        () => callMcpDirect('cernion_grid_loss_analysis', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      // CR-02: Transformer loading forecast – Ist-Zustand (forecastYears=0)
      const transformerLoading = await gated(
        availableTools, ['cernion_transformer_loading_forecast'],
        () => callMcpDirect('cernion_transformer_loading_forecast', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
          forecastYears: 0,
        }, cernionToken)
      );

      // ── MaStR data quality checks (parallel, fast local MongoDB) ──────────
      // cernion_installations_local requires gridOperatorMastrId – BDEW code is NOT supported.
      // Skip all three queries when only a BDEW code is available (no MaStR ID resolved).
      const dataQualityBaseParams = resolvedMastrId
        ? { gridOperatorMastrId: resolvedMastrId }
        : null;

      // Run 3 queries in parallel: sample-for-PLZ, in-Prüfung count, ≥100kW ohne MeLo
      const [sampleForPlz, anlagenInPruefung, installationenOhneMelo] = await Promise.all([
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              status: 'InBetrieb',
              format: 'detailed',
              includeStats: true,
              limit: 100,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No grid operator identifier' }),
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              // CR-CERNION-043 BUG-4: Use COUNT(*) to get true total, not query limit.
              // Set limit high (5000) to capture most real-world edge cases.
              // Report will show "≥ COUNT result" if count hits limit to indicate potential undercount.
              netzbetreiberPruefungStatus: ['NetzbetreiberPruefung', 'InPruefung'],
              status: 'InBetrieb',
              format: 'detailed',
              includeStats: true,
              includeNapData: true,
              limit: 5000,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No grid operator identifier' }),
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              minCapacity: 100,
              status: 'InBetrieb',
              format: 'detailed',
              includeStats: true,
              includeNapData: true,
              limit: 2000,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No grid operator identifier' }),
      ]);

      // Derive dominant PLZ prefix from sample and query ortsfremde Anlagen
      let ortsfremdeAnlagen = { available: false, error: 'PLZ prefix could not be determined' };
      if (sampleForPlz.available) {
        const sampleInsts =
          sampleForPlz.data?.installations ||
          sampleForPlz.data?.data?.installations ||
          [];
        const plzCounts = {};
        for (const inst of sampleInsts) {
          const pfx = String(inst.postleitzahl || '').slice(0, 3);
          if (pfx.length === 3) plzCounts[pfx] = (plzCounts[pfx] || 0) + 1;
        }
        const dominantPrefix = Object.entries(plzCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (dominantPrefix) {
          ortsfremdeAnlagen = await callMcpDirect('cernion_installations_local', {
            ...dataQualityBaseParams,
            postleitzahlNot: dominantPrefix,
            status: 'InBetrieb',
            format: 'detailed',
            includeStats: true,
            includeNapData: true,
            limit: 5000,  // CR-CERNION-043 BUG-4: Increase ortsfremde limit to 5000 for consistency
          }, cernionToken);
          if (ortsfremdeAnlagen.available) {
            ortsfremdeAnlagen.dominantPlzPrefix = dominantPrefix;
          }
        }
      }

      p.results.section1 = {
        capacityUtilization,
        redispatchExport,
        residualLoad,
        co2Intensity,
        operatorAnalysis,
        emobilityImpact,
        gridLossAnalysis,
        transformerLoading,
        anlagenInPruefung,
        installationenOhneMelo,
        ortsfremdeAnlagen,
      };
      saveProgress(p);

      // ── Section 2: EE-Portfolio ────────────────────────────────────────────
      const solar = await callBroker(ctx, 'assets.solar', { ...gridOpParams });
      const wind = await callBroker(ctx, 'assets.wind', { ...gridOpParams });
      const storage = await callBroker(ctx, 'assets.storage', { ...gridOpParams });

      const generationForecast = await callBroker(ctx, 'forecast.generationForecast', {
        ...gridOpParams,
        installationType: 'solar',
        forecastDays: 1,
      });

      const windSolarActual = await callBroker(ctx, 'entsoe.windSolarActual', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const regionalEnergyMix = await gated(
        availableTools, ['cernion_regional_energy_mix'],
        () => callMcpDirect('cernion_regional_energy_mix', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      // CR-01: Direct MaStR enrichment – PV, Wind, Speicher exact counts/capacities
      // via cernion_installations_local (fast local MongoDB). Used as fallback when
      // the assets broker service returns incomplete or unavailable data.
      const [pvLocal, windLocal, speicherLocal] = await Promise.all([
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              type: 'solar',
              status: 'InBetrieb',
              includeStats: true,
              limit: 5000,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No MaStR ID' }),
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              type: 'wind',
              status: 'InBetrieb',
              includeStats: true,
              limit: 5000,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No MaStR ID' }),
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              type: 'storage',
              status: 'InBetrieb',
              includeStats: true,
              limit: 5000,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No MaStR ID' }),
      ]);

      p.results.section2 = {
        solar,
        wind,
        storage,
        generationForecast,
        windSolarActual,
        regionalEnergyMix,
        pvLocal,
        windLocal,
        speicherLocal,
      };
      saveProgress(p);

      // ── Section 3: Energiemarkt ────────────────────────────────────────────
      // CR-04: Fetch 24h of day-ahead prices for a complete chart
      const priceDateFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const prices = await callBroker(ctx, 'energy-market.prices', {
        market: 'day-ahead',
        region: 'DE',
        dateFrom: priceDateFrom,
        dateTo: today,
      });

      const spotprices = await callBroker(ctx, 'german-grid.spotprices', { date: today });

      const negativePrices = await callBroker(ctx, 'german-grid.negativePrices', {
        dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        dateTo: today,
      });

      const actualGeneration = await callBroker(ctx, 'entsoe.actualGeneration', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const loadForecast = await callBroker(ctx, 'entsoe.loadForecast', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const unavailability = await callBroker(ctx, 'entsoe.unavailability', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const priceProductionAnalysis = await gated(
        availableTools, ['cernion_price_production_analysis'],
        // CR-43: Pass VNB BDEW code (990x, guaranteed by CR-37) so the tool can
        // check license coverage per market role.  This prevents 'not licensed'
        // rejections that occur when the token context resolves to a Lieferant role.
        () => callMcpDirect('cernion_price_production_analysis', {
          region: 'DE',
          dateFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          dateTo: today,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      p.results.section3 = {
        prices,
        spotprices,
        negativePrices,
        actualGeneration,
        loadForecast,
        unavailability,
        priceProductionAnalysis,
        // CR-50: Cross-reference windSolarActual from section2 for dual-axis chart
        windSolarActual: p.results.section2?.windSolarActual ?? { available: false },
      };
      saveProgress(p);

      // ── Section 4: Gas ────────────────────────────────────────────────────
      const countryStorage = await callBroker(ctx, 'gas-storage.countryStorage', { country: 'DE' });
      const euStatistics = await callBroker(ctx, 'gas-storage.euStatistics', {});
      const storageTrend = await callBroker(ctx, 'gas-storage.storageTrend', {
        country: 'DE',
        period: 'monthly',
      });
      const supplySecurityCheck = await callBroker(ctx, 'gas-storage.supplySecurityCheck', {
        country: 'DE',
      });
      const compareCountries = await callBroker(ctx, 'gas-storage.compareCountries', {
        countries: ['DE', 'AT', 'NL', 'FR'],
      });

      // CR-14: Direct MCP calls for EU aggregate + country trend as enrichment
      // The broker's gas-storage.euStatistics call may return empty data if the
      // underlying AGSI tool is gated; direct calls ensure we always try.
      const [euStatisticsDirect, storageTrendDirect] = await Promise.all([
        gated(availableTools, ['agsi_eu_statistics'],
          () => callMcpDirect('agsi_eu_statistics', {}, cernionToken)
        ),
        gated(availableTools, ['agsi_storage_trend'],
          () => callMcpDirect('agsi_storage_trend', { country: 'DE', period_days: 14 }, cernionToken)
        ),
      ]);

      // Merge: prefer broker data (has error-handling wrapping); fallback to direct
      const euStatisticsFinal = euStatistics?.available ? euStatistics : euStatisticsDirect;
      const storageTrendFinal = storageTrend?.available ? storageTrend : storageTrendDirect;

      p.results.section4 = {
        countryStorage,
        euStatistics: euStatisticsFinal,
        storageTrend: storageTrendFinal,
        supplySecurityCheck,
        compareCountries,
      };
      saveProgress(p);

      // ── Section 5: Regulierung ────────────────────────────────────────────
      const ewkAnschlussdauer = await callBroker(ctx, 'ewk-monitoring.anschlussdauer', {
        vnbName: resolvedVnbName,
        voltageLevel: 'NS',
        installationType: 'EE',
        limit: 1,
        includeRanking: true,
      });

      const ewkDigitalisierungsindex = await callBroker(ctx, 'ewk-monitoring.digitalisierungsindex', {
        vnbName: resolvedVnbName,
        limit: 1,
        includeRanking: true,
      });

      const ewkUmsetzungsquote = await callBroker(ctx, 'ewk-monitoring.umsetzungsquote', {
        vnbName: resolvedVnbName,
        voltageLevel: 'NS',
        installationType: 'EE',
        limit: 1,
      });

      const nestCompliance = await gated(
        availableTools, ['cernion_nest_compliance_report'],
        () => callMcpDirect('cernion_nest_compliance_report', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      p.results.section5 = {
        benchmarkVnb: p.results.phase2?.ewkBenchmark ?? { available: false },
        anschlussdauer: ewkAnschlussdauer,
        digitalisierungsindex: ewkDigitalisierungsindex,
        umsetzungsquote: ewkUmsetzungsquote,
        nestCompliance,
      };
      saveProgress(p);

      // ── Section 6: Kunden & Vertrieb ──────────────────────────────────────
      const churnPrediction = await callBroker(ctx, 'business-intelligence.churnPrediction', {
        // CR-06/12: Include retention strategy, churn reasons, 12-month window
        customerSegment: 'all',
        region: region || resolvedVnbName,
        riskThreshold: 'medium',
        predictionWindowMonths: 12,
        includeRetentionStrategy: true,
        includeChurnReasons: true,
        includeCompetitiveAnalysis: true,
      });

      const salesLeads = await callBroker(ctx, 'business-intelligence.salesLeads', {
        // CR-06/12: Include all installation types (PV + Wallbox + WP + Speicher)
        region: region || resolvedVnbName,
        installationType: 'all',
        daysBack: 90,
        limit: 50,
      });

      const marketPenetration = await gated(
        availableTools, ['cernion_market_penetration_analysis'],
        () => callBroker(ctx, 'business-intelligence.marketPenetration', {
          region: region || resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        })
      );

      const prosumerTariff = await gated(
        availableTools, ['cernion_prosumer_tariff_designer'],
        () => callMcpDirect('cernion_prosumer_tariff_designer', {
          customerSegment: 'all',
          region: region || resolvedVnbName,
          designGoal: 'customer-acquisition',
        }, cernionToken)
      );

      const directMarketing = await gated(
        availableTools, ['cernion_direct_marketing_opportunity_scanner'],
        () => callMcpDirect('cernion_direct_marketing_opportunity_scanner', {
          gridOperator: resolvedVnbName,
          minCapacity: 100,
          region: region || resolvedVnbName,
        }, cernionToken)
      );

      p.results.section6 = {
        churnPrediction,
        salesLeads,
        marketPenetration,
        prosumerTariff,
        directMarketing,
      };
      saveProgress(p);

      // ── Section 7: Investition ────────────────────────────────────────────
      const investmentBusinessCase = await gated(
        availableTools, ['cernion_investment_business_case'],
        () => callMcpDirect('cernion_investment_business_case', {
          gridOperator: resolvedVnbName,
          scenario: 'grid-expansion',
          region: region || resolvedVnbName,
        }, cernionToken)
      );

      const operatorPortfolio = await gated(
        availableTools, ['cernion_operator_portfolio'],
        () => callMcpDirect('cernion_operator_portfolio', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      const storageOptimization = await gated(
        availableTools, ['cernion_storage_optimization'],
        () => callMcpDirect('cernion_storage_optimization', {
          gridOperator: resolvedVnbName,
          region: region || resolvedVnbName,
        }, cernionToken)
      );

      p.results.section7 = {
        investmentBusinessCase,
        operatorPortfolio,
        storageOptimization,
        operatorAnalysis,
      };
      saveProgress(p);

      // ── Section 8: Digitalisierung & System ──────────────────────────────
      const systemStatus = await callBroker(ctx, 'system.status', {});

      const eicStatistics = await callBroker(ctx, 'eic-codes.statistics', {});

      p.results.section8 = {
        systemStatus,
        eicStatistics,
        digitalisierungsindex: ewkDigitalisierungsindex,
      };
      saveProgress(p);

      p.phase = 4;
      saveProgress(p);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 4: Context enrichment + HTML rendering
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 4) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 4: Context & Rendering`);

      // Web search context (3 queries)
      const searchQueries = [
        `${resolvedVnbName} Netzausbau ${new Date().getFullYear()}`,
        `${utilityName} Digitalisierung Energiewende aktuell`,
        `BNetzA EWK Anschlussdauer ${resolvedVnbName} Benchmark`,
      ];

      const webSearchResults = [];
      for (const q of searchQueries) {
        const res = await callBroker(ctx, 'web-search.query', { query: q, numResults: 3 });
        if (res.available) webSearchResults.push(res.data);
      }

      // Build compact KPI summary for Gemini (CR-09: include all 8 sections)
      const kpiSummary = {};
      const allSections = {
        ...p.results.section1,
        ...p.results.section2,
        ...p.results.section3,
        ...p.results.section4,
        ...p.results.section5,
        ...p.results.section6,
        ...p.results.section7,
        ...p.results.section8,
      };
      for (const [key, val] of Object.entries(allSections)) {
        Object.assign(kpiSummary, summarizeForReport(val, key));
      }

      // CR-31: Compute a clear, accurate MeLo count and expose it as a clean
      //         'meloCheck' key so the LLM sees the correct number (installations
      //         WITHOUT a linked Messlokation, not the total ≥100 kW count).
      //         Also remove the ambiguous raw key to avoid the contradiction between
      //         the Summary ("34 ohne MeLo") and Section 1 ("0 ohne MeLo").
      const ohneMeloRaw = p.results.section1?.installationenOhneMelo;
      if (ohneMeloRaw?.available && ohneMeloRaw?.data) {
        const insts =
          ohneMeloRaw.data?.installations ??
          ohneMeloRaw.data?.data?.installations ??
          [];
        const withoutMelo = Array.isArray(insts) ? insts.filter((i) => !i?.napData).length : null;
        const totalGe100kw = Array.isArray(insts) ? insts.length : null;
        kpiSummary.meloCheck = {
          anlagen_ohne_melo: withoutMelo,    // TRUE ohne-MeLo count (used in Section 1)
          anlagen_gesamt_ge100kw: totalGe100kw, // total ≥100 kW (context for LLM)
        };
      }
      // Remove the ambiguous raw key so the LLM cannot misread the array count
      delete kpiSummary.installationenOhneMelo;

      const managementSummary = await generateNarrative(utilityName, kpiSummary);

      // CR-15: Save flat kpiSummary for future cross-VNB fingerprint check
      p.kpiSummaryFlat = kpiSummary;

      // CR-15: Validate uniqueness vs. previously completed reports (log only)
      validateVnbUniqueness(kpiSummary, p.reportId, this.logger);

      // Build HTML
      const html = buildHtmlReport({
        meta: {
          utilityName,
          vnbName: resolvedVnbName,
          region,
          bdew: resolvedBdew,
          mastrId: resolvedMastrId,
          identityMismatch: p.meta.identityMismatch ?? null,
          reportId: p.reportId,
          allPartners: p.meta.allPartners ?? [], // CR-19
          marktRollenProfile: p.meta.marktRollenProfile ?? null, // CR-37/CR-45
          vnbIdentification: p.meta.vnbIdentification ?? null,
        },
        section1: p.results.section1,
        section2: p.results.section2,
        section3: p.results.section3,
        section4: p.results.section4,
        section5: p.results.section5,
        section6: p.results.section6,
        section7: p.results.section7,
        section8: p.results.section8,
        managementSummary,
        webSearchResults,
        generatedAt: new Date().toISOString(),
      });

      // Save HTML and index
      ensureReportsDir();
      fs.writeFileSync(reportPath(p.reportId), html, 'utf-8');
      indexReport(utilityName, today, p.reportId);

      p.status = 'completed';
      p.phase = 4;
      p.completedAt = new Date().toISOString();
      p.managementSummary = managementSummary;
      p.webSearchResults = webSearchResults;
      saveProgress(p);

      this.logger.info(`[UtilityReport] ${p.reportId} – Completed!`);
    }
  },

  }, // end methods
};
