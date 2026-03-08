# CR-CERNION-044 · Report Engine Quality – Implementierungsplan
**Status:** PLANUNG · v1.0 · 8. März 2026

---

## 🎯 Strategische Übersicht

### Kernprinzipien dieser CR
1. **Datenvalidation durch Microservices**: Alle Daten müssen durch dedizierte Services abgefragt werden (nicht direkt aus MaStR)
2. **Single Source of Truth**: Jede Kennzahl wird einmal pro Report-Generierung abgerufen, caching auf Service-Ebene
3. **Fehlerfreie Beispieldaten**: Keine hardcodierten oder beliebig gewählten Beispiele – immer aus gefilterten Datensätzen
4. **Live-Wert + Kontext**: Für Real-Time-Daten: Wert + Zeitstempel + Quelle, niemals nur "verfügbar"

### Microservices-Strategie
- **query.service.js**: Zentrale MaStR-Abfragen (bereits mit Parameter-Validierung)
- **utility-report.service.js**: Report-Orchestration und Daten-Mapping
- **grid-operations.service.js**: VNB-/Grid-Kontext (Geodaten, Netzgebiete)
- **energy-market.service.js**: Live-Erzeugungsdaten (ENTSO-E, regionale Mix)
- **forecast.service.js**: Residuallast-Prognosen (bestehend)
- **report-builder.js**: Template-Rendering mit datengetriebener Logik

---

## 📋 Detaillierter Fix-Plan pro Bug

### 🔴 BUG-4/8: MaStR Prüfstatus – COUNT + Beispiel

**Root Cause:**
- `query.service.js` hat LIMIT 5000 im Default-Query
- Beispielanlage wird ungefiltert ausgewählt (kein Prüfstatus-Filter)

#### Phase 1: Data Layer (query.service.js)

**Neue Action: `queryMastrInPruefung`** (mit Parameter-Validation)
```js
// Input-Validierung
const params = {
  gridOperatorId: this.validateGridOperatorId(gridOperatorId),  // SNB/GNB format
  statusFilter: 'InPruefung',                                    // konstant
  maxResults: 1000000,                                           // realistic upper bound
};

// Query 1: Authentischer COUNT
const countResult = await this.broker.call('query.getMastrCount', {
  gridOperatorId: params.gridOperatorId,
  netzbetreiberPruefungStatus: 'InPruefung',  // explicit enum value
  validate: true,  // enforce schema validation
});
// Returns: { count: 41, operator: 'SNB961745390019', timestamp: ISO8601 }

// Query 2: Beispielanlage aus gefilterten Daten
const exampleResult = await this.broker.call('query.getMastrInstallations', {
  gridOperatorId: params.gridOperatorId,
  netzbetreiberPruefungStatus: 'InPruefung',
  limit: 1,
  sortBy: 'capacity',
  sortOrder: 'DESC',
  validate: true,
});
// Returns: { installations: [{ mastrNumber, capacity, status, ... }], ... }

// Validation: Ist das Beispiel wirklich in Prüfung?
if (!exampleResult.installations.length) {
  return { count: 0, example: null, reason: 'NO_INSTALLATIONS_IN_PRUEFUNG' };
}
const example = exampleResult.installations[0];
if (example.netzbetreiberPruefungStatus !== 'InPruefung') {
  throw new ValidationError(`Example ${example.mastrNumber} has status ${example.netzbetreiberPruefungStatus}, expected InPruefung`);
}

return {
  count: countResult.count,
  example: {
    mastrNumber: example.mastrNumber,
    capacity: example.capacity,
    type: example.anlagentyp,
    status: 'InPruefung',
    timestamp: exampleResult.queryTime,
  },
  source: 'query.getMastr*',
  validated: true,
};
```

**Implementierungsort:** `services/query.service.js`

**Neue Parameter-Validierung in query.service.js:**
```js
validateGridOperatorId(id) {
  if (!id || typeof id !== 'string') throw new ParamError('gridOperatorId required');
  if (!id.match(/^(SNB|GNB)\d{18}[A-Z]$/)) throw new ParamError('Invalid format SNB/GNB...');
  return id;
}

validateStatusFilter(status) {
  const valid = ['InPruefung', 'Geprueft', 'NichtVorgesehen'];
  if (!valid.includes(status)) throw new ParamError(`Status must be one of ${valid}`);
  return status;
}

validateSortOrder(order) {
  if (!['ASC', 'DESC'].includes(order)) throw new ParamError('sortOrder must be ASC or DESC');
  return order;
}
```

#### Phase 2: Report Layer (utility-report.service.js)

