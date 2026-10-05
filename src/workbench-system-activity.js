'use strict';

const { getFunctionModel } = require('./function-model');
const { normalizePhrase } = require('./function-resolver');
const { resolveFunctionsHybrid } = require('./function-resolver-hybrid');
const { principal } = require('./domain-router-policy');
const { compareCanonicalStrings } = require('./canonical-order');

const managers = ['ROLE_TENANT_ADMIN', 'ROLE_ADMIN', 'ROLE_UTILITY_HQ'];
const TIERS = {
  transient: 'vorübergehend',
  established: 'eingesessen',
  retained: 'beibehalten',
  inventory: 'Inventar',
};
const LIFECYCLES = {
  proposed: 'vorgeschlagen',
  active: 'aktiv',
  sleeping: 'schlafend',
  retired: 'zurückgezogen',
};
const POLICY =
  /routing advice only|unverified routing hints|never claim approval|policy blocked|no.call.guard/i;

function display(value) {
  if (typeof value !== 'string' || POLICY.test(value)) return '';
  return value
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, 280);
}

function activityScope(message) {
  const text = String(message || '').trim();
  if (
    /^(?:was gibt es neues|gibt[’']?s (?:was|etwas) neues|was ist passiert|irgendwelche hinweise für mich|what[’']?s new)[?.!\s]*$/i.test(
      text
    )
  )
    return { overview: true, noticesOnly: true };
  if (/\bcase[_-][\w-]+\b|\b(case|fall|klärfall|klaerfall)\b/i.test(text)) return null;
  if (
    /\b(bewerte|vergleiche|empfiehl|empfehlung|recommend|compare|assess)\b|was soll ich|what should i/i.test(
      text
    )
  )
    return null;
  if (/^(?:was gehört zum inventar|what is (?:in|part of) (?:the )?inventory)[?.!\s]*$/i.test(text))
    return { overview: true, inventoryOnly: true };
  if (
    /^(?:welche|which)\s+(?:deiner\s+|your\s+)?(?:agents?|agenten|funktionen|functions)\s+(?:laufen|sind aktiv|are (?:running|active))(?:\s+(?:gerade|aktuell|momentan|currently))?[?.!\s]*$/i.test(
      text
    )
  )
    return { overview: true };
  const patterns = [
    /^(?:was ist|wie ist)\s+(?:dein|deine)\s+(?:(?:gerade|aktuell|momentan|aktueller|aktuelle)\s+)?(?:arbeitsstand|arbeit|tätigkeit|aufgabe|status|inventar)\b(.*?)[?.!]*$/i,
    /^(?:was macht(?: eigentlich)?|woran arbeitet)\s+(.+?)[?.!]*$/i,
    /^(?:was (?:machst|tust) du|woran arbeitest du|wor(?:um|an) kümmerst du dich|(?:warum |wieso )?kümmerst du dich|arbeitest du|(?:warum |wieso )?kümmert sich cet|what are you (?:doing|working on)|what does cet do|are you working)\b(.*?)[?.!]*$/i,
    /^was passiert(?:\s+(?:gerade|aktuell|momentan))?\s+(?:mit|bei)\s+(.+?)[?.!]*$/i,
    /^what is\s+(.+?)\s+(?:doing(?: right now)?|working on|currently)[?.!]*$/i,
  ];
  const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
  if (!match) return null;
  const target = match[1]
    .replace(/\b(?:gerade|aktuell|momentan|eigentlich|currently|right now)\b/gi, '')
    .replace(/^(?:cet|du|you|the assistant|der assistent)\b/i, '')
    .replace(/^\s*(?:beim|bei|an|um|mit|on|with|about)\s+/i, '')
    .replace(/^\s*(?:die|der|das|the)\s+/i, '')
    .trim();
  return target ? { overview: false, target } : { overview: true };
}

function isFunctionKnowledgeQuery(message) {
  const match = String(message || '')
    .trim()
    .match(/^(?:was (?:ist|sind)|what (?:is|are))\s+(.+?)[?.!]*$/i);
  if (!match) return false;
  const target = normalizePhrase(match[1]);
  return getFunctionModel().functions.some((fn) =>
    [fn.label, ...(fn.aliases || [])].some(
      (label) => typeof label === 'string' && normalizePhrase(label) === target
    )
  );
}

