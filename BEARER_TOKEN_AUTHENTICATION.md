# Bearer Token Authentication

**Date**: February 7, 2026
**Feature**: Optional request-level token authentication for REST API requests

## Overview

The REST API Gateway supports optional request-level token authentication, allowing API consumers to specify custom Cernion MCP tokens per request. Supported input methods are:

- `Authorization: Bearer <token>` header
- `token` request parameter (query/body/path)

This enables:

- **Multi-tenant scenarios**: Different API consumers with their own Cernion quotas
- **User-specific tokens**: Individual users authenticate with their own tokens
- **Flexible authentication**: Choose between shared token (from `.env`) or per-request tokens
- **Graceful fallback**: If no request token is provided, uses `CERNION_TOKEN` from environment

### Security note

Both methods are supported for compatibility. For production and internet-facing clients,
prefer the Bearer header because query parameters can leak via browser history, reverse-proxy
logs, access logs, and shared URLs.

## Authentication Flow

```
┌─────────────────┐
│  API Consumer   │
└────────┬────────┘
         │
         │ POST /api/grid-operations/grid-data
         │ Authorization: Bearer <custom-token>
         │
         ▼
┌─────────────────────────────┐
│   API Gateway               │
│  (api.service.js)           │
│  - Extracts Bearer token    │
│  - Stores in ctx.meta       │
└────────┬────────────────────┘
         │
         │ ctx.meta.cernionToken = <custom-token>
         │
         ▼
┌──────────────────────────────┐
│  Service Handler             │
│  (grid-operations.service.js)│
│  - Receives ctx.meta         │
│  - Passes token to MCP       │
└────────┬─────────────────────┘
         │
         │ CernionMCPClient.callWithNewSession(
         │   'cernion_grid_data',
         │   params,
         │   ctx.meta.cernionToken  // Optional token
         │ )
         │
         ▼
┌─────────────────────────────┐
│  MCP Client                  │
│  (src/mcp-client.js)         │
│  - Uses custom token if      │
│    provided, else falls      │
│    back to CERNION_TOKEN     │
│    from .env                 │
└──────────────────────────────┘
         │
         │ new CernionMCPClient(
         │   customToken || process.env.CERNION_TOKEN
         │ )
         │
         ▼
┌─────────────────────────────┐
│  Cernion MCP Backend         │
│  mcp.cernion.de              │
└─────────────────────────────┘
```

## Usage Examples

### 1. With Bearer Token (Custom Quota)

```bash
curl -X POST http://localhost:3000/api/grid-operations/grid-data \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your-custom-cernion-token-here' \
  -d '{
    "dataType": "load",
    "region": "Bayern",
    "date": "2026-02-01",
    "gridOperator": "Stadtwerke München"
  }'
```

**Behavior**: Uses `your-custom-cernion-token-here` for MCP authentication.

### 2. Without Bearer Token (Environment Fallback)

```bash
curl -X POST http://localhost:3000/api/grid-operations/grid-data \
  -H 'Content-Type: application/json' \
  -d '{
    "dataType": "load",
    "region": "Bayern",
    "date": "2026-02-01",
    "gridOperator": "Stadtwerke München"
  }'
```

**Behavior**: Uses `CERNION_TOKEN` from `.env` file.

### 3. JavaScript/TypeScript Client

```javascript
const API_BASE = 'http://localhost:3000/api';
const BEARER_TOKEN = 'your-custom-token';

async function getGridData(params) {
  const response = await fetch(`${API_BASE}/grid-operations/grid-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BEARER_TOKEN}`, // Optional
    },
    body: JSON.stringify(params),
  });

  return response.json();
}

// Use with Bearer token
const result = await getGridData({
  dataType: 'load',
  region: 'Bayern',
  date: '2026-02-01',
});
```

### 4. Python Client

```python
import requests

API_BASE = 'http://localhost:3000/api'
BEARER_TOKEN = 'your-custom-token'

def get_grid_data(params, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    response = requests.post(
        f'{API_BASE}/grid-operations/grid-data',
        headers=headers,
        json=params
    )
    return response.json()

# With custom token
result = get_grid_data({
    'dataType': 'load',
    'region': 'Bayern',
    'date': '2026-02-01'
}, token=BEARER_TOKEN)

# Without custom token (uses env CERNION_TOKEN)
result = get_grid_data({
    'dataType': 'load',
    'region': 'Bayern',
    'date': '2026-02-01'
})
```

## OpenAPI Documentation

The Bearer authentication is documented in the OpenAPI schema:

```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >
        Optional Cernion MCP token. If not provided, falls back to
        CERNION_TOKEN from environment.

security:
  - {}              # No authentication required (uses env fallback)
  - BearerAuth: []  # Optional Bearer token authentication
```

