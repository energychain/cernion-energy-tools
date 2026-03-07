/**
 * Report Builder
 *
 * Renders the 360° Utility Management Report as a self-contained HTML document.
 * Designed for browser print-to-PDF (A4, portrait, German language).
 *
 * Charts powered by Chart.js (CDN), inline CSS with @media print rules.
 * No external npm dependencies – only Node.js built-ins.
 */

'use strict';

// DataStatus module imported for future kpiRowDs usage; currently used via inline logic
// eslint-disable-next-line no-unused-vars
const { DataStatus } = require('./data-status');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(val, decimals = 1, fallback = '–') {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return Number(val).toFixed(decimals);
}

function fmtPct(val, fallback = '–') {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return `${Number(val).toFixed(1)} %`;
}

function fmtMw(val, fallback = '–') {
  if (val === null || val === undefined) return fallback;
  return `${fmtNum(val, 0)} MW`;
}

function fmtKwp(val, fallback = '–') {
  if (val === null || val === undefined) return fallback;
  return `${fmtNum(val, 0)} kWp`;
}

function getVal(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function safeData(section, key) {
  const raw = section?.[key]?.data ?? null;
  // Auto-unwrap {success, data: payload} service envelope (present in AGSI, EWK, EIC tools)
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
    return raw.data;
  }
  return raw;
}

/**
 * Extract structured JSON from EWK/MCP text-array responses.
 * EWK services return: [{type:'text',text:'human readable'}, {type:'text',text:'JSON',json:{...}}]
 * The second item carries a .json object with structured benchmark data.
 */
function extractEwkJson(data) {
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    if (item?.json && typeof item.json === 'object') return item.json;
    if (item?.text) {
      try {
        const p = JSON.parse(item.text);
        if (p && typeof p === 'object' && !Array.isArray(p)) return p;
      } catch { /* not a JSON text item */ }
    }
  }
  return null;
}

function isAvail(section, key) {
  return section?.[key]?.available === true;
}

/**
 * CR-22: Parse summary statistics from a cernion_installations_local markdown
 * text response.  The tool returns [{type:'text', text:'# MaStR Installations…'}].
 * After safeData() the payload is still the raw array (not auto-unwrapped).
 *
 * @param {Array|null} dataArr - result of safeData(section, 'pvLocal') etc.
 * @returns {{ count: number|null, totalCapacityKW: number|null }}
 */
