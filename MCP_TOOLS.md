# Cernion MCP Tools - Developer Documentation

**Version**: 1.0
**Last Updated**: February 2026

This documentation provides comprehensive information about all available tools in the Cernion Model Context Protocol (MCP) server. It is designed to help developers and LLMs select the appropriate tool for specific energy data tasks.

## Table of Contents

- [Overview](#overview)
- [Tool Categories](#tool-categories)
- [Authentication](#authentication)
- [Tool Reference](#tool-reference)
  - [Query Tools](#query-tools)
  - [Energy Market Data](#energy-market-data)
  - [Grid Operations](#grid-operations)
  - [Business Intelligence](#business-intelligence)
  - [Customer Service](#customer-service)
  - [European Energy Data (ENTSO-E)](#european-energy-data-entso-e)
  - [Gas Storage (AGSI)](#gas-storage-agsi)
  - [EIC Code Management](#eic-code-management)
  - [German Grid Data (Netztransparenz.de)](#german-grid-data-netztransparenzde)
  - [System Tools](#system-tools)

---

## Overview

The Cernion MCP server provides access to comprehensive energy data across Europe, with special focus on the German energy market. It integrates multiple data sources including:

- **MaStR** (Marktstammdatenregister) - German registry of energy installations
- **ENTSO-E** - European electricity grid transparency data
- **SMARD** - German electricity market data
- **AGSI** - European gas storage data
- **Netztransparenz.de** - German grid operator data
- **GrünstromIndex** - Regional CO₂ intensity forecasts

### Key Features

- **Direct API Access**: Many tools bypass LLM reasoning for faster, more reliable results
- **Intelligent EIC Code Resolution**: Automatic area code selection based on query type
- **Async Job Processing**: Heavy computations return job IDs for polling
- **Comprehensive Statistics**: Most tools include statistical summaries
- **Multi-Format Support**: ISO 8601, YYYYMMDD, and German date formats (DD.MM.YYYY)

---

## Tool Categories

| Category | Purpose | Tool Count |
|----------|---------|------------|
| **Query Tools** | Natural language queries and template-based searches | 3 |
| **Energy Market Data** | Prices, production, forecasts | 5 |
| **Grid Operations** | Network data, redispatch, capacity analysis | 5 |
| **Business Intelligence** | Market analysis, lead generation, tariff design | 4 |
| **Customer Service** | Self-service widgets, health checks, wizards | 3 |
| **European Energy Data (ENTSO-E)** | Cross-border flows, unavailability, generation, PSR types | 9 |
| **Gas Storage (AGSI)** | European gas storage monitoring | 7 |
| **EIC Codes** | Energy Identification Code management | 5 |
| **German Grid (Netztransparenz)** | Spotprices, redispatch, forecasts | 4 |
| **System Tools** | Status, discovery, job management | 4 |

---

## Authentication

### Token-Based Authentication

All API calls require a valid authentication token:

```typescript
headers: {
  'Authorization': 'Bearer YOUR_TOKEN_HERE'
}
```

### Token Management Tools

- `cernion_token_info`: Check remaining quota and token validity
- `cernion_switch_token`: Switch to a different token during session

---

## Tool Reference

### Query Tools

#### cernion_ask

**Purpose**: Natural language queries to energy data (MaStR, ENTSO-E, SMARD)

**Parameters**:
```typescript
{
  query: string;  // Natural language question (e.g., "How much PV capacity in Bavaria?")
}
```

**Use Cases**:
- Ad-hoc data exploration
- Quick questions without SQL knowledge
- Multi-source data aggregation

**Example Request**:
```json
{
  "query": "Wieviel PV-Leistung in Bayern?"
}
```

**Example Response**:
```json
{
  "answer": "Total PV capacity in Bavaria: 31,604,839.789 kW",
  "sources": ["mastr_db"],
  "reasoning": [...]
}
```

---

#### cernion_ask_learned

**Purpose**: Template-based queries using self-learning system (20x faster than `cernion_ask`)

**Parameters**:
```typescript
{
  query: string;                // Natural language query
  confidence?: number;          // Minimum confidence threshold (0.0-1.0, default: 0.6)
  forceGenerate?: boolean;      // Force LLM generation even if template matches
  verbose?: boolean;            // Show detailed reasoning
}
```

**Use Cases**:
- Recurring queries (regional capacity, installation counts)
- Performance-critical applications
- Batch processing

**Example Request**:
```json
{
  "query": "PV-Leistung in Hessen"
}
```

**Example Response**:
```json
{
  "result": {
    "totalCapacityKW": 5234567.89,
    "installationCount": 234567,
    "region": "Hessen"
  },
  "templateUsed": true,
  "executionTimeMs": 45
}
```

---

#### cernion_discover

**Purpose**: Schema discovery for databases, tables, columns, and available tools

**Parameters**:
```typescript
{
  scope: 'tools' | 'databases' | 'tables' | 'columns' | 'operators' | 'locations';
  database?: string;   // Required for 'tables' and 'columns'
  table?: string;      // Required for 'columns'
  region?: string;     // Optional filter for 'locations'
}
```

**Use Cases**:
- Explore available data sources
- Prevent query errors (validate parameters before execution)
- Build dynamic UIs with available options

**Example Request**:
```json
{
  "scope": "databases"
}
```

**Example Response**:
```json
{
  "databases": [
    "mastr_db",
    "energy_charts_api",
    "deutschlandatlas",
    "ntp_api",
    "corrently_gsi_api"
  ]
}
```

---

### Energy Market Data

#### cernion_energy_prices

**Purpose**: Day-ahead electricity prices (EPEX Spot) + intraday + futures

**Data Sources**:
- ENTSO-E Transparency Platform (primary for EU markets)
- SMARD.de (German EPEX Spot prices)
- Netztransparenz.de (official German spotprices)

**Parameters**:
```typescript
{
  market: 'day-ahead' | 'intraday' | 'futures';
  region: string;        // e.g., "Deutschland", "France", "Spain"
  date?: string;         // ISO 8601 or YYYYMMDD (default: today)
  startDate?: string;    // For date ranges
  endDate?: string;
}
```

**Use Cases**:
- Dynamic tariff calculation
- Price forecasting and analysis
- Merit-order studies
- Direct marketing optimization

**Example Request**:
```json
{
  "market": "day-ahead",
  "region": "Deutschland",
  "date": "2026-02-04"
}
```

**Example Response**:
```json
{
  "prices": [
    { "timestamp": "2026-02-04T00:00:00Z", "priceEURperMWh": 132.4 },
    { "timestamp": "2026-02-04T01:00:00Z", "priceEURperMWh": 125.8 },
    ...
  ],
  "statistics": {
    "min": 87.45,
    "max": 211.99,
    "avg": 156.32,
    "median": 148.50
  }
}
```

---

#### entsoe_day_ahead_prices

**Purpose**: Direct ENTSO-E day-ahead price queries (bypasses LLM for faster, more reliable results)

**Parameters**:
```typescript
{
  region: string;                // Country/region (e.g., "Deutschland", "France")
  dateFrom: string;              // Start date (ISO 8601, YYYYMMDD, DD.MM.YYYY)
  dateTo: string;                // End date
  includeStatistics?: boolean;   // Include price statistics (default: true)
}
```

**Technical Details**:
- **Automatic EIC Code Selection**: Resolves correct bidding zone code (BZN) automatically
- **Multi-Format Dates**: Supports ISO 8601, YYYYMMDD, German format (DD.MM.YYYY)
- **15-Minute Resolution**: 96 data points per day (quarterhourly)
- **No LLM Overhead**: Direct API access for faster response

**Germany EIC Codes**:
- `10Y1001A1001A82H` (BZN - Bidding Zone) → Day-ahead/intraday prices
- `10Y1001A1001A83F` (IPA - Imbalance Price Area) → Generation/load data

**Use Cases**:
- Fast day-ahead price retrieval
- Automated workflows (API integration)
- Historical price analysis
- Time-critical queries

**Example Request**:
```json
{
  "region": "Deutschland",
  "dateFrom": "2026-02-01",
  "dateTo": "2026-02-03",
  "includeStatistics": true
}
```

**Example Response**:
```json
{
  "success": true,
  "region": "Deutschland",
  "eicCode": "10Y1001A1001A82H",
  "periodStart": "2026-02-01T00:00:00Z",
  "periodEnd": "2026-02-03T23:00:00Z",
  "currency": "EUR",
  "resolution": "PT60M",
  "dataPoints": [
    { "timestamp": "2026-02-01T00:00:00Z", "hour": 0, "priceEURperMWh": 91.22 },
    { "timestamp": "2026-02-01T01:00:00Z", "hour": 1, "priceEURperMWh": 87.45 }
  ],
  "statistics": {
    "minPrice": 87.45,
    "maxPrice": 110.19,
    "avgPrice": 97.83,
    "medianPrice": 96.50,
    "totalDataPoints": 72
  },
  "metadata": {
    "queryType": "day-ahead",
    "areaType": "BZN",
    "officialName": "DE-LU BZN"
  }
}
```

**When to Use**:
- ✅ Fast day-ahead price queries for known regions
- ✅ Historical price data (past dates)
- ✅ Time-critical queries (no LLM overhead)
- ✅ Automated workflows
- ❌ Complex multi-source queries → use `cernion_energy_prices`
- ❌ Unstructured natural language queries → use `cernion_energy_prices`

---

#### cernion_energy_production

**Purpose**: Electricity generation data by source and region

**Data Sources**:
- SMARD.de (German generation data by source)
- ENTSO-E Transparency Platform (European data)

**Parameters**:
```typescript
{
  energySource: 'Solar' | 'Wind' | 'Biomass' | 'Nuclear' | 'Gas' | 'Coal' | 'Hydro' | 'all';
  region: string;           // e.g., "Deutschland", "Bayern", "50Hertz" (TSO zone)
  startDate: string;        // ISO 8601
  endDate: string;
  resolution?: 'quarterhour' | 'hour' | 'day' | 'week' | 'month' | 'year';
}
```

**SMARD Generation Filters**:
- Filter 11: Solar
- Filter 12: Wind Onshore
- Filter 13: Wind Offshore
- Filter 14: Hydro
- Filter 15: Biomass
- Filter 16: Conventional/Fossil
- Filter 17: Nuclear
- Filter 18: Pumped Storage

**Use Cases**:
- Energy balance analysis
- Merit-order studies
- Renewable integration monitoring
- Capacity utilization tracking

**Example Request**:
```json
{
  "energySource": "Solar",
  "region": "Deutschland",
  "startDate": "2026-02-01",
  "endDate": "2026-02-03",
  "resolution": "hour"
}
```

**Example Response**:
```json
{
  "generation": [
    { "timestamp": "2026-02-01T12:00:00Z", "generationMW": 28500 },
    { "timestamp": "2026-02-01T13:00:00Z", "generationMW": 31200 }
  ],
  "statistics": {
    "totalMWh": 245680,
    "avgMW": 10236,
    "peakMW": 31200,
    "minMW": 0
  }
}
```

---

#### cernion_co2_intensity

**Purpose**: Regional CO₂ intensity forecasts (GrünstromIndex)

**Parameters**:
```typescript
{
  location: string;        // City name or ZIP code (e.g., "Heidelberg", "69115")
  timestamp?: string;      // ISO 8601 or natural language (default: current time)
  forecast?: boolean;      // Get forecast instead of current value (default: false)
}
```

**Use Cases**:
- CO₂-optimized tariffs
- EV charging time optimization
- Heat pump scheduling
- Green energy certifications

**Example Request**:
```json
{
  "location": "Heidelberg",
  "forecast": true
}
```

**Example Response**:
```json
{
  "location": "Heidelberg",
  "postalCode": "69115",
  "currentCO2Intensity": 318,
  "unit": "gCO2eq/kWh",
  "forecast24h": [
    { "timestamp": "2026-02-06T00:00:00Z", "co2Intensity": 325 },
    { "timestamp": "2026-02-06T01:00:00Z", "co2Intensity": 310 }
  ],
  "optimalHours": ["22:00-06:00"],
  "source": "GrünstromIndex"
}
```

---

#### cernion_installations

**Purpose**: Search for energy installations in German registry (MaStR)

**Parameters**:
```typescript
{
  installationType: 'solar' | 'wind' | 'storage' | 'biomass' | 'hydro' | 'combustion';
  location: string;               // City, region, or state
  limit?: number;                 // Max results (default: 10)
  minCapacityKW?: number;         // Minimum capacity filter
  maxCapacityKW?: number;         // Maximum capacity filter
  commissioningYear?: number;     // Filter by commissioning year
}
```

**Use Cases**:
- Portfolio analysis
- Site selection studies
- Competitor analysis
- Market penetration research

**Example Request**:
```json
{
  "installationType": "solar",
  "location": "Heidelberg",
  "minCapacityKW": 5,
  "maxCapacityKW": 15,
  "limit": 5
}
```

**Example Response**:
```json
{
  "installations": [
    {
      "mastrNumber": "SEE951127117129",
      "capacityKW": 11.75,
      "location": "Heidelberg",
      "commissioningDate": "2013-06-28",
      "operator": "John Doe"
    }
  ],
  "totalFound": 1250,
  "returned": 5
}
```

---

### Grid Operations

#### cernion_grid_data

**Purpose**: Grid operation data (load, frequency, flows, redispatch)

**Parameters**:
```typescript
{
  dataType: 'load' | 'frequency' | 'flows' | 'redispatch';
  region: string;
  date: string;           // ISO 8601
  gridOperator?: string;  // Optional filter
}
```

**Use Cases**:
- Grid congestion analysis
- Redispatch cost monitoring
- Frequency stability studies
- Cross-border flow analysis

---

#### cernion_grid_operator_analysis

**Purpose**: Comprehensive grid operator analysis (installations, feed-in, redispatch potential)

**Parameters**:
```typescript
{
  gridOperator: string;        // Operator name (fuzzy matching supported)
  includeRedispatch?: boolean; // Include redispatch analysis (default: false)
  includeCapacity?: boolean;   // Include capacity analysis (default: true)
}
```

**Use Cases**:
- Network planning
- Risk assessment
- Investment prioritization
- Redispatch cost forecasting

**Example Request**:
```json
{
  "gridOperator": "Netze BW",
  "includeRedispatch": true
}
```

**Example Response**:
```json
{
  "operator": "Netze BW GmbH",
  "serviceArea": "Baden-Württemberg",
  "totalInstallations": 52341,
  "capacityByType": {
    "solar": { "count": 48230, "capacityMW": 5234.5 },
    "wind": { "count": 1250, "capacityMW": 2145.8 }
  },
  "redispatchPotential": {
    "eligibleInstallations": 1250,
    "totalCapacityMW": 1245.7
  }
}
```

---

#### cernion_capacity_utilization

**Purpose**: Network capacity utilization analysis (transformers, lines, heatmaps)

**Parameters**:
```typescript
{
  gridOperator: string;
  date: string;                    // ISO 8601
  includeHeatmap?: boolean;        // Generate hotspot heatmap (default: false)
  utilizationThreshold?: number;   // Highlight assets above threshold % (default: 85)
}
```

**Use Cases**:
- Investment prioritization
- NEST (Network Expansion Testing) justification
- Transformer upgrade planning
- Grid bottleneck identification

**Example Request**:
```json
{
  "gridOperator": "Netze BW",
  "date": "2026-02-06",
  "includeHeatmap": true,
  "utilizationThreshold": 90
}
```

**Example Response**:
```json
{
  "operator": "Netze BW",
  "analysisDate": "2026-02-06",
  "criticalAssets": [
    {
      "assetId": "T-123456",
      "type": "transformer",
      "location": "Stuttgart-Mitte",
      "utilization": 94.5,
      "ratedCapacity": "630 kVA",
      "recommendation": "Upgrade to 1000 kVA (Priority: HIGH)"
    }
  ],
  "heatmap": {
    "hotspots": ["Stuttgart-Mitte", "Heidelberg-Pfaffengrund"],
    "avgUtilization": 67.3
  }
}
```

---

#### cernion_redispatch_export

**Purpose**: Export redispatch 2.0 installations (≥100 kW) per grid operator

**Parameters**:
```typescript
{
  gridOperator: string;                      // Grid operator name (fuzzy matching)
  minCapacity?: number;                      // Minimum capacity in kW (default: 100)
  types?: ('solar'|'wind'|'storage'|'biomass'|'combustion')[];
  autoConfirm?: boolean;                     // Skip confirmation (default: true for MCP)
}
```

**Output**: Returns CSV export or job ID for async processing

**Use Cases**:
- Regulatory reporting
- Redispatch compliance
- Portfolio analysis
- Capacity tracking

**Example Request**:
```json
{
  "gridOperator": "Stadtwerke Heidelberg",
  "minCapacity": 100,
  "types": ["solar", "wind"]
}
```

**Example Response**:
```json
{
  "jobId": "abc123...",
  "status": "processing",
  "estimatedTimeSeconds": 30,
  "message": "Use cernion_job_result to retrieve CSV export"
}
```

---

#### cernion_connection_capacity_check

**Purpose**: Automated grid connection feasibility check (customer self-service)

**Parameters**:
```typescript
{
  gridOperator: string;                 // Grid operator name
  location: string;                     // Address or postal code
  installationType: 'solar' | 'wind' | 'storage' | 'wallbox' | 'heat-pump' | 'other';
  capacityKW: number;                   // Installation capacity in kW
  voltageLevel?: 'NS' | 'MS' | 'HS';    // Optional preferred voltage level
  simultaneityFactor?: number;          // Optional (0-1)
}
```

**Use Cases**:
- Customer self-service connection checks
- Pre-feasibility screening
- Grid capacity planning

---

### Business Intelligence

#### cernion_sales_lead_identification

**Purpose**: Identify sales leads from MaStR (new PV/wallbox/heatpump/storage installations)

**Parameters**:
```typescript
{
  region: string;                         // City, region, or state
  installationType: 'solar' | 'storage' | 'wallbox' | 'heatpump';
  daysBack?: number;                      // Look back period (default: 30)
  limit?: number;                         // Max leads (default: 10)
  minScore?: number;                      // Minimum lead score 0-100 (default: 60)
}
```

**Lead Scoring** (0-100):
- Commissioning date (40 points): Newer = higher score
- Installation size (30 points): Prosumer sweet spot (5-15 kWp)
- Location (20 points): High-income areas
- Type (10 points): Solar + storage = premium

**Use Cases**:
- B2C customer acquisition
- Prosumer tariff marketing
- Storage retrofit campaigns
- Cross-sell opportunities

**Example Request**:
```json
{
  "region": "Heidelberg",
  "installationType": "solar",
  "daysBack": 30,
  "limit": 5,
  "minScore": 80
}
```

**Example Response**:
```json
{
  "leads": [
    {
      "score": 95,
      "installation": {
        "mastrNumber": "SEE...",
        "capacityKW": 9.9,
        "location": "Heidelberg-Neuenheim",
        "commissioningDate": "2026-01-22",
        "daysAgo": 15
      },
      "recommendation": "Prosumer tariff + storage offer",
      "estimatedARPU": 1450
    }
  ]
}
```

---

#### cernion_dynamic_tariff_calculator

**Purpose**: Calculate dynamic electricity tariffs based on market prices or CO₂ intensity

**Parameters**:
```typescript
{
  region: string;
  tariffType: 'dynamic-spot' | 'co2-optimized' | 'time-of-use';
  calculationPeriod: string;              // Year (YYYY) or date range
  customerProfile?: {                     // Optional customer details
    annualConsumption?: number;           // kWh/year
    flexibleLoad?: boolean;               // Has flexible loads (EV, heat pump)
  };
}
```

**Use Cases**:
- Dynamic tariff product design
- Customer savings calculation
- Marketing material generation
- Tariff innovation

**Example Request**:
```json
{
  "region": "Heidelberg",
  "tariffType": "dynamic-spot",
  "calculationPeriod": "2024",
  "customerProfile": {
    "annualConsumption": 4500,
    "flexibleLoad": true
  }
}
```

**Example Response**:
```json
{
  "tariffAnalysis": {
    "dynamicTariff": {
      "avgPricePerKWh": 0.28,
      "annualCost": 1260,
      "savingsVsFlat": 285,
      "savingsPercent": 18.4
    },
    "flatTariff": {
      "pricePerKWh": 0.35,
      "annualCost": 1575
    },
    "optimalLoadingWindows": [
      "22:00-06:00 (5-8 Cent/kWh)",
      "12:00-14:00 (15-20 Cent/kWh) solar surplus"
    ],
    "peakAvoidance": "17:00-20:00 (35-45 Cent/kWh)"
  }
}
```

---

#### cernion_customer_churn_prediction

**Purpose**: Predict customer churn risk for energy suppliers (residential, prosumer, commercial)

**Parameters**:
```typescript
{
  customerSegment: 'residential' | 'prosumer' | 'commercial' | 'premium' | 'all';
  region: string;
  riskThreshold?: 'high' | 'medium' | 'low';           // Risk level filter (default: 'medium')
  limit?: number;                                       // Max at-risk customers (default: 100)
  predictionWindowMonths?: number;                      // Forecast horizon (default: 3)
  includeRetentionStrategy?: boolean;                   // Include recommendations (default: true)
}
```

**Churn Scoring** (0-100):
- Contract status (30p): <3 months to end = 30p CRITICAL
- Price sensitivity (25p): Complaints, >10% above market, recent increase
- Service quality (20p): >5 support contacts, unresolved tickets, NPS Detractor
- Payment behavior (15p): >2 late payments, manual vs. automatic
- Usage pattern (10p): Consumption declining >20%, no app usage

**Customer Segments**:
- **Residential**: ARPU 600€, LTV 3k€, churn 10-12%, retention budget max 600€
- **Prosumer**: ARPU 1,450€, LTV 10k€, churn 5-8%, budget 2,000€ (HIGH PRIORITY!)
- **Commercial**: ARPU 10k€, LTV 50k€, churn 3-5%, budget unlimited (MUST WIN!)
- **Premium**: ARPU >5k€, LTV >25k€, churn <3%, no budget limit

**Use Cases**:
- Retention campaign targeting
- Customer lifetime value protection
- Segmented marketing strategies
- Service quality improvement

**Example Request**:
```json
{
  "customerSegment": "prosumer",
  "region": "Heidelberg",
  "riskThreshold": "high",
  "limit": 10
}
```

**Example Response**:
```json
{
  "atRiskCustomers": [
    {
      "customerId": "C-12345",
      "churnScore": 87,
      "riskLevel": "HIGH",
      "segment": "prosumer",
      "ARPU": 1450,
      "LTV": 10000,
      "primaryReason": "Price sensitivity (competitor 15% cheaper)",
      "retentionStrategy": {
        "approach": "Early intervention",
        "recommendedAction": "Personal call + retention offer (max 200€)",
        "successProbability": 0.45,
        "estimatedCost": 150,
        "potentialRevenueSaved": 7250
      }
    }
  ],
  "summary": {
    "totalAtRisk": 10,
    "potentialRevenueLoss": 72500,
    "estimatedRetentionCost": 1500,
    "expectedSaveRate": 0.40,
    "ROI": 19.3
  }
}
```

---

#### cernion_market_penetration_analysis

**Purpose**: Analyze market penetration rates for energy suppliers in specific regions

**Parameters**:
```typescript
{
  region: string;
  currentCustomers?: number;          // Optional: current customer count
  installationType?: 'solar' | 'wind' | 'storage' | 'wallbox' | 'heat-pump' | 'all';
  postalCodes?: string[];             // Optional filter
  includeSegmentation?: boolean;      // Default: true
  includeWhiteSpots?: boolean;        // Default: true
  includeTrendAnalysis?: boolean;     // Default: true
  includeCompetitorAnalysis?: boolean;// Default: true
  includeRecommendations?: boolean;   // Default: true
}
```

**Use Cases**:
- Market expansion planning
- White-spot identification
- Competitive positioning
- Sales strategy prioritization

---

### Customer Service

#### cernion_customer_portal_widget

**Purpose**: Generate embeddable self-service widgets for customer portals (reduces call center load by 30-40%)

**Parameters**:
```typescript
{
  widgetType: 'installation_lookup' | 'installation_overview' | 'operator_change_wizard' |
              'storage_calculator' | 'eeg_end_helper' | 'faq_embedded' |
              'contact_finder' | 'document_templates';
  mode?: 'compact' | 'full' | 'modal' | 'embedded';    // Display mode (default: 'embedded')
  theme?: 'light' | 'dark' | 'auto';                    // Visual theme (default: 'light')
  language?: 'de' | 'en';                               // Widget language (default: 'de')
  outputFormat?: 'html' | 'json' | 'markdown';         // Output format (default: 'html')
  mastrNummer?: string;                                 // Optional: Customer installation ID
  postalCode?: string;                                  // Optional: Customer location
  installationAge?: number;                             // Optional: Installation age (years)
}
```

**Widget Types**:
1. **installation_lookup**: Find installation by address
2. **installation_overview**: Quick info dashboard for customer
3. **operator_change_wizard**: Step-by-step operator change guide
4. **storage_calculator**: Storage worthiness check
5. **eeg_end_helper**: Post-EEG guidance (after 20 years)
6. **faq_embedded**: Top 10 frequently asked questions
7. **contact_finder**: Find VNB/BNetzA/Finanzamt by postal code
8. **document_templates**: Download forms and templates

**Business Impact**:
- 30-40% reduction in call center load
- 24/7 availability
- Higher customer satisfaction (instant answers vs. callbacks)
- Reduced peak-time call center strain

**Use Cases**:
- Customer self-service portals
- Website integration
- Mobile app widgets
- Automated customer support

**Example Request**:
```json
{
  "widgetType": "storage_calculator",
  "mode": "embedded",
  "theme": "light",
  "language": "de",
  "outputFormat": "html",
  "postalCode": "69115"
}
```

**Example Response**:
```html
<!-- Embeddable HTML snippet ready for integration -->
<div class="cernion-widget" data-type="storage-calculator">
  <h3>Ist ein Speicher für Sie sinnvoll?</h3>
  <form class="storage-calculator-form">
    <label>PV-Anlagenleistung (kWp): <input type="number" name="capacity" /></label>
    <label>Jahresverbrauch (kWh): <input type="number" name="consumption" /></label>
    <button type="submit">Berechnen</button>
  </form>
  <div class="results"></div>
  <footer class="powered-by">Powered by Cernion 🌱</footer>
</div>
<script src="https://cdn.cernion.de/widgets/storage-calculator.js"></script>
```

---

#### cernion_installation_health_check

**Purpose**: Compare actual vs. expected yield and diagnose performance issues

**Parameters**:
```typescript
{
  capacityKWp: number;           // Installed capacity
  commissioningYear: number;     // Year of commissioning
  postalCode: string;            // Installation location
  actualYieldKWh: number;        // Actual yield
  yieldPeriod: 'month' | 'year'; // Measurement period
  yieldYear?: number;            // Optional: specific year
}
```

**Health Status**:
- **EXCELLENT** (>95% of expected): ✅ Performing above average
- **GOOD** (90-95%): ✅ Normal performance
- **ACCEPTABLE** (85-90%): ⚠️ Slightly below expected
- **POOR** (70-85%): ⚠️ Significant underperformance
- **CRITICAL** (<70%): 🚨 Urgent investigation needed

**Root Cause Analysis**:
- Shading (60% probability)
- Soiling/dirt (30% probability)
- Inverter issues (5% probability)
- Panel degradation (3% probability)
- Other (2% probability)

**Use Cases**:
- Customer service calls (yield complaints)
- Proactive maintenance offers
- Warranty validation
- Performance guarantees

**Example Request**:
```json
{
  "capacityKWp": 10,
  "commissioningYear": 2015,
  "postalCode": "69115",
  "actualYieldKWh": 9000,
  "yieldPeriod": "year",
  "yieldYear": 2024
}
```

**Example Response**:
```json
{
  "healthCheck": {
    "status": "ACCEPTABLE",
    "performance": 85.7,
    "expectedYieldKWh": 10500,
    "actualYieldKWh": 9000,
    "lossKWh": 1500,
    "lossEUR": 600
  },
  "rootCauseAnalysis": [
    { "cause": "Shading", "probability": 0.60, "description": "Nearby trees or buildings" },
    { "cause": "Soiling", "probability": 0.30, "description": "Dust, bird droppings" }
  ],
  "recommendations": [
    {
      "action": "Professional cleaning",
      "cost": 150,
      "expectedGain": 450,
      "roi": "3 months"
    },
    {
      "action": "Thermography inspection",
      "cost": 300,
      "condition": "If performance doesn't improve after cleaning"
    }
  ]
}
```

---

#### cernion_installation_change_wizard

**Purpose**: Step-by-step guidance for installation changes (operator change, storage retrofit, decommissioning)

**Parameters**:
```typescript
{
  changeType: 'operator_change' | 'storage_retrofit' | 'capacity_increase' |
              'decommissioning' | 'tariff_switch' | 'direct_marketing';
  currentSituation: string;              // Natural language description
  installationType?: string;             // Optional: solar, wind, etc.
  mastrNummer?: string;                  // Optional: Installation ID
}
```

**Change Types**:
1. **operator_change**: Change of installation operator (e.g., house purchase)
2. **storage_retrofit**: Add battery storage to existing PV
3. **capacity_increase**: Expand installation capacity
4. **decommissioning**: Remove/decommission installation
5. **tariff_switch**: Switch feed-in tariff model
6. **direct_marketing**: Switch to direct marketing (Direktvermarktung)

**Use Cases**:
- Customer self-service
- Call center scripts
- Process documentation
- Compliance checklists

**Example Request**:
```json
{
  "changeType": "operator_change",
  "currentSituation": "Bought house with existing PV system on 2026-01-01",
  "installationType": "solar"
}
```

**Example Response**:
```json
{
  "wizard": {
    "changeType": "operator_change",
    "totalSteps": 7,
    "estimatedDuration": "4-6 weeks",
    "steps": [
      {
        "stepNumber": 1,
        "title": "Notify grid operator (VNB)",
        "description": "Submit operator change form to VNB within 30 days",
        "deadline": "2026-02-01",
        "status": "urgent",
        "requiredDocuments": ["Purchase contract", "Property deed"],
        "cost": 0
      },
      {
        "stepNumber": 2,
        "title": "Update MaStR registry",
        "description": "Register as new operator in Marktstammdatenregister",
        "deadline": "2026-02-15",
        "status": "pending",
        "requiredDocuments": ["Personal ID", "Installation data"],
        "url": "https://www.marktstammdatenregister.de"
      }
    ],
    "checklist": [
      { "item": "Purchase contract", "status": "completed" },
      { "item": "Property deed", "status": "completed" },
      { "item": "VNB notification form", "status": "pending" },
      { "item": "MaStR registration", "status": "pending" }
    ]
  }
}
```

---

### European Energy Data (ENTSO-E)

All ENTSO-E tools provide direct access to the ENTSO-E Transparency Platform with automatic EIC code resolution.

#### entsoe_unavailability

**Purpose**: Query unavailable generation units, transmission assets, and load

**Document Types**: A77 (Production unavailability), A78 (Transmission unavailability), A76 (Load unavailability)

**Parameters**:
```typescript
{
  region: string;                                       // Country (e.g., "Deutschland", "France")
  dateFrom: string;                                     // Start date
  dateTo: string;                                       // End date
  unavailabilityType?: 'production' | 'transmission' | 'load' | 'all';  // Default: 'production'
  psrType?: string;                                     // Optional: PSR type code (use entsoe_psr_types tool for list)
  includeStatistics?: boolean;                          // Default: true
}
```

**Note**: For available PSR type codes (B14=Nuclear, B16=Solar, etc.), use the `entsoe_psr_types` tool.

**Use Cases**:
- Outage monitoring (planned and unplanned)
- Capacity forecasting
- Security of supply assessment
- Market intelligence (correlate outages with price spikes)

---

#### entsoe_physical_flows

**Purpose**: Query physical cross-border electricity flows between countries/bidding zones

**Document Type**: A11 (Aggregated energy data)

**Parameters**:
```typescript
{
  fromRegion: string;                      // Source region (e.g., "France")
  toRegion: string;                        // Target region (e.g., "Germany")
  dateFrom: string;
  dateTo: string;
  resolution?: 'hourly' | 'daily';         // Default: 'hourly'
  includeStatistics?: boolean;             // Default: true
}
```

**Flow Convention**:
- **Positive values**: Import to `toRegion`
- **Negative values**: Export from `toRegion`

**Use Cases**:
- Import/export dependency monitoring
- Grid stress assessment
- Trading arbitrage opportunities
- Cross-border capacity utilization

---

#### entsoe_actual_generation

**Purpose**: Query actual electricity generation by production type

**Document Types**: A75 (Actual generation per type), A73 (Aggregated), A74 (Wind and solar)

**Parameters**:
```typescript
{
  region: string;
  dateFrom: string;
  dateTo: string;
  psrType?: string;                        // Optional: Filter by type (B16=Solar, B19=Wind Onshore)
  resolution?: 'hourly' | 'daily';         // Default: 'hourly'
  includeStatistics?: boolean;             // Default: true
}
```

**Use Cases**:
- Energy mix analysis
- Renewable share monitoring
- Forecast validation
- Carbon intensity calculation

---

#### entsoe_wind_solar_forecast

**Purpose**: Day-ahead wind and solar generation forecasts

**Document Type**: A69 (Wind and solar forecast)

**Parameters**:
```typescript
{
  region: string;
  dateFrom: string;
  dateTo: string;
  forecastType?: 'wind' | 'solar' | 'both';   // Default: 'both'
  includeStatistics?: boolean;                 // Default: true
}
```

**Use Cases**:
- Renewable energy planning
- Grid balancing (day-ahead)
- Trading strategies
- Conventional backup capacity planning

---

#### entsoe_load_forecast

**Purpose**: Day-ahead electricity load (demand) forecasts

**Document Type**: A65 (Day-ahead total load forecast)

**Parameters**:
```typescript
{
  region: string;
  dateFrom: string;
  dateTo: string;
  resolution?: 'hourly' | 'daily';          // Default: 'hourly'
  includeStatistics?: boolean;              // Default: true
}
```

**Use Cases**:
- Grid planning
- Demand forecasting for trading
- Peak load management
- Infrastructure planning

---

#### entsoe_aggregated_generation

**Purpose**: Total actual generation (no breakdown by type)

**Document Type**: A73 (Actual generation aggregated)

**Parameters**:
```typescript
{
  region: string;
  dateFrom: string;
  dateTo: string;
  resolution?: 'hourly' | 'daily';          // Default: 'hourly'
  includeStatistics?: boolean;              // Default: true
}
```

**Use Cases**:
- High-level generation monitoring
- Demand vs. supply comparisons
- Quick dashboards (total generation only)

**Note**: For detailed breakdown by production type, use `entsoe_actual_generation` (A75)

---

#### entsoe_wind_solar_actual

**Purpose**: Actual wind (offshore/onshore) and solar generation

**Document Type**: A74 (Wind and solar generation)

**Use Cases**:
- Renewable energy monitoring
- Forecast validation (compare with A69)
- Actual vs. forecast comparison

---

#### entsoe_generation_forecast

**Purpose**: Day-ahead electricity generation forecasts by production type

**Document Type**: A71 (Generation forecast - day ahead)

**Use Cases**:
- Comprehensive day-ahead generation planning
- All production types (more comprehensive than A69)
- Forecast validation with actual data (A75)

---

#### entsoe_psr_types

**Purpose**: Retrieve list of ENTSO-E Production Source Type (PSR) codes with descriptions

**Parameters**: None (or optional filter parameter)

**Response Structure**:
```typescript
{
  psrTypes: Array<{
    code: string;           // e.g., "B14"
    name: string;           // e.g., "Nuclear"
    category: 'renewable' | 'fossil' | 'other';
    description: string;    // Detailed description
  }>;
}
```

**Available PSR Types**:
- B01-B20: Complete list of production source types
- Includes: Nuclear, Solar, Wind (Offshore/Onshore), Gas, Coal, Biomass, Hydro, etc.

**Use Cases**:
- Validate PSR type codes before using ENTSO-E tools
- Build dynamic UI dropdowns for production type selection
- Documentation and reference
- Filter available types by category (renewable/fossil)

**Example Response**:
```json
{
  "psrTypes": [
    {
      "code": "B14",
      "name": "Nuclear",
      "category": "other",
      "description": "Nuclear power generation"
    },
    {
      "code": "B16",
      "name": "Solar",
      "category": "renewable",
      "description": "Solar photovoltaic and solar thermal"
    },
    {
      "code": "B19",
      "name": "Wind Onshore",
      "category": "renewable",
      "description": "Onshore wind generation"
    }
  ]
}
```

**When to Use**:
- ✅ Before querying ENTSO-E tools with `psrType` parameter
- ✅ Building UI components for production type selection
- ✅ Validation and documentation purposes
- ❌ Simple hardcoded queries where you already know the PSR code

---

### Gas Storage (AGSI)

European gas storage data from Gas Infrastructure Europe (GIE) AGSI+ platform.

#### agsi_country_storage

**Purpose**: Current gas storage data for European countries (fill level, injection/withdrawal, operator breakdown)

**Parameters**:
```typescript
{
  country: string;                  // ISO country code (e.g., "DE", "AT", "FR")
  includeOperators?: boolean;       // Include operator breakdown (default: false)
  includeFacilities?: boolean;      // Include facility list (default: false)
}
```

**Use Cases**:
- Supply security monitoring
- Winter preparation assessment
- EU 90% mandate compliance check
- Operator performance analysis

**Example Response**:
```json
{
  "country": "Germany",
  "date": "2026-02-03",
  "fillLevel": 31.97,
  "gasInStorage": 80.3,
  "workingGasVolume": 251.1,
  "unit": "TWh",
  "withdrawal": 1223.5,
  "trend": -0.47,
  "coverage": 8.88
}
```

---

#### agsi_operator_storage

**Purpose**: Detailed storage data for a specific storage system operator (SSO) including facility breakdown

**Parameters**:
```typescript
{
  operatorCode: string;           // Operator EIC code (e.g., "21X000000001262B")
  date?: string;                  // Optional date (YYYY-MM-DD)
  includeFacilities?: boolean;    // Include facility breakdown (default: true)
}
```

**Use Cases**:
- Operator performance monitoring
- Facility portfolio analysis
- Commercial due diligence
- Regulatory reporting

**Example Request**:
```json
{
  "operatorCode": "21X000000001262B",
  "includeFacilities": true
}
```

---

#### agsi_historical_data

**Purpose**: Historical time-series data (daily/weekly/monthly) for trend analysis

**Parameters**:
```typescript
{
  country: string;
  from: string;                     // Start date (ISO 8601)
  to: string;                       // End date
  aggregation?: 'daily' | 'weekly' | 'monthly';  // Default: 'daily'
}
```

**Use Cases**:
- Seasonal pattern analysis
- Forecasting models
- Year-over-year comparison

---

#### agsi_eu_statistics

**Purpose**: EU-wide aggregate statistics (total capacity, fill level, days of coverage)

**Parameters**:
```typescript
{
  includeCountryBreakdown?: boolean;    // Include per-country data (default: false)
}
```

**Use Cases**:
- EU-wide supply security monitoring
- EU Storage Regulation compliance (2017/1938)
- Policy maker dashboards

---

#### agsi_compare_countries

**Purpose**: Multi-country comparison (fill levels, capacities, trends)

**Parameters**:
```typescript
{
  countries: string[];              // ISO country codes (e.g., ["DE", "AT", "NL"])
  metric: 'fill_percentage' | 'capacity' | 'withdrawal_rate' | 'coverage_days';
}
```

**Use Cases**:
- Cross-border supply security analysis
- Policy effectiveness comparison
- Best-practice identification

---

#### agsi_storage_trend

**Purpose**: Trend analysis over defined periods (injection/withdrawal patterns, seasonality)

**Parameters**:
```typescript
{
  country: string;
  period: 'week' | 'month' | 'quarter' | 'year';
  endDate?: string;                 // Default: today
}
```

**Use Cases**:
- Seasonal depletion rate calculation
- Anomaly detection
- Comparison to previous periods

---

#### agsi_supply_security_check

**Purpose**: Supply security assessment (fill level vs. consumption, EU 90% mandate, critical thresholds)

**Parameters**:
```typescript
{
  country: string;
  winterMandateCheck?: boolean;     // Check EU 90% mandate (default: true)
}
```

**Security Status**:
- **SECURE** (>70% fill): ✅ Adequate reserves
- **ADEQUATE** (50-70%): ✅ Sufficient but monitor
- **WARNING** (30-50%): ⚠️ Below target
- **CRITICAL** (<30%): 🚨 Emergency measures needed

**Use Cases**:
- Early warning system
- Emergency planning
- EU 90% mandate compliance (target: 1 November)

---

### EIC Code Management

Energy Identification Code (EIC) database with 72,580+ codes from ENTSO-E and AGSI/GIE.

#### cernion_eic_search

**Purpose**: Search EIC code database by code or company name

**Parameters**:
```typescript
{
  code?: string;                    // Exact EIC code search
  name?: string;                    // Company name search (fuzzy matching)
  country?: string;                 // Filter by country (ISO code)
  sector?: 'electricity' | 'gas';   // Filter by sector
  limit?: number;                   // Max results (default: 10)
}
```

**Use Cases**:
- Find valid codes for AGSI/ENTSO-E tools
- Market partner research
- Code validation
- Energy market research

---

#### cernion_eic_validate

**Purpose**: Validate EIC code format (IEC 62325 standard)

**Validation Checks**:
- Length (16 characters)
- LIO area (10-70)
- Code type character
- Check digit algorithm

**Parameters**:
```typescript
{
  code: string;                     // EIC code to validate
}
```

**Use Cases**:
- Pre-validation before API calls
- Form input validation
- Developer debugging

---

#### cernion_eic_gas_operators

**Purpose**: List German gas storage operators with EIC codes

**Parameters**:
```typescript
{
  country?: string;                 // Default: "DE"
  includeMetadata?: boolean;        // Include additional details (default: false)
}
```

**Use Cases**:
- Find valid codes for AGSI operator queries
- German gas storage market overview
- Operator portfolio analysis

---

#### cernion_eic_gas_facilities

**Purpose**: List German gas storage facilities (UGS) with EIC codes

**Parameters**:
```typescript
{
  operatorCode?: string;            // Filter by operator EIC code
  country?: string;                 // Default: "DE"
}
```

**Use Cases**:
- Find valid codes for AGSI facility queries
- Operator portfolio breakdown
- Facility-level monitoring

---

#### cernion_eic_statistics

**Purpose**: Statistics about EIC database (total count, breakdown by type/sector/country)

**Parameters**: None

**Use Cases**:
- Database health check
- Coverage assessment
- Data quality monitoring

---

### German Grid Data (Netztransparenz.de)

Official German grid operator data from Netztransparenz.de (authenticated access).

#### netztransparenz_spotprices

**Purpose**: German spotmarket prices (EPEX/EEX) for dynamic tariffs

**Parameters**:
```typescript
{
  dateFrom: string;                 // ISO 8601 datetime
  dateTo: string;
  includeStatistics?: boolean;      // Default: true
}
```

**Use Cases**:
- Dynamic tariff calculation
- Market analysis
- Price optimization
- Merit-order visualization

---

#### netztransparenz_negative_prices

**Purpose**: Negative price analysis for §51 EEG 2023 compliance

**Regulation**: §51 EEG 2023 - No compensation during ≥6 consecutive hours of negative prices

**Parameters**:
```typescript
{
  dateFrom: string;
  dateTo: string;
  logic?: 1 | 2 | 3 | 4 | 6 | 15;       // Consecutive hours threshold (default: 6)
  includeEegCompliance?: boolean;        // Include §51 EEG analysis (default: true)
}
```

**Use Cases**:
- EEG direct marketing compliance
- Prosumer advisory (self-consumption vs. direct marketing)
- Risk management for energy suppliers

---

#### netztransparenz_forecast

**Purpose**: Solar/wind generation forecasts for grid planning and load forecasting

**Parameters**:
```typescript
{
  product: 'Solar' | 'Wind';
  dateFrom: string;
  dateTo: string;
  includeActual?: boolean;          // Include actual data (default: false)
  includeOnline?: boolean;          // Include real-time data (default: false)
}
```

**Use Cases**:
- Load forecasting for procurement
- Grid congestion forecasting
- Renewable generation planning
- Balancing energy reduction

---

#### netztransparenz_redispatch

**Purpose**: Redispatch measures and grid congestion analysis

**Parameters**:
```typescript
{
  dateFrom: string;
  dateTo: string;
  includeAnalysis?: boolean;        // Include root cause analysis (default: true)
  includeCurtailment?: boolean;     // Include curtailment data (default: false)
}
```

**Use Cases**:
- Grid congestion analysis
- Curtailment risk assessment for new installations
- Redispatch cost forecasting
- NEST project justification (§11 EnWG)

---

### System Tools

#### cernion_status

**Purpose**: System and provider status check

**Parameters**: None

**Response**:
```json
{
  "status": "Healthy",
  "toolsAvailable": 70,
  "sessionManagement": "Active",
  "version": "1.0.0",
  "platform": "linux",
  "apiKeys": {
    "entsoE": "configured",
    "smard": "configured",
    "agsi": "configured"
  }
}
```

---

#### cernion_validate_params

**Purpose**: Validate tool parameters before execution

**Parameters**:
```typescript
{
  tool: string;                     // Tool name
  params: object;                   // Parameters to validate
}
```

**Use Cases**:
- Pre-validation before expensive operations
- Form validation
- Error prevention

---

#### cernion_job_status

**Purpose**: Check status of async jobs

**Parameters**:
```typescript
{
  job_id: string;                   // Job identifier from async tool
}
```

**Job States**:
- `queued`: Waiting for execution
- `running`: Currently processing
- `succeeded`: Completed successfully
- `failed`: Error occurred

---

#### cernion_job_result

**Purpose**: Retrieve result of async job

**Parameters**:
```typescript
{
  job_id: string;                   // Job identifier
}
```

**Use Cases**:
- Polling for long-running operations
- Retrieve results after job completion
- Error diagnosis

---

## Date Format Support

All tools with date parameters support multiple formats:

- **ISO 8601**: `2026-02-06` or `2026-02-06T14:30:00Z`
- **Compact**: `20260206`
- **German**: `06.02.2026`

## Response Format

All tool responses follow this structure:

```typescript
{
  success: boolean;
  data?: any;                       // Tool-specific response data
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    executionTimeMs: number;
    source: string;
    queryTime: string;
  };
}
```

## Rate Limits

- **ENTSO-E API**: 400 requests/minute
- **SMARD API**: 10 requests/second
- **AGSI API**: No official limit (respectful usage recommended)
- **Netztransparenz.de**: OAuth2 authenticated (limits not publicly documented)

## Error Handling

Common error codes:

- `INVALID_PARAMETERS`: Missing or invalid input parameters
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `API_UNAVAILABLE`: External API temporarily unavailable
- `NO_DATA_FOUND`: Query returned no results
- `AUTHENTICATION_FAILED`: Token invalid or expired

## Best Practices

1. **Use specific tools over general ones**: `entsoe_day_ahead_prices` is faster than `cernion_energy_prices` for known queries
2. **Pre-validate parameters**: Use `cernion_validate_params` to prevent errors
3. **Poll async jobs**: Use `cernion_job_status` before `cernion_job_result`
4. **Cache results**: Many queries return static data that can be cached
5. **Respect rate limits**: Implement backoff strategies
6. **Use date ranges wisely**: Large date ranges may timeout - break into smaller chunks

## Support

For technical questions or integration support, please refer to the full API documentation.

---

**Document Version**: 1.0
**Last Updated**: February 2026
**Total Tools**: 71
