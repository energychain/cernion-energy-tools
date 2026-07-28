# Project-Specific Conventions

Before writing new logic in `services/` or `src/`, check whether it already
exists as a shared utility — the biggest recurring maintainability problem
in this codebase has been the same helper getting hand-copied into a new
service instead of reused (see CHANGELOG.md's duplication-cleanup entries
for the history). In particular:

- **PouchDB-backed persistence** → `src/pouchdb-lifecycle-mixin.js`'s
  `createPouchDbLifecycleMixin({ dbPathEnvVar, defaultDbPath, indexes })` via
  `mixins: [...]`, not hand-written `settings.dbPath` / `created()` /
  `async started()` / `async stopped()`. Used by 60+ services — see
  `services/company.service.js` for a minimal example, `services/hitl.service.js`
  for one that also keeps its own extra `started()`/`stopped()` logic
  alongside the mixin (Moleculer chains `created`/`started` mixin-first,
  `stopped` service-first, so the extra logic runs at the correct point).
  If a service needs to close a PouchDB handle it does _not_ own exclusively
  (a path also opened by other services), do not add it to the mixin's
  auto-close lifecycle — closing one handle to a shared PouchDB path hangs
  sibling handles onto the same path.
- **Calling an LLM** (Gemini/OpenAI-compatible/Ollama) → `src/llm-client.js`
  (`generateText`/`generateStructured`/`generateChat`/`embeddings`/
  `generateImage`), never a provider SDK directly — only this facade applies
  PII scrubbing, quota enforcement, tracing and retries.
- **HTTP request classification** (read vs. write, sidecar/runbook
  exceptions) → `src/gateway-request-classifiers.js`.
- When unsure, `grep -rl "keyword" src/` before adding a new helper.

CONTRIBUTING.md has more detail. `templates/skeleton.service.js` (the base
for `npm run create` and manual `cp` scaffolding) also documents these.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cernion-energy-tools** (13347 symbols, 26472 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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

| Resource                                              | Use for                                  |
| ----------------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/cernion-energy-tools/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/cernion-energy-tools/clusters`       | All functional areas                     |
| `gitnexus://repo/cernion-energy-tools/processes`      | All execution flows                      |
| `gitnexus://repo/cernion-energy-tools/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
