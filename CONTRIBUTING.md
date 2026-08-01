# Contributing to Cernion Energy Tools

Thank you for your interest in contributing to Cernion Energy Tools! This document provides guidelines for contributing to the project.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help maintain a welcoming environment

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/cernion-energy-tools.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Workflow

### Running the Project

```bash
# Start all services
npm start

# Development mode with hot reload
npm run dev

# Run CLI tool
npm run cli -- v1.service.action --param=value
```

### Code Quality

Before submitting a pull request:

```bash
# Run linter
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

## Creating New Services

Use the service creator tool:

```bash
npm run create -- my-service
```

Or manually copy the skeleton template:

```bash
cp templates/skeleton.service.js services/my-service.service.js
```

### Reuse shared utilities before writing new ones

The most common source of duplication in this codebase (and the biggest
maintenance cost when an agent or contributor is working in it) has been the
same helper getting hand-copied into a new service instead of reused. Before
writing new logic, check whether it already exists:

- **PouchDB-backed persistence** → `src/pouchdb-lifecycle-mixin.js`'s
  `createPouchDbLifecycleMixin({ dbPathEnvVar, defaultDbPath, indexes })` via
  `mixins: [...]`. Used by 60+ services (see `services/company.service.js`
  for a minimal example). Do not hand-write
  `settings.dbPath` / `created()` / `async started()` / `async stopped()`.
- **Calling an LLM** (Gemini/OpenAI-compatible/Ollama) → `src/llm-client.js`
  (`generateText`/`generateStructured`/`generateChat`/`embeddings`/
  `generateImage`). Never call a provider SDK directly — only this facade
  applies PII scrubbing, quota enforcement, tracing and retries.
- **HTTP request classification** (read vs. write, sidecar/runbook
  exceptions) → `src/gateway-request-classifiers.js`.
- When unsure whether something already exists, grep `src/` for the concept
  first (e.g. `grep -rl "keyword" src/`) before adding a new helper.

### Service Structure

Each service should follow this structure:

```javascript
module.exports = {
  name: 'service-name',
  version: 1,

  settings: {
    // Service settings
  },

  actions: {
    // Service actions with OpenAPI docs
  },

  events: {
    // Event handlers
  },

  methods: {
    // Internal methods
  },

  created() {},
  async started() {},
  async stopped() {},
};
```

### OpenAPI Documentation

Add OpenAPI documentation to your actions:

```javascript
/**
 * @openapi
 * /service/action:
 *   get:
 *     summary: Action description
 *     tags:
 *       - Service
 *     parameters:
 *       - name: param1
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
action: {
  rest: 'GET /action',
  params: {
    param1: { type: 'string' }
  },
  async handler(ctx) {
    // Implementation
  }
}
```

## Commit Guidelines

### Commit Messages

Follow these conventions:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Example:

```
feat: add energy consumption prediction service

- Implements ML-based prediction
- Integrates with Gemini AI
- Adds REST API endpoints
```

## Pull Request Process

1. Update documentation if needed
2. Ensure all tests pass: `npm test`
3. Run linter and fix any issues
4. Update README.md if adding new features
5. Submit PR with clear description

### PR Description Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Tested locally
- [ ] Added/updated tests (if applicable)
- [ ] All linters pass

## Related Issues

Fixes #(issue number)
```

## Project Structure

```
cernion-energy-tools/
├── services/              # Core microservices (run `ls services/*.service.js | wc -l` for current count)
│   ├── api.service.js     # API Gateway + Swagger UI
│   ├── agent.service.js   # AI agent — plan/execute/export
│   ├── assets.service.js  # MaStR installation assets
│   ├── datapoint.service.js # Named datapoints with PouchDB
│   ├── osm-geo.service.js # OSM geo layer (v0.10)
│   ├── oep.service.js     # Open Energy Platform connector (v0.12)
│   └── ...                # See services/ for full list
├── src/
│   ├── app.html           # Research Web App (single-page)
│   ├── mcp-client.js      # Centralised MCP tool caller
│   ├── async-job-poller.js # Async job polling
│   ├── prompt-scrubber.js # PII masking for LLM prompts
│   ├── oeo-mappings.js    # OEO class mappings (~150 entries)
│   ├── oemetadata-builder.js # OEMetadata v2.0 builder
│   └── connectors/        # Built-in datasource connector plugins
├── custom-services/       # Local/custom services (git-ignored)
├── custom-tests/          # Local/custom tests (git-ignored)
├── templates/
│   └── skeleton.service.js
├── tests/                 # Core test suite (~1 400 tests)
├── scripts/               # Build, audit, and sync scripts
├── docs/                  # Documentation and use-case files
├── uploads/               # User-uploaded inhouse datasets (git-ignored)
├── index.js               # Main entry point
├── cli.js                 # CLI tool
├── create-service.js      # Interactive service creator
├── moleculer.config.js    # Moleculer configuration
├── .env.example           # Environment variables template
└── package.json
```

## Testing

### Manual Testing

Test your service:

```bash
# Start services
npm start

# Test via HTTP
curl http://localhost:3000/api/v1/yourservice/action

# Test via CLI
npm run cli -- v1.yourservice.action --param=value
```

## Best Practices

### Service Development

- Keep services small and focused
- Use proper error handling
- Add comprehensive logging
- Document all public actions
- Use parameter validation

### Code Style

- Use meaningful variable names
- Add comments for complex logic
- Follow existing code patterns
- Keep functions small and focused

### Performance

- Avoid blocking operations
- Use async/await properly
- Implement caching when appropriate
- Monitor resource usage

## Environment Variables

Create a `.env` file (never commit this):

```bash
cp .env.example .env
```

Add your configuration:

- API keys
- Service URLs
- Feature flags

## Integration with AI Services

### Google Gemini

To use Gemini AI in your service:

```javascript
async callGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    this.logger.warn('GEMINI_API_KEY not set');
    return null;
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-3-pro-preview' });

  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

### MCP Integration

Use the MCP SDK for Model Context Protocol integration:

```javascript
const { MCPClient } = require('@modelcontextprotocol/sdk');
// Your MCP integration code
```

## Getting Help

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Provide detailed information and examples

## License

By contributing, you agree that your contributions will be licensed under the GPL-3.0 License.
