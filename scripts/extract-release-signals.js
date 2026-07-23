#!/usr/bin/env node
'use strict';

/**
 * Read-only release signal extractor.
 *
 * Reads CHANGELOG.md plus a local OpenAPI export and emits neutral raw signals for later
 * human/agent publication workflows. This script intentionally writes no files and performs
 * no GitHub, website, Kanban, deployment, or publication actions.
 *
 * Usage:
 *   node scripts/extract-release-signals.js
 *   node scripts/extract-release-signals.js --format=markdown --limit=10
 *   node scripts/extract-release-signals.js --changelog=CHANGELOG.md --openapi=openapi-export.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const DEFAULT_OPENAPI_PATH = path.join(ROOT, 'openapi-export.json');
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const DEFAULT_LIMIT = 50;

class InputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InputError';
    this.code = code;
  }
}

function readUtf8File(filePath, label) {
  const resolved = path.resolve(filePath);
  try {
    return fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new InputError('MISSING_FILE', `${label} not found: ${resolved}`);
    }
    throw new InputError('READ_FAILED', `${label} could not be read: ${resolved} (${err.message})`);
  }
}

function readJsonFile(filePath, label) {
  const raw = readUtf8File(filePath, label);
  try {
    return JSON.parse(raw);
  } catch {
    throw new InputError('INVALID_JSON', `${label} is not valid JSON: ${path.resolve(filePath)}`);
  }
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_#[\](){}:;,.!?/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength = 260) {
  const compact = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trim()}…`;
}

function splitTokenSet(value) {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9äöüß-]+/)
      .filter((token) => token.length >= 4)
  );
}

function parseChangelogEntries(markdown) {
  const entries = [];
  let currentRelease = 'Unreleased';
  let currentDate = null;
  let currentSection = 'Changed';
  let currentEntry = null;

  const flush = () => {
    if (!currentEntry) return;
    const text = currentEntry.lines.join('\n').trim();
    entries.push({
      release: currentEntry.release,
      releaseDate: currentEntry.releaseDate,
      section: currentEntry.section,
      title: extractEntryTitle(text),
      text,
      issueRefs: Array.from(text.matchAll(/#(\d+)/g)).map((match) => `#${match[1]}`),
      endpointRefs: extractEndpointRefs(text),
      pathRefs: extractPathRefs(text),
    });
    currentEntry = null;
  };

  for (const line of String(markdown || '').split(/\r?\n/)) {
    const releaseMatch = line.match(/^##\s+(?:\[([^\]]+)\]|(Unreleased))(?:\s+[—-]\s+(.+))?/i);
    if (releaseMatch) {
      flush();
      currentRelease = releaseMatch[1] || releaseMatch[2] || 'Unreleased';
      currentDate = releaseMatch[3] ? releaseMatch[3].trim() : null;
      currentSection = 'Changed';
      continue;
    }

    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      flush();
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (/^-\s+/.test(line)) {
      flush();
      currentEntry = {
        release: currentRelease,
        releaseDate: currentDate,
        section: currentSection,
        lines: [line.replace(/^-\s+/, '').trim()],
      };
      continue;
    }

    if (currentEntry && /^\s{2,}-\s+/.test(line)) {
      currentEntry.lines.push(line.trim());
    }
  }

  flush();
  return entries;
}

function extractEntryTitle(text) {
  const boldMatch = String(text || '').match(/^\*\*([^*]+)\*\*/);
  if (boldMatch) return boldMatch[1].replace(/`/g, '').trim();
  return truncateText(
    String(text || '')
      .split(':')[0]
      .replace(/`/g, ''),
    140
  );
}

function extractEndpointRefs(text) {
  const refs = [];
  const regex = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/api\/[\w./:{}-]+)/gi;
  for (const match of String(text || '').matchAll(regex)) {
    refs.push(`${match[1].toUpperCase()} ${match[2].replace(/[),.;]+$/, '')}`);
  }
  return Array.from(new Set(refs));
}

function extractPathRefs(text) {
  const refs = [];
  const regex = /(?:`|\b)(\/api\/[\w./:{}-]+)(?:`|\b)/g;
  for (const match of String(text || '').matchAll(regex)) {
    refs.push(match[1].replace(/[),.;]+$/, ''));
  }
  return Array.from(new Set(refs));
}

function extractOpenApiOperations(spec) {
  if (!spec || typeof spec !== 'object' || !spec.paths || typeof spec.paths !== 'object') {
    throw new InputError('INVALID_OPENAPI', 'OpenAPI document must contain a paths object.');
  }

  const operations = [];
  for (const [apiPath, pathItem] of Object.entries(spec.paths).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      const lowerMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(lowerMethod)) continue;
      const op = operation && typeof operation === 'object' ? operation : {};
      const tags = Array.isArray(op.tags) ? op.tags.filter(Boolean) : [];
      operations.push({
        method: lowerMethod.toUpperCase(),
        path: apiPath,
        operationId: op.operationId || `${lowerMethod.toUpperCase()}_${apiPath}`,
        service: inferServiceName(apiPath, op, tags),
        tags,
        summary: op.summary || '',
        description: op.description || '',
      });
    }
  }
  return operations;
}

