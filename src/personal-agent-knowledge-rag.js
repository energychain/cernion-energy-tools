'use strict';

const QUERY_TIMEOUT_MS = Number.isFinite(Number(process.env.PERSONAL_AGENT_KNOWLEDGE_RAG_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.PERSONAL_AGENT_KNOWLEDGE_RAG_TIMEOUT_MS)))
  : 25000;
const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

const DOMAIN_HINT_RULES = Object.freeze([
  {
    domainHint: 'grid-operations',
    signals: [
      'netzbetreiber',
      'vnb',
      'bdew',
      'netzanschluss',
      'netzanschlusspunkt',
      'grid operator',
    ],
  },
  {
    domainHint: 'market-regulatory',
    signals: [
      'regulator',
      'regulatory',
      'bnetza',
      'festlegung',
      'entso-e',
      'netztransparenz',
      'enwg',
    ],
  },
  {
    domainHint: 'finance-risk',
    signals: ['risk', 'risiko', 'due diligence', 'kreditausschuss', 'finanz', 'finance', 'kredit'],
  },
  {
    domainHint: 'energy-sharing',
    signals: ['mieterstrom', 'energy sharing', '§42c', '42c', 'allokation', 'bilanzkreis'],
  },
]);

const REGULATORY_FRAME_RULES = Object.freeze([
  {
    frame: 'BNetzA-Festlegung',
    signals: ['bnetza', 'festlegung'],
  },
  {
    frame: 'EnWG-Rahmen',
    signals: ['enwg', '§14a', '14a', '§42c', '42c'],
  },
  {
    frame: 'Marktdaten-Rahmen (ENTSO-E/Netztransparenz)',
    signals: ['entso-e', 'netztransparenz', 'day-ahead', 'negativpreis'],
  },
]);

function clampLimit(limit) {
  const value = Number(limit || DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.floor(value)));
}

function normalizeSignalValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHits(result) {
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result?.data?.results)) return result.data.results;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.data?.data?.results)) return result.data.data.results;
  return [];
}

function collectSignalsFromHit(hit = {}) {
  const metadata = hit?.metadata && typeof hit.metadata === 'object' ? hit.metadata : {};
  const rawSignals = [
    hit?.domain,
    hit?.category,
    hit?.docType,
    ...(Array.isArray(hit?.oeoTags) ? hit.oeoTags : []),
    ...(Array.isArray(hit?.tags) ? hit.tags : []),
    metadata.domain,
    metadata.category,
    metadata.docType,
    metadata.authority,
    metadata.regulatoryFrame,
    metadata.regulation,
    ...(Array.isArray(metadata.tags) ? metadata.tags : []),
    ...(Array.isArray(metadata.keywords) ? metadata.keywords : []),
    ...(Array.isArray(metadata.oeoTags) ? metadata.oeoTags : []),
    ...(Array.isArray(metadata.ontologyTags) ? metadata.ontologyTags : []),
  ];

  return rawSignals.map(normalizeSignalValue).filter(Boolean);
}

function resolveDomainHint({ signals = [], activeDomains = [] }) {
  const active = Array.isArray(activeDomains)
    ? activeDomains.map(normalizeSignalValue).filter(Boolean)
    : [];

  for (const rule of DOMAIN_HINT_RULES) {
    const hasRuleSignal = rule.signals.some((signal) =>
      signals.some((item) => item.includes(signal))
    );
    if (!hasRuleSignal) continue;

    const hasActiveMatch =
      active.length === 0 ||
      active.some((domain) => domain.includes(rule.domainHint) || rule.domainHint.includes(domain));

    if (hasActiveMatch) {
      return rule.domainHint;
    }
  }

  if (active.length > 0) {
    return active[0];
  }

  return null;
}

function resolveRegulatoryFrame(signals = []) {
  for (const rule of REGULATORY_FRAME_RULES) {
    const matches = rule.signals.some((signal) => signals.some((item) => item.includes(signal)));
    if (matches) {
      return rule.frame;
    }
  }

  return null;
}

function resolveSynthesisStyle({ domainHint, regulatoryFrame, signals = [] }) {
  if (domainHint === 'finance-risk') {
    return 'cautionary';
  }

  if (domainHint === 'market-regulatory' || regulatoryFrame) {
    return 'methodological';
  }

  const hasRiskSignal = signals.some((item) => /risk|risiko|compliance|due diligence/.test(item));
  if (hasRiskSignal) {
    return 'cautionary';
  }

  return 'methodological';
}

function isServiceUnavailableError(error) {
  return (
    error?.code === 404 ||
    error?.type === 'SERVICE_NOT_FOUND' ||
    error?.type === 'SERVICE_NOT_AVAILABLE' ||
    /service\s+not\s+found/i.test(String(error?.message || '')) ||
    /action\s+not\s+found/i.test(String(error?.message || ''))
  );
}

function isTimeoutError(error) {
  return (
    error?.code === 'REQUEST_TIMEOUT' ||
    error?.type === 'REQUEST_TIMEOUT' ||
    error?.name === 'TimeoutError' ||
    /timeout/i.test(String(error?.message || ''))
  );
}

function buildTimeoutError(ms) {
  const err = new Error(`knowledge-rag query timeout (${ms}ms)`);
  err.code = 'REQUEST_TIMEOUT';
  err.type = 'REQUEST_TIMEOUT';
  return err;
}

async function callWithHardTimeout(ctx, params, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      ctx.call('knowledge-rag.query', params, {
        timeout: timeoutMs,
        meta: { ...ctx?.meta, $gateway: false },
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(buildTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function queryKnowledgeOrientation(
  ctx,
  { message, activeDomains = [], limit = DEFAULT_LIMIT } = {}
) {
  const query = String(message || '').trim();
  if (!query) {
    return null;
  }

  if (!ctx || typeof ctx.call !== 'function') {
    return null;
  }

  try {
    const ragResult = await callWithHardTimeout(
      ctx,
      {
        queryType: 'semantic',
        query,
        limit: clampLimit(limit),
      },
      QUERY_TIMEOUT_MS
    );

    const hits = extractHits(ragResult);
    if (hits.length === 0) {
      return null;
    }

    const signals = hits.slice(0, 5).flatMap((hit) => collectSignalsFromHit(hit));

    const domainHint = resolveDomainHint({ signals, activeDomains });
    const regulatoryFrame = resolveRegulatoryFrame(signals);
    const synthesisStyle = resolveSynthesisStyle({ domainHint, regulatoryFrame, signals });

    return {
      domainHint,
      regulatoryFrame,
      synthesisStyle,
    };
  } catch (error) {
    if (isTimeoutError(error) || isServiceUnavailableError(error)) {
      return null;
    }
    return null;
  }
}

module.exports = {
  queryKnowledgeOrientation,
  _internal: {
    QUERY_TIMEOUT_MS,
    DOMAIN_HINT_RULES,
    REGULATORY_FRAME_RULES,
    extractHits,
    collectSignalsFromHit,
    resolveDomainHint,
    resolveRegulatoryFrame,
    resolveSynthesisStyle,
    isTimeoutError,
    isServiceUnavailableError,
  },
};
