# Cernion Energy Tools - MCP Microservices

Comprehensive MicroService Agent System for Energy Markets, mapping Cernion MCP tools to REST API endpoints.

## Overview

This project provides a complete REST API wrapper around the Cernion Model Context Protocol (MCP) server, exposing 70+ energy data tools through 12 microservices organized by functional categories. Starting with v0.9, it also includes a parallel inhouse datasource layer for internal utility datasets.

## Architecture

- **Moleculer Framework**: Microservices-based architecture
- **MCP SDK**: HTTP streaming transport to Cernion MCP server
- **Session Management**: One MCP session per HTTP request
- **Auto-generated OpenAPI**: Documentation available at `/api/openapi.json`

## Microservices

### 1. Query Tools Service (`query`)
Natural language queries and template-based searches

**Endpoints:**
- `POST /api/query/ask` - Natural language energy data queries
- `POST /api/query/ask-learned` - Template-based queries (20x faster)
- `POST /api/query/discover` - Schema discovery for databases and tools

### 2. Energy Market Data Service (`energy-market`)
Prices, production, forecasts, installations

**Endpoints:**
- `POST /api/energy-market/prices` - Day-ahead/intraday electricity prices
- `POST /api/energy-market/production` - Generation data by source
- `POST /api/energy-market/co2-intensity` - Regional CO₂ intensity forecasts
- `POST /api/energy-market/installations` - Search MaStR installations

### 3. Grid Operations Service (`grid-operations`)
Network data, redispatch, capacity analysis

**Endpoints:**
- `POST /api/grid-operations/grid-data` - Grid operation data
- `POST /api/grid-operations/operator-analysis` - Comprehensive operator analysis
- `POST /api/grid-operations/capacity-utilization` - Network capacity utilization
- `POST /api/grid-operations/redispatch-export` - Export redispatch installations
- `POST /api/grid-operations/connection-capacity-check` - Grid connection feasibility

### 4. Business Intelligence Service (`business-intelligence`)
Market analysis, lead generation, tariff design

**Endpoints:**
- `POST /api/business-intelligence/sales-leads` - Identify sales leads from MaStR
- `POST /api/business-intelligence/dynamic-tariff-calculator` - Dynamic tariff calculation
- `POST /api/business-intelligence/churn-prediction` - Customer churn risk prediction
- `POST /api/business-intelligence/market-penetration` - Market penetration analysis

### 5. Customer Service Service (`customer-service`)
Self-service widgets, health checks, wizards

**Endpoints:**
- `POST /api/customer-service/portal-widget` - Generate embeddable widgets
- `POST /api/customer-service/installation-health-check` - Yield performance diagnosis
- `POST /api/customer-service/installation-change-wizard` - Step-by-step change guidance

### 6. ENTSO-E Service (`entsoe`)
European Energy Data from ENTSO-E Transparency Platform

**Endpoints:**
- `POST /api/entsoe/day-ahead-prices` - Direct ENTSO-E day-ahead prices
- `POST /api/entsoe/unavailability` - Generation/transmission unavailability
- `POST /api/entsoe/physical-flows` - Cross-border electricity flows
- `POST /api/entsoe/actual-generation` - Actual generation by type
- `POST /api/entsoe/wind-solar-forecast` - Wind/solar forecasts
- `POST /api/entsoe/load-forecast` - Load demand forecasts
- `POST /api/entsoe/aggregated-generation` - Aggregated actual generation (all types)
- `POST /api/entsoe/wind-solar-actual` - Actual wind/solar generation
- `POST /api/entsoe/generation-forecast` - Generation forecasts by type
- `GET /api/entsoe/psr-types` - List PSR type codes

### 7. Gas Storage (AGSI) Service (`gas-storage`)
European gas storage monitoring

**Endpoints:**
- `POST /api/gas-storage/country-storage` - Country storage data
- `POST /api/gas-storage/operator-storage` - Operator-specific storage
- `POST /api/gas-storage/historical-data` - Historical time-series
- `POST /api/gas-storage/eu-statistics` - EU-wide statistics
- `POST /api/gas-storage/compare-countries` - Multi-country comparison
- `POST /api/gas-storage/storage-trend` - Trend analysis
- `POST /api/gas-storage/supply-security-check` - Security assessment