**Access OpenAPI docs**: http://localhost:3000/api/docs

## Implementation Details

### API Gateway (services/api.service.js)

Added `onBeforeCall` hook to extract Bearer token:

```javascript
onBeforeCall(ctx, route, req, res) {
  // Extract Bearer token from Authorization header if present
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    ctx.meta.cernionToken = token;
    this.logger.debug('Using Bearer token from request header');
  } else {
    this.logger.debug('No Bearer token provided, will use CERNION_TOKEN from environment');
  }
}
```

### MCP Client (src/mcp-client.js)

Updated `callWithNewSession` to accept optional token:

```javascript
static async callWithNewSession(toolName, params = {}, customToken = null) {
  const token = customToken || process.env.CERNION_TOKEN;
  if (!token) {
    return {
      success: false,
      error: {
        code: 'MISSING_TOKEN',
        message: 'CERNION_TOKEN environment variable not set and no custom token provided',
      },
    };
  }

  const client = new CernionMCPClient(token);
  try {
    await client.connect();
    const result = await client.callTool(toolName, params);
    return result;
  } finally {
    await client.disconnect();
  }
}
```

### Async Job Poller (src/async-job-poller.js)

Updated all polling functions to pass token through:

```javascript
async function callWithAutoPoll(toolName, params, pollOptions = {}, token = null) {
  // Call the MCP tool with optional token
  const response = await CernionMCPClient.callWithNewSession(toolName, params, token);

  const jobId = detectAsyncJob(response);

  if (jobId) {
    // Poll with same token
    const result = await pollJobUntilComplete(jobId, {
      ...pollOptions,
      token, // Pass token through to polling
      onStatusUpdate: (update) => {
        // ...
      },
    });
    return result;
  }

  return response;
}
```

### Service Handlers

All service handlers updated to pass `ctx.meta.cernionToken`:

**Example from grid-operations.service.js**:
```javascript
async handler(ctx) {
  return await callWithAutoPoll(
    'cernion_grid_data',
    ctx.params,
    {
      maxWaitTime: 12 * 60 * 1000,
      pollInterval: 3000,
    },
    ctx.meta.cernionToken  // Optional Bearer token from request
  );
}
```

**Updated services**:
- ✅ `grid-operations.service.js` (5 handlers)
- ✅ `business-intelligence.service.js` (4 handlers)
- ✅ `energy-market.service.js` (4 handlers)
- ✅ `gas-storage.service.js` (7 handlers)
- ✅ `system.service.js` (4 handlers)
- ✅ `customer-service.service.js` (3 handlers)
- ✅ `query.service.js` (2 handlers)
- ✅ `eic-codes.service.js` (5 handlers)
- ✅ `german-grid.service.js` (4 handlers)
- ✅ `entsoe.service.js` (9 handlers)

**Total**: 47 endpoints support Bearer token authentication

## Use Cases

### Multi-Tenant SaaS Platform

Different customers have their own Cernion quotas:

```javascript
// Customer A (1000 requests/month quota)
const customerAToken = 'cernion-token-customer-a';

// Customer B (5000 requests/month quota)
const customerBToken = 'cernion-token-customer-b';

// Route requests with appropriate token
app.post('/api/customer/:id/grid-data', async (req, res) => {
  const customer = await getCustomer(req.params.id);
  const token = customer.cernionToken;

  const result = await callCernionAPI({
    endpoint: '/grid-operations/grid-data',
    data: req.body,
    token: token,
  });

  res.json(result);
});
```

### User-Specific Authentication

Individual users authenticate with their own Cernion accounts:

```javascript
// User login flow
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  // Verify user credentials
  const user = await authenticateUser(email, password);

  // Store Cernion token in session
  req.session.cernionToken = user.cernionToken;

  res.json({ success: true });
});

// Protected API routes
app.post('/api/grid-operations/*', async (req, res) => {
  // Use user's Cernion token
  const token = req.session.cernionToken;

  // Forward request with user's token
  const result = await fetch(CERNION_API_URL + req.path, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(req.body),
  });

  res.json(await result.json());
});
```

### Development vs Production Environments

Use different tokens for testing and production:

```bash
# Development environment
export CERNION_TOKEN=dev-token-limited-quota

# Production environment
export CERNION_TOKEN=prod-token-unlimited-quota

# Override for specific requests (e.g., premium customer)
curl -X POST http://api/grid-operations/grid-data \
  -H "Authorization: Bearer premium-customer-token" \
  -d '...'
```

## Security Considerations

### Token Storage

- **Never commit tokens**: Add `.env` to `.gitignore`
- **Environment variables**: Store shared token in `.env` file
- **Secure storage**: Use secret managers (AWS Secrets Manager, HashiCorp Vault) for production
- **User tokens**: Store in secure session storage or encrypted database