**Neuer Report-Builder-Call:**
```js
async generateSchocker(vnbData) {
  const pruefungData = await this.broker.call('query.queryMastrInPruefung', {
    gridOperatorId: vnbData.gridOperatorId,
  });

  // Validation: wurde der Wert wirklich abgefragt?
  if (pruefungData.count === undefined) {
    this.logger.warn(`BUG-4: count is undefined for ${vnbData.gridOperatorId}`);
    return null;  // Don't render SCHOCKER if data invalid
  }

  // AC-3: Nur rendern wenn count > 0
  if (pruefungData.count === 0) {
    return { render: false, reason: 'NO_INSTALLATIONS_IN_PRUEFUNG' };
  }

  return {
    render: true,
    title: `🔴 ${pruefungData.count} Anlagen in Netzbetreiberprüfung`,
    example: {
      mastrNumber: pruefungData.example.mastrNumber,
      capacity: pruefungData.example.capacity,
      type: pruefungData.example.type,
    },
    source: 'MaStR Netzbetreiberprüfung',
    queryTime: pruefungData.timestamp,
    validated: true,
  };
}
```

**Sektion-1-Binding:**
```html
<!-- report-builder.js template -->
{{#if schocker.render}}
  <div class="section-1-schocker">
    <h3>{{schocker.title}}</h3>
    <p>Beispiel: <code>{{schocker.example.mastrNumber}}</code>
       ({{schocker.example.capacity}} kW {{schocker.example.type}})</p>
    <p><small>Quelle: {{schocker.source}} · Abfrage: {{schocker.queryTime}}</small></p>
  </div>
{{/if}}
```

#### Phase 3: Test-Layer (tests/query.service.test.js)

**Neue Test-Cases:**
```js
describe('queryMastrInPruefung - AC-1/2/3/4/5', () => {

  test('AC-1: Frankenthal (SNB961745390019) zeigt 41 Anlagen', async () => {
    const result = await broker.call('query.queryMastrInPruefung', {
      gridOperatorId: 'SNB961745390019',
    });
    expect(result.count).toBe(41);
    expect(result.example).toBeDefined();
  });

  test('AC-2: Beispielanlage hat Status InPruefung', async () => {
    const result = await broker.call('query.queryMastrInPruefung', {
      gridOperatorId: 'SNB961745390019',
    });
    // Zusätzliche Abfrage zum Verifizieren
    const verification = await broker.call('query.getMastrInstallations', {
      mastrNumbers: [result.example.mastrNumber],
    });
    expect(verification.installations[0].netzbetreiberPruefungStatus).toBe('InPruefung');
  });

  test('AC-3: Bei 0 Anlagen wird null returned', async () => {
    const result = await broker.call('query.queryMastrInPruefung', {
      gridOperatorId: 'SNB000000000000XXX',  // VNB mit 0 Anlagen in Prüfung
    });
    expect(result.count).toBe(0);
    expect(result.example).toBeNull();
    expect(result.reason).toBe('NO_INSTALLATIONS_IN_PRUEFUNG');
  });

  test('AC-4: Alle Zähler identisch (Gmünd SNB966216072913)', async () => {
    const result = await broker.call('utility-report.generate', {
      gridOperatorId: 'SNB966216072913',
    });
    const schockerCount = result.schocker.count;
    const section1Count = result.section1.pruefstatus.count;
    const briefingCount = result.briefing.highlights.pruefstatus.count;
    expect(schockerCount).toBe(section1Count);
    expect(section1Count).toBe(briefingCount);
  });

  test('Parameter-Validierung: Invalid gridOperatorId rejected', async () => {
    await expect(
      broker.call('query.queryMastrInPruefung', { gridOperatorId: 'INVALID' })
    ).rejects.toThrow(ParamError);
  });
});
```

**Test-Laufzeit:** ~30 min

---

### 🟠 BUG-10: PLZ-Ausreißer → VNBDigital Geodaten

**Strategie:** 3-Stufen-Fallback
1. Stufe 1: VNBDigital Polygon (Primary)
2. Stufe 2: PLZ-Präfix (Fallback mit Hinweis)
3. Stufe 3: Manuell (wenn beides nicht verfügbar)

#### Phase 1: Data Layer – VNB-Polygon-Service

**Neue Action: `grid-operations.getVnbPolygon`**
```js
async getVnbPolygon(params) {
  // Parameter: gridOperatorId oder postcode oder coordinates
  const validated = {
    gridOperatorId: this.validateGridOperatorId(params.gridOperatorId),
    includeGeometry: params.includeGeometry !== false,
  };

  // MCP Call: vnbdigital_lookup
  const polygonData = await this.broker.call('mcp.vnbdigital_lookup', {
    gridOperatorId: validated.gridOperatorId,
    format: 'geojson',  // MultiPolygon format
  });

  if (!polygonData.geometry) {
    return {
      available: false,
      method: 'NONE',
      reason: 'NO_GEOJSON_DATA',
      fallbackMethod: 'PLZ_PREFIX',
    };
  }

  return {
    available: true,
    method: 'GEOJSON_POLYGON',
    geometry: polygonData.geometry,
    gridOperatorId: validated.gridOperatorId,
    postalCodeRanges: polygonData.postalCodeRanges,  // optional, als Zusatzinfo
    timestamp: new Date().toISOString(),
  };
}
```