function inferServiceName(apiPath, operation, tags) {
  if (tags.length > 0) return tags[0];
  if (operation && operation.operationId && operation.operationId.includes('_')) {
    return operation.operationId.split('_')[0];
  }
  const parts = String(apiPath || '')
    .split('/')
    .filter(Boolean);
  return parts[1] || 'unmapped';
}

function scoreEntryOperation(entry, operation) {
  const entryText = `${entry.title} ${entry.text}`;
  const operationText = [
    operation.method,
    operation.path,
    operation.operationId,
    operation.service,
    operation.tags.join(' '),
    operation.summary,
    operation.description,
  ].join(' ');

  let score = 0;
  const exactEndpoint = `${operation.method} ${operation.path}`;
  if (entry.endpointRefs.includes(exactEndpoint)) score += 100;
  if (entry.pathRefs.includes(operation.path)) score += 70;
  if (normalizeText(entryText).includes(normalizeText(operation.operationId))) score += 25;

  const entryTokens = splitTokenSet(entryText);
  const operationHaystack = normalizeText(operationText);
  for (const token of entryTokens) {
    if (operationHaystack.includes(token)) score += 1;
  }

  return score;
}

function findChangelogLinks(operation, entries) {
  return entries
    .map((entry) => ({ entry, score: scoreEntryOperation(entry, operation) }))
    .filter((item) => item.score >= 20)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.release.localeCompare(b.entry.release) ||
        a.entry.title.localeCompare(b.entry.title)
    )
    .slice(0, 5)
    .map(({ entry, score }) => ({
      release: entry.release,
      section: entry.section,
      title: entry.title,
      issueRefs: entry.issueRefs,
      score,
    }));
}

function buildEndpointSignals(operations, entries, limit) {
  return operations
    .map((operation) => {
      const changelogLinks = findChangelogLinks(operation, entries);
      return {
        kind: 'openapi-operation',
        changeClass: inferChangeClass(changelogLinks),
        method: operation.method,
        path: operation.path,
        operationId: operation.operationId,
        service: operation.service,
        tags: operation.tags,
        summary: operation.summary,
        description: truncateText(operation.description, 320),
        changelogLinks,
        publicationBoundary: 'raw-extraction-only',
      };
    })
    .sort((a, b) => {
      const linkDiff = b.changelogLinks.length - a.changelogLinks.length;
      return linkDiff || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
    })
    .slice(0, limit);
}

function inferChangeClass(changelogLinks) {
  if (!changelogLinks || changelogLinks.length === 0) return 'openapi-observed';
  const sections = new Set(changelogLinks.map((link) => String(link.section).toLowerCase()));
  if (sections.has('added')) return 'changelog-added';
  if (sections.has('changed')) return 'changelog-changed';
  if (sections.has('fixed')) return 'changelog-fixed';
  if (sections.has('security')) return 'changelog-security';
  return 'changelog-mentioned';
}

function buildServiceSignals(operations, entries) {
  const services = new Map();
  for (const operation of operations) {
    const key = operation.service || 'unmapped';
    if (!services.has(key)) {
      services.set(key, {
        service: key,
        operationCount: 0,
        tags: new Set(),
        endpointExamples: [],
        changelogMentions: [],
      });
    }
    const service = services.get(key);
    service.operationCount += 1;
    operation.tags.forEach((tag) => service.tags.add(tag));
    if (service.endpointExamples.length < 5) {
      service.endpointExamples.push(`${operation.method} ${operation.path}`);
    }
  }

  for (const entry of entries) {
    const text = normalizeText(`${entry.title} ${entry.text}`);
    for (const service of services.values()) {
      if (text.includes(normalizeText(service.service))) {
        service.changelogMentions.push({
          release: entry.release,
          section: entry.section,
          title: entry.title,
          issueRefs: entry.issueRefs,
        });
      }
    }
  }

  return Array.from(services.values())
    .map((service) => ({
      ...service,
      tags: Array.from(service.tags).sort(),
      changelogMentions: service.changelogMentions.slice(0, 10),
      publicationBoundary: 'raw-extraction-only',
    }))
    .sort(
      (a, b) =>
        b.changelogMentions.length - a.changelogMentions.length ||
        b.operationCount - a.operationCount ||
        a.service.localeCompare(b.service)
    );
}

function buildChangelogReleaseHints(entries, limit) {
  return entries.slice(0, limit).map((entry) => ({
    kind: 'changelog-entry',
    release: entry.release,
    releaseDate: entry.releaseDate,
    section: entry.section,
    title: entry.title,
    issueRefs: entry.issueRefs,
    endpointRefs: entry.endpointRefs,
    pathRefs: entry.pathRefs,
    summary: truncateText(entry.text, 360),
    publicationBoundary: 'raw-extraction-only',
  }));
}