### Token Validation

- **Backend validation**: Cernion MCP backend validates all tokens
- **Invalid tokens**: Return error response from MCP
- **No client-side validation**: API Gateway passes token through without validation

### Best Practices

1. **Rotate tokens regularly**: Update tokens every 90 days
2. **Monitor usage**: Track quota consumption per token
3. **Rate limiting**: Implement rate limiting per token at API Gateway level
4. **Audit logging**: Log token usage for compliance
5. **Least privilege**: Use tokens with minimum required permissions

## Error Handling

### Missing Token (No Bearer + No Environment)

**Request**:
```bash
# Remove CERNION_TOKEN from environment
unset CERNION_TOKEN

curl -X POST http://localhost:3000/api/grid-operations/grid-data \
  -d '{"dataType": "load", "region": "Bayern"}'
```

**Response**:
```json
{
  "success": false,
  "error": {
    "code": "MISSING_TOKEN",
    "message": "CERNION_TOKEN environment variable not set and no custom token provided"
  }
}
```

### Invalid Bearer Token

**Request**:
```bash
curl -X POST http://localhost:3000/api/grid-operations/grid-data \
  -H "Authorization: Bearer invalid-token-12345" \
  -d '{"dataType": "load", "region": "Bayern"}'
```

**Response** (from Cernion MCP):
```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Invalid or expired token"
  }
}
```

### Quota Exceeded

**Response** (from Cernion MCP):
```json
{
  "success": false,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Monthly request quota exceeded. Please upgrade your plan."
  }
}
```

## Monitoring and Debugging

### Console Logs

API Gateway logs token usage:

```
[API Gateway] Using Bearer token from request header
[API Gateway] No Bearer token provided, will use CERNION_TOKEN from environment
```

### Request Tracing

Enable verbose logging to see token flow:

```javascript
// moleculer.config.js
module.exports = {
  logger: {
    type: 'Console',
    options: {
      level: 'debug', // Shows token extraction logs
    },
  },
};
```

### Token Quota Monitoring

Track quota usage per token:

```javascript
// Middleware to log token usage
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  // Log token usage
  logTokenUsage({
    token: token || 'default',
    endpoint: req.path,
    timestamp: new Date(),
  });

  next();
});
```

## Testing

### Manual Testing

```bash
# Test with Bearer token
curl -X POST http://localhost:3000/api/system/status \
  -H "Authorization: Bearer $YOUR_CERNION_TOKEN"

# Test without Bearer token (uses env)
curl -X POST http://localhost:3000/api/system/status

# Test with invalid token
curl -X POST http://localhost:3000/api/system/status \
  -H "Authorization: Bearer invalid-token-xyz"
```

### Automated Testing

```javascript
describe('Bearer Token Authentication', () => {
  it('should use Bearer token when provided', async () => {
    const response = await request(app)
      .post('/api/grid-operations/grid-data')
      .set('Authorization', 'Bearer custom-token')
      .send({ dataType: 'load', region: 'Bayern' });

    expect(response.status).toBe(200);
    // Verify custom token was used (check logs or mock)
  });

  it('should fallback to env token when no Bearer', async () => {
    const response = await request(app)
      .post('/api/grid-operations/grid-data')
      .send({ dataType: 'load', region: 'Bayern' });

    expect(response.status).toBe(200);
    // Verify env token was used
  });
});
```

## Migration Guide

### Existing Deployments

**No breaking changes!** The feature is backward compatible:

1. **Without Bearer tokens**: Continues to work exactly as before using `CERNION_TOKEN` from `.env`
2. **With Bearer tokens**: New functionality, opt-in

### Enabling Bearer Authentication

**Step 1**: No code changes needed - feature is already active

**Step 2**: Update API clients to include Bearer token (optional):

```javascript
// Before (still works)
fetch('/api/grid-operations/grid-data', {
  method: 'POST',
  body: JSON.stringify(params),
});

// After (optional, for custom token)
fetch('/api/grid-operations/grid-data', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${customToken}`,
  },
  body: JSON.stringify(params),
});
```

## Related Documentation

- [MCP_TOOLS.md](MCP_TOOLS.md) - Available MCP tools
- [README.md](README.md) - Project overview

## Summary

✅ **Implemented**: Optional request-level token authentication
✅ **Backward compatible**: Falls back to `CERNION_TOKEN` from environment
✅ **Universal support**: All REST API endpoints support both Bearer and `token` parameter input
✅ **Async job polling**: Token passed through to job status/result checks
✅ **OpenAPI documented**: Bearer authentication documented in Swagger UI
✅ **Production ready**: No breaking changes, opt-in feature

**Impact**:
- Multi-tenant scenarios enabled
- User-specific quotas supported
- Flexible authentication strategy
- Zero impact on existing deployments
