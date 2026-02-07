# Cernion Energy Tools

MicroService Agent System for Energy Markets

A modular, scalable microservices platform built with [Moleculer](https://moleculer.services/) for developing energy market applications with AI integration (Google Gemini) and MCP (Model Context Protocol) support.

## Features

- 🚀 **Moleculer Microservices Framework** - Fast, modern, and powerful microservices framework
- 🌐 **API Gateway** - HTTP REST API with automatic route generation
- 🤖 **AI Integration** - Google Gemini SDK support for AI-powered services
- 🔌 **MCP Support** - Model Context Protocol SDK integration
- 📝 **OpenAPI Documentation** - Automatic API documentation generation
- 🛠️ **CLI Tool** - Command-line interface for calling microservices
- 📦 **Service Templates** - Ready-to-use skeleton service template
- 🔄 **Hot Reload** - Automatic service reloading during development
- 🎯 **Best Practices** - ESLint, Prettier, and structured project layout

## Documentation

- [CHANGELOG.md](CHANGELOG.md) - Release notes and notable changes
- [MCP_TOOLS.md](MCP_TOOLS.md) - MCP tool reference
- [MCP_SERVICES.md](MCP_SERVICES.md) - Microservice-to-tool mapping
- [ASYNC_JOB_POLLING.md](ASYNC_JOB_POLLING.md) - Async job handling
- [BEARER_TOKEN_AUTHENTICATION.md](BEARER_TOKEN_AUTHENTICATION.md) - Auth guide
- [SECURITY.md](SECURITY.md) - Security policy and disclosure
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community guidelines

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/energychain/cernion-energy-tools.git
cd cernion-energy-tools

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env and add your API keys (optional)
nano .env
```

### Running the Services

```bash
# Start all services
npm start

# Or use development mode with hot reload
npm run dev
```

The API Gateway will start on `http://localhost:3000` by default.

### Using the CLI

```bash
# Call a microservice action
npm run cli -- skeleton.hello --name=John

# Process data
npm run cli -- skeleton.process --data="test" --options.uppercase=true

# Health check
npm run cli -- skeleton.health

# Get help
npm run cli -- --help
```

### Testing the API

Once services are running, you can test the API endpoints:

```bash
# Using curl
curl http://localhost:3000/api/skeleton/hello?name=World

# Using httpie
http GET http://localhost:3000/api/skeleton/hello name==World

# Using the CLI tool
npm run cli -- skeleton.hello --name=World
```

## Creating New Services

### Using the Service Creator

```bash
# Create a new service
npm run create -- my-service

# Or run interactively
npm run create
```

This will create a new service file in the `custom-services/` directory based on the skeleton template and generate tests in `custom-tests/`.

Custom services are meant for local extensions and are ignored by git by default. Core services shipped with the project remain in `services/`.

### Manual Service Creation

1. Copy the skeleton template:
   ```bash
  cp templates/skeleton.service.js custom-services/my-service.service.js
   ```

2. Edit the service:
   - Change the `name` property
   - Add your actions, events, and methods
   - Update OpenAPI documentation

3. Restart services:
   ```bash
   npm start
   ```

### Custom Services & Tests

- Custom services live in `custom-services/` and are loaded at startup.
- Custom tests live in `custom-tests/` and are excluded from release coverage.
- Run custom tests without global coverage thresholds:
  ```bash
  npm run test:custom -- my-service.service.test.js
  ```

If you enable live MCP integration tests in the creator, they are stored in `custom-tests/` and run separately. The default `npm test` run only covers core services.

## Project Structure

```
cernion-energy-tools/
├── services/           # Core microservices (release)
│   └── api.service.js  # API Gateway service
├── custom-services/    # Local/custom microservices (ignored by git)
├── custom-tests/       # Local/custom tests (ignored by git)
├── templates/          # Service templates
│   └── skeleton.service.js  # Skeleton service template
├── index.js            # Main entry point
├── cli.js              # CLI tool for calling services
├── create-service.js   # Service creation tool
├── moleculer.config.js # Moleculer configuration
├── .env.example        # Environment variables example
├── eslint.config.js    # ESLint configuration
├── jest.config.js      # Jest configuration
├── CHANGELOG.md        # Release notes
├── SECURITY.md         # Security policy
├── CODE_OF_CONDUCT.md  # Community guidelines
└── package.json        # Project dependencies
```

## Service Architecture

### Service Template Structure

Each service follows this structure:

```javascript
module.exports = {
  name: 'service-name',

  settings: {
    // Service-specific settings
  },

  actions: {
    // Service actions (endpoints)
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

Services use OpenAPI/JSDoc comments for automatic API documentation:

```javascript
/**
 * @openapi
 * /service/action:
 *   get:
 *     summary: Action description
 *     parameters:
 *       - name: param1
 *         in: query
 *         schema:
 *           type: string
 */
action: {
  rest: 'GET /action',
  params: {
    param1: { type: 'string' }
  },
  async handler(ctx) {
    // Action logic
  }
}
```

## Configuration

### Environment Variables

Edit `.env` file to configure:

- `PORT` - API Gateway port (default: 3000)
- `LOG_LEVEL` - Logging level (info, debug, warn, error)
- `NAMESPACE` - Moleculer namespace for service isolation
- `TRANSPORTER` - Message transporter (NATS, Redis, MQTT, etc.)
- `GEMINI_API_KEY` - Google Gemini API key
- `MCP_SERVER_URL` - MCP server URL
- `CERNION_TOKEN` - Cernion MCP token (request at https://cernion.de/ or by email: dev@stromdao.com)

### Moleculer Configuration

Edit `moleculer.config.js` to customize:

- Logger settings
- Transporter configuration
- Cacher settings
- Circuit breaker
- Metrics and tracing

## Available Scripts

- `npm start` - Start all services
- `npm run dev` - Start with hot reload and REPL
- `npm run cli` - Run CLI tool
- `npm run create` - Create new service from template
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run test:custom` - Run custom tests without global coverage thresholds

## Release Checklist

For open source releases:

1. Update version in package.json and OpenAPI info in services/api.service.js
2. Update CHANGELOG.md
3. Run tests: npm test
4. Run lint: npm run lint
5. Ensure custom-services/ and custom-tests/ are untracked (local only)
6. Ensure .env is not committed and no secrets are present
7. Commit, tag, and push release

## AI Integration

### Google Gemini

The skeleton service includes an example method for calling Google Gemini:

```javascript
const result = await this.callGemini('Your prompt here');
```

Make sure to set `GEMINI_API_KEY` in your `.env` file.

### MCP Support

The project includes the MCP SDK (`@modelcontextprotocol/sdk`) for integrating with Model Context Protocol services.

## Development

### Code Style

The project uses ESLint and Prettier for code quality:

```bash
# Lint code
npm run lint

# Auto-fix issues
npm run lint:fix

# Format code
npm run format
```

### Hot Reload

During development, use `npm run dev` for automatic service reloading when files change.

### REPL

The Moleculer REPL provides interactive debugging:

```
mol $ actions
mol $ call skeleton.hello --name World
mol $ events
mol $ nodes
```

## API Gateway

The API Gateway service (`services/api.service.js`) provides HTTP access to all microservices:

- **Base URL**: `http://localhost:3000/api`
- **API Docs**: `http://localhost:3000/api/docs`
- **Auto-generated routes**: All service actions are automatically exposed
- **REST mapping**: Actions with `rest` property get REST endpoints
- **Body parsers**: JSON and URL-encoded body parsing

### Example Endpoints

- `GET /api/skeleton/hello?name=World`
- `POST /api/skeleton/process` (with JSON body)
- `GET /api/skeleton/health`

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting and tests
5. Submit a pull request

## Versioning

This project follows [Semantic Versioning](https://semver.org/). See [CHANGELOG.md](CHANGELOG.md) for release history.

## Security

Please report security issues privately. See [SECURITY.md](SECURITY.md) for details.

## Code of Conduct

Please follow our community guidelines in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

This project is licensed under the GPL-3.0 License. See [LICENSE](LICENSE) for details.

## License

GPL-3.0 - See [LICENSE](LICENSE) file for details

## Support

For issues and questions:

- GitHub Issues: https://github.com/energychain/cernion-energy-tools/issues
- Documentation: Check the code comments and this README

## Acknowledgments

- [Moleculer](https://moleculer.services/) - Microservices framework
- [Google Gemini](https://ai.google.dev/) - AI integration
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol

## 📁 Project Structure

```
cernion-energy-tools/
├── .github/              # GitHub configuration and workflows
├── .vscode/             # VS Code workspace settings
├── config/              # Configuration files
├── docs/                # Documentation
├── examples/            # Example code and use cases
├── scripts/             # Build and deployment scripts
├── src/                 # Source code
├── tests/               # Test files
├── .editorconfig        # Editor configuration
├── .env.example         # Example environment variables
├── .gitignore          # Git ignore rules
├── eslint.config.js    # ESLint configuration
├── jest.config.js      # Jest testing configuration
├── LICENSE             # Apache 2.0 License
├── package.json        # Project dependencies and scripts
└── README.md           # This file
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## 📖 Documentation

For detailed documentation, please see the [docs](./docs) directory.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🔒 Security

Please see our [Security Policy](SECURITY.md) for reporting security vulnerabilities.

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 💬 Support

- 📧 Create an issue for bug reports or feature requests
- 💡 Contribute to discussions in GitHub Discussions

## 🙏 Acknowledgments

- Energy Chain for project sponsorship
- Open source community for tools and libraries

---

Made with ❤️ by the Cernion team

