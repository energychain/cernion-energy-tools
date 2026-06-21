# Cernion Energy Tools — Agent Guide

MicroService Agent System for Energy Markets. Moleculer + CommonJS + Node.js 22+.

## Quick start

```bash
npm install                          # install dependencies
cp .env.example .env                 # configure CERNION_TOKEN, LLM_PROVIDER, LLM_MODEL
npm run dev                          # hot-reload mode with REPL
npm start                            # production start (port 3000)
```

## Key commands

| Command | What |
|---------|------|
| `npm test` | All Jest tests with coverage (serial, `--experimental-vm-modules`) |
| `npm run test:unit` | Unit tests only (no integration) |
| `npm run test:unit:ci` | CI variant (`--runInBand --forceExit`) |
| `npm run test:tdd-matrix` | TDD matrix parser + generated tests |
| `npm run test:integration` | Integration tests (need real `CERNION_TOKEN`) |
| `npm run test:custom` | Custom service tests |
| `npm run test:watch` | Watch mode |
| `npm run lint` | ESLint (flat config, ES2022, CommonJS) |
| `npm run format` | Prettier (semi, singleQuote, trailingComma es5, printWidth 100) |
| `npm run lint:hygiene` | SonarJS + security audit → `feedback/eslint-findings.txt` |
| `npm run release:check` | Full release gate: `test:unit:ci → test:tdd-matrix → check:tdd-matrix-coverage → audit:openapi → check:llm → audit:security` |
| `npm run audit:openapi` | OpenAPI coverage/completeness |
| `npm run generate:llm` | Generate `llm.txt` context file |
| `npm run check:llm` | Verify `llm.txt` is in sync (--check mode) |
| `npm run create` | AI-assisted service generator from `templates/` |
| `npm run build` | No-op — no build step |

## Testing quirks

- Jest runs **serially** (`maxWorkers: 1`) — MCP sessions conflict if parallel
- Coverage gates: branches 60%, functions 75%, lines 75%, statements 75%
- **Integration tests** (`*.integration.test.js`) require a real `CERNION_TOKEN` and running MCP server — excluded from `test:unit`
- **TDD matrix** tests have a **hard 100% coverage gate** (`check:tdd-matrix-coverage` script) required for CI and release
- `console.log`/`.info`/`.error` etc. are **mocked** in `tests/setup.js` — writes go to `jest.fn()` but output is suppressed
- Custom services have their own test dir `custom-tests/`, run via `npm run test:custom`
- OpenAPI export (`openapi-export.json`) and `llm.txt` must be regenerated when services change

## Architecture essentials

- **Single-process Moleculer broker** — all 76 services in `services/` plus optional `custom-services/` load into one Node.js process via in-process transport
- `index.js` — entrypoint: creates broker, loads all `*.service.js` from both dirs, starts
- `services/api.service.js` — API gateway, REST on port 3000, Swagger UI at `/api/docs`
- `src/` — shared libraries (LLM client, MCP client, connectors, auth, EDM, CYA agent, personal agent, etc.)
- `src/mcp-client.js` — MCP SDK client with streaming HTTP transport (connects to external Cernion MCP Server)
- `src/llm-client.js` — multi-provider LLM client (gemini / openai-compat / ollama) with PII scrubbing
- Persistence via **PouchDB** databases under `data/` and various `.pouchdb-paths` (per-service DBs)
- No TypeScript, no build step, no bundler

## Code conventions

- CommonJS (`require`/`module.exports`), ES2022
- Service files: `*.service.js` (e.g. `assets.service.js`)
- Test files: `*.test.js` (unit), `*.integration.test.js` (integration)
- ESLint: flat config `eslint.config.js` — `no-unused-vars: warn` (prefix unused params with `_`), prettier plugin
- Prettier: 2-space indent, single quotes, trailing commas where valid, 100 col width
- `.editorconfig`: UTF-8, LF line endings
- Generated files (`*.generated.test.js`, `llm.txt`, `openapi-export.json`) — regenerate after changes

## CI flow (in order)

```
npm run lint
npm run build                    # no-op, but must pass
npm run test:unit:ci             # unit tests + coverage gates
npm run test:tdd-matrix          # TDD matrix tests
npm run check:tdd-matrix-coverage
npm run audit:openapi
npm run check:llm                # if CHANGELOG.md changed
```

## Documentation

| File | What |
|------|------|
| `README.md` | German overview, setup, API table |
| `QUICKSTART.md` | English setup guide |
| `docs/ARCHITECTURE.md` | Full layered architecture (317 lines) |
| `docs/CYA_ARCHITECTURE.md` | CYA agent pipeline |
| `MCP_TOOLS.md` | MCP tool reference (53 KB) |
| `BEARER_TOKEN_AUTHENTICATION.md` | Auth guide (16 KB) |
| `MCP_SERVICES.md` | MCP service reference |
| `.env.example` | All 199 env vars with descriptions |

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cernion-energy-tools** (12588 symbols, 25957 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/cernion-energy-tools/context` | Codebase overview, check index freshness |
| `gitnexus://repo/cernion-energy-tools/clusters` | All functional areas |
| `gitnexus://repo/cernion-energy-tools/processes` | All execution flows |
| `gitnexus://repo/cernion-energy-tools/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