function isSystemActivityQuery(message) {
  return !!activityScope(message);
}

// Only visibility-filtered digest scalars cross the presenter boundary.
function presentDigest(digest) {
  if (!digest) return null;
  const items = (values) =>
    (Array.isArray(values) ? values : []).slice(-10).map((entry) => ({
      summary: display(entry.summary),
      at: display(entry.at),
      hiddenRefCount: Number(entry.hiddenRefCount) || 0,
    }));
  return {
    state: digest.status?.state || 'latent',
    cet: digest.status?.responsibility?.cet === true,
    humanCount: digest.status?.responsibility?.humans?.length || 0,
    lifecycles: (digest.status?.agents || []).map((agent) => agent.lifecycle),
    openExpectationCount: digest.openExpectations?.length || 0,
    openProposalCount: digest.openProposals?.length || 0,
    openExpectations: items(digest.openExpectations),
    openProposals: items(digest.openProposals),
    lastDecisions: items(digest.lastDecisions),
    entryCount: Number(digest.entryCount) || 0,
    lastEntryAt: digest.lastEntryAt || null,
  };
}

async function readSource(ctx, name, input, validate) {
  try {
    const value = await ctx.call(name, input);
    return validate(value) ? { available: true, value } : { available: false };
  } catch {
    return { available: false };
  }
}

async function readFunction(ctx, fn, p, activations) {
  const input = { tenantId: p.tenantId, functionId: fn.functionId };
  const [explanation, digest, agents, coverage] = await Promise.all([
    readSource(ctx, 'activation.explain', input, (value) => Array.isArray(value?.activations)),
    readSource(
      ctx,
      'journal.digest',
      input,
      (value) =>
        value?.tenantId === p.tenantId &&
        value.functionId === fn.functionId &&
        value.schemaVersion === 1
    ),
    readSource(ctx, 'agents.list', { tenantId: p.tenantId }, Array.isArray),
    p.roles.some((role) => managers.includes(role))
      ? readSource(ctx, 'function-coverage.byFunction', { ...input, limit: 100 }, (value) =>
          Array.isArray(value?.items)
        )
      : Promise.resolve({ available: false, restricted: true }),
  ]);
  const row = (explanation.available ? explanation.value.activations : activations || []).find(
    (item) => item.tenantId === p.tenantId && item.functionId === fn.functionId
  );
  const agentRows = agents.available
    ? agents.value.filter(
        (item) => item.tenantId === p.tenantId && item.functionId === fn.functionId
      )
    : [];
  return projectFunction(fn, p, row, agentRows, digest, agents, coverage);
}

function activityState(row, agents) {
  if (!row) return 'state_unavailable';
  if (row.state === 'latent' || row.state === 'dormant') return row.state;
  if (row.attention?.allowanceExhausted || agents.some((agent) => agent.lifecycle === 'sleeping'))
    return 'sleeping';
  if (row.responsibility?.cet) return 'active_cet';
  return row.responsibility?.humans?.length ? 'active_human' : 'active_observed';
}

function presentAttention(attention) {
  if (!attention) return null;
  return {
    tier: TIERS[attention.tier] ? attention.tier : null,
    relevance: Number.isFinite(attention.relevance) ? attention.relevance : null,
    allowance: Number.isFinite(attention.allowance) ? attention.allowance : null,
    allowanceExhausted: attention.allowanceExhausted === true,
  };
}

function projectFunction(fn, p, row, agentRows, digest, agents, coverage) {
  const identities = coverage.available
    ? coverage.value.items
        .filter(
          (item) =>
            item.tenantId === p.tenantId && item.functionId === fn.functionId && item.score >= 0.5
        )
        .map((item) => display(item.actorId))
        .filter(Boolean)
    : [];
  return {
    functionId: fn.functionId,
    label: display(fn.label),
    state: activityState(row, agentRows),
    cetResponsibility: row?.responsibility?.cet === true,
    humanCoverageObserved: (row?.responsibility?.humans?.length || 0) > 0,
    people: identities,
    coverageRestricted: coverage.restricted === true,
    attention: presentAttention(row?.attention),
    lifecycles: agentRows.map((item) => item.lifecycle).filter((value) => LIFECYCLES[value]),
    reasonKinds: [
      ...new Set(
        (row?.reason || [])
          .map((item) => item.kind)
          .filter((value) =>
            [
              'touched',
              'neighbor',
              'human_coverage',
              'budget_deferred',
              'rest',
              'allowance_exhausted',
            ].includes(value)
          )
      ),
    ],
    journal: presentDigest(digest.value),
    sources: {
      activation: !!row,
      journal: digest.available,
      agents: agents.available,
      coverage: coverage.available,
    },
  };
}

