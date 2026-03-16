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
- Meet coverage thresholds (v0.9.4: branches 55%, functions 70%,
  lines 70%, statements 70%)
- Current suite: 961 tests, 43 suites — all must pass after changes
- Acceptance fixtures in `tests/acceptance/` — do not modify

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

### Inhouse Data Layer (v0.9+)
- All inhouse datasource access MUST go through `datasource-cache.query`
- NEVER use `query.ask`, SQL actions, or database lookups for inhouse sources
- Inhouse sources are identified by sourceId in `inhouseSources` or
  `semanticHints.domain` in discovery descriptor
- Event payloads must remain lean — `datasource.inference.complete` carries
  only `{ sourceId, filename, description }`, never sampleRows
- `datasource-classifier` is stateless and fetches sample rows itself
- Semantic domains are defined in `src/semantic-domains.js`
- Classifier uses heuristic scoring only — no external AI calls in classif
- `src/period-normaliser.js` handles mixed period formats (e.g. `Jan 2026`, `2026-Q1`)
  for time-series joins
- `src/vnb-identity.js` resolves VNB identity automatically from env and datasource metadata
- `services/datasource-watcher.service.js` detects upload file changes and triggers
  datasource cache refresh
- LLM classifier fallback is opt-in via `CLASSIFIER_LLM_FALLBACK_ENABLED` and runs only
  for low-confidence unknown classifications

## Current Project Status (v0.9.4)

- Release `v0.9.4` is published and tagged.
- Datasource layer: registry, connector, cache, discovery, classifier
  (all in `services/datasource-*.service.js`)
- Semantic onboarding flow active — new sources are auto-classified
  after inference via `datasource.inference.complete` event
- CSV connector supports `encoding` (utf-8/latin1/windows-1252)
  and `skipRows` for metadata preamble rows
- Known limitations tracked for v0.9.5:
  - 37 non-blocking ESLint `no-unused-vars` warnings remain — tracked for cleanup
  - Jest open handles on test exit — likely `fs.watch` teardown in datasource-watcher,
    tracked for v0.9.5
- Release gate: `npm run release:check` (tests + OpenAPI + security)
- Known risk: `xlsx` high advisory — documented exception


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
