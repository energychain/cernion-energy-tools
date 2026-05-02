# Quick Start Guide - Cernion MCP Microservices

## Prerequisites
- Node.js 22+ installed
- Cernion MCP token (get from https://cernion.de)

## Installation (3 minutes)

### 1. Clone and Install
```bash
cd /opt/cernion-energy-tools
npm install
```

### 2. Configure Token
```bash
cp .env.example .env
# Edit .env and add your CERNION_TOKEN
nano .env
```

Required in `.env`:
```
CERNION_TOKEN=your_actual_token_here
PORT=3000
# Optional: enable email notifications for MaStR Monitor (v0.27)
# SMTP_HOST=smtp.example.com
# SMTP_USER=user@example.com
# SMTP_PASS=yourpassword
# SMTP_FROM=noreply@example.com
# MASTR_MONITOR_BASE_URL=http://localhost:3000
```

### 3. Start Services
```bash
# Development mode (hot reload)
npm run dev

# OR Production mode
npm start
```

You should see:
```
✓ ServiceBroker started successfully
✓ API Gateway listening on port 3000
✔ 45 services loaded
```

## Test Your Setup

### Option 1: Run Integration Tests
```bash
npm run test:integration

# Optional live end-to-end test (requires valid token and reachable MCP backend)
npm run test:e2e
```

### Option 2: Manual Test
```bash
# Test system status
curl http://localhost:3000/api/system/status

# Test natural language query
curl -X POST http://localhost:3000/api/query/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Wieviel PV-Leistung in Bayern?"}'
```

## Available Endpoints

### Core Services
- **Query Tools**: http://localhost:3000/api/query/...
- **Energy Market**: http://localhost:3000/api/energy-market/...
- **Grid Operations**: http://localhost:3000/api/grid-operations/...
- **Business Intelligence**: http://localhost:3000/api/business-intelligence/...
- **Customer Service**: http://localhost:3000/api/customer-service/...

### Data Sources
- **ENTSO-E**: http://localhost:3000/api/entsoe/...
- **Gas Storage**: http://localhost:3000/api/gas-storage/...
- **EIC Codes**: http://localhost:3000/api/eic-codes/...
- **German Grid**: http://localhost:3000/api/german-grid/...

### Validation & Audit Agents
- **Grid Connection**: http://localhost:3000/api/grid-connection/...
- **Energy Sharing**: http://localhost:3000/api/energy-sharing/...
- **MaStR Quality Audit**: http://localhost:3000/api/mastr-quality/...
- **Redispatch Ex-Post**: http://localhost:3000/api/redispatch-expost/...

### AI & Narrative
- **AI Agent**: http://localhost:3000/api/agent/...
- **CYA Narrative**: http://localhost:3000/api/cya/...

### Monitoring
- **MaStR Monitor**: http://localhost:3000/api/mastr-monitor/...
- **VNB Monitor**: http://localhost:3000/api/vnb-monitor/...
- **NBP Monitor**: http://localhost:3000/api/nbp-monitor/...

### Platform
- **Object Store**: http://localhost:3000/api/object-store/...
- **ZNP Projects**: http://localhost:3000/api/znp/projects
- **Cookbook**: http://localhost:3000/api/cookbook/...
- **Dashboard**: http://localhost:3000/api/dashboard/...

### System
- **System Tools**: http://localhost:3000/api/system/...

## API Documentation
OpenAPI documentation: http://localhost:3000/api/openapi.json

**Swagger UI (Interactive Testing):** http://localhost:3000/api/docs

Use the Swagger UI to explore and test all endpoints directly in your browser!

## Common Use Cases

### 1. Query PV Capacity in a Region
```bash
curl -X POST http://localhost:3000/api/query/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Wieviel PV-Leistung in Bayern?"}'
```

### 2. Get Day-Ahead Electricity Prices
```bash
curl -X POST http://localhost:3000/api/energy-market/prices \
  -H "Content-Type: application/json" \
  -d '{
    "market": "day-ahead",
    "region": "Deutschland",
    "date": "2026-02-04"
  }'
```

### 3. Check CO2 Intensity for EV Charging
```bash
curl -X POST http://localhost:3000/api/energy-market/co2-intensity \
  -H "Content-Type: application/json" \
  -d '{
    "location": "Heidelberg",
    "forecast": true
  }'
```

### 4. Find New Solar Installations (Sales Leads)
```bash
curl -X POST http://localhost:3000/api/business-intelligence/sales-leads \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Heidelberg",
    "installationType": "solar",
    "daysBack": 30,
    "limit": 10,
    "minScore": 80
  }'
```

### 5. Check Grid Connection Feasibility
```bash
curl -X POST http://localhost:3000/api/grid-operations/connection-capacity-check \
  -H "Content-Type: application/json" \
  -d '{
    "gridOperator": "Netze BW",
    "location": "Heidelberg",
    "installationType": "solar",
    "capacityKW": 10
  }'
```

### 6. Analyze Customer Churn Risk
```bash
curl -X POST http://localhost:3000/api/business-intelligence/churn-prediction \
  -H "Content-Type: application/json" \
  -d '{
    "customerSegment": "prosumer",
    "region": "Baden-Württemberg",
    "riskThreshold": "high",
    "limit": 100
  }'
```

## Development

### Run Tests
```bash
npm test                # All tests with coverage
npm run test:watch      # Watch mode
npm run test:integration # Integration tests only
```

### Code Quality
```bash
npm run lint           # Check code style
npm run lint:fix       # Auto-fix issues
npm run format         # Format code
```

### Hot Reload Development
```bash
npm run dev
# Services automatically reload when you edit files
```

## Troubleshooting

### Services won't start
- Check CERNION_TOKEN is set in .env
- Verify port 3000 is available: `lsof -i :3000`
- Check Node.js version: `node --version` (should be 22+)

### Connection errors
- Verify your Cernion token is valid
- Check network connectivity to https://mcp.cernion.de
- Review logs for detailed error messages

### Tool call failures
- Ensure parameters match the expected schema
- Check OpenAPI docs for required fields
- Verify data format (dates should be ISO 8601)

## Next Steps

1. **Read full documentation**: See [MCP_SERVICES.md](./MCP_SERVICES.md)
2. **Explore API**: Access OpenAPI at http://localhost:3000/api/openapi.json
3. **Add authentication**: Implement API key middleware
4. **Deploy**: Containerize with Docker or deploy to cloud

## Support

- **Documentation**: [MCP_SERVICES.md](./MCP_SERVICES.md)
- **Cernion Tools**: https://cernion.de/mcp_tools.md
- **GitHub Issues**: https://github.com/energychain/cernion-energy-tools/issues

## Architecture Overview

```
HTTP Request → API Gateway (Moleculer Web)
                     ↓
            Microservice (e.g., query.service.js)
                     ↓
            MCP Client (src/mcp-client.js)
                     ↓
            New MCP Session via HTTP/SSE
                     ↓
            Cernion MCP Server (https://mcp.cernion.de)
                     ↓
            Tool Execution (cernion_ask, etc.)
                     ↓
            Response → Close Session → Return to Client
```

Each HTTP request creates a fresh MCP session, ensuring stateless REST behavior.

---

**Ready in 3 minutes!** 🚀