async function answerSystemActivity(
  ctx,
  message,
  { model = getFunctionModel(), overviewLimit = 5, resolverOptions = {} } = {}
) {
  const p = principal(ctx);
  const scope = activityScope(message);
  if (!scope) return { mode: 'system_activity_query', state: 'function_unknown', items: [] };
  if (scope.noticesOnly) {
    const source = await readSource(
      ctx,
      'notices.list',
      { tenantId: p.tenantId, actorId: p.actorId },
      (value) => Array.isArray(value?.items)
    );
    return {
      mode: 'system_activity_query',
      state: source.available ? 'notices' : 'notices_unavailable',
      items: [],
      noticeQueue: source.value || null,
    };
  }
  const resolution = scope.overview
    ? { metadata: { path: 'overview' } }
    : await resolveFunctionsHybrid(message, {
        ...resolverOptions,
        model,
        tenantId: p.tenantId,
        broker: ctx.broker,
        logger: ctx.logger,
      });
  if (!scope.overview) {
    if (resolution.status !== 'resolved')
      return {
        mode: 'system_activity_query',
        resolution: resolution.metadata,
        state: resolution.status === 'ambiguous' ? 'function_ambiguous' : 'function_unknown',
        candidates: resolution.matches.map(({ functionId, label, confidence }) => ({
          functionId,
          label: display(label),
          confidence,
        })),
        items: [],
      };
    const fn = model.functions.find((item) => item.functionId === resolution.matches[0].functionId);
    const item = await readFunction(ctx, fn, p);
    return {
      mode: 'system_activity_query',
      resolution: resolution.metadata,
      state: item.state,
      items: [item],
    };
  }
  const source = await readSource(ctx, 'activation.list', { tenantId: p.tenantId }, Array.isArray);
  if (!source.available)
    return {
      mode: 'system_activity_query',
      resolution: resolution.metadata,
      state: 'state_unavailable',
      items: [],
    };
  const rows = source.value
    .filter(
      (row) =>
        row.tenantId === p.tenantId &&
        row.state !== 'latent' &&
        (!scope.inventoryOnly || row.attention?.tier === 'inventory') &&
        model.functions.some((fn) => fn.functionId === row.functionId)
    )
    .sort(
      (a, b) =>
        (a.state === 'active' ? 0 : 1) - (b.state === 'active' ? 0 : 1) ||
        compareCanonicalStrings(a.functionId, b.functionId)
    );
  const items = await Promise.all(
    rows.slice(0, overviewLimit).map((row) =>
      readFunction(
        ctx,
        model.functions.find((fn) => fn.functionId === row.functionId),
        p,
        [row]
      )
    )
  );
  return {
    mode: 'system_activity_query',
    resolution: resolution.metadata,
    state: 'overview',
    inventoryOnly: scope.inventoryOnly === true,
    items,
    remaining: Math.max(0, rows.length - items.length),
  };
}

function renderAttention({ tier, relevance, allowance }) {
  const relevanceText = relevance == null ? 'nicht angegeben' : `${Math.round(relevance * 100)} %`;
  const allowanceText =
    allowance == null ? 'nicht angegeben' : `${Number(allowance.toFixed(2))} Einheiten`;
  return `Aufmerksamkeit: ${TIERS[tier] || 'nicht angegeben'}; Relevanz ${relevanceText}; Rahmen ${allowanceText}.`;
}

