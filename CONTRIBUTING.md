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
  async stopped() {}
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
2. Ensure all tests pass (when available)
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
├── services/          # Active microservices
├── templates/         # Service templates
├── cli.js             # CLI tool
├── create-service.js  # Service creator
├── index.js           # Main entry point
└── moleculer.config.js # Configuration
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
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

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