### 8. EIC Code Management Service (`eic-codes`)
Energy Identification Code database

**Endpoints:**
- `POST /api/eic-codes/search` - Search EIC code database
- `POST /api/eic-codes/validate` - Validate EIC code format
- `GET /api/eic-codes/gas-operators` - List gas storage operators
- `GET /api/eic-codes/gas-facilities` - List gas storage facilities
- `GET /api/eic-codes/statistics` - EIC database statistics

### 9. German Grid Data Service (`german-grid`)
Official German grid operator data from Netztransparenz.de

**Endpoints:**
- `POST /api/german-grid/spotprices` - German spotmarket prices
- `POST /api/german-grid/negative-prices` - Negative price analysis (§51 EEG 2023)
- `POST /api/german-grid/forecast` - Solar/wind generation forecasts
- `POST /api/german-grid/redispatch` - Redispatch measures

### 10. Renewable Energy Forecast Service (`forecast`)
Weather-based renewable energy generation forecasting using real MaStR installation data

**Endpoints:**
- `POST /api/forecast/generation-forecast` - Weather-based generation forecasts

**Key Features:**
- Real installation data from German Marktstammdatenregister (3.7M+ installations)
- IEC standard compliance (IEC 61853 for solar, IEC 61400 for wind)
- Hourly forecasts up to 7 days (168 hours)
- Regional filtering (state, district, municipality, postal code)
- Installation-level breakdown available
- Weather data integration via Visual Crossing API
- 24-hour weather data caching for performance

**Use Cases:**
- Energy procurement optimization for Stadtwerke
- Grid congestion anticipation for VNB/GNB
- Virtual Power Plant (VPP) trading
- Intraday and day-ahead market positioning
- Industrial load shifting optimization

### 11. System Tools Service (`system`)
Status, job management, parameter validation

**Endpoints:**
- `GET /api/system/status` - System and provider status
- `POST /api/system/validate-params` - Validate tool parameters
- `GET /api/system/job-status/:jobId` - Check async job status
- `GET /api/system/job-result/:jobId` - Retrieve async job result

### 12. Inhouse Datasource Registry (`datasource-registry`)
Datasource registration, dictionary versioning, and schema inference drafts

**Endpoints:**
- `POST /api/datasources` - Register a new datasource
- `GET /api/datasources` - List registered datasources
- `GET /api/datasources/:id` - Get datasource definition
- `PUT /api/datasources/:id` - Update datasource definition
- `DELETE /api/datasources/:id` - Remove datasource definition
- `GET /api/datasources/:id/dictionary` - Get current dictionary
- `PUT /api/datasources/:id/dictionary` - Replace current dictionary and increment version
- `GET /api/datasources/:id/dictionary/history` - Get version history
- `GET /api/datasources/:id/dictionary/:version` - Get specific dictionary version
- `POST /api/datasources/:id/infer` - Generate inferred draft dictionary
- `POST /api/datasources/:id/refresh` - Trigger datasource refresh

### 13. Inhouse Datasource Cache (`datasource-cache`)
Privacy-aware cached datasource row access and audit trail

**Endpoints:**
- `GET /api/datasource-cache/:sourceId` - Query cached rows
- `GET /api/datasource-cache/:sourceId/status` - Cache status and staleness
- `GET /api/datasource-cache/:sourceId/audit` - DSGVO substitution audit log
- `POST /api/datasource-cache/:sourceId/refresh` - Refresh cache entry now
- `DELETE /api/datasource-cache/:sourceId` - Invalidate cache entry

### 14. Inhouse Datasource Discovery (`datasource-discovery`)
AI-ready descriptors for fresh internal data sources

**Endpoints:**
- `GET /api/datasource-discovery` - List discoverable datasource descriptors
- `GET /api/datasource-discovery/search?q=...` - Search datasource descriptors
- `GET /api/datasource-discovery/:sourceId/descriptor` - Get one descriptor

### 15. Inhouse Datasource Connectors (`datasource-connector`)
Internal plugin runtime for heterogeneous datasource reads (not exposed directly via public REST)

**Built-in plugins:**
- `csv`
- `rest`
- `geojson`
- `xlsx`
- `docx` (optional dependency scaffold)
- `scraper` (optional dependency scaffold)