**Implementierungsort:** `services/grid-operations.service.js`

#### Phase 2: Installation Filtering – Point-in-Polygon Test

**Neue Utility-Funktion: `isOutlierInstallation`**
```js
// src/geo-utils.js (neu)

const inside = require('point-in-polygon');  // npm install point-in-polygon

/**
 * Prüft, ob eine Installation außerhalb des VNB-Netzgebiets liegt
 * Fallback-Kaskade:
 * 1. Polygon-Test (wenn VNBDigital verfügbar)
 * 2. PLZ-Präfix-Test (wenn Polygon nicht verfügbar)
 */
async function isOutlierInstallation(installation, vnbData, vnbPolygon = null) {
  // Input-Validierung
  if (!installation.koordinaten || !installation.koordinaten.length === 2) {
    return { isOutlier: null, method: 'UNKNOWN', reason: 'MISSING_COORDINATES' };
  }
  if (!vnbData.gridOperatorId) {
    return { isOutlier: null, method: 'UNKNOWN', reason: 'MISSING_VNBDATA' };
  }

  // Methode 1: Polygon (wenn verfügbar)
  if (vnbPolygon && vnbPolygon.available && vnbPolygon.geometry) {
    const [lon, lat] = [installation.koordinaten[1], installation.koordinaten[0]];
    const polygon = vnbPolygon.geometry.coordinates;  // GeoJSON format

    const isInside = pointInPolygon([lon, lat], polygon[0]);  // polygon[0] = outer ring

    return {
      isOutlier: !isInside,
      method: 'GEOJSON_POLYGON',
      confidence: 0.99,  // Polygon ist autoritative Quelle
      installationCoordinates: installation.koordinaten,
      polygonArea: calculatePolygonArea(polygon),
    };
  }

  // Methode 2: PLZ-Präfix (Fallback)
  if (vnbData.plzPrefix) {
    const installationPlz = installation.postleitzahl.toString().substring(0, 3);
    const isMatch = installationPlz === vnbData.plzPrefix.substring(0, 3);

    return {
      isOutlier: !isMatch,
      method: 'PLZ_PREFIX_APPROXIMATION',
      confidence: 0.60,  // Nur Näherung
      installationPlz,
      expectedPlzPrefix: vnbData.plzPrefix,
      note: '(Methode: PLZ-Näherung bei fehlenden Geodaten)',
    };
  }

  return {
    isOutlier: null,
    method: 'NONE',
    reason: 'NO_METHOD_AVAILABLE',
  };
}

module.exports = { isOutlierInstallation };
```

**Implementierungsort:** `src/geo-utils.js` (neu)

#### Phase 3: Report Integration

**Neuer Report-Builder-Call:**
```js
// utility-report.service.js - generateOutlierAnalysis()

async generateOutlierAnalysis(vnbData) {
  // Schritt 1: VNB-Polygon laden
  const vnbPolygon = await this.broker.call('grid-operations.getVnbPolygon', {
    gridOperatorId: vnbData.gridOperatorId,
  });
  this.logger.info(`Outlier-Methode für VNB: ${vnbPolygon.method}`);

  // Schritt 2: Alle Anlagen der VNB laden
  const installations = await this.broker.call('query.getMastrInstallations', {
    gridOperatorId: vnbData.gridOperatorId,
    limit: 10000,  // alle
  });

  // Schritt 3: Für jede Anlage: Outlier-Status prüfen
  const outliers = [];
  const { isOutlierInstallation } = require('../src/geo-utils');

  for (const inst of installations.installations) {
    const outlierCheck = await isOutlierInstallation(inst, vnbData, vnbPolygon);
    if (outlierCheck.isOutlier) {
      outliers.push({
        mastrNumber: inst.mastrNumber,
        capacity: inst.capacity,
        postleitzahl: inst.postleitzahl,
        coordinates: inst.koordinaten,
        method: outlierCheck.method,
        confidence: outlierCheck.confidence,
      });
    }
  }

  return {
    totalInstallations: installations.installations.length,
    outlierCount: outliers.length,
    method: vnbPolygon.method,
    methodLabel: vnbPolygon.method === 'GEOJSON_POLYGON'
      ? 'außerhalb Netzgebiet (geo-verifiziert)'
      : 'außerhalb PLZ-Bereich (Näherung)',
    outliers: outliers.slice(0, 10),  // top 10 für Report
    note: vnbPolygon.method !== 'GEOJSON_POLYGON'
      ? vnbPolygon.fallbackMethod
      : null,
  };
}
```

#### Phase 4: Tests