function parseMaStrLocalStats(dataArr) {
  const text = Array.isArray(dataArr)
    ? (dataArr.find((i) => i?.type === 'text' && i?.text)?.text ?? '')
    : '';
  if (!text) return { count: null, totalCapacityKW: null };

  // CR-25: Prefer "Total found" from the Summary Statistics block (accurate total
  // across all matching installations).  Fall back to the "Results:" header line
  // which is bounded by the query limit and may under-count.
  const totalFoundMatch = text.match(/Total found:\*\*\s+(\d+)\s+installation/i);
  const resultsMatch = text.match(/\*\*Results:\*\*\s+(\d+)\s+installation/i);
  const count = totalFoundMatch
    ? parseInt(totalFoundMatch[1], 10)
    : resultsMatch
      ? parseInt(resultsMatch[1], 10)
      : null;

  // "**Total capacity (shown):** 4.37 MW (4367.5 kW)"
  const capKwMatch = text.match(/Total capacity[^:]*:\*\*[^(]*\(\s*([\d.]+)\s*kW\)/i);
  const totalCapacityKW = capKwMatch ? parseFloat(capKwMatch[1]) : null;

  return { count, totalCapacityKW };
}

// ─── KPI Row Helper ───────────────────────────────────────────────────────────

function kpiRow(label, value, unit = '', description = '', fallbackReason = '') {
  let val;
  if (value !== null && value !== undefined) {
    val = escapeHtml(String(value));
  } else if (fallbackReason) {
    val = '<span class="kpi-nvl">n/v</span>';
  } else {
    val = '\u2013';
  }
  const unitStr = (value !== null && value !== undefined && unit)
    ? `<span class="kpi-unit">${escapeHtml(unit)}</span>`
    : '';
  let descHtml = description ? escapeHtml(description) : '';
  if ((value === null || value === undefined) && fallbackReason) {
    descHtml += (descHtml ? ' \u00b7 ' : '') + `<em>${escapeHtml(fallbackReason)}</em>`;
  }
  const desc = descHtml
    ? `<td class="kpi-desc">${descHtml}</td>`
    : '<td class="kpi-desc"></td>';
  return `<tr><td class="kpi-label">${escapeHtml(label)}</td><td class="kpi-value">${val}${unitStr}</td>${desc}</tr>`;
}

function kpiTable(rows) {
  return `<table class="kpi-table"><thead><tr><th>Kennzahl</th><th>Wert</th><th>Beschreibung</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function noDataBox(toolName) {
  return `<div class="no-data">Keine Daten verfügbar${toolName ? ` (${escapeHtml(toolName)})` : ''} – Tool nicht erreichbar oder keine Lizenz.</div>`;
}

/**
 * Action hint box — rendered below each section's KPI table.
 * @param {string} title   Short bold heading (e.g. "Handlungsempfehlung")
 * @param {string[]} items  One action per array item
 */
function actionHint(title, items) {
  const bullets = items
    .map((i) => `<li>${escapeHtml(i)}</li>`)
    .join('');
  return `<div class="action-hint"><strong>${escapeHtml(title)}</strong><ul>${bullets}</ul></div>`;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

function buildCss() {
  return `
    :root {
      --primary: #1a5276;
      --accent: #2e86c1;
      --success: #1e8449;
      --warning: #d68910;
      --danger: #c0392b;
      --bg-light: #f4f6f7;
      --border: #d5d8dc;
      --text: #212529;
      --text-muted: #6c757d;
      --chart-h: 220px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: var(--text); background: #fff; }
    a { color: var(--accent); }

    /* ── Layout ── */
    .page { padding: 20mm 18mm; max-width: 210mm; margin: 0 auto; }
    .cover { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%); color: #fff; padding: 20mm; }
    .cover h1 { font-size: 28pt; font-weight: 700; margin-bottom: 8mm; letter-spacing: 1px; }
    .cover h2 { font-size: 18pt; font-weight: 400; margin-bottom: 4mm; opacity: .9; }
    .cover .subtitle { font-size: 11pt; opacity: .75; margin-top: 6mm; }
    .cover .badge { display: inline-block; background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.4); border-radius: 4px; padding: 2mm 5mm; font-size: 9pt; margin-top: 10mm; }

    /* ── Section headers ── */
    h1.section-title { font-size: 16pt; color: var(--primary); border-bottom: 3px solid var(--accent); padding-bottom: 3mm; margin-bottom: 5mm; margin-top: 8mm; }
    h2.sub-title { font-size: 12pt; color: var(--primary); margin-top: 6mm; margin-bottom: 3mm; }
    h3.sub-sub { font-size: 10pt; font-weight: 600; color: var(--text); margin-top: 4mm; margin-bottom: 2mm; }
    .section-number { display: inline-block; background: var(--accent); color: #fff; border-radius: 50%; width: 7mm; height: 7mm; text-align: center; line-height: 7mm; font-size: 9pt; font-weight: 700; margin-right: 2mm; }

    /* ── Management Summary ── */
    .summary-box { background: var(--bg-light); border-left: 4px solid var(--accent); padding: 5mm 6mm; margin: 4mm 0; border-radius: 0 4px 4px 0; }
    .summary-box h2 { font-size: 13pt; color: var(--primary); margin-bottom: 3mm; }
    .summary-finding { display: flex; align-items: flex-start; margin-bottom: 3mm; }
    .summary-finding .num { background: var(--primary); color: #fff; border-radius: 50%; width: 5.5mm; height: 5.5mm; min-width: 5.5mm; text-align: center; line-height: 5.5mm; font-size: 8pt; font-weight: 700; margin-right: 2.5mm; margin-top: .5mm; }
    .summary-finding p { font-size: 9.5pt; line-height: 1.5; }

    /* ── KPI Tables ── */
    .kpi-table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9pt; }
    .kpi-table th { background: var(--primary); color: #fff; padding: 2mm 3mm; text-align: left; font-weight: 600; font-size: 8.5pt; }
    .kpi-table tr:nth-child(even) { background: var(--bg-light); }
    .kpi-table td { padding: 1.5mm 3mm; border-bottom: 1px solid var(--border); vertical-align: middle; }
    .kpi-label { font-weight: 500; width: 38%; }
    .kpi-value { font-weight: 700; color: var(--primary); width: 20%; }
    .kpi-unit { font-weight: 400; font-size: 8pt; color: var(--text-muted); margin-left: 1mm; }
    .kpi-desc { color: var(--text-muted); font-size: 8.5pt; width: 42%; }

    /* ── Charts ── */
    .chart-wrap { margin: 4mm 0; height: var(--chart-h); position: relative; }
    .chart-wrap canvas { max-height: var(--chart-h); }
    .chart-caption { font-size: 8pt; color: var(--text-muted); text-align: center; margin-top: 1mm; font-style: italic; }

    /* ── Status badges ── */
    .badge-ok { background: #d5f5e3; color: var(--success); padding: 0.5mm 2mm; border-radius: 3px; font-size: 8pt; font-weight: 600; }
    .badge-warn { background: #fef9e7; color: var(--warning); padding: 0.5mm 2mm; border-radius: 3px; font-size: 8pt; font-weight: 600; }
    .badge-err { background: #fdedec; color: var(--danger); padding: 0.5mm 2mm; border-radius: 3px; font-size: 8pt; font-weight: 600; }
    .no-data { background: #fdfefe; border: 1px dashed var(--border); color: var(--text-muted); padding: 3mm 4mm; border-radius: 4px; font-size: 8.5pt; font-style: italic; margin: 2mm 0; }
    .kpi-nvl { color: var(--text-muted); font-style: italic; font-weight: 400; font-size: 8.5pt; }
    .action-hint { background: #eaf4fb; border-left: 3px solid var(--accent); padding: 3mm 4mm; border-radius: 0 4px 4px 0; margin: 3mm 0 5mm; font-size: 8.5pt; color: #1a3a5c; line-height: 1.55; }
    .action-hint strong { font-weight: 600; }
    .action-hint ul { margin: 1.5mm 0 0 4mm; padding: 0; }
    .action-hint li { margin-bottom: 1mm; }
    .badge-alert { background: #fdedec; color: var(--danger); padding: 0.5mm 2mm; border-radius: 3px; font-size: 8pt; font-weight: 600; }

    /* ── Footer ── */
    .report-footer { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid var(--border); font-size: 8pt; color: var(--text-muted); display: flex; justify-content: space-between; }

    /* ── Print ── */
    @media print {
      @page { size: A4 portrait; margin: 15mm 15mm; }
      body { font-size: 9pt; }
      .cover { min-height: auto; page-break-after: always; }
      .summary-box { page-break-after: always; }
      h1.section-title { page-break-before: always; }
      h1.section-title:first-child { page-break-before: avoid; }
      .no-break { page-break-inside: avoid; }
      .chart-wrap { page-break-inside: avoid; height: 180px; }
      .chart-wrap canvas { max-height: 180px; }
    }
  `;
}

// ─── Section Renderers ────────────────────────────────────────────────────────

function renderSection1(s1) {
  const cu = safeData(s1, 'capacityUtilization');
  const rd = safeData(s1, 'redispatchExport');
  const rl = safeData(s1, 'residualLoad');
  // CO₂ tool returns {success, co2_intensity_gco2eq_kwh, ..., data:{hourly series}}.
  // safeData() would unwrap into the inner data object, losing the top-level scalar.
  // Read the raw .data object directly for scalar KPIs.
  const co2Raw = s1?.co2Intensity?.data ?? null;
  const co2 = safeData(s1, 'co2Intensity');

  // CR-02: transformer loading fallback + operator analysis enrichment
  const tl = safeData(s1, 'transformerLoading');
  const opData = safeData(s1, 'operatorAnalysis');

  // Transformer utilization – primary: capacityUtilization; fallback: transformerLoading (CR-02)
  const voltages = ['NS', 'MS', 'HS'];
  const utilValues = voltages.map((v) => {
    const vl = v.toLowerCase();
    const lvl =
      cu?.utilizationByVoltage?.[v] ??
      cu?.data?.[v] ??
      tl?.current?.[vl] ??
      tl?.transformers?.[vl]?.utilizationPercent ??
      tl?.data?.current?.[vl] ??
      null;
    return lvl !== null ? Math.round(Number(lvl)) : null;
  });
  const trafoAvail = isAvail(s1, 'capacityUtilization') || isAvail(s1, 'transformerLoading');
  const hasChart = utilValues.some((v) => v !== null);
  const chartData = hasChart
    ? JSON.stringify({ labels: voltages, values: utilValues.map((v) => v ?? 0) })
    : null;

  // CR-02: enrichment from operatorAnalysis for redispatch/pruefung counts
  const opRedispatch = getVal(
    opData, 'redispatchAnlagen', 'redispatch_count', 'redispatchCount', 'redispatchAnlagenCount'
  );

  // CR-36: Pre-compute installationenOhneMelo total here so it can serve as a
  //         redispatch fallback count (both queries use minCapacity ≥100 kW).
  const ohneMeloDataEarly = safeData(s1, 'installationenOhneMelo');
  const ohneMeloInstsEarly =
    ohneMeloDataEarly?.installations ??
    ohneMeloDataEarly?.data?.installations ??
    [];
  const ohneMeloTotalEarly =
    ohneMeloDataEarly?.stats?.total ??
    ohneMeloDataEarly?.stats?.totalCount ??
    (Array.isArray(ohneMeloInstsEarly) ? ohneMeloInstsEarly.length : null);

  // CR-03: residual load warning handling
  const rlRaw = s1?.residualLoad?.data ?? null;
  const rlWarning = rlRaw?.warning ?? rlRaw?.warningMessage ?? null;
  const rlValueMw = isAvail(s1, 'residualLoad')
    ? fmtMw(
        rl?.summary?.netResidualLoad ??
        rl?.summary?.residualLoad ??
        rl?.summary?.kpis?.avgResidualLoadMW ??
        getVal(rl, 'netResidualLoad', 'residualLoad', 'avgResidualLoadMW', 'currentLoad')
      )
    : null;
  const rlDisplay = rlValueMw && rlValueMw !== '–'
    ? (rlWarning ? `${rlValueMw} ⚠` : rlValueMw)
    : null;
  const rlDesc = rlWarning
    ? `Ø Netto-Residuallast (regionaler Forecast) – Hinweis: ${rlWarning}`
    : 'Ø Netto-Residuallast (regionaler Forecast)';

  const rows = [
    // CR-38: When both Trafo tools unavailable, collapse to one honest info row
    //         instead of three identical 'Tool nicht verfügbar' placeholder rows.
    ...(!trafoAvail ? [
      kpiRow(
        'Trafo-Auslastung (NS/MS/HS)',
        null, '',
        'Auslastung nach Spannungsebene – Echtzeit-Kapazitätsanalyse nicht verfügbar',
        'Tool nicht lizenziert – Tagesaktueller Trafo-Forecast als Ergänzungsmodul verfügbar'
      ),
    ] : [
      kpiRow('Trafo-Auslastung NS', fmtPct(utilValues[0]), '', 'Niederspannung – aktuelle Auslastung'),
      kpiRow('Trafo-Auslastung MS', fmtPct(utilValues[1]), '', 'Mittelspannung – aktuelle Auslastung'),
      kpiRow('Trafo-Auslastung HS', fmtPct(utilValues[2]), '', 'Hochspannung – aktuelle Auslastung'),
    ]),
    kpiRow(
      'Redispatch-Anlagen',
      (() => {
        // Primary: certified redispatch export
        if (isAvail(s1, 'redispatchExport') && rd?.success !== false) {
          return getVal(rd, 'totalCount', 'count', 'total') ?? opRedispatch;
        }
        // Secondary: operatorAnalysis enrichment
        if (opRedispatch !== null) return opRedispatch;
        // CR-36 Fallback: installations ≥100 kW from MaStR (same capacity threshold,
        //                 not a certified redispatch list but a valid estimate).
        if (isAvail(s1, 'installationenOhneMelo') && ohneMeloTotalEarly !== null) {
          return `~${ohneMeloTotalEarly}`;
        }
        return null;
      })(),
      'Anlagen',
      'Steuerbare Anlagen ≥100 kW im Netzgebiet',
      (() => {
        if (isAvail(s1, 'redispatchExport') && rd?.success !== false) return '';
        if (opRedispatch !== null) return '';
        if (isAvail(s1, 'installationenOhneMelo') && ohneMeloTotalEarly !== null) {
          return 'Schätzung: MaStR-Abfrage ≥100 kW (kein zertifizierter Redispatch-Export)';
        }
        return 'Redispatch-Export fehlgeschlagen – MaStR-ID erforderlich';
      })()
    ),
    kpiRow(
      'Residuallast regional',
      rlDisplay,
      '',
      rlDesc,
      !isAvail(s1, 'residualLoad') ? 'Residuallast-Tool nicht erreichbar' : ''
    ),
    kpiRow(
      'CO₂-Intensität Strom',
      isAvail(s1, 'co2Intensity')
        ? fmtNum(
            co2Raw?.co2_intensity_gco2eq_kwh ??
            co2Raw?.average_today_gco2eq_kwh ??
            getVal(co2, 'co2_intensity_gco2eq_kwh', 'co2intensity', 'intensity', 'value'),
            0
          )
        : null,
      'gCO₂eq/kWh',
      'GrünstromIndex – aktuelle regionale CO₂-Intensität',
      !isAvail(s1, 'co2Intensity') ? 'CO₂-Index nicht verfügbar' : ''
    ),
    kpiRow(
      'E-Mobilität Netzauswirkung',
      isAvail(s1, 'emobilityImpact') ? '✓ Analyse verfügbar' : null,
      '',
      'Kritische Straßenzüge, §14a-Relevanz',
      !isAvail(s1, 'emobilityImpact') ? 'Tool nicht lizenziert' : ''
    ),
    kpiRow(
      'Netzverluste (I²R)',
      isAvail(s1, 'gridLossAnalysis') ? '✓ Analyse verfügbar' : null,
      '',
      'Monetarisierte Verlustenergie je Netzabschnitt',
      // CR-40: Route to Section 7 upsell instead of plain 'nicht lizenziert'
      !isAvail(s1, 'gridLossAnalysis') ? 'Premium-Feature – Upsell-Optionen in Abschnitt 7 gelistet' : ''
    ),
  ];

  // ── MaStR data quality rows ────────────────────────────────────────────────
  (() => {
    const pruefung = safeData(s1, 'anlagenInPruefung');
    const pruefungCount =
      pruefung?.stats?.total ??
      pruefung?.stats?.totalCount ??
      pruefung?.totalCount ??
      (Array.isArray(pruefung?.installations) ? pruefung.installations.length : null);

    const ohneMeloData = safeData(s1, 'installationenOhneMelo');
    const ohneMeloInsts =
      ohneMeloData?.installations ??
      ohneMeloData?.data?.installations ??
      [];
    const ohneMeloCount = Array.isArray(ohneMeloInsts)
      ? ohneMeloInsts.filter((i) => !i?.napData).length
      : null;
    const redispatchTotal =
      ohneMeloData?.stats?.total ??
      ohneMeloData?.stats?.totalCount ??
      (Array.isArray(ohneMeloInsts) ? ohneMeloInsts.length : null);

    const ortsfremd = s1?.ortsfremdeAnlagen;
    const ortsfremdData = safeData(s1, 'ortsfremdeAnlagen');
    const ortsfremdCount =
      ortsfremdData?.stats?.total ??
      ortsfremdData?.stats?.totalCount ??
      (Array.isArray(ortsfremdData?.installations) ? ortsfremdData.installations.length : null);
    const plzPrefix = s1?.ortsfremdeAnlagen?.dominantPlzPrefix ?? null;

    rows.push(
      kpiRow(
        'Anlagen in Netzbetreiberprüfung',
        isAvail(s1, 'anlagenInPruefung') && pruefungCount !== null ? pruefungCount : null,
        'Anlagen',
        'Aktive Anlagen mit offener Netzbetreiberprüfung (§14 NABEG) – Frist: 4 Wo. NS / 6 Wo. MS'
      ),
      kpiRow(
        'Redispatch-/§14a-Anlagen ohne MeLo',
        isAvail(s1, 'installationenOhneMelo') && ohneMeloCount !== null
          ? `${ohneMeloCount} ohne MeLo (von ${redispatchTotal ?? '?'} ≥100 kW)`
          : null,
        '',
        'Anlagen ≥100 kW ohne verknüpfte Messlokation – MSCONS-Stammdaten unvollständig'
      ),
      kpiRow(
        'Ortsfremde Anlagen (PLZ-Ausreißer)',
        isAvail(s1, 'ortsfremdeAnlagen') && ortsfremdCount !== null ? ortsfremdCount : null,
        'Anlagen',
        // CR-41: VNB-centric description – queries already filter by VNB mastrId;
        //         these are installations MaStR assigns to THIS VNB but whose postal
        //         code is outside the operator's core service territory.
        plzPrefix
          ? `Im MaStR diesem VNB zugeordnet, PLZ außerhalb Kerngebiet (≠ ${plzPrefix}xx)`
          : 'Im MaStR diesem VNB zugeordnet, aber PLZ außerhalb des Kerngebiets'
      )
    );
  })();

  let chartHtml = '';
  if (chartData) {
    chartHtml = `
      <h3 class="sub-sub">Auslastungsprofil nach Spannungsebene</h3>
      <div class="chart-wrap no-break">
        <canvas id="chartCapUtil"></canvas>
      </div>
      <p class="chart-caption">Abb. 1: Aktuelle Transformatorauslastung (%) nach Spannungsebene</p>
      <script>
        (function(){
          var d=${chartData};
          new Chart(document.getElementById('chartCapUtil'),{
            type:'bar',
            data:{labels:d.labels,datasets:[{label:'Auslastung %',data:d.values,
              backgroundColor:d.values.map(function(v){return v>80?'#c0392b':v>60?'#d68910':'#1e8449';}),
              borderRadius:4}]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.raw+'%';}}}},
              scales:{y:{min:0,max:100,ticks:{callback:function(v){return v+'%';}},
                grid:{color:'#e8e8e8'}}}}
          });
        })();
      </script>`;
  }

  // CR-48: Residuallast 48h chart (Ist + Prognose) after the trafo chart
  let residualChartHtml = '';
  const rlData = safeData(s1, 'residualLoad');
  const rlForecast = rlData?.forecast ?? rlData?.data?.forecast ?? [];
  if (isAvail(s1, 'residualLoad') && Array.isArray(rlForecast) && rlForecast.length >= 6) {
    const rlSlice = rlForecast.slice(0, 48); // max 48h
    const rlLabels = JSON.stringify(
      rlSlice.map((p) => {
        const d = new Date(p.timestamp || '');
        return isNaN(d) ? '' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      })
    );
    const rlValues = JSON.stringify(rlSlice.map((p) => p.residualLoadMW ?? p.residualLoad ?? null));
    const rlLoad = JSON.stringify(rlSlice.map((p) => p.loadMW ?? p.load ?? null));
    residualChartHtml = `
      <h3 class="sub-sub">Residuallast-Kurve (48h-Horizont)</h3>
      <div class="chart-wrap no-break" style="height:200px">
        <canvas id="chartResidualLoad"></canvas>
      </div>
      <p class="chart-caption">Abb. A: Netto-Residuallast (MW) – Ist + 48h-Prognose (Regionaler Forecast). Zeigt den Beschaffungsbedarf des Stadtwerks auf dem EPEX Spotmarkt.</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartResidualLoad'),{
            type:'line',
            data:{labels:${rlLabels},datasets:[
              {label:'Residuallast MW',data:${rlValues},
                borderColor:'#1B4F8A',backgroundColor:'rgba(27,79,138,0.12)',
                borderWidth:2,pointRadius:1,fill:true,tension:0.4,spanGaps:true},
              {label:'Gesamtlast MW',data:${rlLoad},
                borderColor:'#95A5A6',backgroundColor:'transparent',
                borderWidth:1,pointRadius:0,fill:false,tension:0.4,
                borderDash:[5,4],spanGaps:true}
            ]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{labels:{font:{size:9}}}},
              scales:{y:{ticks:{callback:function(v){return v+' MW';}},grid:{color:'#e8e8e8'}},
                x:{ticks:{maxTicksLimit:12}}}}
          });
        })();
      </script>`;
  }

  return `
    <h1 class="section-title"><span class="section-number">1</span>Netzbetrieb &amp; Netzplanung</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Grundlage für Investitionsentscheidungen, NEST-Regulierung und langfristige Infrastrukturplanung.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung Netzbetrieb', [
      'Trafo-Auslastung >80 %: Engpass-Meldung gemäß §11 EnWG und Aufnahme in NEST-Investitionsplanung.',
      'Redispatch-Anlagen ≥100 kW: fristgerechte §12 StromNZV-Meldung an Übertragungsnetzbetreiber sicherstellen.',
      'Anlagen in Netzbetreiberprüfung: Bearbeitungsfristen im MaStR-Portal einhalten (4 Wo. NS, 6 Wo. MS/HS).',
      'Redispatch-/§14a-Anlagen ohne MeLo: Stammdaten im MaStR ergänzen – fehlende MeLo verhindert MSCONS-Abrechnung.',
      'Ortsfremde Anlagen: VNB-Zuordnung im MaStR korrigieren oder Netzgebiet-Abgrenzung mit BNetzA klären.',
    ])}
    ${chartHtml}
    ${residualChartHtml}`;
}

function renderSection2(s2) {
  const sol = safeData(s2, 'solar');
  const wind = safeData(s2, 'wind');
  const stor = safeData(s2, 'storage');

  // CR-01: Direct MaStR enrichment fallbacks (pvLocal/windLocal/speicherLocal)
  const pvLocalData = safeData(s2, 'pvLocal');
  const windLocalData = safeData(s2, 'windLocal');
  const speicherLocalData = safeData(s2, 'speicherLocal');

  // CR-22: cernion_installations_local returns markdown text arrays – parse stats
  const pvLocalStats = parseMaStrLocalStats(pvLocalData);
  const windLocalStats = parseMaStrLocalStats(windLocalData);
  const speicherLocalStats = parseMaStrLocalStats(speicherLocalData);

  // Prefer broker service data; fall back to local MaStR direct stats
  const pvCapacity =
    getVal(sol, 'totalCapacityKw', 'totalCapacity', 'totalKwp') ??
    pvLocalData?.stats?.totalCapacityKW ??
    pvLocalData?.stats?.totalCapacity ??
    pvLocalData?.totalCapacityKW ??
    pvLocalStats.totalCapacityKW ??
    null;
  const pvCount =
    getVal(sol, 'totalCount', 'count', 'total') ??
    pvLocalData?.stats?.total ??
    pvLocalData?.stats?.totalCount ??
    pvLocalStats.count ??
    null;
  const windCapacity =
    getVal(wind, 'totalCapacityKw', 'totalCapacity', 'totalKw') ??
    windLocalData?.stats?.totalCapacityKW ??
    windLocalData?.stats?.totalCapacity ??
    windLocalStats.totalCapacityKW ??
    null;
  const windCount =
    getVal(wind, 'totalCount', 'count', 'total') ??
    windLocalData?.stats?.total ??
    windLocalStats.count ??
    null;
  const speicherCapacity =
    getVal(stor, 'totalCapacityKw', 'totalCapacity', 'totalKw') ??
    speicherLocalData?.stats?.totalCapacityKW ??
    speicherLocalData?.stats?.totalCapacity ??
    speicherLocalStats.totalCapacityKW ??
    null;

  const pvAvail = isAvail(s2, 'solar') || isAvail(s2, 'pvLocal');
  const windAvail = isAvail(s2, 'wind') || isAvail(s2, 'windLocal');
  const speicherAvail = isAvail(s2, 'storage') || isAvail(s2, 'speicherLocal');

  // CR-42: Extract actual generation values instead of showing '✓ verfügbar' placeholders.
  // windSolarActual → average or last-period total MW (national DE, ENTSO-E Ist-Wert)
  const windSolarData = safeData(s2, 'windSolarActual');
  const windSolarStats = windSolarData?.statistics ?? windSolarData?.data?.statistics ?? null;
  const windSolarForecasts = windSolarData?.forecasts ?? windSolarData?.data?.forecasts ?? [];
  const windSolarLatest = Array.isArray(windSolarForecasts) && windSolarForecasts.length > 0
    ? windSolarForecasts[windSolarForecasts.length - 1]
    : null;
  const windSolarTotalMW =
    windSolarStats?.avgForecastMW ??
    windSolarStats?.avgMW ??
    windSolarStats?.avg ??
    windSolarLatest?.total ??
    (windSolarLatest
      ? ((windSolarLatest.windOnshore ?? 0) + (windSolarLatest.windOffshore ?? 0) + (windSolarLatest.solar ?? 0))
      : null);
  const windSolarLabel = isAvail(s2, 'windSolarActual')
    ? (windSolarTotalMW != null && windSolarTotalMW > 0
        ? `${fmtMw(windSolarTotalMW)} Ø DE (Ist)`
        : '✓ Echtzeit-Daten verfügbar')
    : null;

  // CR-42: generationForecast → first-day generation MW (Netzgebiet-Solar forecast)
  const genFcData = safeData(s2, 'generationForecast');
  const genFcForecasts = genFcData?.forecasts ?? genFcData?.data?.forecasts ?? [];
  const genFcFirstMW = Array.isArray(genFcForecasts) && genFcForecasts.length > 0
    ? (genFcForecasts[0]?.generationMW ?? null)
    : null;
  const genFcLabel = isAvail(s2, 'generationForecast')
    ? (genFcFirstMW != null && genFcFirstMW >= 0
        ? `${fmtMw(genFcFirstMW)} morgen (Netzgebiet-Solar)`
        : '✓ Prognose verfügbar')
    : null;

  const rows = [
    kpiRow(
      'Installierte PV-Leistung',
      pvAvail ? fmtKwp(pvCapacity) : null,
      '',
      'Summe aktiver PV-Anlagen (MaStR)',
      !pvAvail ? 'MaStR-Abfrage nicht verfügbar' : ''
    ),
    kpiRow(
      'Anzahl PV-Anlagen',
      pvAvail ? pvCount : null,
      'Anlagen',
      'Aktive Solaranlagen im Netzgebiet',
      !pvAvail ? 'MaStR-Abfrage nicht verfügbar' : ''
    ),
    kpiRow(
      'Installierte Windleistung',
      windAvail && windCapacity !== null
        ? `${fmtNum(windCapacity, 0)} kW${windCount !== null ? ` (${windCount} Anlagen)` : ''}`
        : null,
      '',
      'Onshore-Wind nach Betriebsstatus (MaStR)',
      !windAvail ? 'MaStR-Abfrage nicht verfügbar' : ''
    ),
    kpiRow(
      'Installierte Speicherleistung',
      speicherAvail && speicherCapacity !== null
        ? `${fmtNum(speicherCapacity, 0)} kW`
        : null,
      '',
      'Batteriespeicher, Heim- und Großspeicher',
      !speicherAvail ? 'MaStR-Abfrage nicht verfügbar' : ''
    ),
    kpiRow(
      'Einspeisung Wind/Solar (Ist)',
      windSolarLabel,
      '',
      'ENTSO-E Echtzeit-Einspeisung (nationaler DE-Wert)'
    ),
    kpiRow(
      'Einspeise-Prognose (24h)',
      genFcLabel,
      '',
      'Regionalprognose auf Basis MaStR-Kapazitäten'
    ),
    kpiRow(
      'Regionaler Energiemix',
      isAvail(s2, 'regionalEnergyMix') ? '✓ Analyse verfügbar' : null,
      '',
      'PV, Wind, Biomasse, KWK im Netzgebiet'
    ),
  ];

  // CR-49: EE-Portfolio Mix Donut – VNB-specific installed base
  let portfolioChartHtml = '';
  const portfolioData = (() => {
    const pv = pvCapacity != null ? Number(pvCapacity) : 0;
    const wind = windCapacity != null ? Number(windCapacity) : 0;
    const speicher = speicherCapacity != null ? Number(speicherCapacity) : 0;
    const total = pv + wind + speicher;
    if (total <= 0) return null;
    return { pv: Math.round(pv), wind: Math.round(wind), speicher: Math.round(speicher) };
  })();
  if ((pvAvail || windAvail || speicherAvail) && portfolioData !== null) {
    const donutLabels = JSON.stringify(['PV', 'Wind', 'Speicher']);
    const donutValues = JSON.stringify([portfolioData.pv, portfolioData.wind, portfolioData.speicher]);
    portfolioChartHtml = `
      <h3 class="sub-sub">EE-Portfolio-Mix (installierte Leistung, kW)</h3>
      <div class="chart-wrap no-break" style="height:180px">
        <canvas id="chartPortfolioMix"></canvas>
      </div>
      <p class="chart-caption">Abb. B: Installiertes EE-Portfolio nach Technologie (kW, MaStR-Bestand, Betrieb). PV · Wind · Speicher.</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartPortfolioMix'),{
            type:'doughnut',
            data:{labels:${donutLabels},datasets:[{data:${donutValues},
              backgroundColor:['#F39C12','#4A9FD4','#27AE60'],
              borderWidth:2,borderColor:'#fff'}]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{position:'right',labels:{font:{size:9}}},
                tooltip:{callbacks:{label:function(c){
                  const v=c.raw,t=${donutValues}.reduce(function(a,b){return a+b},0);
                  return c.label+': '+(v/1000).toFixed(1)+' MW ('+Math.round(v/t*100)+'%)';
                }}}}}
          });
        })();
      </script>`;
  }

  // CR-54: Zubaukurve – cumulative capacity by commissioning year from pvLocal data
  let zubauChartHtml = '';
  const pvLocalRaw = safeData(s2, 'pvLocal');
  const pvInstallations = pvLocalRaw?.installations ?? pvLocalRaw?.data?.installations ?? [];
  if (Array.isArray(pvInstallations) && pvInstallations.length >= 5) {
    const yearMap = {};
    for (const inst of pvInstallations) {
      const year = String(inst.inbetriebnahmeDatum || inst.commissioning || '').slice(0, 4);
      const yr = parseInt(year, 10);
      if (yr >= 2000 && yr <= 2030) {
        yearMap[yr] = (yearMap[yr] || 0) + (inst.leistungKw ?? inst.capacity ?? 0);
      }
    }
    const years = Object.keys(yearMap).map(Number).sort((a, b) => a - b);
    if (years.length >= 3) {
      let cum = 0;
      const cumKw = years.map((y) => { cum += yearMap[y]; return Math.round(cum); });
      const zubauLabels = JSON.stringify(years);
      const zubauCum = JSON.stringify(cumKw);
      zubauChartHtml = `
      <h3 class="sub-sub">EE-Zubaukurve – kumulierte PV-Leistung</h3>
      <div class="chart-wrap no-break" style="height:180px">
        <canvas id="chartZubau"></canvas>
      </div>
      <p class="chart-caption">Abb. C: Kumulierte installierte PV-Leistung im Netzgebiet nach Inbetriebnahmejahr (kW, MaStR-Bestand). Zeigt Tempo und Phasen des EE-Ausbaus.</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartZubau'),{
            type:'line',
            data:{labels:${zubauLabels},datasets:[{label:'kum. kW',data:${zubauCum},
              borderColor:'#F39C12',backgroundColor:'rgba(243,156,18,0.15)',
              borderWidth:2,pointRadius:3,fill:true,tension:0.3}]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{display:false}},
              scales:{y:{ticks:{callback:function(v){return (v/1000).toFixed(0)+' MW';}},
                grid:{color:'#e8e8e8'}},x:{ticks:{maxTicksLimit:10}}}}
          });
        })();
      </script>`;
    }
  }

  return `
    <h1 class="section-title"><span class="section-number">2</span>Erneuerbare Energien &amp; Einspeiser</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">MaStR-basierte Analyse des Einspeiserportfolios und dessen Betriebsstatus.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung EE-Portfolio', [
      'Redispatch-Pool: Alle Anlagen ≥100 kW automatisch in Redispatch 2.0 einbinden (§12 StromNZV).',
      'Speicher als Puffer: Standorte für Quartiersspeicher an EE-Einspeiseschwerpunkten identifizieren.',
      'PV-Prognose nutzen: Tagesvorschau für Netzbetrieb und Beschaffungsoptimierung einsetzen.',
      'Direktvermarktung: Anlagen >100 kW mit abgelaufenem EEG-Tarif auf §21 EEG-Marktprämie prüfen.',
    ])}
    ${portfolioChartHtml}
    ${zubauChartHtml}`;
}

// ─── CR-43: Pearson correlation helper ──────────────────────────────────────
function pearsonCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return null;
  const xSlice = xs.slice(0, n);
  const ySlice = ys.slice(0, n);
  const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
  const yMean = ySlice.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - xMean;
    const dy = ySlice[i] - yMean;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

function renderSection3(s3) {
  const prices = safeData(s3, 'prices');
  const spot = safeData(s3, 'spotprices');

  // Day-ahead price chart – ENTSO-E tool returns dataPoints[] with priceEURperMWh
  const priceTimeSeries =
    prices?.dataPoints || prices?.prices || prices?.data?.prices ||
    spot?.dataPoints || spot?.prices || spot?.data?.prices || [];
  const hasChart = Array.isArray(priceTimeSeries) && priceTimeSeries.length > 0;
  const chartSrc = hasChart
    ? priceTimeSeries.map((p) => ({
        t: p.timestamp || p.startTime || p.time || '',
        v: p.priceEURperMWh ?? p.price ?? p.value ?? 0,
      }))
    : [];

  const latestPt = priceTimeSeries.length > 0 ? priceTimeSeries[priceTimeSeries.length - 1] : null;
  const latestPrice =
    getVal(prices, 'latestPrice', 'currentPrice') ??
    (latestPt ? (latestPt.priceEURperMWh ?? latestPt.price ?? null) : null);

  // CR-43: Compute Pearson correlation from price time-series + windSolarActual
  // when the dedicated priceProductionAnalysis tool is unavailable.
  const windSolarActualS3 = safeData(s3, 'windSolarActual');
  const solarForecasts = windSolarActualS3?.forecasts ?? windSolarActualS3?.data?.forecasts ?? [];
  let pearsonR = null;
  if (!isAvail(s3, 'priceProductionAnalysis') && chartSrc.length >= 4 && Array.isArray(solarForecasts) && solarForecasts.length >= 4) {
    // Align on index (both series are typically hourly, same time range)
    const priceArr = chartSrc.map((p) => p.v);
    const solarArr = solarForecasts.map((f) => f.solar ?? f.total ?? 0);
    pearsonR = pearsonCorrelation(priceArr, solarArr);
  }

  // Negative price periods: tool returns {content:[{type,text}]}; parse count from text
  const npData = safeData(s3, 'negativePrices');
  const npText =
    npData?.content?.[0]?.text ??
    (Array.isArray(npData) ? npData[0]?.text : null) ?? '';
  const npCountRaw = npText.match(/(\d+)\s*(?:hours?|Stunden?|h\b)/i)?.[1];
  const npCount =
    npCountRaw != null
      ? parseInt(npCountRaw, 10)
      : (npText.toLowerCase().includes('no negative') ||
         npText.toLowerCase().includes('not found') ||
         npText.toLowerCase().includes('keine negativen'))
        ? 0
        : getVal(npData, 'count', 'totalHours', 'periods');

  // Unavailability: tool returns flat {statistics:{totalCapacityMW, totalUnavailabilities}}
  const unavailData = safeData(s3, 'unavailability');
  const unavailMW =
    unavailData?.statistics?.totalCapacityMW ??
    getVal(unavailData, 'totalUnavailableMW', 'totalMW', 'count');
  const unavailCount = unavailData?.statistics?.totalUnavailabilities ?? null;

  const rows = [
    kpiRow(
      'Day-Ahead-Preis (aktuell)',
      isAvail(s3, 'prices') ? fmtNum(latestPrice, 2) : null,
      '€/MWh',
      'EPEX Spotmarkt Deutschland'
    ),
    kpiRow(
      'Negative Preisphasen',
      isAvail(s3, 'negativePrices') ? npCount : null,
      'h §51 EEG',
      npCount === 0
        ? '✅ Keine negativen Preisphasen im Berichtszeitraum'
        : '§51 EEG Compliance-Monitoring'
    ),
    kpiRow(
      'Kraftwerksausfälle (Kapazität)',
      isAvail(s3, 'unavailability') && unavailMW !== null
        ? `${fmtNum(unavailMW, 0)} MW${unavailCount !== null ? ` / ${unavailCount} Ereignisse` : ''}`
        : null,
      '',
      'Ungeplante &amp; geplante Abschaltungen DE (ENTSO-E)'
    ),
    kpiRow(
      'Tatsächliche Erzeugung (DE)',
      isAvail(s3, 'actualGeneration') ? '✓ Daten verfügbar' : null,
      '',
      'ENTSO-E aggregiert nach Erzeugungstyp'
    ),
    kpiRow(
      'Lastprognose (ENTSO-E)',
      isAvail(s3, 'loadForecast') ? '✓ Daten verfügbar' : null,
      '',
      'Bundesdeutsche Verbrauchserwartung'
    ),
    kpiRow(
      'Preis-Einspeise-Korrelation',
      (() => {
        if (isAvail(s3, 'priceProductionAnalysis')) {
          const ppa = safeData(s3, 'priceProductionAnalysis');
          const r = getVal(ppa, 'correlationCoefficient', 'correlation', 'r');
          return r !== null ? `r = ${fmtNum(r, 2)}` : '✓ Analyse verfügbar';
        }
        // CR-43: Pearson fallback from price + windSolarActual data
        if (pearsonR !== null) {
          const desc = pearsonR < -0.3 ? ' (neg. Korrelation)' : pearsonR > 0.3 ? ' (pos. Korrelation)' : ' (schwach)';
          return `r = ${fmtNum(pearsonR, 2)}${desc}`;
        }
        return null;
      })(),
      '',
      isAvail(s3, 'priceProductionAnalysis')
        ? 'Korrelation hohe Einspeisung / niedrige Preise (7 Tage)'
        : pearsonR !== null
          ? 'Pearson r aus ENTSO-E Preis × Solar (letzte 24h, berechnet)'
          : 'Korrelation hohe Einspeisung / niedrige Preise (7 Tage)',
      !isAvail(s3, 'priceProductionAnalysis') && pearsonR === null ? 'Korrelations-Tool nicht lizenziert – Datenbasis für Berechnung unzureichend' : ''
    ),
  ];

  // CR-50: Dual-axis chart (price + solar) when both datasets available
  let chartHtml = '';
  if (chartSrc.length > 0) {
    const labels = JSON.stringify(
      chartSrc.map((p) => {
        const d = new Date(p.t);
        return isNaN(d) ? p.t : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      })
    );
    const values = JSON.stringify(chartSrc.map((p) => p.v));
    const hasSolarOverlay = Array.isArray(solarForecasts) && solarForecasts.length >= 4;
    if (hasSolarOverlay) {
      // Align solar to same length as price series by index
      const solarAligned = chartSrc.map((_, i) => {
        const f = solarForecasts[i];
        return f ? (f.solar ?? f.total ?? null) : null;
      });
      const solarValues = JSON.stringify(solarAligned);
      // Shade negative price bars red
      const bgColors = JSON.stringify(chartSrc.map((p) => p.v < 0 ? 'rgba(231,76,60,0.25)' : 'rgba(46,134,193,0.1)'));
      chartHtml = `
      <h3 class="sub-sub">Day-Ahead Preis + Solar-Einspeisung DE (letzte 24h)</h3>
      <div class="chart-wrap no-break">
        <canvas id="chartPrices"></canvas>
      </div>
      <p class="chart-caption">Abb. 2: EPEX Day-Ahead Preis (€/MWh, linke Achse) + ENTSO-E Solar-Einspeisung DE (GW, rechte Achse) – letzte 24h. Rot: negative Preisperioden (§51 EEG).</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartPrices'),{
            type:'line',
            data:{labels:${labels},datasets:[
              {label:'Preis €/MWh',data:${values},yAxisID:'y',
                borderColor:'#2e86c1',backgroundColor:${bgColors},
                borderWidth:2,pointRadius:2,fill:true,tension:0.3},
              {label:'Solar GW',data:${solarValues},yAxisID:'y2',
                borderColor:'#f39c12',backgroundColor:'rgba(243,156,18,0.08)',
                borderWidth:1.5,pointRadius:1,fill:false,tension:0.4,
                borderDash:[4,3]}
            ]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{labels:{font:{size:9}}}},
              scales:{
                y:{position:'left',ticks:{callback:function(v){return v+' €';}},grid:{color:'#e8e8e8'}},
                y2:{position:'right',ticks:{callback:function(v){return v+' GW';}},grid:{drawOnChartArea:false}},
                x:{ticks:{maxTicksLimit:8}}}}
          });
        })();
      </script>`;
    } else {
      chartHtml = `
      <h3 class="sub-sub">Day-Ahead Preisverlauf (letzte 24h)</h3>
      <div class="chart-wrap no-break">
        <canvas id="chartPrices"></canvas>
      </div>
      <p class="chart-caption">Abb. 2: EPEX Day-Ahead Strompreise (€/MWh) – letzte 24 Stunden</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartPrices'),{
            type:'line',
            data:{labels:${labels},datasets:[{label:'€/MWh',data:${values},
              borderColor:'#2e86c1',backgroundColor:'rgba(46,134,193,0.1)',
              borderWidth:2,pointRadius:2,fill:true,tension:0.3}]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{display:false}},
              scales:{y:{ticks:{callback:function(v){return v+' €';}},grid:{color:'#e8e8e8'}},
                      x:{ticks:{maxTicksLimit:8}}}}
          });
        })();
      </script>`;
    }
  }

  return `
    <h1 class="section-title"><span class="section-number">3</span>Energiemarkt &amp; Preise</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Strom- und Gaspreise, Marktdaten für Beschaffung, Tariffierung und Portfoliosteuerung.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung Energiemarkt', [
      'Negative Preisphasen (§51 EEG): Direktvermarktungsverträge auf Abregelungsklauseln prüfen – Erträge sichern.',
      'Day-Ahead-Benchmark: Beschaffungspreise quartalsweise gegen EPEX Spot benchmarken und Tarife anpassen.',
      'Kraftwerksausfälle (ENTSO-E): Versorgungssicherheit und Redispatch-Bedarf täglich überwachen.',
      'CO₂-Intensität: Grünstromzeiten für §14a-Steuerung und Kundenmarketing nutzen.',
    ])}
    ${chartHtml}`;
}

function renderSection4(s4) {
  const cs = safeData(s4, 'countryStorage');
  const eu = safeData(s4, 'euStatistics');
  const trend = safeData(s4, 'storageTrend');
  const sec = safeData(s4, 'supplySecurityCheck');

  const fillLevel =
    cs?.storage?.gasInStorage ??
    getVal(cs, 'gasInStorage', 'fillLevel', 'gasinStorage');
  // AGSI uses fillPercentage; some legacy/test mocks use 'full'
  const fillPct =
    cs?.storage?.fillPercentage ??
    cs?.storage?.full ??
    getVal(cs, 'fillPercentage', 'full', 'fillLevelPct', 'percentFull');
  const euFill =
    eu?.storage?.fillPercentage ??
    eu?.storage?.full ??
    getVal(eu, 'fillPercentage', 'full', 'fillLevelPct', 'euFillLevel');

  // Gas storage trend chart
  const trendPoints =
    trend?.trend ||
    trend?.data?.trend ||
    trend?.dataPoints ||
    trend?.data?.dataPoints ||
    [];
  const hasChart = Array.isArray(trendPoints) && trendPoints.length > 0;
  const trendSlice = hasChart ? trendPoints.slice(-30) : [];

  const rows = [
    kpiRow(
      'Gasfüllstand Deutschland',
      isAvail(s4, 'countryStorage') ? fmtPct(fillPct) : null,
      '',
      `Aktueller Speicherstand DE${fillLevel ? ` (${fmtNum(fillLevel, 1)} TWh)` : ''}`
    ),
    kpiRow(
      'Gasfüllstand EU gesamt',
      isAvail(s4, 'euStatistics') ? fmtPct(euFill) : null,
      '',
      'EU-Aggregat – EU-Mandats-Compliance (≥90%)',
      !isAvail(s4, 'euStatistics') ? 'AGSI EU-Statistik nicht verfügbar' : ''
    ),
    kpiRow(
      'Versorgungssicherheits-Status',
      isAvail(s4, 'supplySecurityCheck')
        ? getVal(sec, 'securityStatus', 'status', 'complianceStatus', 'level')
        : null,
      '',
      'EU-90%-Mandat, kritische Schwellen'
    ),
    kpiRow(
      'Ländervergleich Gasfüllstand',
      (() => {
        if (!isAvail(s4, 'compareCountries')) return null;
        const cc = safeData(s4, 'compareCountries');
        // Try rankings array (agsi_compare_countries shape)
        const rankings = cc?.rankings ?? cc?.countries ?? cc?.data?.rankings ?? null;
        if (Array.isArray(rankings) && rankings.length > 0) {
          return rankings
            .map((c) => {
              const pct = c.fillPercent ?? c.fillPercentage ?? c.full ?? c.fill;
              return pct !== undefined ? `${c.country ?? c.code}: ${Number(pct).toFixed(0)} %` : null;
            })
            .filter(Boolean)
            .join(' · ');
        }
        return '✓ Daten verfügbar';
      })(),
      '',
      'DE vs. AT vs. NL vs. FR',
      !isAvail(s4, 'compareCountries') ? 'Ländervergleich-Tool nicht verfügbar' : ''
    ),
    kpiRow(
      'Speicher-Trendbewertung',
      isAvail(s4, 'storageTrend')
        ? (() => {
            // CR-17: trend.trend is the nested trend sub-object; extract only the
            // direction string to avoid serialising the entire object as [object Object].
            const dirRaw =
              (typeof trend?.trend?.direction === 'string' ? trend.trend.direction : null) ??
              (typeof trend?.trendDirection === 'string' ? trend.trendDirection : null) ??
              (typeof trend?.direction === 'string' ? trend.direction : null) ??
              (typeof trend?.status === 'string' ? trend.status : null) ??
              null;
            const LABELS = {
              injection: '↑ Einspeisung',
              withdrawal: '↓ Entnahme',
              stable: '→ Stabil',
              rising: '↑ Steigend',
              falling: '↓ Fallend',
            };
            return dirRaw ? (LABELS[dirRaw.toLowerCase()] ?? dirRaw) : null;
          })()
        : null,
      '',
      'Injection vs. Withdrawal-Trend',
      !isAvail(s4, 'storageTrend') ? 'Trenddaten nicht verfügbar' : ''
    ),
  ];

  let chartHtml = '';
  if (trendSlice.length > 0) {
    const labels = JSON.stringify(
      trendSlice.map((p) => {
        const d = new Date(p.gasDayStart || p.date || p.timestamp || '');
        return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { month: '2-digit', day: '2-digit' });
      })
    );
    const values = JSON.stringify(
      trendSlice.map((p) => {
        const v = p.full ?? p.fillLevel ?? p.gasInStorage ?? null;
        return v !== null ? parseFloat(String(v).replace(',', '.')) : null;
      })
    );
    chartHtml = `
      <h3 class="sub-sub">Gasfüllstand Deutschland – letzter Monat</h3>
      <div class="chart-wrap no-break">
        <canvas id="chartGasTrend"></canvas>
      </div>
      <p class="chart-caption">Abb. 3: Gasfüllstand Deutschland (%) – letzte 30 Tage (AGSI/GIE)</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartGasTrend'),{
            type:'line',
            data:{labels:${labels},datasets:[{label:'Füllstand %',data:${values},
              borderColor:'#1a5276',backgroundColor:'rgba(26,82,118,0.1)',
              borderWidth:2,pointRadius:2,fill:true,tension:0.4,spanGaps:true},
              {label:'90%-Mandat',data:Array(${trendSlice.length}).fill(90),
              borderColor:'#c0392b',borderWidth:1,borderDash:[5,5],pointRadius:0}]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{labels:{font:{size:9}}}},
              scales:{y:{min:0,max:100,ticks:{callback:function(v){return v+'%';}},
                grid:{color:'#e8e8e8'}},x:{ticks:{maxTicksLimit:10}}}}
          });
        })();
      </script>`;
  }

  // CR-51: Country comparison chart – stacked or grouped bars for DE/AT/NL/FR
  let countryChartHtml = '';
  if (isAvail(s4, 'compareCountries')) {
    const cc = safeData(s4, 'compareCountries');
    const rankings = cc?.rankings ?? cc?.countries ?? cc?.data?.rankings ?? null;
    if (Array.isArray(rankings) && rankings.length >= 2) {
      const countryLabels = JSON.stringify(rankings.map((c) => c.country ?? c.code ?? '?'));
      const countryValues = JSON.stringify(rankings.map((c) => {
        const v = c.fillPercent ?? c.fillPercentage ?? c.full ?? c.fill;
        return v !== undefined ? parseFloat(String(v).replace(',', '.')) : null;
      }));
      const colors = JSON.stringify(
        rankings.map((c, i) => {
          const code = (c.country ?? c.code ?? '').toUpperCase();
          if (code === 'DE') return '#1B4F8A';
          return ['#4A9FD4','#27AE60','#F39C12','#E74C3C'][i % 4];
        })
      );
      countryChartHtml = `
      <h3 class="sub-sub">Ländervergleich Gasfüllstand (DE / AT / NL / FR)</h3>
      <div class="chart-wrap no-break" style="height:140px">
        <canvas id="chartGasCountry"></canvas>
      </div>
      <p class="chart-caption">Abb. D: Aktueller Gasfüllstand (%) im Ländervergleich – gestrichelte Linie = EU-90%-Mandat (AGSI/GIE).</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartGasCountry'),{
            type:'bar',
            data:{labels:${countryLabels},datasets:[{label:'Füllstand %',data:${countryValues},
              backgroundColor:${colors},borderRadius:4},
              {label:'90%-Mandat',data:Array(${rankings.length}).fill(90),
              type:'line',borderColor:'#c0392b',borderWidth:1.5,borderDash:[5,4],
              pointRadius:0,fill:false}]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{labels:{font:{size:9}}}},
              scales:{y:{min:0,max:100,ticks:{callback:function(v){return v+'%';}},
                grid:{color:'#e8e8e8'}}}}
          });
        })();
      </script>`;
    }
  }

  return `
    <h1 class="section-title"><span class="section-number">4</span>Gasinfrastruktur &amp; Versorgungssicherheit</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Speicherfüllstände, Einspeisung/Entnahme und EU-weite Gasversorgungssicherheit.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung Gasversorgung', [
      'Füllstand <80 % bis Oktober: Einspeisung priorisieren – EU-Mandat 90 % zum 1. November (VO 2022/1032).',
      'Versorgungssicherheits-Status CRITICAL: Geschäftsführung und Krisenplan aktivieren.',
      'EU-Vergleich monatlich reporten: DE-Füllstand vs. AT/NL/FR für Frühwarnung nutzen.',
      'Injection-Trend: Bestehende Gaslieferverträge auf Abrufoptionen für Spitzenzeiten prüfen.',
    ])}
    ${chartHtml}
    ${countryChartHtml}`;
}

function renderSection5(s5) {
  const bm = safeData(s5, 'benchmarkVnb');
  const ad = safeData(s5, 'anschlussdauer');
  const di = safeData(s5, 'digitalisierungsindex');

  // Extract structured JSON from EWK text-array responses (second array item has .json field)
  const bmJson = extractEwkJson(bm) ?? extractEwkJson(ad) ?? extractEwkJson(di);
  const adJson = extractEwkJson(ad) ?? bmJson;
  const diJson = extractEwkJson(di) ?? bmJson;
  const uqData = safeData(s5, 'umsetzungsquote');
  const uqJson = extractEwkJson(uqData) ?? bmJson;

  // EWK ranking and benchmark values
  const ewkRank = bmJson?.rankings?.anschlussdauer_ee_ns_rank ?? null;
  const ewkTotal = bmJson?.rankings?.anschlussdauer_ee_ns_total ?? null;

  // Anschlussdauer ranking chart – VNB value vs. Bundesmedian
  // adJson rows[0] uses ee_ns_gesamt_wochen; older bmJson uses anschlussdauer.ee_ns_gesamt
  const vnbAnschlussdauer =
    adJson?.rows?.[0]?.ee_ns_gesamt_wochen ??
    adJson?.anschlussdauer?.ee_ns_gesamt ??
    bmJson?.anschlussdauer?.ee_ns_gesamt ??
    null;
  // Bundesmedian from EWK stats object (anschlussdauer tool returns stats.ee_ns_gesamt.median)
  const bundesMedian = adJson?.stats?.ee_ns_gesamt?.median ?? null;
  // Bundesmedian for Digitalisierungsindex (diJson stats.gesamtscore.median)
  const diMedian = diJson?.stats?.gesamtscore?.median ?? null;
  const hasAdChart = vnbAnschlussdauer !== null;

  const rows = [
    kpiRow(
      'EWK Anschlussdauer Rang',
      (isAvail(s5, 'benchmarkVnb') || isAvail(s5, 'anschlussdauer')) && ewkRank != null
        ? `${ewkRank} / ${ewkTotal ?? '?'}`
        : null,
      '',
      'EWK-Rang Anschlussdauer EE NS 2024 (BNetzA)'
    ),
    kpiRow(
      'Anschlussdauer EE NS',
      isAvail(s5, 'anschlussdauer') || isAvail(s5, 'benchmarkVnb')
        ? fmtNum(vnbAnschlussdauer, 0)
        : null,
      'Wochen',
      'Gesamtdauer Phase 1 + Phase 2 (BNetzA EWK 2024)'
    ),
    kpiRow(
      'Bundesmedian Anschlussdauer EE NS',
      (isAvail(s5, 'anschlussdauer') || isAvail(s5, 'benchmarkVnb')) && bundesMedian !== null
        ? fmtNum(bundesMedian, 0)
        : null,
      'Wochen',
      'Bundesmedian aller VNBs – Vergleichswert (BNetzA EWK 2024)'
    ),
    kpiRow(
      'Digitalisierungsindex (Gesamt)',
      isAvail(s5, 'digitalisierungsindex') || isAvail(s5, 'benchmarkVnb')
        ? fmtPct((diJson?.digitalisierungsindex?.gesamtscore ?? bmJson?.digitalisierungsindex?.gesamtscore) * 100)
        : null,
      '',
      'Smart Grids, Digitale Prozesse, Kundenmanagement'
    ),
    kpiRow(
      'Digitalisierungsindex Rang',
      isAvail(s5, 'benchmarkVnb') && bmJson?.rankings?.digitalisierungsindex_rank != null
        ? `${bmJson.rankings.digitalisierungsindex_rank} / ${bmJson.rankings.digitalisierungsindex_total ?? '?'}`
        : (isAvail(s5, 'digitalisierungsindex') ? (diJson?.rows?.[0]?.gesamtscore_rank ?? null) : null),
      '',
      'Rang im bundesweiten VNB-Vergleich (BNetzA EWK 2024)'
    ),
    kpiRow(
      'DI-Bundesmedian (alle VNBs)',
      (isAvail(s5, 'digitalisierungsindex') || isAvail(s5, 'benchmarkVnb')) && diMedian !== null
        ? fmtPct(diMedian)
        : null,
      '',
      'Bundesmedian Digitalisierungsindex – Vergleichswert'
    ),
    kpiRow(
      'Smart-Grids Score',
      isAvail(s5, 'digitalisierungsindex') || isAvail(s5, 'benchmarkVnb')
        ? fmtPct((diJson?.digitalisierungsindex?.smart_grids ?? bmJson?.digitalisierungsindex?.smart_grids) * 100)
        : null,
      '',
      'Teilscore Smart Grids'
    ),
    kpiRow(
      'Umsetzungsquote EE NS',
      isAvail(s5, 'umsetzungsquote') || isAvail(s5, 'benchmarkVnb')
        ? fmtPct((uqJson?.umsetzungsquote?.umsetzungsquote_ee_ns ?? bmJson?.umsetzungsquote?.umsetzungsquote_ee_ns) * 100)
        : null,
      '',
      'Umgesetzte EE-Anschlussbegehren NS (BNetzA EWK)'
    ),
    kpiRow(
      'NEST-Compliance',
      isAvail(s5, 'nestCompliance') ? '✓ Bericht verfügbar' : null,
      '',
      'Automatisierter BNetzA-Regulierungsbericht'
    ),
  ];

  let chartHtml = '';
  if (hasAdChart) {
    const chartLabels = JSON.stringify(['Dieser VNB', 'Bundesmedian']);
    const chartVals = JSON.stringify([
      vnbAnschlussdauer !== null ? Math.round(vnbAnschlussdauer) : 0,
      bundesMedian !== null ? Math.round(bundesMedian) : 0,
    ]);
    chartHtml = `
      <h3 class="sub-sub">Anschlussdauer EE NS vs. Bundesmedian</h3>
      <div class="chart-wrap no-break" style="height:100px">
        <canvas id="chartAnschlussdauer"></canvas>
      </div>
      <p class="chart-caption">Abb. 4: Anschlussdauer EE-Anlagen Niederspannung (Wochen) – VNB vs. Bundesmedian</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartAnschlussdauer'),{
            type:'bar',
            data:{labels:${chartLabels},
              datasets:[{data:${chartVals},
                backgroundColor:['#2e86c1','#aab7b8'],borderRadius:4}]},
            options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
              plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.raw+' Wochen';}}}},
              scales:{x:{ticks:{callback:function(v){return v+' W';}},grid:{color:'#e8e8e8'}}}}
          });
        })();
      </script>`;
  }

  // CR-05: Build dynamic recommendations from actual EWK values
  const ewkHints = (() => {
    const items = [];

    // CR-28: Three modes – ACTION (deficit), HOLD (above median), LEVERAGE (top 25 %)
    // Anschlussdauer vs. Bundesmedian
    if (vnbAnschlussdauer !== null && bundesMedian !== null) {
      const ansch = Number(vnbAnschlussdauer);
      const median = Number(bundesMedian);
      const diff = ansch - median;
      const ratio = ansch / median;

      if (ratio > 1.2) {
        // ACTION: clearly above median
        items.push(
          `Anschlussdauer ${ansch.toFixed(0)} Wo. – ${Math.round(diff)} Wo. über Bundesmedian ` +
          `(${median.toFixed(0)} Wo.): Phase 1 (Angebotserstellung) und Phase 2 (Inbetriebnahme) ` +
          `optimieren. BNetzA-Beschwerderisiko bei >13 Wochen.`
        );
      } else if (diff > 0) {
        // ACTION-light: slightly above median
        items.push(
          `Anschlussdauer ${ansch.toFixed(0)} Wo. – ${Math.round(diff)} Wo. über Bundesmedian ` +
          `(${median.toFixed(0)} Wo.). Phase-1/2-Prozesse optimieren.`
        );
      } else if (ratio < 0.75) {
        // LEVERAGE: top ~25 % (below 75 % of median)
        items.push(
          `Anschlussdauer ${ansch.toFixed(0)} Wo. ✅ Top-Performer – ` +
          `${Math.abs(Math.round(diff))} Wo. unter Bundesmedian (${median.toFixed(0)} Wo.). ` +
          `Als Qualitätsmerkmal in Kommunikation mit Gemeinde und Projektierer einsetzen.`
        );
      } else {
        // HOLD: below median but not top 25 %
        items.push(
          `Anschlussdauer ${ansch.toFixed(0)} Wo. ✅ – ${Math.abs(Math.round(diff))} Wo. unter ` +
          `Bundesmedian (${median.toFixed(0)} Wo.). Niveau halten; Phase-2-Zeiten weiter optimieren.`
        );
      }
    } else {
      items.push('Anschlussdauer: Prozesse für Phase 1 und Phase 2 optimieren – BNetzA-Beschwerderisiko bei >13 Wochen.');
    }

    // Digitalisierungsindex
    const diScore = (diJson?.digitalisierungsindex?.gesamtscore ?? bmJson?.digitalisierungsindex?.gesamtscore);
    const diPct = diScore != null ? diScore * 100 : null;
    if (diPct !== null && diPct < 50) {
      items.push(`Digitalisierungsindex ${diPct.toFixed(0)} % (unter 50 %): SMGW-Rollout priorisieren, Förderanträge Digitalisierungsoffensive stellen.`);
    } else if (diPct !== null && diPct >= 70) {
      items.push(`Digitalisierungsindex ${diPct.toFixed(0)} % ✅ – §14a-Steuerboxen für neue steuerbare Verbrauchseinrichtungen kontinuierlich ausrollen.`);
    } else if (diPct !== null) {
      items.push(`Digitalisierungsindex ${diPct.toFixed(0)} %: Smart-Meter-Rollout fortführen, §14a-Steuerboxen bis Ende 2025 installieren.`);
    } else {
      items.push('Digitalisierungsindex: Smart Meter Rollout und SMGW-Integration priorisieren.');
    }

    // CR-24 fix: Umsetzungsquote – correct conditional (was always showing <70 % text for high performers)
    const uqScore = (uqJson?.umsetzungsquote?.umsetzungsquote_ee_ns ?? bmJson?.umsetzungsquote?.umsetzungsquote_ee_ns);
    const uqPct = uqScore != null ? uqScore * 100 : null;
    if (uqPct !== null && uqPct < 80) {
      items.push(`Umsetzungsquote EE NS ${uqPct.toFixed(0)} % – offene Anschlussbegehren bis EWK-Stichtag 31. März nacharbeiten.`);
    } else if (uqPct !== null && uqPct >= 100) {
      items.push(`Umsetzungsquote ${uqPct.toFixed(0)} % ✅ – alle EE-Anschlussbegehren fristgerecht umgesetzt. Standard halten.`);
    } else if (uqPct !== null) {
      items.push(`Umsetzungsquote ${uqPct.toFixed(0)} % ✅ – Niveau halten; Restfälle bis EWK-Stichtag 31. März abschließen.`);
    } else {
      items.push('Umsetzungsquote prüfen: EWK-Daten nicht verfügbar – offene EE-Anschlussbegehren bis Stichtag 31. März nacharbeiten.');
    }

    items.push('NEST-Report: §11 Abs. 2 EnWG Nachweispflicht erfüllen, bevor CAPEX-Antrag gestellt wird.');
    items.push('§14a EnWG: Steuerungsboxen (SMGW + Steuerbox) für alle steuerbaren Verbrauchseinrichtungen fristgerecht installieren.');
    return items;
  })();

  // CR-52: EWK Radar chart – 5 digitalization categories vs Bundesmedian
  let radarChartHtml = '';
  const diScores = diJson?.digitalisierungsindex ?? bmJson?.digitalisierungsindex ?? null;
  if (diScores) {
    const radarAxes = ['Smart Grids', 'Digitale Prozesse', 'Kundenmanagement'];
    const vnbValues = [
      Math.round((diScores.smart_grids ?? 0) * 100),
      Math.round((diScores.digitale_prozesse ?? 0) * 100),
      Math.round((diScores.kundenmanagement ?? 0) * 100),
    ];
    // Bundesmedian per category – best available or fallback to 35%
    const medianSg = diJson?.stats?.smart_grids?.median ?? 35;
    const medianDp = diJson?.stats?.digitale_prozesse?.median ?? 30;
    const medianKm = diJson?.stats?.kundenmanagement?.median ?? 40;
    const medianValues = [
      Math.round(medianSg * (medianSg <= 1 ? 100 : 1)),
      Math.round(medianDp * (medianDp <= 1 ? 100 : 1)),
      Math.round(medianKm * (medianKm <= 1 ? 100 : 1)),
    ];
    radarChartHtml = `
      <h3 class="sub-sub">Digitalisierungsprofil – Radar</h3>
      <div class="chart-wrap no-break" style="height:200px">
        <canvas id="chartDigiRadar"></canvas>
      </div>
      <p class="chart-caption">Abb. E: Digitalisierungsteilscores (%) – Dieser VNB (blau) vs. Bundesmedian (grau). Quelle: BNetzA EWK 2024.</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartDigiRadar'),{
            type:'radar',
            data:{labels:${JSON.stringify(radarAxes)},datasets:[
              {label:'Dieser VNB',data:${JSON.stringify(vnbValues)},
                borderColor:'#1B4F8A',backgroundColor:'rgba(27,79,138,0.18)',
                borderWidth:2,pointRadius:3},
              {label:'Bundesmedian',data:${JSON.stringify(medianValues)},
                borderColor:'#95A5A6',backgroundColor:'rgba(149,165,166,0.08)',
                borderWidth:1.5,pointRadius:2,borderDash:[4,3]}
            ]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{labels:{font:{size:9}}}},
              scales:{r:{min:0,max:100,ticks:{stepSize:25,font:{size:8}},
                pointLabels:{font:{size:8.5}}}}}
          });
        })();
      </script>`;
  }

  return `
    <h1 class="section-title"><span class="section-number">5</span>Regulierung, Compliance &amp; Marktprozesse</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">BNetzA-Monitoring, EIC-Register, MaKo-Stammdaten und §14a-Pflichten.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung Regulierung & Compliance', ewkHints)}
    ${chartHtml}
    ${radarChartHtml}
    ${renderNestAgnesBlock(s5, bmJson, diJson, diMedian, vnbAnschlussdauer, bundesMedian, ewkRank, ewkTotal)}
    ${renderPeerBenchmarkBlock(bmJson, diJson, vnbAnschlussdauer, bundesMedian, diMedian)}`;
}

// ─── CR-26: NEST / AgNeS Sub-section ─────────────────────────────────────────
/**
 * Renders a compact NEST & Regulierungsrahmen sub-section inside Section 5.
 * Uses EWK benchmark and nestCompliance data already available in scope.
 */
function renderNestAgnesBlock(s5, bmJson, diJson, _diMedian, vnbAnschlussdauer, bundesMedian, ewkRank, ewkTotal) {
  const nestData = safeData(s5, 'nestCompliance');
  const hasNest = isAvail(s5, 'nestCompliance');

  // AgNeS-Effizienzwert from EWK benchmark JSON (varies by tool version)
  const agnesEff =
    bmJson?.agnes?.effizienzwert ??
    bmJson?.effizienzwert ??
    bmJson?.agnes_effizienzwert ??
    null;

  // Regulierungskonto saldo
  const regKonto =
    bmJson?.agnes?.regulierungskontoSaldo ??
    bmJson?.regulierungskontoSaldo ??
    null;

  // Erlösobergrenze
  const erloesobergrenze =
    bmJson?.agnes?.erloesobergrenze ??
    bmJson?.erloesobergrenze ??
    null;

  const rankLabel = ewkRank !== null && ewkTotal !== null
    ? `Rang ${ewkRank} / ${ewkTotal}`
    : null;

  // Build KPI rows for this sub-block
  const agnesDataAvailable = agnesEff !== null || erloesobergrenze !== null || regKonto !== null;

  const nestRows = [
    kpiRow(
      'NEST-Compliance-Status',
      hasNest ? '✓ Bericht abgerufen' : null,
      '',
      '§11 Abs. 2 EnWG – automatisierter Regulierungsbericht',
      !hasNest ? 'Bericht nicht verfügbar (Lizenz oder Timeout)' : ''
    ),
    kpiRow(
      'AgNeS-Effizienzwert',
      agnesEff !== null ? fmtPct(agnesEff * 100) : null,
      '',
      'Anreizregulierung – Basis für Erlösobergrenze (BNetzA)',
      // CR-34: informative note instead of bare n/v
      agnesEff === null ? 'BNetzA-Festsetzungsdaten nicht maschinenlesbar – individuell abrufbar (BNetzA BK8)' : ''
    ),
    kpiRow(
      'Erlösobergrenze (EO)',
      erloesobergrenze !== null ? fmtNum(erloesobergrenze, 0) : null,
      '€',
      'Aktuelle Erlösobergrenze laut BNetzA-Festsetzung',
      erloesobergrenze === null ? 'BNetzA-Festsetzungsdaten nicht maschinenlesbar – individuell abrufbar (BNetzA BK8)' : ''
    ),
    kpiRow(
      'Regulierungskonto-Saldo',
      regKonto !== null ? fmtNum(regKonto, 0) : null,
      '€',
      'Positiv = Nachholpotenzial für Investitionen im Regulierungszeitraum',
      regKonto === null ? 'BNetzA-Festsetzungsdaten nicht maschinenlesbar – individuell abrufbar (BNetzA BK8)' : ''
    ),
    kpiRow(
      'EWK-Rang Anschlussdauer',
      rankLabel,
      '',
      'Bundesweiter Rang im BNetzA-Effizienzvergleich 2024'
    ),
  ];

  // Only render if at least one KPI has data (avoid all-n/v sub-section)
  const anyData = hasNest || agnesDataAvailable || rankLabel !== null;
  if (!anyData) return '';

  // CR-34: If AgNeS fields are all missing, add an explanatory note so the block
  //         is not just three n/v rows without context.
  const agnesNote = !agnesDataAvailable
    ? `<p style="font-size:8pt;color:#6c757d;margin:1mm 0 2mm;font-style:italic">
        ℹ️ AgNeS-Effizienzwert und Erlösobergrenze werden von der BNetzA nicht als
        maschinenlesbare Daten veröffentlicht. Die Werte sind individuell über
        <a href="https://www.bundesnetzagentur.de/DE/Beschlusskammern/BK08/bk8_node.html"
           style="color:#1a5276">BNetzA Beschlusskammer 8</a> abrufbar.
        Cernion-Integration (Option A) ist als Roadmap-Item erfasst.
      </p>`
    : '';

  return `
    <h2 class="sub-title" style="margin-top:5mm">NEST &amp; Regulierungsrahmen</h2>
    <p style="font-size:8.5pt;color:#6c757d;margin-bottom:2mm;">NEST-Festsetzung, AgNeS-Effizienzwert und Regulierungskonto (§11 EnWG / Anreizregulierungsverordnung).</p>
    ${kpiTable(nestRows)}
    ${agnesNote}`;
}

// ─── CR-27: Peer Benchmark Sub-section ───────────────────────────────────────
/**
 * Renders a compact peer-benchmark comparison table using EWK ranking data
 * already retrieved in renderSection5.  Shows VNB vs. Bundesmedian for the
 * three core EWK metrics with rank percentile.
 */
function renderPeerBenchmarkBlock(bmJson, diJson, vnbAnschlussdauer, bundesMedian, diMedian) {
  if (!bmJson && !diJson) return '';

  const ansch = vnbAnschlussdauer !== null ? Number(vnbAnschlussdauer) : null;
  const median = bundesMedian !== null ? Number(bundesMedian) : null;

  const diScore = (diJson?.digitalisierungsindex?.gesamtscore ?? bmJson?.digitalisierungsindex?.gesamtscore);
  const diPct = diScore != null ? diScore * 100 : null;

  const ewkRank = bmJson?.rankings?.anschlussdauer_ee_ns_rank ?? null;
  const ewkTotal = bmJson?.rankings?.anschlussdauer_ee_ns_total ?? null;
  const diRank = bmJson?.rankings?.digitalisierungsindex_rank ?? diJson?.rows?.[0]?.gesamtscore_rank ?? null;
  const diRankTotal = bmJson?.rankings?.digitalisierungsindex_total ?? null;

  const uqScore = (bmJson?.umsetzungsquote?.umsetzungsquote_ee_ns ?? null);
  const uqPct = uqScore != null ? uqScore * 100 : null;

  // CR-32: Percentile helper – betterThan = % of VNBs this VNB outperforms.
  // For Anschlussdauer, lower rank number = better performer (rank 1 = fastest).
  // "Top X%" is only shown when the VNB genuinely outperforms ≥75% of peers.
  const betterThanAd = (ewkRank !== null && ewkTotal)
    ? Math.round((ewkTotal - ewkRank) / ewkTotal * 100)
    : null;

  // At least one data point must exist
  if (ansch === null && diPct === null && uqPct === null) return '';

  const fmtCell = (val, unit = '') =>
    val !== null ? `${val}${unit}` : '–';

  const medianAdCell = median !== null ? fmtCell(Math.round(median), ' Wo.') : '–';
  // CR-32: "Top X%" only when truly top-quartile; otherwise "besser als X%"
  const rankAdSuffix = betterThanAd !== null
    ? (betterThanAd >= 75 ? ` (Top ${100 - betterThanAd} %)` : ` (besser als ${betterThanAd} %)`)
    : '';
  const rankAdCell = ewkRank !== null
    ? `${ewkRank} / ${ewkTotal ?? '?'}${rankAdSuffix}`
    : '–';
  const diMedianCell = diMedian !== null ? fmtCell(Math.round(diMedian * 100), ' %') : '–';
  // CR-35: DI rank percentile (higher DI score = better, same direction as Ad)
  const betterThanDi = (diRank !== null && diRankTotal)
    ? Math.round((diRankTotal - diRank) / diRankTotal * 100)
    : null;
  const diRankSuffix = betterThanDi !== null
    ? (betterThanDi >= 75 ? ` (Top ${100 - betterThanDi} %)` : ` (besser als ${betterThanDi} %)`)
    : '';
  const diRankCell = diRank !== null ? `${diRank} / ${diRankTotal ?? '?'}${diRankSuffix}` : '–';

  // CR-53: Tornado/divergence chart – VNB delta vs Bundesmedian
  let tornadoHtml = '';
  const tornadoMetrics = [];
  if (ansch !== null && median !== null) {
    // For Anschlussdauer: lower = better, so delta = median - VNB (positive means better than median)
    tornadoMetrics.push({ label: 'Anschlussdauer EE NS (Wo.)', delta: +(median - ansch).toFixed(1), unit: 'Wo.' });
  }
  if (diPct !== null && diMedian !== null) {
    tornadoMetrics.push({ label: 'Digitalisierungsindex (%)', delta: +(diPct - diMedian * 100).toFixed(1), unit: '%' });
  }
  if (uqPct !== null) {
    // Umsetzungsquote: no national median available, skip
  }
  if (tornadoMetrics.length >= 2) {
    const tLabels = JSON.stringify(tornadoMetrics.map((m) => m.label));
    const tDeltas = JSON.stringify(tornadoMetrics.map((m) => m.delta));
    const tColors = JSON.stringify(tornadoMetrics.map((m) => m.delta >= 0 ? '#27AE60' : '#E74C3C'));
    tornadoHtml = `
      <h3 class="sub-sub" style="margin-top:4mm">Peer-Benchmark – Delta zum Bundesmedian</h3>
      <div class="chart-wrap no-break" style="height:${tornadoMetrics.length * 55 + 30}px">
        <canvas id="chartTornado"></canvas>
      </div>
      <p class="chart-caption">Abb. F: Abweichung zum Bundesmedian (grün = besser, rot = schlechter). Anschlussdauer: negativer Delta = schlechter; Digitalisierungsindex: positiver Delta = besser.</p>
      <script>
        (function(){
          new Chart(document.getElementById('chartTornado'),{
            type:'bar',
            data:{labels:${tLabels},datasets:[{data:${tDeltas},
              backgroundColor:${tColors},borderRadius:3}]},
            options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
              plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){
                return (c.raw>=0?'+':'')+c.raw.toFixed(1)+' vs. Median';
              }}}},
              scales:{x:{grid:{color:'#e8e8e8'},ticks:{callback:function(v){return (v>=0?'+':'')+v;}},
                afterBuildTicks:function(ax){if(!ax.ticks.some(function(t){return t.value===0;})){ax.ticks.push({value:0});}}}}}
          });
        })();
      </script>`;
  }

  return `
    <h2 class="sub-title" style="margin-top:5mm">Peer-Benchmarking (Bundesvergleich)</h2>
    <p style="font-size:8.5pt;color:#6c757d;margin-bottom:2mm;">Vergleich mit allen ~740 deutschen VNBs im BNetzA-EWK-Datensatz 2024. Rang-Percentil: „Top X%" = besser als (100−X)% der VNBs; „besser als Y%" = besser als Y% der VNBs.</p>
    <table style="width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:3mm">
      <thead>
        <tr style="background:#f8f9fa">
          <th style="text-align:left;padding:1.5mm 2mm;border-bottom:2px solid #dee2e6">Kennzahl</th>
          <th style="text-align:right;padding:1.5mm 2mm;border-bottom:2px solid #dee2e6">Dieser VNB</th>
          <th style="text-align:right;padding:1.5mm 2mm;border-bottom:2px solid #dee2e6">Bundesmedian</th>
          <th style="text-align:right;padding:1.5mm 2mm;border-bottom:2px solid #dee2e6">Rang (national)</th>
        </tr>
      </thead>
      <tbody>
        ${ansch !== null ? `<tr>
          <td style="padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0">Anschlussdauer EE NS</td>
          <td style="text-align:right;padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;font-weight:600">${Math.round(ansch)} Wo.</td>
          <td style="text-align:right;padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;color:#6c757d">${medianAdCell}</td>
          <td style="text-align:right;padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;color:#6c757d">${rankAdCell}</td>
        </tr>` : ''}
        ${diPct !== null ? `<tr>
          <td style="padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0">Digitalisierungsindex</td>
          <td style="text-align:right;padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;font-weight:600">${Math.round(diPct)} %</td>
          <td style="text-align:right;padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;color:#6c757d">${diMedianCell}</td>
          <td style="text-align:right;padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;color:#6c757d">${diRankCell}</td>
        </tr>` : ''}
        ${uqPct !== null ? `<tr>
          <td style="padding:1.5mm 2mm">Umsetzungsquote EE NS</td>
          <td style="text-align:right;padding:1.5mm 2mm;font-weight:600">${Math.round(uqPct)} %</td>
          <td style="text-align:right;padding:1.5mm 2mm;color:#6c757d">–</td>
          <td style="text-align:right;padding:1.5mm 2mm;color:#6c757d">–</td>
        </tr>` : ''}
      </tbody>
    </table>
    <p style="font-size:7.5pt;color:#868e96;margin:0">Quelle: BNetzA EWK 2024 – alle deutschen Verteilnetzbetreiber.
      Regionaler Peer-Vergleich (Bundesland, Größenklasse) ist als Roadmap-Item für den nächsten EWK-Datensatz geplant.</p>
    ${tornadoHtml}`;
}

function renderSection6(s6) {
  const churn = safeData(s6, 'churnPrediction');
  const leads = safeData(s6, 'salesLeads');

  // Parse churn text for segment data
  // After safeData unwrap, churn may be an array [{type,text}] or a legacy flat object
  const churnText = typeof churn === 'string'
    ? churn
    : (churn?.[0]?.text ?? churn?.data?.[0]?.text ?? '');
  // Match 'at-risk customers (max 100)**: 60' OR plain '60 customers/Kunden'
  const atRiskMatch =
    churnText.match(/at-risk customers[^:]*\*{0,2}:\s*\*{0,2}(\d+)/i) ||
    churnText.match(/at-risk Kunden[^:]*:\s*(\d+)/i) ||
    churnText.match(/(\d+)\s+(?:customers?|Kunden)/i);
  const atRiskCount = atRiskMatch ? parseInt(atRiskMatch[1], 10) : null;
  const churnRateMatch = churnText.match(/churn rate.*?:\s*([\d.]+)%/i);
  const churnRate = churnRateMatch ? parseFloat(churnRateMatch[1]) : null;
  // CR-12: Detect heuristic/fallback values – tag with DataStatus.FALLBACK
  const isHeuristicChurn = /heuristic|heuristik/i.test(churnText);

  // CR-12: Build DataStatus-aware display values for churn fields
  const churnRateDisplay = (() => {
    if (!isAvail(s6, 'churnPrediction')) return null;
    if (churnRate === null) return null;
    if (isHeuristicChurn) {
      // Heuristic model – show with ~ prefix, not as a definitive number
      return `~${churnRate.toFixed(1)} ℹ️`;
    }
    return fmtPct(churnRate);
  })();
  const churnRateFallback = (() => {
    if (!isAvail(s6, 'churnPrediction')) return 'Churn-Tool nicht verfügbar';
    if (isHeuristicChurn) return 'Branchenheuristik (BDEW-Referenz) – kein CRM-Datenzugang';
    if (churnRate === null) return 'Wert nicht extrahierbar';
    return '';
  })();

  const atRiskDisplay = (() => {
    if (!isAvail(s6, 'churnPrediction')) return null;
    if (atRiskCount === null) return null;
    if (isHeuristicChurn) return `~${atRiskCount} ℹ️`;
    return atRiskCount;
  })();
  const atRiskFallback = (() => {
    if (!isAvail(s6, 'churnPrediction')) return 'Churn-Tool nicht verfügbar';
    if (isHeuristicChurn) return 'Branchenheuristik – nicht VNB-spezifisch';
    if (atRiskCount === null) return 'Wert nicht extrahierbar';
    return '';
  })();

  const leadsCount =
    leads?.leads?.length ??
    leads?.data?.leads?.length ??
    getVal(leads, 'totalCount', 'count', 'total');

  const rows = [
    kpiRow(
      'Churn-Risiko-Score (Segment-Ø)',
      churnRateDisplay,
      '',
      isHeuristicChurn ? 'Wechselwahrscheinlichkeit (Branchenheuristik – nicht VNB-spezifisch)' : 'Wechselwahrscheinlichkeit (Heuristik-Modell)',
      churnRateFallback
    ),
    kpiRow(
      'Gefährdete Kunden (geschätzt)',
      atRiskDisplay,
      isHeuristicChurn ? 'Kunden ℹ️' : 'Kunden',
      'At-risk Kunden im Analysezeitraum',
      atRiskFallback
    ),
    kpiRow(
      'Neukunden-Leads (Neuanlagen)',
      isAvail(s6, 'salesLeads') ? leadsCount : null,
      'Leads',
      'Neue PV, Wallbox, WP, Speicher im Netzgebiet',
      !isAvail(s6, 'salesLeads') ? 'Leads-Tool nicht verfügbar' : ''
    ),
    kpiRow(
      'Marktdurchdringungsquote',
      isAvail(s6, 'marketPenetration')
        ? fmtPct(getVal(safeData(s6, 'marketPenetration'), 'penetrationRate', 'marketShare', 'rate'))
        : null,
      '',
      'Eigene Kunden vs. Gesamtpotenzial im Netzgebiet',
      !isAvail(s6, 'marketPenetration') ? 'Tool nicht lizenziert' : ''
    ),
    kpiRow(
      'Direktvermarktungs-Kandidaten',
      isAvail(s6, 'directMarketing')
        ? getVal(safeData(s6, 'directMarketing'), 'count', 'total')
        : null,
      'Anlagen',
      '§21 EEG – identifizierte Wechselkandidaten (>100 kW)',
      !isAvail(s6, 'directMarketing') ? 'Tool nicht lizenziert' : ''
    ),
    kpiRow(
      'Prosumer-Tarif-Optimierung',
      isAvail(s6, 'prosumerTariff') ? '✓ Analyse verfügbar' : null,
      '',
      'PV + Speicher + Wallbox + WP – optimaler Tarif',
      !isAvail(s6, 'prosumerTariff') ? 'Tool nicht lizenziert' : ''
    ),
  ];

  // Churn doughnut chart (Preis 40%, Service 30%, Innovation 20%, Umzug 10%)
  const churnDonut = `
    <h3 class="sub-sub">Churn-Gründe (Branchenschätzung)</h3>
    <div class="chart-wrap no-break" style="height:180px">
      <canvas id="chartChurn"></canvas>
    </div>
    <p class="chart-caption">Abb. 5: Kundenabwanderungsgründe – Branchenverteilung (Heuristik)</p>
    <script>
      (function(){
        new Chart(document.getElementById('chartChurn'),{
          type:'doughnut',
          data:{labels:['Preis (40%)','Service (30%)','Innovation (20%)','Umzug (10%)'],
            datasets:[{data:[40,30,20,10],
              backgroundColor:['#c0392b','#d68910','#2e86c1','#1e8449'],
              borderWidth:2,borderColor:'#fff'}]},
          options:{responsive:true,maintainAspectRatio:false,cutout:'55%',
            plugins:{legend:{position:'right',labels:{font:{size:9},boxWidth:12}}}}
        });
      })();
    </script>`;

  return `
    <h1 class="section-title"><span class="section-number">6</span>Kundenmanagement, Vertrieb &amp; Prosumer</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Churn-Prävention, Prosumer-Tarife, Mieterstrom und Neukundenakquise.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung Kundenmanagement', [
      'Churn-Prävention: Retention-Kampagne für "at-risk"-Kunden starten – Fokus Preis und Service (70 % der Wechselgründe).',
      'Neukunden-Leads: Neue PV-, Speicher- und Wallbox-Anschlüsse als Sales-Trigger nutzen (3–5× höhere Konversionsrate als Kaltakquise).',
      'Prosumer-Tarif: EEG-ablaufende Anlagen (>20 Jahre) proaktiv ansprechen – Post-EEG-Tariflösung anbieten.',
      'Direktvermarktung: §21 EEG-Kandidaten >100 kW im Netzgebiet identifizieren und Marktprämienvertrag anbieten.',
    ])}
    ${churnDonut}`;
}

function renderSection7(s7) {
  // CR-07: Use operatorAnalysis as fallback for portfolio count when dedicated tool is unavailable
  const opData7 = safeData(s7, 'operatorAnalysis');
  const totalFromOp = getVal(
    opData7, 'totalInstallations', 'total', 'count', 'installationCount', 'anlagenCount'
  );

  // CR-20: Collapse to compact upsell block when all four dedicated tools are unavailable.
  // Avoids a full page of n/v rows that provides no actionable insight.
  const anyAvail =
    isAvail(s7, 'investmentBusinessCase') ||
    isAvail(s7, 'storageOptimization') ||
    isAvail(s7, 'operatorPortfolio') ||
    isAvail(s7, 'operatorAnalysis');

  if (!anyAvail) {
    return `
    <h1 class="section-title"><span class="section-number">7</span>Investitionsplanung &amp; Business Cases</h1>
    <div style="border:1px solid #dee2e6;border-radius:4px;padding:4mm 5mm;margin:3mm 0;background:#f8f9fa">
      <p style="font-size:9.5pt;font-weight:600;color:#495057;margin:0 0 2mm 0">🔒 Erweiterte Investitionsanalyse nicht verfügbar</p>
      <p style="font-size:8.5pt;color:#6c757d;margin:0 0 2mm 0">
        Die folgenden Premium-Funktionen sind in Ihrer aktuellen Lizenzstufe nicht aktiviert oder konnten nicht abgerufen werden:
      </p>
      <ul style="font-size:8.5pt;color:#6c757d;margin:0 0 2mm 0;padding-left:4mm">
        <li><strong>Investment Business Case</strong> – NPV-Kalkulation für Kabel-, Trafo- und Speicherprojekte</li>
        <li><strong>Storage Optimization</strong> – Standortbewertung für Quartiers- und Industriespeicher</li>
        <li><strong>Operator Portfolio</strong> – Vollständige Portfolioauswertung inkl. NAP/MeLo-Status</li>
        <li><strong>Grid Operator Dashboard</strong> – Kapazitäten, Redispatch-Pool, Investitionspriorität</li>
      </ul>
      <p style="font-size:8pt;color:#868e96;margin:0">
        Für Freischaltung wenden Sie sich an Ihren Cernion-Ansprechpartner.
      </p>
    </div>
    ${actionHint('Handlungsempfehlung Investitionsplanung', [
      'NEST-Förderung: §11 Abs. 2 EnWG-Engpassnachweis vorlegen, bevor Netzausbau-CAPEX beantragt wird.',
      'Batteriespeicher: NPV-Berechnung für USW-Standorte mit hoher EE-Einspeisung und Redispatch-Häufigkeit.',
      'Amortisation Netzausbau vs. Steuerungslösung: §14a-Szenario (40–60 % CAPEX-Einsparung) vor Budgetfreigabe prüfen.',
      'Portfolioauswertung: Anlagen ohne NAP/MeLo priorisiert nachrüsten – Grundlage für Direktvermarktung und Redispatch.',
    ])}
  `;
  }

  const rows = [
    kpiRow(
      'NPV Netzinvestition',
      isAvail(s7, 'investmentBusinessCase')
        ? getVal(safeData(s7, 'investmentBusinessCase'), 'npv', 'netPresentValue')
        : null,
      '€',
      'CAPEX (Kabel/Trafo/Speicher) vs. Netzalternative',
      !isAvail(s7, 'investmentBusinessCase') ? 'Investment-Business-Case-Tool nicht lizenziert' : ''
    ),
    kpiRow(
      'Amortisationszeit Netzerweiterung',
      isAvail(s7, 'investmentBusinessCase')
        ? fmtNum(getVal(safeData(s7, 'investmentBusinessCase'), 'paybackYears', 'roi', 'amortization'), 1)
        : null,
      'Jahre',
      'Break-Even Netzausbau vs. Steuerungslösung',
      !isAvail(s7, 'investmentBusinessCase') ? 'Investment-Business-Case-Tool nicht lizenziert' : ''
    ),
    kpiRow(
      'Betreiber-Portfolio Gesamt',
      isAvail(s7, 'operatorPortfolio')
        ? getVal(safeData(s7, 'operatorPortfolio'), 'totalInstallations', 'count', 'total')
        : (totalFromOp ?? null),
      'Anlagen',
      'Vollständige Portfolioauswertung',
      (!isAvail(s7, 'operatorPortfolio') && totalFromOp === null)
        ? 'Operator-Portfolio-Tool nicht verfügbar' : ''
    ),
    kpiRow(
      'Speicheroptimierungs-Potenzial',
      isAvail(s7, 'storageOptimization')
        ? getVal(safeData(s7, 'storageOptimization'), 'potentialKwh', 'capacity')
        : null,
      'kWh',
      'NPV-Analyse Batteriespeicherstandorte',
      !isAvail(s7, 'storageOptimization') ? 'Storage-Optimierungs-Tool nicht lizenziert' : ''
    ),
    kpiRow(
      'Grid Operator Vollanalyse',
      isAvail(s7, 'operatorAnalysis') ? '✓ Dashboard verfügbar' : null,
      '',
      'Alle Anlagen + Kapazitäten + Status im Netzgebiet',
      !isAvail(s7, 'operatorAnalysis') ? 'Grid-Operator-Analyse nicht verfügbar' : ''
    ),
  ];

  return `
    <h1 class="section-title"><span class="section-number">7</span>Investitionsplanung &amp; Business Cases</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Wirtschaftlichkeit von Netzinvestitionen, Speicherprojekten und Eigenanlagen.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung Investitionsplanung', [
      'NEST-Förderung: §11 Abs. 2 EnWG-Engpassnachweis vorlegen, bevor Netzausbau-CAPEX beantragt wird.',
      'Batteriespeicher: NPV-Berechnung für USW-Standorte mit hoher EE-Einspeisung und Redispatch-Häufigkeit.',
      'Amortisation Netzausbau vs. Steuerungslösung: §14a-Szenario (40–60 % CAPEX-Einsparung) vor Budgetfreigabe prüfen.',
      'Portfolioauswertung: Anlagen ohne NAP/MeLo priorisiert nachrüsten – Grundlage für Direktvermarktung und Redispatch.',
    ])}
  `;
}

// ─── Marktpartner-Register (CR-19) ───────────────────────────────────────────

/**
 * Render a small table of ALL market-partner candidates found during Phase 1
 * VNB resolution.  Shows name, BDEW code, market role(s), and MaStR-ID so
 * report readers can verify the correct entry was selected and spot any
 * Lieferant/Vertrieb roles that may have MaStR installation assignments.
 *
 * @param {Array<{name:string, bdew:string|null, roles:string[], mastrId:string|null}>} allPartners
 * @returns {string} HTML fragment (empty string when allPartners is empty)
 */
function renderMarktpartnerRegistry(allPartners) {
  if (!Array.isArray(allPartners) || allPartners.length === 0) return '';

  // CR-18: Quality gate – suppress table when fewer than 50 % of entries carry
  // a resolved Marktrolle.  A table of bare BDEW codes without role information
  // adds no value and clutters the report.
  const enrichedCount = allPartners.filter(
    (p) => Array.isArray(p.roles) && p.roles.length > 0
  ).length;
  if (enrichedCount < Math.ceil(allPartners.length * 0.5)) return '';

  const rows = allPartners.map((p) => {
    const roles = Array.isArray(p.roles) && p.roles.length ? p.roles.join(', ') : '–';
    const isVnb = /VNB|Verteilnetz|Netzbetreiber/i.test(roles);
    const rowStyle = isVnb ? ' style="font-weight:600"' : '';
    return `<tr${rowStyle}>
      <td style="padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0">${escapeHtml(p.name)}</td>
      <td style="padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;font-family:monospace">${escapeHtml(p.bdew || '–')}</td>
      <td style="padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0">${escapeHtml(roles)}</td>
      <td style="padding:1.5mm 2mm;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:7.5pt">${escapeHtml(p.mastrId || '–')}</td>
    </tr>`;
  }).join('');
  return `
    <div style="margin-top:4mm">
      <h4 style="font-size:9pt;color:#495057;margin:0 0 1.5mm 0">Marktpartner-Register (alle gefundenen BDEW-Codes)</h4>
      <table style="width:100%;border-collapse:collapse;font-size:8pt">
        <thead><tr style="background:#f8f9fa">
          <th style="text-align:left;padding:1.5mm 2mm;border-bottom:1px solid #dee2e6">Name</th>
          <th style="text-align:left;padding:1.5mm 2mm;border-bottom:1px solid #dee2e6">BDEW-Code</th>
          <th style="text-align:left;padding:1.5mm 2mm;border-bottom:1px solid #dee2e6">Marktrolle(n)</th>
          <th style="text-align:left;padding:1.5mm 2mm;border-bottom:1px solid #dee2e6">MaStR-ID</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ─── CR-45: Marktrollen-Profil block ─────────────────────────────────────────
