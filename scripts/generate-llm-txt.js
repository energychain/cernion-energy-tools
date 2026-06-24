#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const {
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
} = require('../src/capability-catalog');
const { CANONICAL_DOMAINS, classifyAll } = require('../src/llm-manifest-taxonomy');

const ROOT = path.join(__dirname, '..');
const LLM_PATH = path.join(ROOT, 'llm.txt');
const OPENAPI_PATH = path.join(ROOT, 'openapi-export.json');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const README_PATH = path.join(ROOT, 'README.md');
const BACKEND_CONTEXT_PATH = path.join(ROOT, 'docs', 'BACKEND_CONTEXT.md');

const END_OF_AGENT_RELEVANT_MARKER = '--- END OF AGENT-RELEVANT CONTENT ---';

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashFile(filePath) {
  return hashText(readUtf8(filePath));
}

function splitLines(text) {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function sliceMarkdownSection(markdown, heading) {
  const lines = splitLines(markdown);
  const marker = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start === -1) return '';

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function latestReleaseHeading(changelogText) {
  const match = changelogText.match(/^## \[(?!Unreleased\])([^\]]+)\]/m);
  return match ? match[1] : 'unknown';
}

function truncateOneLine(text, maxLen) {
  const oneLine = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (oneLine.length <= maxLen) return oneLine;
  const cut = oneLine.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function summarizeOpenApi(spec) {
  const paths = Object.keys(spec.paths || {}).sort();
  const operations = [];

  for (const p of paths) {
    const pathItem = spec.paths[p] || {};
    for (const method of Object.keys(pathItem).sort()) {
      const op = pathItem[method] || {};
      operations.push({
        path: p,
        method: method.toUpperCase(),
        operationId: op.operationId || '',
        summary: op.summary || '',
        tags: Array.isArray(op.tags) ? op.tags : [],
      });
    }
  }

  return { pathCount: paths.length, operationCount: operations.length, operations };
}

// Groups operations sharing an operationId into one canonical entry (shortest,
// alphabetically-first path) — mirrors services/agent-manifest.service.js so the
// manifest's per-domain operation counts match what GET /_agent/operations returns.
function dedupeOperations(operations) {
  const byOperationId = new Map();
  for (const op of operations) {
    const key = op.operationId || `${op.method} ${op.path}`;
    if (!byOperationId.has(key)) byOperationId.set(key, []);
    byOperationId.get(key).push(op);
  }

  const result = [];
  for (const group of byOperationId.values()) {
    const sorted = group
      .slice()
      .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
    result.push(sorted[0]);
  }
  return result;
}

function renderDomainKnowledge(readme, backendContext) {
  const backendSections = [
    '## 8. KRITIS Compliance Constraints',
    '## 5. Async Job Pattern',
    '## 4. Finding Codes (92 total)',
  ];

  const selectedBackend = backendSections
    .map((heading) => {
      const marker = heading.replace(/^##\s+/, '');
      return sliceMarkdownSection(backendContext, marker);
    })
    .filter(Boolean)
    .join('\n\n');

  const readmeFeatures = sliceMarkdownSection(readme, 'Features');

  return [
    '## Domain-Specific Business Knowledge (Energy + Utility)',
    '',
    'This section captures implementation constraints and regulatory context that generic LLMs typically do not know.',
    '',
    '### From README Features',
    readmeFeatures || 'n/a',
    '',
    '### From Backend Context (KRITIS, Findings, Async jobs)',
    selectedBackend || 'n/a',
  ].join('\n');
}

function renderResolutionProtocol() {
  return [
    '## RESOLUTION PROTOCOL',
    '',
    'CLUSTER HEADS only below (capability ids, recipe ids, domain names) — no',
    'endpoints. Resolve a head before acting. Multiple reasoning hops (domain →',
    'resolve → item → resolve) are expected; do not guess endpoint shapes.',
    '',
    '- Vague intent → closest CAPABILITY id → GET /api/_agent/capabilities/<id>',
    '  (preferredActions, requiredInputs, risksAndNotes, keywords).',
    '- Known workflow → closest RECIPE id → GET /api/cookbook/<id>',
    '  (step-by-step service/action/restPath/params).',
    '- Raw operation surface for a domain → GET /api/_agent/operations?domain=<d>',
    '  (deduplicated operationId → canonical path + aliases).',
    '- Full OpenAPI contract (schemas/bodies) → openapi-export.json (repo root) or',
    '  GET /api/openapi.json. Not embedded here — would duplicate that file.',
  ].join('\n');
}

function renderClusterManifest(buckets) {
  const lines = ['## Cluster Manifest', ''];

  for (const domain of CANONICAL_DOMAINS) {
    const bucket = buckets[domain];
    const capabilityIds = bucket.capabilities
      .map((c) => c.capability)
      .sort()
      .join(', ');
    const recipeLines = bucket.recipes
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => `  ${r.id} "${truncateOneLine(r.problem, 65)}"`)
      .join('\n');
    const dedupedOps = dedupeOperations(bucket.operations);

    lines.push(
      `### ${domain} (${bucket.capabilities.length} capabilities · ${bucket.recipes.length} recipes · ${dedupedOps.length} operations)`,
      `capabilities: ${capabilityIds || '(none)'}`,
      'recipes:',
      recipeLines || '  (none)',
      `resolve: GET /api/_agent/operations?domain=${domain}`,
      ''
    );
  }

  return lines.join('\n').trim();
}

function regenerateOpenApiExport() {
  execSync('node scripts/export-openapi.js', {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENAPI_EXPORT_INCLUDE_TIMESTAMP: 'false',
    },
  });
}

function printDomainStats(buckets, unmapped) {
  console.log('[generate-llm-txt] Domain classification stats:');
  for (const domain of CANONICAL_DOMAINS) {
    const b = buckets[domain];
    console.log(
      `  ${domain.padEnd(16)} caps=${b.capabilities.length}  recipes=${b.recipes.length}  ops=${dedupeOperations(b.operations).length}`
    );
  }

  const unmappedTotal =
    unmapped.capabilities.length + unmapped.recipes.length + unmapped.operations.length;
  if (unmappedTotal > 0) {
    console.error(
      '[generate-llm-txt] UNMAPPED entries found (taxonomy gap, no silent loss allowed):'
    );
    if (unmapped.capabilities.length) {
      console.error('  capabilities:', unmapped.capabilities.join(', '));
    }
    if (unmapped.recipes.length) {
      console.error('  recipes:', unmapped.recipes.join(', '));
    }
    if (unmapped.operations.length) {
      console.error('  operations:', unmapped.operations.join(', '));
    }
    console.error(
      '[generate-llm-txt] Add the missing entries to src/llm-manifest-taxonomy.js and re-run.'
    );
  }
  return unmappedTotal;
}

function buildLlmTxt() {
  regenerateOpenApiExport();

  const packageJson = JSON.parse(readUtf8(path.join(ROOT, 'package.json')));
  const changelog = readUtf8(CHANGELOG_PATH);
  const readme = readUtf8(README_PATH);
  const backendContext = readUtf8(BACKEND_CONTEXT_PATH);
  const recipesModule = require(path.join(ROOT, 'src', 'cookbook-recipes'));
  const recipes = (recipesModule.COOKBOOK_RECIPES || [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const capabilities = [...CURATED_CAPABILITIES, INTERFACE_PLACEHOLDER_CAPABILITY];

  const openapiRaw = JSON.parse(readUtf8(OPENAPI_PATH));
  const openapiSummary = summarizeOpenApi(openapiRaw);

  const unreleased = sliceMarkdownSection(changelog, '[Unreleased]');
  const latestVersion = latestReleaseHeading(changelog);

  const { buckets, unmapped } = classifyAll({
    capabilities,
    recipes,
    operations: openapiSummary.operations,
  });
  const unmappedTotal = printDomainStats(buckets, unmapped);
  if (unmappedTotal > 0) {
    console.error(
      `[generate-llm-txt] ${unmappedTotal} unmapped entries — refusing to generate llm.txt.`
    );
    process.exit(1);
  }

  const agentRelevantLines = [
    '# LLM IMPLEMENTATION CONTEXT',
    '',
    '## Metadata',
    `- project: ${packageJson.name}`,
    `- version: ${packageJson.version}`,
    `- changelog_latest_release: ${latestVersion}`,
    '',
    '## Purpose',
    'This file is a navigation manifest for LLM/agent consumers. It lists cluster',
    'heads (capabilities, recipes, domains) — not endpoints — so a consuming agent',
    'can pick a cluster and resolve it to detail in a second call. See RESOLUTION',
    'PROTOCOL below.',
    '',
    renderResolutionProtocol(),
    '',
    renderDomainKnowledge(readme, backendContext),
    '',
    renderClusterManifest(buckets),
  ];

  const agentRelevantBody = `${agentRelevantLines.join('\n')}\n`;

  const nonAgentLines = [
    END_OF_AGENT_RELEVANT_MARKER,
    '',
    'Everything below is release/build provenance, not navigation content.',
    'Agents resolving capabilities/recipes/operations do not need to read past this point.',
    '',
    '## Release Provenance',
    '### Unreleased (from CHANGELOG)',
    unreleased || 'n/a',
    '',
    '## Source File Hashes',
    `- CHANGELOG.md: ${hashFile(CHANGELOG_PATH)}`,
    `- README.md: ${hashFile(README_PATH)}`,
    `- docs/BACKEND_CONTEXT.md: ${hashFile(BACKEND_CONTEXT_PATH)}`,
    `- src/cookbook-recipes.js: ${hashFile(path.join(ROOT, 'src', 'cookbook-recipes.js'))}`,
    `- src/capability-catalog.js: ${hashFile(path.join(ROOT, 'src', 'capability-catalog.js'))}`,
    `- openapi-export.json: ${hashFile(OPENAPI_PATH)}`,
    '',
    '## OpenAPI Surface (full contract, not embedded)',
    `- path_count: ${openapiSummary.pathCount}`,
    `- operation_count: ${openapiSummary.operationCount}`,
    '- full_spec: openapi-export.json (repo root) or GET /api/openapi.json',
  ];

  const nonAgentBody = `${nonAgentLines.join('\n')}\n`;

  const body = `${agentRelevantBody}\n${nonAgentBody}`;
  const digest = hashText(body);
  return {
    content: `${body}\n## Integrity\n- llm_txt_sha256: ${digest}\n`,
    agentRelevantBody,
  };
}

function writeIfChanged(filePath, nextContent) {
  const prev = fs.existsSync(filePath) ? readUtf8(filePath) : null;
  if (prev === nextContent) return false;
  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function runCheck(filePath, nextContent) {
  if (!fs.existsSync(filePath)) {
    console.error('[generate-llm-txt] llm.txt missing. Run: npm run generate:llm');
    process.exit(1);
  }

  const current = readUtf8(filePath);
  if (current !== nextContent) {
    console.error('[generate-llm-txt] llm.txt is outdated. Run: npm run generate:llm');
    process.exit(1);
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const { content } = buildLlmTxt();

  if (checkOnly) {
    runCheck(LLM_PATH, content);
    console.log('[generate-llm-txt] llm.txt is up-to-date');
    return;
  }

  const changed = writeIfChanged(LLM_PATH, content);
  if (changed) {
    console.log('[generate-llm-txt] Updated llm.txt');
  } else {
    console.log('[generate-llm-txt] llm.txt unchanged');
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildLlmTxt, END_OF_AGENT_RELEVANT_MARKER };