**Test-Cases für Geo-Utils:**
```js
// tests/geo-utils.test.js (neu)

describe('isOutlierInstallation', () => {
  test('Polygon-Methode: Punkt im Polygon = kein Outlier', () => {
    const installation = { koordinaten: [8.5, 49.6] };  // Mannheim center
    const vnbData = { gridOperatorId: 'SNB...' };
    const polygon = mockMannheimPolygon();

    const result = isOutlierInstallation(installation, vnbData, polygon);
    expect(result.isOutlier).toBe(false);
    expect(result.method).toBe('GEOJSON_POLYGON');
  });

  test('PLZ-Fallback: Präfix-Match', () => {
    const installation = { postleitzahl: '67201' };
    const vnbData = { plzPrefix: '672' };

    const result = isOutlierInstallation(installation, vnbData, null);
    expect(result.isOutlier).toBe(false);
    expect(result.method).toBe('PLZ_PREFIX_APPROXIMATION');
    expect(result.confidence).toBe(0.60);
  });

  test('Regression: Frankenthal-Report (Polygon + PLZ sollten Match sein)', async () => {
    const vnb = await broker.call('grid-operations.getVnbPolygon', {
      gridOperatorId: 'SNB961745390019',
    });

    // Sollte Polygon zurückgeben
    expect(vnb.method).toBe('GEOJSON_POLYGON');

    // Outlier-Analyse sollte mit Polygon arbeiten
    const analysis = await broker.call('utility-report.generateOutlierAnalysis', {
      gridOperatorId: 'SNB961745390019',
    });
    expect(analysis.method).toBe('GEOJSON_POLYGON');
  });
});
```

**Test-Laufzeit:** ~45 min

---

### 🟠 BUG-11: "Analyse verfügbar" ohne Datenwert

**Strategie:** Template-Binding mit Daten-Null-Checks

#### Phase 1: Report Service – Daten-Mapper

**Neue Action: `utility-report.getMappedAnalysisData`**
```js
async getMappedAnalysisData(vnbData) {
  const results = {};

  // 1. Netzverluste (I²R)
  const gridLossData = await this.broker.call('grid-operations.getGridLosses', {
    gridOperatorId: vnbData.gridOperatorId,
    validate: true,
  }).catch(err => {
    this.logger.warn(`Grid loss analysis failed: ${err.message}`);
    return null;
  });

  results.gridLosses = gridLossData ? {
    available: true,
    lossPercentage: gridLossData.lossPercentage,
    lossValue: gridLossData.estimatedLossEuro,  // €/Jahr
    method: 'I²R_Berechnung',
    confidence: gridLossData.confidence,
  } : null;

  // 2. E-Mobilität
  const emobilityData = await this.broker.call(
    'cernion_emobility_impact_analysis',
    {
      gridOperator: vnbData.name,
      identifyCriticalStreets: true,
      includeHomeCharging: true,
      section14aIntegration: true,
    }
  ).catch(err => {
    this.logger.warn(`E-mobility analysis failed: ${err.message}`);
    return null;
  });

  results.emobility = emobilityData ? {
    available: true,
    criticalStreetsCount: emobilityData.criticalStreets.length,
    section14aRelevance: emobilityData.section14aDevices,
    wallboxesIdentified: emobilityData.homeChargingInstallations,
  } : null;

  return results;
}
```

#### Phase 2: Template-Layer (report-builder.js)

**Handlebars-Helper für bedingte Anzeige:**
```js
// report-builder.js - new helpers

Handlebars.registerHelper('showAnalysisResult', function(analysisData) {
  // Nur anzeigen wenn Daten vorhanden
  if (!analysisData || !analysisData.available) {
    return '';  // Zeile wird gar nicht gerendert
  }

  // Mit Daten: Wert + Quelle
  if (analysisData.lossPercentage !== undefined) {
    return `✓ ${analysisData.lossPercentage.toFixed(1)}% der Energie (≈ ${
      (analysisData.lossValue / 1000000).toFixed(1)
    } Mio. €/Jahr)`;
  }

  if (analysisData.criticalStreetsCount !== undefined) {
    return `✓ ${analysisData.criticalStreetsCount} kritische Straßenzüge · §14a-Relevanz: ${
      analysisData.section14aRelevance
    } Anlagen`;
  }

  return '';
});

Handlebars.registerHelper('shouldRenderAnalysisRow', function(analysisData) {
  return analysisData && analysisData.available;
});
```

**Template-Update (Section 1):**
```handlebars
<!-- report-builder.js -->

{{#if (shouldRenderAnalysisRow analysisData.gridLosses)}}
  <tr>
    <td>Netzverluste (I²R)</td>
    <td>{{{showAnalysisResult analysisData.gridLosses}}}</td>
  </tr>
{{/if}}

{{#if (shouldRenderAnalysisRow analysisData.emobility)}}
  <tr>
    <td>E-Mobilität Netzauswirkung</td>
    <td>{{{showAnalysisResult analysisData.emobility}}}</td>
  </tr>
{{/if}}
```

#### Phase 3: Test-Cases