**Current integration note:**
- These connectors are consumed by `datasource-registry` and `datasource-cache`
- `datasource-discovery` publishes fresh sources to the agent as inhouse descriptors
- `agent.analyze` now includes inhouse datasource descriptors alongside normal microservice actions

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your Cernion token:

```bash
cp .env.example .env
```

Edit `.env`:
```
CERNION_TOKEN=your_token_here
PORT=3000
```

Get your token from https://cernion.de

### 3. Start Services

Development mode (with hot reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Testing

Run all tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Run integration tests:
```bash
npm run test:integration
```

## API Documentation

Once the services are running, access the OpenAPI documentation:

**OpenAPI JSON:**
```
http://localhost:3000/api/openapi.json
```

**Swagger UI (Interactive API Testing):**
```
http://localhost:3000/api/docs
```

The Swagger UI provides an interactive interface where you can:
- Explore all available endpoints
- View request/response schemas
- Test API calls directly from your browser
- See example requests and responses

## MCP Session Management

Each HTTP request creates a new MCP session using the `CernionMCPClient.callWithNewSession()` method:

1. Client connects to Cernion MCP server via HTTP streaming (SSE)
2. Tool is called with provided parameters
3. Session is automatically closed after response
4. Result is returned to the REST API caller

This ensures stateless REST API behavior while properly managing MCP sessions.

## MCP Client Usage

```javascript
const CernionMCPClient = require('./src/mcp-client');

// One-off tool call with automatic session management
const result = await CernionMCPClient.callWithNewSession('cernion_ask', {
  query: 'Wieviel PV-Leistung in Bayern?'
});

// Or manage session manually
const client = new CernionMCPClient(process.env.CERNION_TOKEN);
await client.connect();
const result = await client.callTool('cernion_ask', { query: '...' });
await client.disconnect();
```

## Example Requests

### Query natural language
```bash
curl -X POST http://localhost:3000/api/query/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Wieviel PV-Leistung in Bayern?"}'
```

### Get day-ahead prices
```bash
curl -X POST http://localhost:3000/api/energy-market/prices \
  -H "Content-Type: application/json" \
  -d '{
    "market": "day-ahead",
    "region": "Deutschland",
    "date": "2026-02-04"
  }'
```

### Check grid operator analysis
```bash
curl -X POST http://localhost:3000/api/grid-operations/operator-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "gridOperator": "Netze BW",
    "includeRedispatch": true
  }'
```

### Get sales leads
```bash
curl -X POST http://localhost:3000/api/business-intelligence/sales-leads \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Heidelberg",
    "installationType": "solar",
    "daysBack": 30,
    "limit": 5
  }'
```

## Project Structure

```
cernion-energy-tools/
├── src/
│   ├── mcp-client.js           # MCP SDK wrapper
│   └── index.js
├── services/
│   ├── api.service.js          # API Gateway
│   ├── query.service.js        # Query Tools
│   ├── energy-market.service.js
│   ├── grid-operations.service.js
│   ├── business-intelligence.service.js
│   ├── customer-service.service.js
│   ├── entsoe.service.js
│   ├── gas-storage.service.js
│   ├── eic-codes.service.js
│   ├── german-grid.service.js
│   └── system.service.js
├── tests/
│   ├── setup.js
│   ├── mcp-client.test.js
│   ├── query.service.test.js
│   ├── energy-market.service.test.js
│   ├── grid-operations.service.test.js
│   ├── business-intelligence.service.test.js
│   └── system.service.test.js
├── .env.example
├── package.json
├── moleculer.config.js
└── jest.config.js
```

## Technology Stack

- **Moleculer**: 0.14.35 - Microservices framework
- **@modelcontextprotocol/sdk**: 1.26.0 - MCP client SDK
- **Moleculer Web**: 0.10.8 - API Gateway
- **Moleculer Auto OpenAPI**: 1.1.7 - Auto-generated API docs
- **Jest**: 29.7.0 - Testing framework

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Submit a pull request

## License

GPL-3.0

## Support

For issues and questions:
- GitHub Issues: https://github.com/energychain/cernion-energy-tools/issues
- Cernion Documentation: https://cernion.de/mcp_tools.md

## Credits

Developed by Energy Chain for the Cernion Energy Platform.