function buildReleaseSignals({ changelogMarkdown, openApiSpec, limit = DEFAULT_LIMIT }) {
  const changelogEntries = parseChangelogEntries(changelogMarkdown);
  const operations = extractOpenApiOperations(openApiSpec);
  const recentEntries = changelogEntries.slice(0, Math.max(limit * 4, 100));
  const releases = Array.from(new Set(changelogEntries.map((entry) => entry.release)));
  const tagSet = new Set();
  operations.forEach((operation) => operation.tags.forEach((tag) => tagSet.add(tag)));

  return {
    schemaVersion: 'cernion.releaseSignals.v1',
    generatedAt: new Date().toISOString(),
    extractionOnly: true,
    publicationBoundary:
      'No GitHub issues, PRs, website changes, deployments, or external publication are performed.',
    openapi: {
      title: openApiSpec.info && openApiSpec.info.title ? openApiSpec.info.title : null,
      version: openApiSpec.info && openApiSpec.info.version ? openApiSpec.info.version : null,
      pathCount: Object.keys(openApiSpec.paths || {}).length,
      operationCount: operations.length,
      tagCount: tagSet.size,
    },
    changelog: {
      entryCount: changelogEntries.length,
      releases,
      latestRelease: releases[0] || null,
    },
    signals: {
      endpointSignals: buildEndpointSignals(operations, recentEntries, limit),
      serviceSignals: buildServiceSignals(operations, recentEntries),
      changelogReleaseHints: buildChangelogReleaseHints(changelogEntries, limit),
    },
  };
}

function renderMarkdownReport(report) {
  const lines = [
    '# CET Release Signal Extraction Report',
    '',
    'Read-only Rohsignal-Extraktion aus CHANGELOG.md und OpenAPI.',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- extractionOnly: ${report.extractionOnly}`,
    `- publicationBoundary: ${report.publicationBoundary}`,
    `- openapi: ${report.openapi.title || 'unknown'} ${report.openapi.version || ''}`.trim(),
    `- paths/operations/tags: ${report.openapi.pathCount}/${report.openapi.operationCount}/${report.openapi.tagCount}`,
    `- changelogEntries: ${report.changelog.entryCount}`,
    '',
    '## Endpoint-Signale',
    '',
    '| Change | Method | Path | Service/Tags | Summary | Changelog-Bezug |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const signal of report.signals.endpointSignals) {
    lines.push(
      [
        signal.changeClass,
        signal.method,
        signal.path,
        [signal.service]
          .concat(signal.tags || [])
          .filter(Boolean)
          .join(', '),
        signal.summary || signal.operationId,
        signal.changelogLinks
          .map((link) => `${link.release} ${link.section}: ${link.title}`)
          .join('<br>') || 'OpenAPI-only beobachtet',
      ]
        .map(escapeMarkdownCell)
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |')
    );
  }

  lines.push('', '## Changelog-Hinweise', '');
  for (const hint of report.signals.changelogReleaseHints) {
    const refs = hint.endpointRefs.length ? ` Endpoints: ${hint.endpointRefs.join(', ')}.` : '';
    lines.push(`- ${hint.release} / ${hint.section}: ${hint.title}.${refs}`);
  }

  lines.push('', '## Trennung Extraction vs. Veröffentlichung', '');
  lines.push('- Dieses Skript schreibt nicht in GitHub, Websites, Kanban oder externe Systeme.');
  lines.push(
    '- Der Report ist ein neutrales Rohsignal und kein Veröffentlichungs- oder Claim-Entwurf.'
  );

  return `${lines.join('\n')}\n`;
}

function escapeMarkdownCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function parseArgs(argv) {
  const getValue = (name) => {
    const prefix = `${name}=`;
    const inline = argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1]) return argv[index + 1];
    return null;
  };

  const limitValue = getValue('--limit');
  const limit = limitValue ? Number(limitValue) : DEFAULT_LIMIT;
  return {
    changelogPath: getValue('--changelog') || DEFAULT_CHANGELOG_PATH,
    openapiPath: getValue('--openapi') || DEFAULT_OPENAPI_PATH,
    format: getValue('--format') || (argv.includes('--markdown') ? 'markdown' : 'json'),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT,
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const changelogMarkdown = readUtf8File(options.changelogPath, 'CHANGELOG.md');
    const openApiSpec = readJsonFile(options.openapiPath, 'OpenAPI JSON');
    const report = buildReleaseSignals({ changelogMarkdown, openApiSpec, limit: options.limit });

    if (options.format === 'markdown' || options.format === 'md') {
      process.stdout.write(renderMarkdownReport(report));
      return;
    }
    if (options.format !== 'json') {
      throw new InputError('INVALID_FORMAT', `Unsupported format: ${options.format}`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (err) {
    const code = err && err.code ? err.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`[extract-release-signals] ${code}: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  InputError,
  buildReleaseSignals,
  extractOpenApiOperations,
  parseArgs,
  parseChangelogEntries,
  renderMarkdownReport,
};
