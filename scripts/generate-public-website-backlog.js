#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-public-website-backlog.js
 *
 * Derives public-website/backlog candidates from CHANGELOG.md and the committed
 * OpenAPI export. The script is intentionally read-only: it writes no GitHub,
 * website, Matrix, or Kanban state. Operators can pipe the markdown/JSON into a
 * guarded Rhajaina/Webmaster/Felix/Viki handoff workflow. It can package
 * send-ready drafts per recipient/channel, but never sends them itself.
 *
 * Usage:
 *   node scripts/generate-public-website-backlog.js
 *   npm run generate:public-website-backlog
 *   node scripts/generate-public-website-backlog.js --json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const DEFAULT_OPENAPI_PATH = path.join(ROOT, 'openapi-export.json');

const PUBLIC_SITE_RULES = [
  {
    id: 'personal-agent',
    site: 'cernion.de/ki-agenten',
    keywords: ['personal agent', 'agent', 'chat', 'openai', 'work-out-loud'],
  },
  {
    id: 'redispatch',
    site: 'cernion.de/redispatch',
    keywords: ['redispatch', '§14a', 'steuerbarkeit', 'curtailment'],
  },
  {
    id: 'municipal-energy',
    site: 'cernion.de/kommunale-energiedaten',
    keywords: ['municipal', 'gemeinde', 'kommunal', 'plz', 'lagebild', 'wertschöpfung'],
  },
  {
    id: 'vdmi-governance',
    site: 'cernion.de/vdmi-governance',
    keywords: ['vdmi', 'blueprint', 'governance', 'raci', 'evidence'],
  },
  {
    id: 'market-data',
    site: 'cernion.de/energy-market-api',
    keywords: ['portfolio', 'backtest', 'epex', 'entsoe', 'market value', 'spot'],
  },
  {
    id: 'budibase-workbench',
    site: 'cernion.de/stadtwerk-workbench',
    keywords: ['budibase', 'workbench', 'stadtwerk mauer', 'dashboard'],
  },
  {
    id: 'platform-api',
    site: 'cernion.de/api',
    keywords: ['openapi', 'endpoint', 'api', 'rest', 'object store', 'token'],
  },
];

const ROLE_RULES = [
  { role: 'Webmaster', keywords: ['website', 'public', 'html', 'api', 'openapi'] },
  { role: 'Felix', keywords: ['demo', 'tenant', 'stadtwerk', 'workbench', 'b2b'] },
  { role: 'Rhajaina', keywords: ['claim', 'guardrail', 'evidence', 'governance', 'no-call'] },
  { role: 'DevOps', keywords: ['endpoint', 'script', 'cache', 'job', 'openapi'] },
];

const CHANNEL_PACKAGE_RULES = [
  {
    recipient: 'Webmaster',
    channels: ['cernion.de', 'corrently.io', 'stromdao.de'],
    focus: 'Website-/Doku-/SEO-Draft mit belegbarer Capability und Endpoint-Deeplink.',
  },
  {
    recipient: 'Felix',
    channels: ['LinkedIn', 'Pubbler', 'B2B-E-Mail-Kontakte'],
    focus: 'B2B-Demo-/Kontaktpaket für Stadtwerke, ohne Kundenerfolge oder Preise zu erfinden.',
  },
  {
    recipient: 'Viki',
    channels: ['Viki-Markt-Scouting', 'LinkedIn-Signalbeobachtung'],
    focus: 'Markt-/Wettbewerbs-Signal prüfen und Zielsegmente für Anschlusskommunikation ableiten.',
  },
  {
    recipient: 'Rhajaina',
    channels: ['Claim-Governance', 'Freigabe-/Nachweisprüfung'],
    focus: 'Claim-Risiko, Nachweisbedarf und Grenzen vor externer Zusage festziehen.',
  },
];

const HIGH_RISK_TERMS = [
  'guarantee',
  'garantie',
  'abrechnung',
  'settlement',
  'tariff',
  'device-control',
  'steuerung',
  'approval',
  'rejection',
  'public publication',
  'production mutation',
];

const LOW_RISK_TERMS = ['read-only', 'no-call', 'guardrail', 'evidence', 'demo', 'synthetic'];

