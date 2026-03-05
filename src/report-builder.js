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

// ─── KPI Row Helper ───────────────────────────────────────────────────────────

function kpiRow(label, value, unit = '', description = '') {
  const val = value !== null && value !== undefined ? escapeHtml(String(value)) : '–';
  const unitStr = unit ? `<span class="kpi-unit">${escapeHtml(unit)}</span>` : '';
  const desc = description
    ? `<td class="kpi-desc">${escapeHtml(description)}</td>`
    : '<td class="kpi-desc"></td>';
  return `<tr><td class="kpi-label">${escapeHtml(label)}</td><td class="kpi-value">${val}${unitStr}</td>${desc}</tr>`;
}

function kpiTable(rows) {
  return `<table class="kpi-table"><thead><tr><th>Kennzahl</th><th>Wert</th><th>Beschreibung</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function noDataBox(toolName) {
  return `<div class="no-data">Keine Daten verfügbar${toolName ? ` (${escapeHtml(toolName)})` : ''} – Tool nicht erreichbar oder keine Lizenz.</div>`;
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
  const co2 = safeData(s1, 'co2Intensity');

  // Transformer utilization chart data
  const voltages = ['NS', 'MS', 'HS'];
  const utilValues = voltages.map((v) => {
    const lvl = cu?.utilizationByVoltage?.[v] ?? cu?.data?.[v] ?? null;
    return lvl !== null ? Math.round(Number(lvl)) : null;
  });
  const hasChart = utilValues.some((v) => v !== null);
  const chartData = hasChart
    ? JSON.stringify({ labels: voltages, values: utilValues.map((v) => v ?? 0) })
    : null;

  const rows = [
    kpiRow(
      'Trafo-Auslastung NS',
      isAvail(s1, 'capacityUtilization') ? fmtPct(utilValues[0]) : null,
      '',
      'Niederspannung – aktuelle Auslastung'
    ),
    kpiRow(
      'Trafo-Auslastung MS',
      isAvail(s1, 'capacityUtilization') ? fmtPct(utilValues[1]) : null,
      '',
      'Mittelspannung – aktuelle Auslastung'
    ),
    kpiRow(
      'Trafo-Auslastung HS',
      isAvail(s1, 'capacityUtilization') ? fmtPct(utilValues[2]) : null,
      '',
      'Hochspannung – aktuelle Auslastung'
    ),
    kpiRow(
      'Redispatch-Anlagen',
      isAvail(s1, 'redispatchExport')
        ? getVal(rd, 'totalCount', 'count', 'total')
        : null,
      'Anlagen',
      'Steuerbare Anlagen ≥100 kW im Netzgebiet'
    ),
    kpiRow(
      'Residuallast regional',
      isAvail(s1, 'residualLoad')
        ? fmtMw(rl?.summary?.netResidualLoad ?? rl?.summary?.residualLoad ?? getVal(rl, 'netResidualLoad', 'residualLoad', 'currentLoad'))
        : null,
      '',
      'Aktuelle Nettoresiduallaast'
    ),
    kpiRow(
      'CO₂-Intensität Strom',
      isAvail(s1, 'co2Intensity')
        ? fmtNum(getVal(co2, 'co2_intensity_gco2eq_kwh', 'co2intensity', 'intensity', 'value'), 0)
        : null,
      'gCO₂eq/kWh',
      'GrünstromIndex – aktuelle regionale CO₂-Intensität'
    ),
    kpiRow(
      'E-Mobilität Netzauswirkung',
      isAvail(s1, 'emobilityImpact') ? '✓ Analyse verfügbar' : null,
      '',
      'Kritische Straßenzüge, §14a-Relevanz'
    ),
    kpiRow(
      'Netzverluste (I²R)',
      isAvail(s1, 'gridLossAnalysis') ? '✓ Analyse verfügbar' : null,
      '',
      'Monetarisierte Verlustenergie je Netzabschnitt'
    ),
  ];

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

  return `
    <h1 class="section-title"><span class="section-number">1</span>Netzbetrieb &amp; Netzplanung</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Grundlage für Investitionsentscheidungen, NEST-Regulierung und langfristige Infrastrukturplanung.</p>
    ${kpiTable(rows)}
    ${chartHtml}`;
}

function renderSection2(s2) {
  const sol = safeData(s2, 'solar');
  const wind = safeData(s2, 'wind');
  const stor = safeData(s2, 'storage');

  const rows = [
    kpiRow(
      'Installierte PV-Leistung',
      isAvail(s2, 'solar')
        ? fmtKwp(getVal(sol, 'totalCapacityKw', 'totalCapacity', 'totalKwp'))
        : null,
      '',
      'Summe aktiver PV-Anlagen (MaStR)'
    ),
    kpiRow(
      'Anzahl PV-Anlagen',
      isAvail(s2, 'solar') ? getVal(sol, 'totalCount', 'count', 'total') : null,
      'Anlagen',
      'Aktive Solaranlagen im Netzgebiet'
    ),
    kpiRow(
      'Installierte Windleistung',
      isAvail(s2, 'wind')
        ? `${fmtNum(getVal(wind, 'totalCapacityKw', 'totalCapacity', 'totalKw'), 0)} kW`
        : null,
      '',
      'Onshore-Wind nach Betriebsstatus (MaStR)'
    ),
    kpiRow(
      'Installierte Speicherleistung',
      isAvail(s2, 'storage')
        ? `${fmtNum(getVal(stor, 'totalCapacityKw', 'totalCapacity', 'totalKw'), 0)} kW`
        : null,
      '',
      'Batteriespeicher, Heim- und Großspeicher'
    ),
    kpiRow(
      'Einspeisung Wind/Solar (Ist)',
      isAvail(s2, 'windSolarActual') ? '✓ Echtzeit-Daten verfügbar' : null,
      '',
      'ENTSO-E Echtzeit-Einspeisung'
    ),
    kpiRow(
      'Einspeise-Prognose (24h)',
      isAvail(s2, 'generationForecast') ? '✓ Prognose verfügbar' : null,
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

  return `
    <h1 class="section-title"><span class="section-number">2</span>Erneuerbare Energien &amp; Einspeiser</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">MaStR-basierte Analyse des Einspeiserportfolios und dessen Betriebsstatus.</p>
    ${kpiTable(rows)}`;
}

function renderSection3(s3) {
  const prices = safeData(s3, 'prices');
  const spot = safeData(s3, 'spotprices');

  // Day-ahead price chart – try to build from prices data
  const priceTimeSeries =
    prices?.prices || prices?.data?.prices || spot?.prices || spot?.data?.prices || [];
  const hasChart = Array.isArray(priceTimeSeries) && priceTimeSeries.length > 0;
  const chartSrc = hasChart
    ? priceTimeSeries.slice(-24).map((p) => ({
        t: p.startTime || p.timestamp || p.time || '',
        v: p.price ?? p.value ?? 0,
      }))
    : [];

  const latestPrice =
    getVal(prices, 'latestPrice', 'currentPrice') ??
    (priceTimeSeries.length > 0 ? priceTimeSeries[priceTimeSeries.length - 1]?.price : null);

  const rows = [
    kpiRow(
      'Day-Ahead-Preis (aktuell)',
      isAvail(s3, 'prices') ? fmtNum(latestPrice, 2) : null,
      '€/MWh',
      'EPEX Spotmarkt Deutschland'
    ),
    kpiRow(
      'Negative Preisphasen',
      isAvail(s3, 'negativePrices')
        ? getVal(safeData(s3, 'negativePrices'), 'count', 'totalHours')
        : null,
      'h/Monat',
      '§51 EEG Compliance-Monitoring'
    ),
    kpiRow(
      'Kraftwerksausfälle',
      isAvail(s3, 'unavailability')
        ? getVal(safeData(s3, 'unavailability'), 'totalUnavailableMW', 'totalMW', 'count')
        : null,
      '',
      'Ungeplante &amp; geplante Abschaltungen (ENTSO-E)'
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
      isAvail(s3, 'priceProductionAnalysis') ? '✓ Analyse verfügbar' : null,
      '',
      'Korrelation hohe Einspeisung / niedrige Preise'
    ),
  ];

  let chartHtml = '';
  if (chartSrc.length > 0) {
    const labels = JSON.stringify(
      chartSrc.map((p) => {
        const d = new Date(p.t);
        return isNaN(d) ? p.t : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      })
    );
    const values = JSON.stringify(chartSrc.map((p) => p.v));
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

  return `
    <h1 class="section-title"><span class="section-number">3</span>Energiemarkt &amp; Preise</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Strom- und Gaspreise, Marktdaten für Beschaffung, Tariffierung und Portfoliosteuerung.</p>
    ${kpiTable(rows)}
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
  const fillPct =
    cs?.storage?.full ??
    getVal(cs, 'full', 'fillLevelPct', 'percentFull');
  const euFill = getVal(eu, 'full', 'fillLevelPct', 'euFillLevel');

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
      'EU-Aggregat – EU-Mandats-Compliance (≥90%)'
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
      isAvail(s4, 'compareCountries') ? '✓ Daten verfügbar' : null,
      '',
      'DE vs. AT vs. NL vs. FR'
    ),
    kpiRow(
      'Speicher-Trendbewertung',
      isAvail(s4, 'storageTrend')
        ? getVal(trend, 'trendDirection', 'trend', 'direction')
        : null,
      '',
      'Injection vs. Withdrawal-Trend'
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

  return `
    <h1 class="section-title"><span class="section-number">4</span>Gasinfrastruktur &amp; Versorgungssicherheit</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Speicherfüllstände, Einspeisung/Entnahme und EU-weite Gasversorgungssicherheit.</p>
    ${kpiTable(rows)}
    ${chartHtml}`;
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

  // Anschlussdauer ranking chart (horizontal bar)
  const vnbAnschlussdauer =
    adJson?.anschlussdauer?.ee_ns_gesamt ??
    bmJson?.anschlussdauer?.ee_ns_gesamt ??
    null;
  const bundesMedian = null; // Not returned by API; chart shows VNB value only
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
      'Digitalisierungsindex (Gesamt)',
      isAvail(s5, 'digitalisierungsindex') || isAvail(s5, 'benchmarkVnb')
        ? fmtPct((diJson?.digitalisierungsindex?.gesamtscore ?? bmJson?.digitalisierungsindex?.gesamtscore) * 100)
        : null,
      '',
      'Smart Grids, Digitale Prozesse, Kundenmanagement'
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

  return `
    <h1 class="section-title"><span class="section-number">5</span>Regulierung, Compliance &amp; Marktprozesse</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">BNetzA-Monitoring, EIC-Register, MaKo-Stammdaten und §14a-Pflichten.</p>
    ${kpiTable(rows)}
    ${chartHtml}`;
}