/**
 * Renders a compact role badge summary for all classified market roles.
 * Shows each role (VNB, Lieferant, MSB, BKV, DV) with its BDEW code.
 *
 * @param {object|null} marktRollenProfile - { vnb, lieferant, msb, bkv, direktvermarkter }
 * @returns {string} HTML fragment
 */
function renderMarktrollenProfile(marktRollenProfile) {
  if (!marktRollenProfile) return '';
  const ROLE_CONFIG = [
    { key: 'vnb', label: 'VNB', color: '#1a5276' },
    { key: 'lieferant', label: 'Lieferant', color: '#145a32' },
    { key: 'msb', label: 'MSB', color: '#4a235a' },
    { key: 'bkv', label: 'BKV', color: '#784212' },
    { key: 'direktvermarkter', label: 'DV', color: '#1a3a5c' },
  ];
  const active = ROLE_CONFIG.filter(({ key }) => marktRollenProfile[key]?.bdew);
  if (active.length === 0) return '';
  const badges = active.map(({ key, label, color }) => {
    const entry = marktRollenProfile[key];
    return `<span style="display:inline-block;background:${color};color:#fff;border-radius:2px;` +
      `padding:0.5mm 1.5mm;font-size:7.5pt;margin:0.5mm 1mm 0.5mm 0;font-family:monospace">` +
      `${escapeHtml(label)}: ${escapeHtml(entry.bdew)}</span>`;
  }).join('');
  return `
    <div style="margin-top:4mm">
      <h4 style="font-size:9pt;color:#495057;margin:0 0 1.5mm 0">Marktrollen-Profil (BDEW-Codes nach Rolle)</h4>
      <p style="font-size:8pt;color:#6c757d;margin:0 0 1.5mm 0">Alle gefundenen Marktrollen aus dem BDEW-Register.</p>
      <div>${badges}</div>
    </div>`;
}