```js
// tests/utility-report.service.test.js - BUG-11 suite

describe('AC-1/2/3: Analyse-Felder zeigen Wert statt "verfügbar"', () => {

  test('AC-1: Netzverluste zeigt Prozent + Eurobetrag oder kein Feld', async () => {
    const report = await broker.call('utility-report.generate', {
      gridOperatorId: 'SNB961745390019',
    });

    const lossesRow = report.section1.find(r => r.label.includes('Netzverluste'));
    if (lossesRow) {
      // Wenn vorhanden: muss Zahl haben
      expect(lossesRow.value).toMatch(/^\d+\.\d+%/);
      expect(lossesRow.value).toMatch(/Mio\. €/);
    }
    // Wenn nicht vorhanden: OK, ist in AC-1 akzeptiert
  });

  test('AC-2: E-Mobilität zeigt Straßenzahl oder kein Feld', async () => {
    const report = await broker.call('utility-report.generate', {
      gridOperatorId: 'SNB961745390019',
    });

    const emobRow = report.section1.find(r => r.label.includes('E-Mobilität'));
    if (emobRow) {
      expect(emobRow.value).toMatch(/\d+ kritische Straßenzüge/);
      expect(emobRow.value).toMatch(/§14a-Relevanz: \d+/);
    }
  });

  test('AC-3: Keine Zeile mit nur "✓ Analyse verfügbar"', async () => {
    const report = await broker.call('utility-report.generate', {
      gridOperatorId: 'SNB961745390019',
    });

    const section1Lines = report.section1;
    const badLines = section1Lines.filter(line =>
      line.value === '✓ Analyse verfügbar' ||
      line.value === '✓ Daten verfügbar'
    );

    expect(badLines).toHaveLength(0);  // KEINE Bad Lines
  });
});
```

**Test-Laufzeit:** ~20 min

---

### 🟡 BUG-12: Residuallast-Kurve – Titel ≠ Daten

**Strategie:** Daten-validieren BEVOR Template-Titel gesetzt wird

#### Phase 1: Forecast Service – Daten-Validierung

**Neue Action: `forecast.getResidualLoadWithValidation`**
```js
async getResidualLoadWithValidation(params) {
  const validated = {
    gridOperatorId: this.validateGridOperatorId(params.gridOperatorId),
    includeForecasts: params.includeForecasts !== false,
  };

  // Abfrage: Ist-Kurve + Prognose
  const residualData = await this.broker.call('forecast.getResidualLoad', {
    gridOperatorId: validated.gridOperatorId,
  });

  // Validierung: Wieviele Stunden sind es?
  const actualDataPoints = residualData.actual.length;  // Ist
  const forecastDataPoints = residualData.forecast.length;  // Prognose

  let horizon = 'Ist (kein Prognose-Horizont verfügbar)';
  let dataPoints = actualDataPoints;

  if (forecastDataPoints >= 24 * 2) {
    horizon = 'Ist + 48h-Prognose';
    dataPoints = actualDataPoints + forecastDataPoints;
  } else if (forecastDataPoints >= 24) {
    horizon = 'Ist + 24h-Prognose';
    dataPoints = actualDataPoints + forecastDataPoints;
  } else if (forecastDataPoints > 0) {
    // Warnung: Prognose inkomplett
    this.logger.warn(
      `BUG-12: Incomplete forecast: ${forecastDataPoints} points, expected >=24`
    );
    horizon = `Ist + ${forecastDataPoints}h-Prognose (unvollständig)`;
    dataPoints = actualDataPoints + forecastDataPoints;
  }

  return {
    horizon,  // Titel wird basierend auf tatsächlichen Daten gesetzt
    actual: residualData.actual,
    forecast: residualData.forecast.slice(0, dataPoints - actualDataPoints),  // nur bis Horizont
    dataPoints,
    reportTimestamp: new Date().toISOString(),
    validation: {
      actualCount: actualDataPoints,
      forecastCount: forecastDataPoints,
      isComplete: forecastDataPoints >= 24,
    },
  };
}
```

#### Phase 2: Template-Layer

**Handlebars-Helper:**
```js
Handlebars.registerHelper('residualLoadTitle', function(residualData) {
  return `📊 ${residualData.horizon}`;
});
```

**Template:**
```handlebars
<!-- report-builder.js - Abbildung A -->

<figure>
  <h4>{{residualLoadTitle residualLoad}}</h4>
  <div class="chart" data-chart-type="line">
    <!-- Achsenbeschriftung wird basierend auf dataPoints angepasst -->
    {{#if residualLoad.validation.isComplete}}
      <span class="horizont-label">48h Vollständig</span>
    {{else}}
      <span class="horizont-label">{{residualLoad.dataPoints}}h verfügbar</span>
    {{/if}}
  </div>
  <p><small>Quelle: ENTSO-E Residuallast · Stand: {{residualLoad.reportTimestamp}}</small></p>
</figure>
```

#### Phase 3: Tests