function renderJournal(journal) {
  if (!journal) return [];
  const parts = [];
  const categories = [
    ['openExpectations', 'Offene Erwartungen', journal.openExpectationCount],
    ['openProposals', 'Offene Vorschläge', journal.openProposalCount],
    ['lastDecisions', 'Letzte Entscheidungen', journal.lastDecisions.length],
  ];
  for (const [key, label, count] of categories) {
    const entries = journal[key];
    if (entries.length)
      parts.push(
        `${label}: ${count}. ${entries
          .slice(-3)
          .map((entry) => display(entry.summary))
          .filter(Boolean)
          .join('; ')}`
      );
  }
  return parts;
}

function renderFunctionActivity(item) {
  const states = {
    latent: 'derzeit nicht aktiv, weil noch nicht berührt',
    active_cet: 'aktiv mit CET-Verantwortung',
    active_human: 'aktiv mit beobachteter menschlicher Verantwortung',
    active_observed: 'aktiv; noch keine qualifizierende Verantwortung beobachtet',
    dormant: 'ruhend; wartet auf Anstoß',
    sleeping: 'schlafend; wartet auf Anstoß und einen ausreichenden Rahmen',
    state_unavailable: 'Systemzustand derzeit nicht erreichbar',
  };
  const parts = [`${display(item.label)}: ${states[item.state] || states.state_unavailable}.`];
  if (item.cetResponsibility && item.reasonKinds?.includes('neighbor'))
    parts.push(
      'CET übernimmt ergänzend eine benachbarte Funktion, für die noch keine ausreichende menschliche Abdeckung beobachtet wurde.'
    );
  else if (item.reasonKinds?.includes('touched'))
    parts.push('Die Funktion wurde durch einen menschlichen Anstoß aktiviert.');
  if (item.humanCoverageObserved)
    parts.push(
      item.people?.length
        ? `Sichtbare Personenkennungen: ${item.people.join(', ')}.`
        : 'Menschliche Abdeckung wurde beobachtet; Personenbezüge sind hier nicht sichtbar.'
    );
  if (item.attention) parts.push(renderAttention(item.attention));
  if (item.lifecycles?.length)
    parts.push(`Agent-Zustand: ${item.lifecycles.map((value) => LIFECYCLES[value]).join(', ')}.`);
  parts.push(...renderJournal(item.journal));
  if (
    Object.entries(item.sources || {}).some(
      ([name, available]) => !available && !(name === 'coverage' && item.coverageRestricted)
    )
  )
    parts.push(
      'Ein Teil der Zustandsquellen ist derzeit nicht erreichbar; die Auskunft ist unvollständig.'
    );
  return parts.join(' ');
}

function renderSystemActivity(result = {}) {
  if (result.state === 'notices')
    return result.noticeQueue?.block || 'Derzeit gibt es keine neuen Hinweise für dich.';
  if (result.state === 'notices_unavailable')
    return 'Hinweise sind derzeit nicht erreichbar. Bitte versuche es später erneut.';
  if (result.state === 'function_ambiguous')
    return `Welche Funktion meinst du? ${result.candidates
      .map((item) => display(item.label))
      .filter(Boolean)
      .join('; ')}.`;
  if (result.state === 'function_unknown')
    return 'Welche Funktion meinst du? Bitte nenne ihre Bezeichnung oder frage nach dem CET-Überblick.';
  if (result.state === 'state_unavailable')
    return 'Der CET-Systemzustand ist derzeit nicht erreichbar. Bitte versuche es später erneut.';
  if (result.state === 'overview' && !result.items?.length)
    return result.inventoryOnly
      ? 'Derzeit sind keine Funktionen als Inventar markiert.'
      : 'Derzeit sind keine aktiven Funktionen beobachtet. Noch nicht berührte Funktionen bleiben latent.';
  const lines = (result.items || []).map(renderFunctionActivity);
  if (result.remaining) lines.push(`${result.remaining} weitere Funktionen sind beobachtet.`);
  lines.push(
    'Zur Klärung kannst du eine sichtbare Erwartung auswählen oder den Funktionsbezug präzisieren.'
  );
  return lines.join('\n\n');
}

module.exports = {
  isFunctionKnowledgeQuery,
  isSystemActivityQuery,
  answerSystemActivity,
  renderSystemActivity,
  presentDigest,
};