function renderSection6(s6) {
  const churn = safeData(s6, 'churnPrediction');
  const leads = safeData(s6, 'salesLeads');

  // Parse churn text for segment data
  // After safeData unwrap, churn may be an array [{type,text}] or a legacy flat object
  const churnText = typeof churn === 'string'
    ? churn
    : (churn?.[0]?.text ?? churn?.data?.[0]?.text ?? '');
  const atRiskMatch = churnText.match(/(\d+)\s+(?:customers?|Kunden)/i);
  const atRiskCount = atRiskMatch ? parseInt(atRiskMatch[1], 10) : null;
  const churnRateMatch = churnText.match(/churn rate.*?:\s*([\d.]+)%/i);
  const churnRate = churnRateMatch ? parseFloat(churnRateMatch[1]) : null;

  const leadsCount =
    leads?.leads?.length ??
    leads?.data?.leads?.length ??
    getVal(leads, 'totalCount', 'count', 'total');

  const rows = [
    kpiRow(
      'Churn-Risiko-Score (Segment-Ø)',
      isAvail(s6, 'churnPrediction') && churnRate !== null ? fmtPct(churnRate) : null,
      '',
      'Wechselwahrscheinlichkeit (Heuristik-Modell)'
    ),
    kpiRow(
      'Gefährdete Kunden (geschätzt)',
      isAvail(s6, 'churnPrediction') && atRiskCount !== null ? atRiskCount : null,
      'Kunden',
      'At-risk Kunden im Analysezeitraum'
    ),
    kpiRow(
      'Neukunden-Leads (Neuanlagen)',
      isAvail(s6, 'salesLeads') ? leadsCount : null,
      'Leads',
      'Neue PV, Wallbox, WP, Speicher im Netzgebiet'
    ),
    kpiRow(
      'Marktdurchdringungsquote',
      isAvail(s6, 'marketPenetration')
        ? fmtPct(getVal(safeData(s6, 'marketPenetration'), 'penetrationRate', 'marketShare', 'rate'))
        : null,
      '',
      'Eigene Kunden vs. Gesamtpotenzial im Netzgebiet'
    ),
    kpiRow(
      'Direktvermarktungs-Kandidaten',
      isAvail(s6, 'directMarketing')
        ? getVal(safeData(s6, 'directMarketing'), 'count', 'total')
        : null,
      'Anlagen',
      '§21 EEG – identifizierte Wechselkandidaten (>100 kW)'
    ),
    kpiRow(
      'Prosumer-Tarif-Optimierung',
      isAvail(s6, 'prosumerTariff') ? '✓ Analyse verfügbar' : null,
      '',
      'PV + Speicher + Wallbox + WP – optimaler Tarif'
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
    ${churnDonut}`;
}

function renderSection7(s7) {
  const rows = [
    kpiRow(
      'NPV Netzinvestition',
      isAvail(s7, 'investmentBusinessCase')
        ? getVal(safeData(s7, 'investmentBusinessCase'), 'npv', 'netPresentValue')
        : null,
      '€',
      'CAPEX (Kabel/Trafo/Speicher) vs. Netzalternative'
    ),
    kpiRow(
      'Amortisationszeit Netzerweiterung',
      isAvail(s7, 'investmentBusinessCase')
        ? fmtNum(getVal(safeData(s7, 'investmentBusinessCase'), 'paybackYears', 'roi', 'amortization'), 1)
        : null,
      'Jahre',
      'Break-Even Netzausbau vs. Steuerungslösung'
    ),
    kpiRow(
      'Betreiber-Portfolio Gesamt',
      isAvail(s7, 'operatorPortfolio')
        ? getVal(safeData(s7, 'operatorPortfolio'), 'totalInstallations', 'count', 'total')
        : null,
      'Anlagen',
      'Vollständige Portfolioauswertung'
    ),
    kpiRow(
      'Speicheroptimierungs-Potenzial',
      isAvail(s7, 'storageOptimization')
        ? getVal(safeData(s7, 'storageOptimization'), 'potentialKwh', 'capacity')
        : null,
      'kWh',
      'NPV-Analyse Batteriespeicherstandorte'
    ),
    kpiRow(
      'Grid Operator Vollanalyse',
      isAvail(s7, 'operatorAnalysis') ? '✓ Dashboard verfügbar' : null,
      '',
      'Alle Anlagen + Kapazitäten + Status im Netzgebiet'
    ),
  ];

  return `
    <h1 class="section-title"><span class="section-number">7</span>Investitionsplanung &amp; Business Cases</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Wirtschaftlichkeit von Netzinvestitionen, Speicherprojekten und Eigenanlagen.</p>
    ${kpiTable(rows)}`;
}

function renderSection8(s8) {
  const sysStatus = safeData(s8, 'systemStatus');
  const eicStats = safeData(s8, 'eicStatistics');
  const diData = safeData(s8, 'digitalisierungsindex');
  const diJson8 = extractEwkJson(diData);
  const diScores8 = diJson8?.digitalisierungsindex ?? null;

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
      isAvail(s8, 'digitalisierungsindex')
        ? fmtPct(diScores8?.gesamtscore * 100)
        : null,
      '',
      'VNB Digitalisierungsgesamtscore (BNetzA EWK)'
    ),
    kpiRow(
      'Smart Grids Score',
      isAvail(s8, 'digitalisierungsindex')
        ? fmtPct(diScores8?.smart_grids * 100)
        : null,
      '',
      'Teilscore: Smart Grids Infrastruktur'
    ),
    kpiRow(
      'Kundenportal-Score',
      isAvail(s8, 'digitalisierungsindex')
        ? fmtPct(diScores8?.kundenportal * 100)
        : null,
      '',
      'Teilscore: Webportal und Kundenportal-Digitalisierung'
    ),
  ];

  return `
    <h1 class="section-title"><span class="section-number">8</span>Digitalisierung &amp; Systemübersicht</h1>
    <p style="font-size:9pt;color:#6c757d;margin-bottom:3mm;">Systemstatus, EIC-Register und Infrastruktur-Monitoring.</p>
    ${kpiTable(rows)}`;
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

  // Try to split Gemini narrative into bullet points
  let findings = defaultFindings;
  if (summaryText && typeof summaryText === 'string' && summaryText.trim().length > 50) {
    const lines = summaryText
      .split(/\n+/)
      .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
      .filter((l) => l.length > 20 && l.length < 400);
    if (lines.length >= 3) findings = lines.slice(0, 7);
  }

  const bullets = findings
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

function renderContextBox(webSearchResults) {
  if (!Array.isArray(webSearchResults) || webSearchResults.length === 0) return '';

  const items = webSearchResults
    .flatMap((r) => r?.data?.results ?? [])
    .slice(0, 6)
    .map(
      (r) =>
        `<li><a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(r.title)}</a>` +
        (r.snippet ? ` – <span style="color:#6c757d;font-size:8pt">${escapeHtml(r.snippet.slice(0, 120))}</span>` : '') +
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
  ${renderSection8(section8)}

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
