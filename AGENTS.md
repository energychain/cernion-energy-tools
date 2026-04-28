<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cernion-energy-tools** (9515 symbols, 11393 relationships, 161 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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
| Work in the Services area (196 symbols) | `.claude/skills/generated/services/SKILL.md` |
| Work in the Cluster_89 area (48 symbols) | `.claude/skills/generated/cluster-89/SKILL.md` |
| Work in the Scripts area (36 symbols) | `.claude/skills/generated/scripts/SKILL.md` |
| Work in the Cluster_113 area (13 symbols) | `.claude/skills/generated/cluster-113/SKILL.md` |
| Work in the Tests area (13 symbols) | `.claude/skills/generated/tests/SKILL.md` |
| Work in the Cluster_2 area (12 symbols) | `.claude/skills/generated/cluster-2/SKILL.md` |
| Work in the Cluster_120 area (12 symbols) | `.claude/skills/generated/cluster-120/SKILL.md` |
| Work in the Cluster_127 area (11 symbols) | `.claude/skills/generated/cluster-127/SKILL.md` |
| Work in the Cluster_85 area (10 symbols) | `.claude/skills/generated/cluster-85/SKILL.md` |
| Work in the Cluster_122 area (10 symbols) | `.claude/skills/generated/cluster-122/SKILL.md` |
| Work in the Cluster_150 area (10 symbols) | `.claude/skills/generated/cluster-150/SKILL.md` |
| Work in the Cluster_82 area (9 symbols) | `.claude/skills/generated/cluster-82/SKILL.md` |
| Work in the Cluster_95 area (9 symbols) | `.claude/skills/generated/cluster-95/SKILL.md` |
| Work in the Cluster_143 area (9 symbols) | `.claude/skills/generated/cluster-143/SKILL.md` |
| Work in the Cluster_69 area (8 symbols) | `.claude/skills/generated/cluster-69/SKILL.md` |
| Work in the Cluster_110 area (8 symbols) | `.claude/skills/generated/cluster-110/SKILL.md` |
| Work in the Cluster_138 area (8 symbols) | `.claude/skills/generated/cluster-138/SKILL.md` |
| Work in the Cluster_144 area (8 symbols) | `.claude/skills/generated/cluster-144/SKILL.md` |
| Work in the Cluster_159 area (8 symbols) | `.claude/skills/generated/cluster-159/SKILL.md` |
| Work in the Connectors area (8 symbols) | `.claude/skills/generated/connectors/SKILL.md` |

<!-- gitnexus:end -->
