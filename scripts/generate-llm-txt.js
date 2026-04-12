#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LLM_PATH = path.join(ROOT, 'llm.txt');
const OPENAPI_PATH = path.join(ROOT, 'openapi-export.json');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const README_PATH = path.join(ROOT, 'README.md');
const BACKEND_CONTEXT_PATH = path.join(ROOT, 'docs', 'BACKEND_CONTEXT.md');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashFile(filePath) {
  return hashText(readUtf8(filePath));
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const sorted = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    sorted[key] = sortDeep(value[key]);
  }
  return sorted;
}

function stableJson(value) {
  return JSON.stringify(sortDeep(value), null, 2);
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

function sanitizeOpenApi(spec) {
  const clone = JSON.parse(JSON.stringify(spec));
  delete clone['x-generated-at'];
  return clone;
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

  const tagMap = new Map();
  for (const op of operations) {
    for (const tag of op.tags) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }

  const tags = Array.from(tagMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  return {
    pathCount: paths.length,
    operationCount: operations.length,
    tags,
    operations,
  };
}

function formatOpenApiOperation(op) {
  const tagText = op.tags.length > 0 ? op.tags.join(', ') : 'none';
  return `- ${op.method} ${op.path} | tags: [${tagText}] | operationId: ${op.operationId} | summary: ${op.summary}`;
}

function formatCookbookRecipe(recipe) {
  const tags = Array.isArray(recipe.tags) ? recipe.tags.join(', ') : '';
  const prerequisites = Array.isArray(recipe.prerequisites)
    ? recipe.prerequisites.join(' | ')
    : 'none';

  const steps = (Array.isArray(recipe.process) ? recipe.process : [])
    .slice()
    .sort((a, b) => (a.step || 0) - (b.step || 0))
    .map((step) => {
      const params = step.params ? stableJson(step.params).replace(/\n/g, ' ') : '{}';
      return `  - step ${step.step}: ${step.service}.${step.action} | rest: ${step.restPath || 'n/a'} | params: ${params}`;
    })
    .join('\n');

  return [
    `### Recipe: ${recipe.id}`,
    `title: ${recipe.title}`,
    `domain: ${recipe.domain}`,
    `deprecated: ${Boolean(recipe.deprecated)}`,
    `tags: ${tags}`,
    `problem: ${recipe.problem}`,
    `expectedResult: ${recipe.expectedResult}`,
    `prerequisites: ${prerequisites}`,
    'process:',
    steps,
  ].join('\n');
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

  const openapiRaw = JSON.parse(readUtf8(OPENAPI_PATH));
  const openapi = sanitizeOpenApi(openapiRaw);
  const openapiSummary = summarizeOpenApi(openapi);

  const unreleased = sliceMarkdownSection(changelog, '[Unreleased]');
  const latestVersion = latestReleaseHeading(changelog);

  const cookbookDomains = recipes.reduce((acc, recipe) => {
    const key = recipe.domain || 'unknown';
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  const cookbookDomainLines = Array.from(cookbookDomains.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([domain, count]) => `- ${domain}: ${count}`)
    .join('\n');

  const recipesRendered = recipes.map(formatCookbookRecipe).join('\n\n');
  const operationsRendered = openapiSummary.operations.map(formatOpenApiOperation).join('\n');
  const tagsRendered = openapiSummary.tags
    .map((item) => `- ${item.name}: ${item.count} operations`)
    .join('\n');

  const openApiCanonicalJson = stableJson(openapi);

  const lines = [
    '# LLM IMPLEMENTATION CONTEXT',
    '',
    '## Metadata',
    `- project: ${packageJson.name}`,
    `- version: ${packageJson.version}`,
    `- changelog_latest_release: ${latestVersion}`,
    `- source_files_hash:`,
    `  - CHANGELOG.md: ${hashFile(CHANGELOG_PATH)}`,
    `  - README.md: ${hashFile(README_PATH)}`,
    `  - docs/BACKEND_CONTEXT.md: ${hashFile(BACKEND_CONTEXT_PATH)}`,
    `  - src/cookbook-recipes.js: ${hashFile(path.join(ROOT, 'src', 'cookbook-recipes.js'))}`,
    `  - openapi-export.json: ${hashFile(OPENAPI_PATH)}`,
    '',
    '## Purpose',
    'This file is generated for LLM consumption and release-time context transfer.',
    'It provides a complete implementation picture: architecture, domain knowledge, cookbook recipes, and OpenAPI surface.',
    '',
    '## Release Provenance',
    '### Unreleased (from CHANGELOG)',
    unreleased || 'n/a',
    '',
    renderDomainKnowledge(readme, backendContext),
    '',
    '## Cookbook Summary',
    `- total_recipes: ${recipes.length}`,
    '- recipes_by_domain:',
    cookbookDomainLines || 'n/a',
    '',
    '## Cookbook Recipes (Complete)',
    recipesRendered,
    '',
    '## OpenAPI Summary',
    `- path_count: ${openapiSummary.pathCount}`,
    `- operation_count: ${openapiSummary.operationCount}`,
    '- operations_by_tag:',
    tagsRendered || 'n/a',
    '',
    '## OpenAPI Operations (Complete Index)',
    operationsRendered,
    '',
    '## OpenAPI Canonical JSON (Complete)',
    openApiCanonicalJson,
  ];

  const body = `${lines.join('\n')}\n`;
  const digest = hashText(body);
  return `${body}\n## Integrity\n- llm_txt_sha256: ${digest}\n`;
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
  const content = buildLlmTxt();

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

main();