const OPERATION_MATCH_STOP_TOKENS = new Set([
  'added',
  'changed',
  'computes',
  'endpoint',
  'energy',
  'includes',
  'market',
  'output',
  'read',
  'value',
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_#[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseChangelogEntries(markdown) {
  const entries = [];
  let currentRelease = 'Unreleased';
  let currentSection = 'Changed';
  let currentEntry = null;

  const flush = () => {
    if (currentEntry) {
      currentEntry.text = currentEntry.lines.join('\n').trim();
      currentEntry.title = extractEntryTitle(currentEntry.text);
      currentEntry.issueRefs = Array.from(currentEntry.text.matchAll(/#(\d+)/g)).map(
        (m) => `#${m[1]}`
      );
      entries.push(currentEntry);
      currentEntry = null;
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const releaseMatch = line.match(/^##\s+(?:\[([^\]]+)\]|(Unreleased))/i);
    if (releaseMatch) {
      flush();
      currentRelease = releaseMatch[1] || releaseMatch[2] || 'Unreleased';
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
  const boldMatch = text.match(/^\*\*([^*]+)\*\*/);
  if (boldMatch) return boldMatch[1].replace(/`/g, '').trim();
  return text.split(':')[0].replace(/`/g, '').slice(0, 120).trim();
}

function loadOpenApiOperations(spec) {
  const operations = [];
  for (const [apiPath, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) continue;
      operations.push({
        path: apiPath,
        method: method.toUpperCase(),
        operationId: operation.operationId || `${method.toUpperCase()}_${apiPath}`,
        summary: operation.summary || '',
        description: operation.description || '',
        tags: Array.isArray(operation.tags) ? operation.tags : [],
        uiPage: operation['x-ui-page'] || null,
      });
    }
  }
  return operations;
}

function scoreOperation(entry, operation) {
  const haystack = normalizeText(
    [
      operation.path,
      operation.operationId,
      operation.summary,
      operation.description,
      operation.tags.join(' '),
      operation.uiPage,
    ].join(' ')
  );
  const entryTokens = new Set(
    normalizeText(`${entry.title} ${entry.text}`)
      .split(/[^a-z0-9äöüß]+/)
      .filter((token) => token.length >= 5 && !OPERATION_MATCH_STOP_TOKENS.has(token))
  );

  let score = 0;
  for (const token of entryTokens) {
    if (haystack.includes(token)) score += 1;
  }
  if (operation.path && entry.text.includes(operation.path)) score += 50;
  if (
    operation.operationId &&
    normalizeText(entry.text).includes(normalizeText(operation.operationId))
  ) {
    score += 10;
  }
  if (entry.title && haystack.includes(normalizeText(entry.title))) score += 8;
  for (const ref of entry.issueRefs || []) {
    if (haystack.includes(ref.toLowerCase())) score += 2;
  }
  return score;
}

function findRelatedOperations(entry, operations, max = 3) {
  return operations
    .map((operation) => ({ ...operation, matchScore: scoreOperation(entry, operation) }))
    .filter((operation) => operation.matchScore >= 3)
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        a.path.localeCompare(b.path) ||
        a.method.localeCompare(b.method)
    )
    .slice(0, max)
    .map(({ matchScore: _matchScore, ...operation }) => operation);
}

function selectByKeywordRules(text, rules, fallbackField) {
  const normalized = normalizeText(text);
  let best = null;
  for (const rule of rules) {
    const score = rule.keywords.filter((keyword) =>
      normalized.includes(normalizeText(keyword))
    ).length;
    if (!best || score > best.score) best = { ...rule, score };
  }
  if (best && best.score > 0) return best[fallbackField];
  return null;
}

function inferWebsiteTarget(entry, relatedOperations) {
  const operationText = relatedOperations
    .map((op) => `${op.path} ${op.summary} ${op.tags.join(' ')} ${op.uiPage || ''}`)
    .join(' ');
  return (
    selectByKeywordRules(
      `${entry.title} ${entry.text} ${operationText}`,
      PUBLIC_SITE_RULES,
      'site'
    ) || 'cernion.de/produkt-roadmap'
  );
}

function inferTargetRole(entry, relatedOperations) {
  const operationText = relatedOperations
    .map((op) => `${op.path} ${op.summary} ${op.tags.join(' ')} ${op.uiPage || ''}`)
    .join(' ');
  const combinedText = normalizeText(`${entry.title} ${entry.text} ${operationText}`);
  if (
    relatedOperations.length > 0 &&
    ['demo', 'fixture', 'seed', 'workbench', 'dashboard'].some((term) =>
      combinedText.includes(term)
    )
  ) {
    return 'Felix';
  }
  return (
    selectByKeywordRules(`${entry.title} ${entry.text} ${operationText}`, ROLE_RULES, 'role') ||
    'Rhajaina'
  );
}

function inferDemoReadiness(entry, relatedOperations) {
  const text = normalizeText(entry.text);
  const hasEndpoint =
    relatedOperations.length > 0 || /\b(get|post|put|patch|delete)\s+\/api\//i.test(entry.text);
  const hasDemoSignal = ['demo', 'fixture', 'seed', 'workbench', 'dashboard', 'html'].some((term) =>
    text.includes(term)
  );
  const hasGuard = ['read-only', 'no-call', 'guardrail', 'synthetic'].some((term) =>
    text.includes(term)
  );

  if (hasEndpoint && hasDemoSignal && hasGuard) return 'demo-ready';
  if (hasEndpoint && (hasDemoSignal || hasGuard)) return 'needs-demo-copy-review';
  if (hasEndpoint) return 'api-visible-needs-demo-story';
  return 'concept-only';
}

function inferClaimRisk(entry) {
  const text = normalizeText(entry.text);
  const highHits = HIGH_RISK_TERMS.filter((term) => text.includes(normalizeText(term)));
  const lowHits = LOW_RISK_TERMS.filter((term) => text.includes(normalizeText(term)));

  if (highHits.length > 0 && lowHits.length === 0) {
    return { level: 'high', reasons: highHits.slice(0, 3) };
  }
  if (highHits.length > 0) {
    return { level: 'medium', reasons: highHits.slice(0, 3) };
  }
  if (lowHits.length > 0) {
    return { level: 'low', reasons: lowHits.slice(0, 3) };
  }
  return { level: 'medium', reasons: ['manual public-claim review required'] };
}

function inferRecommendedFollowUpAgent(candidate) {
  if (candidate.claimRisk === 'high') return 'rhajaina-claim-review';
  if (candidate.demoReadiness === 'concept-only') return 'felix-demo-sales';
  if (candidate.targetRole === 'Felix' && candidate.demoReadiness === 'demo-ready') {
    return 'felix-demo-sales';
  }
  if (candidate.websiteTargetPage.includes('corrently.io')) return 'devops-api-check';
  if (candidate.endpoints.length > 0) return 'webmaster';
  return 'rhajaina-claim-review';
}

function buildChannelPackages(candidate) {
  const packages = [];
  const recipients = new Set(['Webmaster', 'Rhajaina']);

  if (candidate.targetRole && candidate.targetRole !== 'DevOps')
    recipients.add(candidate.targetRole);
  if (
    candidate.demoReadiness === 'demo-ready' ||
    candidate.websiteTargetPage.includes('workbench')
  ) {
    recipients.add('Felix');
  }
  if (candidate.claimRisk !== 'high') recipients.add('Viki');

  for (const recipient of recipients) {
    const rule = CHANNEL_PACKAGE_RULES.find((item) => item.recipient === recipient);
    if (!rule) continue;
    packages.push({
      recipient,
      channels: selectChannelsForCandidate(rule.channels, candidate),
      sendReadiness: inferSendReadiness(candidate, recipient),
      messageAngle: buildMessageAngle(candidate, recipient),
      safeClaim: buildSafeClaim(candidate),
      proofRequired: buildProofRequired(candidate),
      nextAction: buildRecipientNextAction(candidate, recipient),
      focus: rule.focus,
    });
  }

  return packages;
}

function selectChannelsForCandidate(channels, candidate) {
  if (candidate.websiteTargetPage.includes('stromdao.de')) {
    return channels.filter((channel) => channel !== 'cernion.de');
  }
  if (candidate.websiteTargetPage.includes('corrently')) {
    return channels.filter((channel) => channel !== 'stromdao.de');
  }
  return channels;
}

function inferSendReadiness(candidate, recipient) {
  if (candidate.claimRisk === 'high') return 'blocked-claim-review';
  if (recipient === 'Rhajaina') return 'review-package';
  if (candidate.demoReadiness === 'demo-ready' && candidate.claimRisk === 'low')
    return 'send-ready-draft';
  if (candidate.demoReadiness === 'concept-only') return 'needs-story-packaging';
  return 'needs-copy-review';
}

function buildMessageAngle(candidate, recipient) {
  const endpointText = candidate.endpoints.length
    ? `mit ${candidate.endpoints[0]} als prüfbarem API-Anker`
    : 'als noch zu erzählende Capability ohne stabilen Endpoint-Anker';
  if (recipient === 'Felix') return `B2B-Demo-Nutzen für Stadtwerke ${endpointText}.`;
  if (recipient === 'Viki') return `Marktsignal und Zielsegment-Relevanz ${endpointText}.`;
  if (recipient === 'Webmaster')
    return `Public-Web-Draft für ${candidate.websiteTargetPage} ${endpointText}.`;
  return `Claim-/Nachweisprüfung für ${candidate.capability} ${endpointText}.`;
}

function buildSafeClaim(candidate) {
  const readiness = candidate.demoReadiness === 'demo-ready' ? 'demo-fähige' : 'prüfbare';
  return `CET stellt eine ${readiness} Read-only-Fähigkeit für ${candidate.title} bereit.`;
}

function buildProofRequired(candidate) {
  const proof = ['CHANGELOG-Eintrag', 'openapi-export.json'];
  if (candidate.endpoints.length) proof.push(candidate.endpoints[0]);
  if (candidate.claimRisk !== 'low') proof.push('fachliche Claim-Prüfung');
  return proof;
}

function buildRecipientNextAction(candidate, recipient) {
  if (recipient === 'Webmaster') return `Draft für ${candidate.websiteTargetPage} vorbereiten.`;
  if (recipient === 'Felix')
    return 'B2B-Anschreib-/Demo-Snippet mit belegbaren Grenzen formulieren.';
  if (recipient === 'Viki') return 'Markt-Scouting auf passende Zielrollen/Trigger anreichern.';
  return 'Claim-Risiko, No-Call-Grenzen und Nachweise prüfen.';
}

function extractCapability(entry) {
  const explicit = Array.from(entry.text.matchAll(/`([^`]+)`/g))
    .map((match) => match[1])
    .find(
      (value) =>
        /(?:capability|endpoint|api|workflow|seed|backtest)/i.test(value) &&
        !/^(?:GET|POST|PUT|PATCH|DELETE)\s+\/api\//i.test(value) &&
        !/\.(?:js|json|md|html|css)$/i.test(value)
    );
  if (explicit) return explicit;
  if (entry.title) return slugify(entry.title);
  return slugify(entry.text) || 'release-capability';
}

function buildBacklogCandidates({ changelogMarkdown, openApiSpec, limit = 30 }) {
  const entries = parseChangelogEntries(changelogMarkdown).filter((entry) =>
    ['Added', 'Changed', 'Fixed', 'Security'].includes(entry.section)
  );
  const operations = loadOpenApiOperations(openApiSpec);

  return entries.slice(0, limit).map((entry) => {
    const relatedOperations = findRelatedOperations(entry, operations);
    const risk = inferClaimRisk(entry);
    const candidate = {
      id: `${entry.release}:${slugify(entry.title)}`,
      release: entry.release,
      changelogSection: entry.section,
      title: entry.title,
      capability: extractCapability(entry),
      endpoints: relatedOperations.map((op) => `${op.method} ${op.path}`),
      serviceOrTag: relatedOperations[0]?.tags?.[0] || 'unmapped',
      targetRole: inferTargetRole(entry, relatedOperations),
      websiteTargetPage: inferWebsiteTarget(entry, relatedOperations),
      demoReadiness: inferDemoReadiness(entry, relatedOperations),
      claimRisk: risk.level,
      claimRiskReasons: risk.reasons,
      issueRefs: entry.issueRefs,
      recommendedFollowUp: buildFollowUp(entry, relatedOperations, risk.level),
    };
    candidate.recommendedFollowUpAgent = inferRecommendedFollowUpAgent(candidate);
    candidate.channelPackages = buildChannelPackages(candidate);
    return candidate;
  });
}

function buildFollowUp(entry, relatedOperations, claimRisk) {
  const endpointText = relatedOperations.length
    ? `Endpoint-Bezug prüfen: ${relatedOperations.map((op) => `${op.method} ${op.path}`).join(', ')}.`
    : 'Capability zuerst in eine öffentliche Demo-/Story-Fläche übersetzen.';
  const riskText =
    claimRisk === 'high'
      ? 'Vor Veröffentlichung Claim juristisch/fachlich härten.'
      : 'Claim als read-only/guarded formulieren.';
  return `${entry.section}-Release-Kandidat: ${endpointText} ${riskText}`;
}

function renderMarkdownReport(candidates, meta = {}) {
  const lines = [
    '# CET Public Website Backlog Candidates',
    '',
    'Read-only Ableitung aus CHANGELOG.md und openapi-export.json. Kein GitHub-/Website-/Kanban-Write.',
    '',
    `- generatedAt: ${meta.generatedAt || new Date().toISOString()}`,
    `- candidateCount: ${candidates.length}`,
    '',
    '| Capability | Endpoint/Service | Zielrolle | Website-Zielseite | Demo-Reife | Claim-Risiko | Folge-Agent | Kanalpakete | Folgehinweis |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const candidate of candidates) {
    lines.push(
      [
        candidate.capability,
        candidate.endpoints.length ? candidate.endpoints.join('<br>') : candidate.serviceOrTag,
        candidate.targetRole,
        candidate.websiteTargetPage,
        candidate.demoReadiness,
        `${candidate.claimRisk}${candidate.claimRiskReasons.length ? ` (${candidate.claimRiskReasons.join(', ')})` : ''}`,
        candidate.recommendedFollowUpAgent || inferRecommendedFollowUpAgent(candidate),
        renderChannelPackageSummary(candidate.channelPackages || []),
        candidate.recommendedFollowUp,
      ]
        .map(escapeMarkdownCell)
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |')
    );
  }

  return `${lines.join('\n')}\n`;
}

function renderChannelPackageSummary(channelPackages) {
  return channelPackages
    .map((pkg) => `${pkg.recipient}: ${pkg.sendReadiness} via ${pkg.channels.join('/')}`)
    .join('<br>');
}

function escapeMarkdownCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    limit: Number(argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || 30),
    changelogPath:
      argv
        .find((arg) => arg.startsWith('--changelog='))
        ?.split('=')
        .slice(1)
        .join('=') || DEFAULT_CHANGELOG_PATH,
    openapiPath:
      argv
        .find((arg) => arg.startsWith('--openapi='))
        ?.split('=')
        .slice(1)
        .join('=') || DEFAULT_OPENAPI_PATH,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const changelogMarkdown = fs.readFileSync(options.changelogPath, 'utf8');
  const openApiSpec = JSON.parse(fs.readFileSync(options.openapiPath, 'utf8'));
  const generatedAt = new Date().toISOString();
  const candidates = buildBacklogCandidates({
    changelogMarkdown,
    openApiSpec,
    limit: options.limit,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 'cernion.publicWebsiteBacklog.v2', generatedAt, candidates }, null, 2)}\n`
    );
    return;
  }

  process.stdout.write(renderMarkdownReport(candidates, { generatedAt }));
}

if (require.main === module) {
  main();
}

module.exports = {
  buildChannelPackages,
  buildBacklogCandidates,
  extractCapability,
  findRelatedOperations,
  inferClaimRisk,
  inferDemoReadiness,
  inferRecommendedFollowUpAgent,
  loadOpenApiOperations,
  parseChangelogEntries,
  renderMarkdownReport,
};