```js
// tests/forecast.service.test.js - BUG-12 suite

describe('AC-1/2/3: Residuallast-Titel konsistent mit Daten', () => {

  test('AC-1: Mit 48h-Daten: Titel = "Ist + 48h-Prognose"', async () => {
    const result = await broker.call('forecast.getResidualLoadWithValidation', {
      gridOperatorId: 'DE_AGGREGATED',
    });

    if (result.validation.isComplete) {
      expect(result.horizon).toBe('Ist + 48h-Prognose');
      expect(result.dataPoints).toBe(48);
    }
  });

  test('AC-2: Mit 24h-Daten: Titel = "Ist + 24h-Prognose"', async () => {
    // Mock: nur 24h Prognose verfügbar
    jest.spyOn(broker, 'call').mockImplementation((action) => {
      if (action === 'forecast.getResidualLoad') {
        return Promise.resolve({
          actual: Array(24).fill(1000),
          forecast: Array(24).fill(1000),
        });
      }
    });

    const result = await broker.call('forecast.getResidualLoadWithValidation', {
      gridOperatorId: 'TEST_VNB',
    });

    expect(result.horizon).toBe('Ist + 24h-Prognose');
    expect(result.dataPoints).toBe(48);
  });

  test('AC-3: Keine leere Prognose-Kurve (Nullline)', async () => {
    const result = await broker.call('forecast.getResidualLoadWithValidation', {
      gridOperatorId: 'SNB961745390019',
    });

    // Prognose-Werte sollten nie 0 sein wenn vorhanden
    if (result.forecast.length > 0) {
      const hasZeros = result.forecast.every(val => val === 0);
      expect(hasZeros).toBe(false);
    }
  });
});
```

**Test-Laufzeit:** ~15 min

---

### 🟡 BUG-13: Echtzeit-Daten zeigen Wert statt "verfügbar"

**Strategie:** Alle Real-Time-Quellen zeitgleich abfragen, Werte im Report binden

#### Phase 1: Data Layer – Echtzeit-Quellen

**Neue Action: `energy-market.getRealTimeEnergyData`**
```js
async getRealTimeEnergyData(params) {
  const timestamp = new Date();
  const results = {};

  // Parallel-Abfrage aller Datenquellen
  const [windSolar, energyMix, deGeneration, loadForecast] = await Promise.allSettled([
    // 1. Wind + Solar Einspeisung (regional)
    this.broker.call('entsoe_actual_generation', {
      psrType: ['B16', 'B10'],  // Wind Onshore/Offshore, Solar
      area: params.entsoeArea || 'DE',
      timeRange: { from: timestamp, to: timestamp },
      validate: true,
    }),

    // 2. Regionaler Energiemix
    this.broker.call('energy-market.getRegionalMix', {
      region: params.region,
      timestamp,
      validate: true,
    }),

    // 3. Tatsächliche Erzeugung Deutschland (Aggregat ENTSO-E)
    this.broker.call('entsoe_actual_generation', {
      psrType: 'ALL',
      area: 'DE',
      timeRange: { from: timestamp, to: timestamp },
      validate: true,
    }),

    // 4. Lastprognose nächste 24h
    this.broker.call('entsoe_load_forecast', {
      area: params.entsoeArea || 'DE',
      periodStart: timestamp,
      periodEnd: new Date(timestamp.getTime() + 24 * 3600000),
      validate: true,
    }),
  ]);

  // Ergebnisse extrahieren mit Error-Handling
  if (windSolar.status === 'fulfilled') {
    const data = windSolar.value;
    results.windSolar = {
      wind: data.find(d => d.psrType === 'B16')?.generationValue || 0,
      solar: data.find(d => d.psrType === 'B10')?.generationValue || 0,
      unit: 'MW',
      timestamp,
    };
  }

  if (energyMix.status === 'fulfilled') {
    results.energyMix = {
      dominant: energyMix.value.dominantSource,
      percentage: energyMix.value.dominantPercentage,
      mix: energyMix.value.fullMix,  // { solar: X%, wind: Y%, ... }
      timestamp,
    };
  }

  if (deGeneration.status === 'fulfilled') {
    const totalGW = deGeneration.value.reduce((sum, d) => sum + d.value, 0) / 1000;
    results.deGeneration = {
      totalGW,
      source: 'ENTSO-E',
      timestamp,
    };
  }

  if (loadForecast.status === 'fulfilled') {
    const peak = Math.max(...loadForecast.value.map(d => d.forecastValue));
    results.loadForecast = {
      peakGW: peak / 1000,
      timeOfPeak: loadForecast.value.find(d => d.forecastValue === peak)?.timestamp,
      horizon: '24h',
      source: 'ENTSO-E',
      timestamp,
    };
  }

  return {
    timestamp: timestamp.toISOString(),
    data: results,
    dataQuality: {
      windSolarAvailable: !!results.windSolar,
      mixAvailable: !!results.energyMix,
      deAvailable: !!results.deGeneration,
      forecastAvailable: !!results.loadForecast,
    },
  };
}
```

**Implementierungsort:** `services/energy-market.service.js`

#### Phase 2: Template-Layer – Daten Binding