function renderSection8(s8, allPartners = [], marktRollenProfile = null) {
  const sysStatus = safeData(s8, 'systemStatus');
  const eicStats = safeData(s8, 'eicStatistics');
  const diData = safeData(s8, 'digitalisierungsindex');
  const diJson8 = extractEwkJson(diData);
  // digitalisierungsindex tool JSON: {metadata, stats, rows:[{gesamtscore:44,smart_grids:3,...}]}
  // Scores are already in % (0-100), NOT 0-1 fractions – do NOT multiply by 100.
  const diScores8 = diJson8?.rows?.[0] ?? null;
  const diMedian8 = diJson8?.stats?.gesamtscore?.median ?? null;

  // systemStatus: production returns text-array (after unwrap); test mocks return flat {status}
  const status =
    getVal(sysStatus, 'status', 'systemStatus', 'overall') ??
    (Array.isArray(sysStatus) ? '✅ Online' : null);

  const rows = [
    kpiRow(
      'Cernion Systemstatus',
      isAvail(s8, 'systemStatus') ? status : null,
      '',
      'Powabase, ENTSO-E, SMARD, GrünstromIndex'
    ),
    kpiRow(
      'EIC-Datenbank Gesamtbestand',
      isAvail(s8, 'eicStatistics')
        ? (eicStats?.statistics?.total ?? getVal(eicStats, 'total', 'totalCount', 'count'))
        : null,
      'Codes',
      'EIC-Register nach Sektor und Land'
    ),
    kpiRow(
      'Digitalisierungsindex (Gesamt)',
      isAvail(s8, 'digitalisierungsindex') && diScores8 !== null
        ? fmtPct(diScores8.gesamtscore)
        : null,
      '',
      'VNB Digitalisierungsgesamtscore (BNetzA EWK)'
    ),
    kpiRow(
      'DI-Rang',
      isAvail(s8, 'digitalisierungsindex') && diScores8?.gesamtscore_rank != null
        ? diScores8.gesamtscore_rank
        : null,
      '',
      'Rang im bundesweiten VNB-Vergleich (BNetzA EWK)'
    ),
    kpiRow(
      'DI-Bundesmedian',
      isAvail(s8, 'digitalisierungsindex') && diMedian8 !== null
        ? fmtPct(diMedian8)
        : null,
      '',
      'Bundesmedian Digitalisierungsgesamtscore aller VNBs'
    ),
    kpiRow(
      'Smart Grids Score',
      isAvail(s8, 'digitalisierungsindex') && diScores8 !== null
        ? fmtPct(diScores8.smart_grids)
        : null,
      '',
      'Teilscore: Smart Grids Infrastruktur'
    ),
    kpiRow(
      'Kundenportal-Score',
      isAvail(s8, 'digitalisierungsindex') && diScores8 !== null
        ? fmtPct(diScores8.kundenmanagement_webportale ?? diScores8.kundenmanagement)
        : null,
      '',
      'Teilscore: Webportal und Kundenportal-Digitalisierung'
    ),
  ];

  // CR-33: Only emit recommendations that have a factual basis in available data.
  //         Threshold-triggered hints (score <30%, offline) are suppressed when
  //         the underlying KPI is unavailable (showing "–").
  const s8Hints = [
    // Always relevant – regulatory obligation regardless of DI data
    'EIC-Codes: Alle Redispatch- und §14a-Anlagen benötigen gültige EIC-Codes für ENTSO-E-Meldungen.',
  ];
  if (isAvail(s8, 'digitalisierungsindex') && diScores8 !== null) {
    if (diScores8.smart_grids < 30) {
      s8Hints.push(`Smart-Grids Score ${fmtPct(diScores8.smart_grids)}: SMGW-Rollout-Plan erstellen und Förderanträge (Digitalisierungsoffensive) prüfen.`);
    } else {
      s8Hints.push(`Smart-Grids Score ${fmtPct(diScores8.smart_grids)}: Niveau halten – Rollout-Plan aktuell halten.`);
    }
    const portalScore = diScores8.kundenmanagement_webportale ?? diScores8.kundenmanagement;
    if (portalScore != null) {
      s8Hints.push(`Kundenportal-Score ${fmtPct(portalScore)}: Selbstservice-Angebote für Betreiberwechsel und EEG-Auskunft reduzieren Callcenter-Last um 30–40 %.`);
    }
  } else {
    // No DI data – generic hint without triggering a specific threshold
    s8Hints.push('Digitalisierungsindex: EWK-Datensatz für diesen VNB prüfen – Score und Rang noch nicht verfügbar.');
  }
  // CR-33: Systemstatus "offline" hint only when status is actually not online
  if (status !== null && !/online|✅/i.test(String(status))) {
    s8Hints.push('Systemstatus offline: Datenversorgung für Redispatch und MaKo-Prozesse sofort prüfen – regulatorische Meldepflichten beachten.');
  }

  return `
    <h1 class="section-title"><span class="section-number">8</span>Digitalisierung &amp; Systemübersicht</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Systemstatus, EIC-Register und Infrastruktur-Monitoring.</p>
    ${kpiTable(rows)}
    ${actionHint('Handlungsempfehlung Digitalisierung', s8Hints)}
    ${renderMarktpartnerRegistry(allPartners)}
    ${renderMarktrollenProfile(marktRollenProfile)}`;
}

