# GitHub Copilot Instructions for Cernion Energy Tools

## Project Overview
This is a MicroService Agent System for Energy Markets built with Moleculer. It wraps the Cernion MCP server and exposes MCP tools as REST endpoints via an API Gateway.

### Key Implementation Facts
- Services live in `services/` and are loaded by Moleculer at runtime.
- MCP calls are centralized in `src/mcp-client.js` and used by services.
- Long-running tools use `src/async-job-poller.js` (`callWithAutoPoll`).
- REST endpoints are declared with `rest` in each action and documented via OpenAPI.
- API Gateway is `services/api.service.js` with OpenAPI at `/api/openapi.json` and Swagger UI at `/api/docs`.

## Coding Guidelines

### General Principles
- Follow clean code principles and SOLID design patterns
- Write self-documenting code with clear variable and function names
- Prioritize readability and maintainability over cleverness
- Use async/await for asynchronous operations instead of callbacks
- Handle errors explicitly and provide meaningful error messages

### Code Style
- Use 2 spaces for indentation
- Use ES6+ modern JavaScript features
- Use descriptive variable names (camelCase for variables, PascalCase for classes)
- Keep functions small and focused (single responsibility)
- Add JSDoc comments for public APIs and complex functions
- Include unit tests for all business logic

### Architecture Guidelines
- Follow microservice architecture patterns
- Each service should be independently deployable
- Use RESTful API design principles
- Implement proper error handling and logging
- Use environment variables for configuration
- Follow 12-factor app methodology

### Security Best Practices
- Never commit sensitive data (API keys, passwords, tokens)
- Use environment variables for secrets
- Validate and sanitize all inputs
- Implement proper authentication and authorization
- Follow OWASP security guidelines

### Testing Guidelines
- Write unit tests for all business logic
- Use Jest as the testing framework
- Meet the current staged global coverage thresholds in `jest.config.js` (v0.8.32: branches 55%, functions 70%, lines 70%, statements 70%)
- Write integration tests for API endpoints
- Use meaningful test descriptions
- Mock MCP network calls in tests (use `jest.mock('../src/mcp-client')`)

### Documentation
- Update README.md with any significant changes
- Document API endpoints with examples
- Include inline comments for complex logic
- Keep documentation up-to-date with code changes

## Project-Specific Context

### Energy Market Domain
- Understand energy market operations and terminology
- Consider time-series data handling for energy consumption/production
- Implement proper data validation for market transactions
- Handle currency and unit conversions carefully

### Microservice Communication
- Use RESTful APIs for synchronous communication
- Consider message queues for asynchronous operations
- Implement proper service discovery mechanisms
- Use correlation IDs for distributed tracing

## File Organization
- `/src` - Source code for microservices
- `/tests` - Test files (unit and integration)
- `/docs` - Documentation files
- `/config` - Configuration files
- `/scripts` - Build and deployment scripts

## Common Patterns to Follow
- Use dependency injection for better testability
- Implement proper logging with structured logs
- Use configuration management for different environments
- Follow semantic versioning for releases

## Current Project Status (v0.8.32)

- Release `v0.8.32` is published and tagged.
- Consolidated release gate is available via `npm run release:check`.
- OpenAPI quality gate is enforced via `npm run audit:openapi` (must return 0 issues).
- Security scanning is split into:
	- Blocking critical gate: `npm run audit:security`
	- Advisory high+ report: `npm run audit:security:advisory`
- Known risk: `xlsx` has an upstream high advisory with no fix currently available; treat as documented exception and keep monitoring.
- API token policy: both Bearer auth and token query/body/path parameter usage are supported for compatibility.
- Operational hardening is in place:
	- Env-driven reliability/observability toggles in `moleculer.config.js`
	- Redacted/sanitized error handling in API and MCP client layers
	- Debug-gated async poller logging controls in `.env.example`

## Release Process (0.x)

1. Update version in `package.json` and OpenAPI version in `services/api.service.js`.
2. Update `CHANGELOG.md` with release notes.
3. Run release gate: `npm run release:check` (tests + OpenAPI + critical security).
4. Ensure no secrets are present (`.env` must not be committed).
5. Commit changes: `git add -A && git commit -m "chore: prepare X.Y.Z release"`.
6. Tag release: `git tag vX.Y.Z`.
7. Push: `git push && git push --tags`.

Notes:
- Advisory scan (`npm run audit:security:advisory`) may fail on known, documented upstream vulnerabilities; review before release.
- Do not store tokens or API keys in the repository; use `.env.example` only.

## What NOT to Do
- Don't use `var` - use `const` or `let`
- Don't ignore errors or use empty catch blocks
- Don't hardcode configuration values
- Don't write functions longer than 50 lines
- Don't commit commented-out code
- Don't use abbreviations in variable names unless widely understood