**Report-Daten-Strukturierung:**
```js
// utility-report.service.js

async generateSection1(vnbData) {
  const realtimeData = await this.broker.call(
    'energy-market.getRealTimeEnergyData',
    { region: vnbData.region }
  );

  return {
    // ... andere Felder ...
    realtimeInsights: [
      // AC-1
      {
        label: 'Einspeisung Wind/Solar (Ist)',
        available: realtimeData.dataQuality.windSolarAvailable,
        value: realtimeData.dataQuality.windSolarAvailable
          ? `Solar: ${realtimeData.data.windSolar.solar} MW · Wind: ${realtimeData.data.windSolar.wind} MW`
          : null,
        source: 'ENTSO-E',
        timestamp: realtimeData.data.windSolar?.timestamp,
      },
      // AC-2
      {
        label: 'Regionaler Energiemix',
        available: realtimeData.dataQuality.mixAvailable,
        value: realtimeData.dataQuality.mixAvailable
          ? `${realtimeData.data.energyMix.dominant}: ${realtimeData.data.energyMix.percentage}%`
          : null,
        source: 'Regional Grid Operator',
        timestamp: realtimeData.data.energyMix?.timestamp,
      },
      // AC-3
      {
        label: 'Tatsächliche Erzeugung (DE)',
        available: realtimeData.dataQuality.deAvailable,
        value: realtimeData.dataQuality.deAvailable
          ? `${realtimeData.data.deGeneration.totalGW.toFixed(1)} GW`
          : null,
        source: 'ENTSO-E',
        timestamp: realtimeData.data.deGeneration?.timestamp,
      },
      // AC-4
      {
        label: 'Lastprognose (nächste 24h)',
        available: realtimeData.dataQuality.forecastAvailable,
        value: realtimeData.dataQuality.forecastAvailable
          ? `Peak: ${realtimeData.data.loadForecast.peakGW.toFixed(1)} GW um ${
              new Date(realtimeData.data.loadForecast.timeOfPeak).getHours()
            }:00 Uhr`
          : null,
        source: 'ENTSO-E',
        timestamp: realtimeData.data.loadForecast?.timestamp,
      },
    ],
  };
}
```

**Handlebars-Helper:**
```js
Handlebars.registerHelper('renderRealtimeField', function(field) {
  if (!field.available || !field.value) {
    return '';  // Zeile nicht rendern
  }

  const timeStr = field.timestamp
    ? new Date(field.timestamp).toLocaleString('de-DE')
    : 'N/A';

  return `${field.value} | ${field.source} · Stand: ${timeStr}`;
});
```

**Template:**
```handlebars
<!-- report-builder.js - Section 1 -->
{{#each realtimeInsights}}
  {{#if this.available}}
    <tr>
      <td>{{this.label}}</td>
      <td>{{{renderRealtimeField this}}}</td>
    </tr>
  {{/if}}
{{/each}}
```

#### Phase 3: Tests

```js
// tests/energy-market.service.test.js - BUG-13 suite

describe('AC-1/2/3/4/5: Echtzeit-Felder zeigen Wert + Kontext', () => {

  test('AC-1: Wind/Solar zeigt numerische Werte + Zeitstempel', async () => {
    const data = await broker.call('energy-market.getRealTimeEnergyData', {
      region: 'DE',
    });

    const field = data.data.realtimeInsights.find(f => f.label.includes('Wind/Solar'));
    if (field.available) {
      expect(field.value).toMatch(/Solar: \d+ MW · Wind: \d+ MW/);
      expect(field.timestamp).toBeDefined();
    }
  });

  test('AC-2: Mix zeigt Prozentanteil + dominante Technologie', async () => {
    const data = await broker.call('energy-market.getRealTimeEnergyData', {
      region: 'Baden-Württemberg',
    });

    const field = data.data.realtimeInsights.find(f => f.label.includes('Energiemix'));
    if (field.available) {
      expect(field.value).toMatch(/\w+: \d+%/);  // "Solar: 45%"
    }
  });

  test('AC-3: DE-Erzeugung zeigt ENTSO-E GW-Wert', async () => {
    const data = await broker.call('energy-market.getRealTimeEnergyData', {
      region: 'DE',
    });

    if (data.data.realtimeInsights[2].available) {
      expect(data.data.realtimeInsights[2].value).toMatch(/\d+\.\d+ GW/);
    }
  });

  test('AC-4: Lastprognose zeigt Peak GW + Tageszeit', async () => {
    const data = await broker.call('energy-market.getRealTimeEnergyData', {
      region: 'DE',
    });

    const field = data.data.realtimeInsights[3];
    if (field.available) {
      expect(field.value).toMatch(/Peak: \d+\.\d+ GW um \d+:\d+ Uhr/);
    }
  });

  test('AC-5: Alle Werte haben Quelle + Zeitstempel', async () => {
    const data = await broker.call('energy-market.getRealTimeEnergyData', {
      region: 'DE',
    });

    data.data.realtimeInsights.forEach(field => {
      if (field.available && field.value) {
        expect(field.source).toBeDefined();
        expect(field.timestamp).toBeDefined();
      }
    });
  });

  test('Keine Zeile mit nur "✓ Daten verfügbar"', async () => {
    const report = await broker.call('utility-report.generate', {
      gridOperatorId: 'SNB961745390019',
    });

    const badLines = report.section1.filter(line =>
      line.value === '✓ Daten verfügbar'
    );
    expect(badLines).toHaveLength(0);
  });
});
```