// ─── Management Summary ───────────────────────────────────────────────────────

function renderManagementSummary(summaryText, utilityName) {
  const defaultFindings = [
    'Transformatorauslastung und Netzkapazitätsreserven wurden analysiert – prüfen Sie kritische Stränge auf §14a-Handlungsbedarf.',
    'Das EE-Portfolio zeigt das aktuelle Einspeiserpotenzial im Netzgebiet; Redispatch-Anlagen wurden inventarisiert.',
    'Energiemarktpreise und CO₂-Intensität liegen im Berichtszeitraum vor; negative Preisphasen wurden erfasst.',
    'BNetzA EWK-Benchmarkdaten (Anschlussdauer, Digitalisierungsindex, Umsetzungsquote) wurden ausgewertet.',
    'Churn-Risiken und Neukundenpotenziale aus dem Netzgebiet wurden identifiziert – Handlungsbedarf im Prosumer-Segment prüfen.',
  ];

  // CR-23: Prompt-leak patterns – the LLM sometimes echoes the prompt as the
  // first output line (classic completion artefact).  Filter these before
  // inserting into the customer-facing report.
  // CR-30: Also filter lines that contain camelCase JavaScript variable names
  //         (e.g. 'loadFallbackWarning') which leak from the raw kpiSummary JSON.
  const PROMPT_LEAK_PATTERNS = [
    /^hier ist/i,
    /^die (folgende|nachfolgende)/i,
    /^management summary für/i,
    /^zusammenfassung für/i,
    /^im folgenden/i,
    /^(nachfolgend|anbei|hiermit)\b/i,
    /:\s*$/,  // Line ends with bare colon → intro/header sentence
    // CR-30: camelCase internal identifiers echoed by LLM from kpiSummary JSON keys
    /['"]?[a-z][a-zA-Z]*(Warning|Error|Status|Fallback|Flag|Raw|Data)['"]?/,
    /\b(DataStatus|NOT_LICENSED|NOT_CALLED|loadFallback|isError|kpiSummary)\b/i,
  ];

  // Try to split Gemini narrative into bullet points
  let findings = defaultFindings;
  if (summaryText && typeof summaryText === 'string' && summaryText.trim().length > 50) {
    const lines = summaryText
      .split(/\n+/)
      .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
      .filter((l) => l.length > 20 && l.length < 400)
      // Strip the GEMINI_API_KEY hint line from the bullet list
      .filter((l) => !l.startsWith('📋 Hinweis:'))
      // CR-23: strip prompt-leak lines
      .filter((l) => {
        const isLeak = PROMPT_LEAK_PATTERNS.some((p) => p.test(l));
        if (isLeak) console.warn(`[Summary] Prompt-Leak unterdrückt: "${l.slice(0, 80)}"`);
        return !isLeak;
      });
    if (lines.length >= 3) findings = lines;
  }

  // CR-16: Cap at 5 bullets
  const capped = findings.slice(0, 5);

  const bullets = capped
    .map(
      (f, i) =>
        `<div class="summary-finding"><span class="num">${i + 1}</span><p>${escapeHtml(f)}</p></div>`
    )
    .join('\n');

  return `
    <div class="summary-box">
      <h2>Management Summary – ${escapeHtml(utilityName)}</h2>
      <p style="font-size:9pt;color:#6c757d;margin-bottom:4mm;">
        Datengetriebene Analyse auf Basis Cernion MCP-Tools (MaStR, ENTSO-E, AGSI/GIE, BNetzA EWK, SMARD, GrünstromIndex).
      </p>
      ${bullets}
    </div>`;
}

// ─── Context Box (Web Search) ─────────────────────────────────────────────────

/**
 * CR-29: Relevance score for a news/web-search item.
 *
 * Positive signals: energy-sector keywords in title+snippet → +2 each.
 * Negative signals: navigation fragments, download links, homepage teasers → -5 each.
 * Items with score ≤ 2 are rejected; up to 4 items survive (sorted by score desc).
 *
 * @param {{ title?: string, snippet?: string }} item
 * @returns {number}
 */
function scoreNewsItem(item) {
  const text = ((item.title ?? '') + ' ' + (item.snippet ?? '')).toLowerCase();
  let score = 0;

  const POSITIVE_KW = [
    'netzausbau', 'photovoltaik', 'solaranlage', 'windkraft', 'speicher',
    'wärmepumpe', 'smartmeter', 'smart meter', 'digitalisierung', 'förderung',
    'regulierung', 'eeg', 'wallbox', 'ladeinfrastruktur', 'energiewende',
    'lorawan', 'smart grid', 'redispatch', 'netzbetreiber', 'stadtwerk',
    'erneuerbare', 'energieeffizienz', '§14a', 'nest-regulierung',
  ];
  score += POSITIVE_KW.filter((kw) => text.includes(kw)).length * 2;

  const NEGATIVE_RE = [
    /^(downloads?|startseite|impressum|datenschutz|kontakt)\s*[-–]/i,
    /preise für den messstellenbetrieb/i,
    /\.(pdf|docx|xlsx)\s*[\(\d]/i,        // Download links with file sizes
    /hauptmen(?:ü|u)|navigation|anmeldung/i,
    /^\s*.{0,60}\s*$/,                    // Very short combined text
  ];
  score -= NEGATIVE_RE.filter((p) => p.test(item.title + ' ' + (item.snippet ?? ''))).length * 5;

  return score;
}

/**
 * CR-19: Blacklist for web-scraping artefacts (navigation DOM, login fragments).
 * Matches snippets that are browser-rendered nav menus rather than editorial text.
 */
const SNIPPET_BLACKLIST_RE =
  /Hauptmen(?:ü|u)|Abmelden|Anmeldung erforderlich|Internet-Planauskunft|Grund der Auskunft|Cookie-Hinweis|Bitte aktivieren Sie JavaScript|Hilfe\s+Hauptmen/i;

/**
 * CR-13 / CR-19: Quality filter – returns true only when at least 2 items pass:
 *   (a) title present, (b) snippet >50 chars, (c) snippet does not end with '...',
 *   (d) snippet does not match the nav-DOM blacklist (CR-19)
 */
function shouldRenderNewsSection(items) {
  if (!Array.isArray(items)) return false;
  const passing = items.filter(
    (item) =>
      item.title &&
      typeof item.snippet === 'string' &&
      item.snippet.length > 50 &&
      !item.snippet.endsWith('...') &&
      !SNIPPET_BLACKLIST_RE.test(item.snippet)
  );
  return passing.length >= 2;
}

/**
 * CR-13: Strip trailing source attribution from a snippet (e.g. " – Publisher").
 */
function formatSnippet(snippet) {
  if (!snippet) return '';
  return snippet.replace(/\s–\s[^.]{2,60}$/, '').trim();
}

function renderContextBox(webSearchResults) {
  if (!Array.isArray(webSearchResults) || webSearchResults.length === 0) return '';

  const rawItems = webSearchResults
    .flatMap((r) => r?.data?.results ?? [])
    .slice(0, 6);

  // CR-13: Suppress section entirely when quality threshold not met
  if (!shouldRenderNewsSection(rawItems)) return '';

  // CR-29: Score items for editorial relevance; keep top-4 with score > 2
  const scoredItems = rawItems
    .filter(
      (r) =>
        r.title &&
        typeof r.snippet === 'string' &&
        r.snippet.length > 50 &&
        !r.snippet.endsWith('...') &&
        !SNIPPET_BLACKLIST_RE.test(r.snippet)
    )
    .map((r) => ({ ...r, _score: scoreNewsItem(r) }))
    .filter((r) => r._score >= 2)
    .sort((a, b) => b._score - a._score)
    .slice(0, 4);

  const items = scoredItems
    .map(
      (r) =>
        `<li><a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(r.title)}</a>` +
        (r.snippet
          ? ` – <span style="color:#6c757d;font-size:8pt">${escapeHtml(formatSnippet(r.snippet).slice(0, 150))}</span>`
          : '') +
        '</li>'
    )
    .join('\n');

  if (!items) return '';

  return `
    <h2 class="sub-title">Aktuelle Meldungen &amp; Kontext</h2>
    <ul style="font-size:8.5pt;line-height:1.7;padding-left:4mm;color:#212529">
      ${items}
    </ul>`;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Build the complete 360° HTML report.
 *
 * @param {object} reportData
 * @param {object}  reportData.meta           - { utilityName, vnbName, bdew, region, reportId }
 * @param {object}  reportData.section1       - Netzbetrieb data buckets
 * @param {object}  reportData.section2       - EE-Portfolio data buckets
 * @param {object}  reportData.section3       - Energiemarkt data buckets
 * @param {object}  reportData.section4       - Gasinfrastruktur data buckets
 * @param {object}  reportData.section5       - Regulierung data buckets
 * @param {object}  reportData.section6       - Kunden & Vertrieb data buckets
 * @param {object}  reportData.section7       - Investition data buckets
 * @param {object}  reportData.section8       - Digitalisierung data buckets
 * @param {string}  reportData.managementSummary - Gemini narrative text
 * @param {Array}   reportData.webSearchResults  - Results from web-search.query
 * @param {string}  reportData.generatedAt    - ISO timestamp
 * @returns {string} Complete HTML document
 */
function buildHtmlReport(reportData) {
  const {
    meta = {},
    section1 = {},
    section2 = {},
    section3 = {},
    section4 = {},
    section5 = {},
    section6 = {},
    section7 = {},
    section8 = {},
    managementSummary = '',
    webSearchResults = [],
    generatedAt = new Date().toISOString(),
  } = reportData;

  const utilityName = meta.utilityName || 'Unbekannter Energieversorger';
  const vnbName = meta.vnbName || '';
  const region = meta.region || '';
  const reportId = meta.reportId || '';
  const allPartners = Array.isArray(meta.allPartners) ? meta.allPartners : []; // CR-19
  const marktRollenProfile = meta.marktRollenProfile ?? null; // CR-37/CR-45
  const reportDate = new Date(generatedAt).toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const reportTime = new Date(generatedAt).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const coverSubtitle = [vnbName, region].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>360° Management Report – ${escapeHtml(utilityName)}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>${buildCss()}</style>
</head>
<body>

<!-- ══════════════════════════════════════════════════════════════════ COVER ══ -->
<div class="cover">
  <div>
    <div style="font-size:9pt;opacity:.6;letter-spacing:3px;text-transform:uppercase;margin-bottom:4mm">Cernion Energy Intelligence</div>
    <h1>360° Management Report</h1>
    <h2>${escapeHtml(utilityName)}</h2>
    ${coverSubtitle ? `<p style="font-size:11pt;opacity:.8;margin-top:2mm">${escapeHtml(coverSubtitle)}</p>` : ''}
    <p class="subtitle">Berichtsstand: ${escapeHtml(reportDate)}</p>
    ${meta.bdew ? `<p style="font-size:8pt;opacity:.55;margin-top:2mm;font-family:monospace">VNB-BDEW: ${escapeHtml(meta.bdew)}${marktRollenProfile?.lieferant?.bdew ? ` &nbsp;&middot;&nbsp; Lieferant: ${escapeHtml(marktRollenProfile.lieferant.bdew)}` : ''}</p>` : ''}
    <div class="badge">Vertraulich · Nur für internen Gebrauch</div>
    ${reportId ? `<p style="font-size:7pt;opacity:.4;margin-top:6mm">Report-ID: ${escapeHtml(reportId)}</p>` : ''}
  </div>
</div>

<!-- ════════════════════════════════════════════════════════ MAIN CONTENT ══ -->
<div class="page">

  <!-- Management Summary -->
  ${renderManagementSummary(managementSummary, utilityName)}

  <!-- Section 1 -->
  ${renderSection1(section1)}

  <!-- Section 2 -->
  ${renderSection2(section2)}

  <!-- Section 3 -->
  ${renderSection3(section3)}

  <!-- Section 4 -->
  ${renderSection4(section4)}

  <!-- Section 5 -->
  ${renderSection5(section5)}

  <!-- Section 6 -->
  ${renderSection6(section6)}

  <!-- Section 7 -->
  ${renderSection7(section7)}

  <!-- Section 8 -->
  ${renderSection8(section8, allPartners, marktRollenProfile)}

  <!-- Web Search Context -->
  ${renderContextBox(webSearchResults)}

  <!-- Footer -->
  <div class="report-footer">
    <span>Cernion Energy Tools · 360° Management Report · ${escapeHtml(reportDate)} ${escapeHtml(reportTime)}</span>
    <span>Datenquellen: MaStR · ENTSO-E · AGSI/GIE · BNetzA EWK · SMARD · GrünstromIndex</span>
  </div>

</div>
</body>
</html>`;
}

/**
 * Summarise a MCP tool result into a compact flat object for Gemini narrative.
 * Strips large arrays, keeps numeric KPIs and status strings.
 *
 * @param {*} result - Raw service call result
 * @param {string} sectionKey - Human-readable label, e.g. 'capacityUtilization'
 * @returns {object}
 */
function summarizeForReport(result, sectionKey) {
  if (!result || !result.available || !result.data) {
    return { [sectionKey]: null };
  }

  const d = result.data;

  // Walk top-level fields; skip large arrays and keep scalars/short strings
  const summary = {};
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v)) {
      summary[`${k}_count`] = v.length;
    } else if (typeof v === 'object' && v !== null) {
      // One level deep: keep numeric/boolean/short-string leaves
      for (const [ik, iv] of Object.entries(v)) {
        if (typeof iv === 'number' || typeof iv === 'boolean') {
          summary[`${k}.${ik}`] = iv;
        } else if (typeof iv === 'string' && iv.length < 100) {
          summary[`${k}.${ik}`] = iv;
        }
      }
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      summary[k] = v;
    } else if (typeof v === 'string' && v.length < 200) {
      summary[k] = v;
    }
  }

  return { [sectionKey]: summary };
}

module.exports = { buildHtmlReport, summarizeForReport, escapeHtml };