**Test-Laufzeit:** ~30 min

---

## 📊 Implementierungs-Timeline

### Sprint 1: P0 Bug-Fixes (Freitag 9. März, Demo-Prep)

| Task | Komponente | Aufwand | Status |
|---|---|---|---|
| BUG-4/8: COUNT + Beispiel | query.service.js | 2 h | 🔴 OFFEN |
| BUG-4/8: Report-Binding | utility-report.service.js | 1 h | 🔴 OFFEN |
| BUG-4/8: Tests | tests/query.service.test.js | 0,5 h | 🔴 OFFEN |
| **Sprint 1 Total** | | **3,5 h** | |

**Demo-ready:** Freitag 10:00 Uhr

---

### Sprint 2: P1 Bug-Fixes (Mo-Di, 10.-11. März)

| Task | Komponente | Aufwand | Status |
|---|---|---|---|
| BUG-10: VNBPolygon-Action | grid-operations.service.js | 1 h | 🟠 OFFEN |
| BUG-10: Geo-Utils | src/geo-utils.js | 2 h | 🟠 OFFEN |
| BUG-10: Report-Integration | utility-report.service.js | 1 h | 🟠 OFFEN |
| BUG-10: Tests | tests/geo-utils.test.js | 1 h | 🟠 OFFEN |
| BUG-11: Daten-Mapper | utility-report.service.js | 1,5 h | 🟠 OFFEN |
| BUG-11: Template-Helper | report-builder.js | 1 h | 🟠 OFFEN |
| BUG-11: Tests | tests/utility-report.service.test.js | 0,5 h | 🟠 OFFEN |
| **Sprint 2 Total** | | **8 h** | |

---

### Sprint 3: P2 Bug-Fixes (Mi, 12. März)

| Task | Komponente | Aufwand | Status |
|---|---|---|---|
| BUG-12: Prognose-Validierung | forecast.service.js | 1 h | 🟡 OFFEN |
| BUG-12: Template-Helper | report-builder.js | 0,5 h | 🟡 OFFEN |
| BUG-12: Tests | tests/forecast.service.test.js | 0,5 h | 🟡 OFFEN |
| BUG-13: Echtzeit-Daten-Action | energy-market.service.js | 2 h | 🟡 OFFEN |
| BUG-13: Report-Integration | utility-report.service.js | 1 h | 🟡 OFFEN |
| BUG-13: Template-Binding | report-builder.js | 1 h | 🟡 OFFEN |
| BUG-13: Tests | tests/energy-market.service.test.js | 1 h | 🟡 OFFEN |
| **Sprint 3 Total** | | **7 h** | |

---

## 🔍 Validierungsstrategie

### Pre-Commit Validation
```bash
# 1. Alle Tests müssen grün sein
npm test -- --testPathPattern="BUG-(4|8|10|11|12|13)" --runInBand

# 2. Parameter-Validierung überprüfen
npm run lint -- --rule="validate-params"

# 3. Keine "verfügbar"-Strings in Templates
grep -r "verfügbar\|available" src/templates/*.html || echo "✅ OK"

# 4. Alle Datenquellen logged
grep -r "logger\." services/*.service.js
```

### Post-Release Validation (Deployment)
```bash
# 1. Reports für alle Test-VNBs generieren
npm run demo:reports -- --vnbs=SNB961745390019,SNB966216072913

# 2. Datenqualität überprüfen
npm run report-audit

# 3. Monitoring: Fehlerrate
curl https://api.cernion.de/health/reports
```

---

## 📝 Zusammenfassung Implementierungs-Prinzipien

| Prinzip | Umsetzung | Benefit |
|---|---|---|
| **Data Validation** | Alle Service-Actions mit `validate: true` | Keine Bad Data in Reports |
| **Single Source of Truth** | Pro Kennzahl max. 1 Abfrage pro Report | Konsistente Zahlen |
| **Fallback-Kaskaden** | Primary → Fallback → Null (nie Error werfen) | Robuster als Fehler-Report |
| **Timestamp Binding** | Jede Realtime-Zahl hat Abfragezeit | Vertrauensbeweis |
| **Template Null-Checks** | Handlebars Helper für bedingte Anzeige | Keine leeren Zeilen |
| **MCP-Integration** | Direkt über `broker.call('mcp.*')` | Verifizierte Live-Daten |

---

**Nächster Schritt:** Sprint 1 (BUG-4/8) starten
**Demo-Deadline:** Sonntag 9. März 23:59 Uhr

*CR-CERNION-044-Plan · v1.0 · 8. März 2026*
