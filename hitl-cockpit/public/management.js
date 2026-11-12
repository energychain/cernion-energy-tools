'use strict';

const bootstrapUrl = new URL(location.href);
if (bootstrapUrl.searchParams.has('token')) {
  bootstrapUrl.searchParams.delete('token');
  history.replaceState(
    null,
    '',
    `${bootstrapUrl.pathname}${bootstrapUrl.search}${bootstrapUrl.hash}`
  );
}
const byId = (id) => document.getElementById(id);
const LAST_VISIT_KEY = 'agentos-management-last-visit';
const ASSISTANT_PAGE_CAP = 100;
const EMPTY_DECISIONS =
  '<div class="empty"><strong>Keine Entscheidung erforderlich</strong>AgentOS arbeitet innerhalb seines Mandats.</div>';
const AGENTS = [
  { id: 'Rhajaina', role: 'Geschäftsleitungsassistenz und Gesamtkoordination' },
  { id: 'Felix', role: 'B2B, CRM, Vertrieb und Partnerschaften' },
  { id: 'Anja', role: 'Finanzen und kaufmännische Vorgänge' },
  { id: 'Viki', role: 'Markt, Strategie und Geschäftschancen' },
  { id: 'Cori', role: 'B2C und Corrently' },
  { id: 'DevOps', role: 'Softwareentwicklung und Produktqualität' },
  { id: 'Infrastructure', role: 'Systeme und Betrieb' },
];

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
}

function parseTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatTime(timestamp, fallback = 'nicht angegeben') {
  const seconds = parseTimestamp(timestamp);
  if (!seconds) return fallback;
  return new Date(seconds * 1000).toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatList(value, fallback = 'nicht angegeben') {
  if (!Array.isArray(value) || !value.length) return fallback;
  return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' · ');
}

function lastVisit() {
  try {
    return Number(localStorage.getItem(LAST_VISIT_KEY)) || 0;
  } catch (_) {
    return 0;
  }
}

function rememberVisit() {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(Math.floor(Date.now() / 1000)));
  } catch (_) {
    // Private browsing may disable local storage. The cockpit remains usable.
  }
}

async function api(pathname) {
  const response = await fetch(pathname, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const assistantState = {
  config: null,
  conversations: [],
  conversationId: null,
  context: null,
  contextLabels: new Map(),
  switching: false,
  sending: false,
  switchVersion: 0,
};
let assistantOpener = null;

async function assistantRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    method: options.method || 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function assistantStatus(message) {
  byId('assistant-status').textContent = message;
}

async function refreshAssistantConfig() {
  const config = await assistantRequest('/api/assistant/config');
  assistantState.config = config;
  byId('assistant-text').maxLength = config.limits.maxMessageChars;
  updateAssistantMode();
  return config;
}

function assistantModePresentation(config) {
  if (!config || !config.enabled) {
    return {
      label: 'Assistenz deaktiviert',
      description: 'Rhajaina ist in dieser Umgebung nicht aktiviert.',
      ready: 'Deaktiviert',
    };
  }
  if (!config.writesEnabled) {
    if (config.mode === 'shadow') {
      return {
        label: 'Shadow-Assistenz',
        description:
          'Rhajaina ordnet den Managementkontext ein und kann Vorschläge simulieren. Es werden keine operativen Änderungen ausgeführt.',
        ready: 'Shadow-Modus · bereit',
      };
    }
    return {
      label: 'Read-only Assistenz',
      description:
        'Rhajaina ordnet den freigegebenen Managementkontext ein. Sie führt keine Änderungen, Tools oder externen Aktionen aus.',
      ready: 'Read-only · bereit',
    };
  }
  const modes = {
    low_risk: {
      label: 'Assistenz · begrenzte Aktionen',
      description:
        'Deine Anweisung erzeugt einen ausführbaren Vorschlag. Nach deiner Bestätigung schreibt das Cockpit den Auftrag nach Kanban und übergibt ihn an den sicheren Matrix-Fachraum.',
      ready: 'Produktiver Low-Risk-Betrieb · bereit',
    },
    scoped: {
      label: 'Assistenz · Scope-gedeckt',
      description:
        'Rhajaina kann bestätigte Aktionen nur innerhalb eines serverseitig belegten Handlungsscope ausführen.',
      ready: 'Scope-gedeckter Modus · bereit',
    },
    productive: {
      label: 'Produktive Assistenz',
      description:
        'Rhajaina kann erlaubte Aktionen innerhalb der aktiven Governance- und Scope-Grenzen ausführen.',
      ready: 'Produktiver Modus · bereit',
    },
  };
  return (
    modes[config.mode] || {
      label: 'Assistenz',
      description: 'Rhajaina arbeitet innerhalb der serverseitig freigegebenen Grenzen.',
      ready: 'Bereit',
    }
  );
}

function updateAssistantMode() {
  const presentation = assistantModePresentation(assistantState.config);
  byId('assistant-mode-label').textContent = presentation.label;
  byId('assistant-mode-description').textContent = presentation.description;
  return presentation;
}

function assistantContextLabel(context) {
  if (!context) return 'Globales Gespräch';
  const labels = {
    topic: 'Thema',
    decision: 'Entscheidung',
    department: 'Abteilung',
    outcome: 'Ergebnis',
    risk: 'Risiko',
    wakeup: 'Wiedervorlage',
  };
  const type = labels[context.objectType] || context.objectType;
  return `${type}: ${context.label ? `${context.label} · ` : ''}${context.objectId}`;
}

function assistantContextKey(context) {
  return context ? `${context.objectType}:${context.objectId}` : '';
}

function assistantContextButton(objectType, objectId, label = '') {
  if (!objectType || !objectId) return '';
  return `<button class="assistant-context-action" type="button" data-assistant-context data-object-type="${escapeHtml(objectType)}" data-object-id="${escapeHtml(objectId)}" data-object-label="${escapeHtml(label)}">Mit Rhajaina besprechen</button>`;
}

function updateAssistantContext() {
  const row = byId('assistant-context-row');
  row.hidden = !assistantState.context;
  row.setAttribute('aria-hidden', String(!assistantState.context));
  if (assistantState.context) {
    const fullLabel = assistantContextLabel(assistantState.context);
    const [type] = fullLabel.split(':');
    byId('assistant-context-type').textContent = type;
    byId('assistant-context-label').textContent = assistantState.context.label || 'Ohne Titel';
    byId('assistant-context-id').textContent = `ID ${assistantState.context.objectId}`;
  }
  byId('assistant-conversation-select').value = assistantState.conversationId || '';
}

function assistantTopicNotice(context) {
  const notice = byId('assistant-topic-notice');
  notice.textContent = `Thema gewechselt · ${assistantContextLabel(context)}`;
  notice.hidden = false;
}

function assistantArtifactItems(item, names) {
  for (const name of names) {
    const value = item && item[name];
    if (Array.isArray(value)) return value;
    if (value) return [value];
  }
  return [];
}

function assistantArtifactText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return [
    value.title,
    value.label,
    value.summary,
    value.description,
    value.action,
    value.status,
    value.id,
  ]
    .filter((part) => typeof part === 'string' || typeof part === 'number')
    .join(' · ');
}

function renderAssistantArtifacts(item, article) {
  const productive = Boolean(assistantState.config && assistantState.config.writesEnabled);
  const groups = [
    [
      productive ? 'Ausführungsvorschlag' : 'Shadow-Vorschlag',
      assistantArtifactItems(item, ['proposal', 'shadowProposals', 'shadowProposal', 'proposals']),
    ],
    [
      productive ? 'Ausführungsbeleg' : 'Shadow-Beleg',
      assistantArtifactItems(item, ['receipt', 'shadowReceipts', 'shadowReceipt', 'receipts']),
    ],
  ];
  for (const [label, values] of groups) {
    for (const value of values) {
      const text = assistantArtifactText(value);
      if (!text) continue;
      const artifact = document.createElement('div');
      artifact.className = 'assistant-shadow-artifact';
      const heading = document.createElement('strong');
      heading.textContent = label;
      const content = document.createElement('span');
      content.textContent = text;
      artifact.append(heading, content);
      if (
        label.toLocaleLowerCase('de-DE').endsWith('vorschlag') &&
        value &&
        value.id &&
        value.status === 'shadow'
      ) {
        const actions = document.createElement('div');
        actions.className = 'assistant-proposal-actions';
        if (assistantState.config && assistantState.config.writesEnabled) {
          const confirm = document.createElement('button');
          confirm.type = 'button';
          confirm.dataset.assistantProposal = value.id;
          confirm.dataset.proposalAction = 'confirm';
          if (value.assigneeRequired) confirm.dataset.assigneeRequired = 'true';
          confirm.textContent = 'Ausführen';
          actions.append(confirm);
        }
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.dataset.assistantProposal = value.id;
        reject.dataset.proposalAction = 'reject';
        reject.textContent = 'Verwerfen';
        actions.append(reject);
        artifact.append(actions);
      }
      article.append(artifact);
    }
  }
}

function assistantActivityStatus(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const receipts = assistantArtifactItems(item, [
      'receipt',
      'shadowReceipts',
      'shadowReceipt',
      'receipts',
    ]);
    if (receipts.length && assistantState.config && assistantState.config.writesEnabled) {
      return 'Ausgeführt · Kanban-Readback und Übergabebeleg sind protokolliert.';
    }
    const proposals = assistantArtifactItems(item, [
      'proposal',
      'shadowProposals',
      'shadowProposal',
      'proposals',
    ]);
    if (
      proposals.some((proposal) => proposal && proposal.status === 'shadow') &&
      assistantState.config &&
      assistantState.config.writesEnabled
    ) {
      return 'Ausführung vorbereitet · Vorschlag prüfen und „Ausführen“ wählen.';
    }
  }
  return assistantModePresentation(assistantState.config).ready;
}

function renderAssistantMessages(items) {
  const container = byId('assistant-messages');
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'assistant-empty';
    empty.textContent = 'Noch keine Nachrichten in dieser Unterhaltung.';
    container.append(empty);
    return;
  }
  for (const item of items) {
    const article = document.createElement('article');
    article.className = `assistant-message ${item.role === 'assistant' ? 'assistant' : 'user'}`;
    const label = document.createElement('strong');
    label.textContent = item.role === 'assistant' ? 'Rhajaina' : 'Du';
    const content = document.createElement('p');
    content.textContent = item.content;
    article.append(label, content);
    renderAssistantArtifacts(item, article);
    container.append(article);
  }
  container.scrollTop = container.scrollHeight;
}

async function refreshAssistantConversations() {
  const data = await assistantRequest('/api/assistant/conversations');
  assistantState.conversations = data.items || [];
  const select = byId('assistant-conversation-select');
  select.replaceChildren(new Option('Globales Gespräch', ''));
  for (const conversation of assistantState.conversations) {
    const context = conversation.objectType
      ? {
          objectType: conversation.objectType,
          objectId: conversation.objectId,
          label: assistantState.contextLabels.get(
            `${conversation.objectType}:${conversation.objectId}`
          ),
        }
      : null;
    select.append(new Option(assistantContextLabel(context), conversation.id));
  }
}

async function loadAssistantMessages() {
  if (!assistantState.conversationId) {
    renderAssistantMessages([]);
    return;
  }
  assistantStatus('Unterhaltung wird geladen …');
  const items = [];
  let cursor = null;
  let pages = 0;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const data = await assistantRequest(
      `/api/assistant/conversations/${encodeURIComponent(assistantState.conversationId)}/messages?${query}`
    );
    items.push(...(data.items || []));
    cursor = data.nextCursor || null;
    pages += 1;
  } while (cursor && pages < ASSISTANT_PAGE_CAP);
  if (cursor) throw new Error('assistant_message_page_cap');
  renderAssistantMessages(items);
  assistantStatus(assistantActivityStatus(items));
}

async function selectAssistantContext(context, options = {}) {
  if (assistantState.sending) {
    assistantStatus('Bitte warte, bis die laufende Nachricht abgeschlossen ist.');
    return;
  }
  const notice = byId('assistant-topic-notice');
  notice.hidden = true;
  notice.textContent = '';
  const nextContext = context
    ? {
        objectType: String(context.objectType),
        objectId: String(context.objectId),
        ...(context.label ? { label: String(context.label) } : {}),
      }
    : null;
  const nextKey = assistantContextKey(nextContext);
  const switchVersion = ++assistantState.switchVersion;
  if (nextContext && nextContext.label) {
    assistantState.contextLabels.set(nextKey, nextContext.label);
  }
  assistantState.switching = true;
  byId('assistant-send').disabled = true;
  byId('assistant-text').disabled = true;
  assistantStatus('Gesprächsthema wird gewechselt …');
  try {
    await refreshAssistantConversations();
    let conversation = assistantState.conversations.find((item) =>
      nextContext
        ? item.objectType === nextContext.objectType && item.objectId === nextContext.objectId
        : !item.objectType && !item.objectId
    );
    if (!conversation) {
      const apiContext = nextContext
        ? { objectType: nextContext.objectType, objectId: nextContext.objectId }
        : null;
      conversation = await assistantRequest('/api/assistant/conversations', {
        method: 'POST',
        body: { context: apiContext },
      });
      await refreshAssistantConversations();
    }
    if (switchVersion !== assistantState.switchVersion) return;
    assistantState.context = nextContext;
    assistantState.conversationId = conversation.id;
    updateAssistantContext();
    await loadAssistantMessages();
    if (options.announce) {
      assistantTopicNotice(nextContext);
      assistantStatus(`Thema gewechselt · ${assistantContextLabel(nextContext)}`);
    }
  } finally {
    if (switchVersion === assistantState.switchVersion) {
      assistantState.switching = false;
      byId('assistant-send').disabled = false;
      byId('assistant-text').disabled = false;
    }
  }
}

async function openAssistant(context = undefined) {
  const panel = byId('assistant-panel');
  const backdrop = byId('assistant-backdrop');
  const wasOpen = document.body.classList.contains('assistant-opened');
  if (!wasOpen) assistantOpener = document.activeElement;
  document.body.classList.add('assistant-opened');
  panel.removeAttribute('inert');
  panel.setAttribute('aria-hidden', 'false');
  backdrop.removeAttribute('hidden');
  backdrop.removeAttribute('inert');
  assistantStatus('Aktueller Betriebsmodus wird geprüft …');
  await refreshAssistantConfig();
  if (!assistantState.config.enabled) {
    assistantStatus('Rhajaina ist in dieser Umgebung deaktiviert.');
    byId('assistant-form').hidden = true;
    byId('assistant-title').focus();
    return;
  }
  byId('assistant-form').hidden = false;
  await selectAssistantContext(context === undefined ? assistantState.context : context, {
    announce: wasOpen && context !== undefined,
  });
  byId('assistant-text').focus();
}

function closeAssistant() {
  document.body.classList.remove('assistant-opened');
  const panel = byId('assistant-panel');
  const backdrop = byId('assistant-backdrop');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('inert', '');
  backdrop.setAttribute('hidden', '');
  backdrop.setAttribute('inert', '');
  if (assistantOpener && typeof assistantOpener.focus === 'function') assistantOpener.focus();
  assistantOpener = null;
}

async function pollAssistantRun(runId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const run = await assistantRequest(`/api/assistant/runs/${encodeURIComponent(runId)}`);
    if (run.status === 'completed') return run;
    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(run.errorCode || 'assistant_run_failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('assistant_run_timeout');
}

function assistantClientMessageId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function sendAssistantMessage() {
  const textarea = byId('assistant-text');
  const text = textarea.value.trim();
  if (!text || !assistantState.conversationId || assistantState.switching || assistantState.sending)
    return;
  const conversationId = assistantState.conversationId;
  const button = byId('assistant-send');
  assistantState.sending = true;
  button.disabled = true;
  textarea.disabled = true;
  assistantStatus('Rhajaina ordnet die Frage ein …');
  try {
    await refreshAssistantConfig();
    if (!assistantState.config.enabled) throw new Error('assistant_disabled');
    const run = await assistantRequest(
      `/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        body: { clientMessageId: assistantClientMessageId(), text },
      }
    );
    textarea.value = '';
    await loadAssistantMessages();
    await pollAssistantRun(run.runId);
    await loadAssistantMessages();
  } catch (cause) {
    assistantStatus(`Antwort nicht verfügbar: ${cause.message}`);
  } finally {
    assistantState.sending = false;
    button.disabled = false;
    textarea.disabled = false;
    textarea.focus();
  }
}

async function previewDecisionAction(decisionId, action, payload) {
  const pathname = `/api/management/decisions/${encodeURIComponent(decisionId)}/${action}`;
  const response = await fetch(pathname, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  if (data.writePerformed || data.persisted || data.mode !== 'shadow') {
    throw new Error('shadow_contract_violated');
  }
  return data;
}

function showError(target, cause) {
  byId(target).innerHTML =
    `<div class="error">Daten konnten nicht gelesen werden: ${escapeHtml(cause.message)}</div>`;
}

function taskButton(board, taskId) {
  if (!taskId) return '';
  const reference = board ? `${board}/${taskId}` : taskId;
  return `<button class="task-ref" type="button" data-copy="${escapeHtml(reference)}" title="Task-Referenz kopieren"><span>Task</span> ${escapeHtml(taskId)} <span aria-hidden="true">⧉</span></button>`;
}

function matrixLink(roomRef) {
  if (!/^![^\s:]{6,}:[a-z0-9.-]+$/i.test(String(roomRef || ''))) return '';
  const href = `https://matrix.to/#/${encodeURIComponent(roomRef)}`;
  return `<a class="context-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Im Fachraum öffnen</a>`;
}

function artifactLabels(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : []).map((artifact) => {
    if (typeof artifact === 'string') return artifact;
    return [artifact.title || artifact.id, artifact.nextcloudPath].filter(Boolean).join(' · ');
  });
}

function details(rows) {
  const content = rows
    .filter((row) => row[1] !== null && row[1] !== undefined && row[1] !== '')
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(Array.isArray(value) ? formatList(value) : value)}</dd></div>`
    )
    .join('');
  return content
    ? `<details><summary>Quellen und Details</summary><dl class="detail-grid">${content}</dl></details>`
    : '';
}

function topicCard(topic) {
  const participants = Array.isArray(topic.participating_agents)
    ? topic.participating_agents
    : [topic.owner_agent].filter(Boolean);
  const refs = Array.isArray(topic.source_task_refs) ? topic.source_task_refs : [];
  const primary = refs[0] || {};
  return `<article class="card">
    <div class="eyebrow">${escapeHtml(topic.owner_agent || 'Ohne Zuordnung')} · ${escapeHtml(topic.current_state || 'unbekannt')}</div>
    <h3>${escapeHtml(topic.title || 'Unbenanntes Thema')}</h3>
    ${topic.business_goal ? `<p><b>Ziel:</b> ${escapeHtml(topic.business_goal)}</p>` : ''}
    ${topic.next_step ? `<p><b>Nächster Schritt:</b> ${escapeHtml(topic.next_step)}</p>` : ''}
    <div class="card-meta">Letzter substantieller Fortschritt: ${escapeHtml(formatTime(topic.last_substantive_progress_at))}</div>
    <div class="pills">${participants.map((agent) => `<span class="pill">${escapeHtml(agent)}</span>`).join('')}</div>
    <div class="context-actions">${taskButton(primary.board, primary.taskId || primary.task_id)}${matrixLink(topic.matrix_room_ref)}${assistantContextButton('topic', topic.topic_id, topic.title || 'Unbenanntes Thema')}</div>
    ${details([
      ['Topic-ID', topic.topic_id],
      ['Erwarteter Fortschritt', formatTime(topic.expected_progress_at)],
      ['Erwartete Wirkung', topic.impact_statement],
      [
        'Quellreferenzen',
        refs.map((ref) => `${ref.board || ''}/${ref.taskId || ref.task_id || ''}`),
      ],
      ['Artefakte', artifactLabels(topic.artifact_refs)],
    ])}
  </article>`;
}

function decisionCard(decision, compact = false, contextType = 'decision') {
  const options = Array.isArray(decision.options) ? decision.options : [];
  const consequences = Array.isArray(decision.consequences) ? decision.consequences : [];
  const risk =
    decision.classifier_label === 'RISK_ESCALATION' ||
    decision.decision_class === 'scope_violation';
  return `<article class="card ${risk ? 'card-risk' : 'card-accent'}">
    <div class="eyebrow">${escapeHtml(decision.decision_class || 'Governance')} · ${escapeHtml(decision.source_board || '')}</div>
    <h3>${escapeHtml(decision.question || 'Entscheidung ohne formulierte Frage')}</h3>
    ${decision.reason_human_required ? `<p>${escapeHtml(decision.reason_human_required)}</p>` : ''}
    ${decision.recommendation ? `<p><b>Empfehlung:</b> ${escapeHtml(decision.recommendation)}</p>` : '<p class="card-meta">Empfehlung ist in der Projektion noch nicht ausgewiesen.</p>'}
    <div class="pills">
      <span class="pill">${escapeHtml(decision.classifier_label || '')}</span>
      ${decision.deadline ? `<span class="pill pill-risk">Frist ${escapeHtml(formatTime(decision.deadline))}</span>` : ''}
    </div>
    <div class="context-actions">${taskButton(decision.source_board, decision.source_task_id)}${matrixLink(decision.matrix_room_ref)}${assistantContextButton(contextType, decision.decision_id, decision.question || 'Entscheidung ohne formulierte Frage')}</div>
    ${
      compact
        ? ''
        : `<div class="shadow-actions" data-decision-actions="${escapeHtml(decision.decision_id)}">
          <div><b>Entscheidung erproben</b><span>Shadow-Modus · keine Speicherung oder Ausführung</span></div>
          <button type="button" data-shadow-action="choose">Option wählen</button>
          <button type="button" data-shadow-action="delegate">Delegieren</button>
          <button type="button" data-shadow-action="question">Rückfrage</button>
          <button type="button" data-shadow-action="schedule">Wiedervorlage</button>
          <button type="button" data-shadow-action="reject">Ablehnen</button>
          <button type="button" data-shadow-action="return-to-rhajaina">An Rhajaina zurück</button>
        </div>`
    }
    ${
      compact
        ? ''
        : details([
            ['Decision-ID', decision.decision_id],
            [
              'Quellkanäle',
              (decision.source_refs || []).map(
                (ref) => `${ref.channel || 'kanban'} · ${ref.board}/${ref.taskId || ref.task_id}`
              ),
            ],
            ['Artefakte', artifactLabels(decision.topic_artifact_refs)],
            ['Optionen', options],
            ['Auswirkungen', consequences],
            ['Folge der Nichtentscheidung', decision.non_decision_effect],
            ['Ausführungsscope', decision.execution_scope],
            ['Ausgeschlossen', decision.excluded_scope],
            ['Klassifikationsgründe', decision.classifier_reasons],
          ])
    }
  </article>`;
}

function shadowPayload(action) {
  if (action === 'choose') {
    const option = window.prompt('Welche projizierte Option soll simuliert werden?');
    return option ? { option } : null;
  }
  if (action === 'delegate') {
    const assignee = window.prompt('An wen soll die Entscheidung delegiert werden?');
    return assignee ? { assignee } : null;
  }
  if (action === 'question') {
    const question = window.prompt('Welche Rückfrage soll simuliert werden?');
    return question ? { question } : null;
  }
  if (action === 'schedule') {
    const wakeAt = window.prompt(
      'Wiedervorlage als ISO-Zeitpunkt, z. B. 2026-12-01T09:00:00+01:00'
    );
    if (!wakeAt) return null;
    const reason = window.prompt('Warum soll der Vorgang dann wieder vorgelegt werden?');
    if (!reason) return null;
    const nextAction = window.prompt(
      'Welcher konkrete nächste Schritt wird bei Fälligkeit ausgeführt?'
    );
    if (!nextAction) return null;
    const owner = window.prompt('Welcher Agent verantwortet die Wiedervorlage?');
    return owner ? { wakeAt, reason, nextAction, owner } : null;
  }
  const reason = window.prompt(
    action === 'reject'
      ? 'Warum soll der Vorgang abgelehnt werden?'
      : 'Was soll Rhajaina an der Decision vervollständigen?'
  );
  return reason ? { reason } : null;
}

function outcomeCard(item) {
  return `<article class="card">
    <div class="eyebrow">${escapeHtml(item.outcome_type || 'Ergebnis')} · ${escapeHtml(formatTime(item.occurred_at))}</div>
    <h3>${escapeHtml(item.statement || 'Belegtes Ergebnis')}</h3>
    ${item.economic_relevance ? `<p class="card-meta">Wirtschaftliche Einordnung: ${escapeHtml(item.economic_relevance)}</p>` : ''}
    <div class="context-actions">${taskButton(item.source_board, item.source_task_id)}${assistantContextButton('outcome', item.outcome_id, item.statement || 'Belegtes Ergebnis')}</div>
    ${details([
      ['Gegenpartei', item.counterparty],
      ['Evidenz', item.evidence_refs],
      ['Konfidenz', item.confidence],
    ])}
  </article>`;
}

function isMatureDecision(item) {
  return Boolean(
    item &&
    item.question &&
    item.reason_human_required &&
    item.recommendation &&
    Array.isArray(item.options) &&
    item.options.length &&
    Array.isArray(item.consequences) &&
    item.consequences.length &&
    item.non_decision_effect
  );
}

async function loadMetadata() {
  try {
    const data = await api('/api/management/metadata');
    const age = data.projectedAt
      ? Math.max(0, Math.floor(Date.now() / 1000) - data.projectedAt)
      : null;
    byId('projection-meta').textContent =
      `${data.boardCount} Quellen · Projektionsstand ${formatTime(data.projectedAt)}` +
      (age !== null ? ` · ${Math.floor(age / 60)} Min. alt` : '');
  } catch (cause) {
    byId('projection-meta').textContent = `Projektion nicht verfügbar: ${cause.message}`;
  }
}

async function loadOverview() {
  try {
    const [data, risks] = await Promise.all([
      api('/api/management/overview'),
      api('/api/management/risks?limit=5'),
    ]);
    const counts = data.counts || {};
    const matureDecisions = (data.decisions || []).filter(isMatureDecision);
    const since = lastVisit();
    const changedTopics = (data.activeTopics || []).filter(
      (item) => parseTimestamp(item.updated_at || item.last_substantive_progress_at) > since
    );
    const newOutcomes = (data.recentOutcomes || []).filter(
      (item) => parseTimestamp(item.occurred_at) > since
    );
    const sinceText = since
      ? `${changedTopics.length} Themen und ${newOutcomes.length} Ergebnisse seit ${formatTime(since)}`
      : 'Erster Besuch in dieser Cockpit-Ansicht';
    byId('overview').innerHTML = `
      <div class="notice"><b>Seit dem letzten Besuch:</b> ${escapeHtml(sinceText)}</div>
      <div class="metrics" aria-label="Verdichteter Projektionsstand">
        <div class="metric"><strong>${counts.decisions || 0}</strong><span>Entscheidungskandidaten der Projektion</span></div>
        <div class="metric"><strong>${counts.topics || 0}</strong><span>Managementthemen</span></div>
        <div class="metric"><strong>${counts.outcomes || 0}</strong><span>belegte Ergebnisse</span></div>
        <div class="metric"><strong>${risks.count || 0}</strong><span>sichtbare Risiken</span></div>
      </div>
      <div class="editorial-grid">
        <section>
          <div class="column-title"><h3>Erwartet Aufmerksamkeit</h3><span>Governance</span></div>
          ${matureDecisions.map((item) => decisionCard(item, true)).join('') || EMPTY_DECISIONS}
          ${(risks.items || []).length ? `<div class="column-title"><h3>Risiken</h3><span>Scope und Bindung</span></div>${risks.items.map((item) => decisionCard(item, true, 'risk')).join('')}` : ''}
        </section>
        <section>
          <div class="column-title"><h3>Aktuell in Arbeit</h3><span>substantieller Fortschritt</span></div>
          ${(data.activeTopics || []).map(topicCard).join('') || '<div class="empty">Keine aktiven Managementthemen in der Projektion.</div>'}
        </section>
      </div>
      <div class="column-title"><h3>Jüngste belegte Ergebnisse</h3><span>Außenwirkung und Abschluss</span></div>
      ${(data.recentOutcomes || []).map(outcomeCard).join('') || '<div class="empty">Noch keine belegten Ergebnisse in der Projektion.</div>'}`;
    rememberVisit();
  } catch (cause) {
    showError('overview', cause);
  }
}

async function loadDecisions() {
  try {
    const query = byId('decision-search').value.trim();
    const data = await api(`/api/management/decisions?limit=100&q=${encodeURIComponent(query)}`);
    const matureDecisions = (data.items || []).filter(isMatureDecision);
    byId('decisions').innerHTML =
      `<div class="list-head"><span>${matureDecisions.length} reife Governance-Fälle in der geladenen Auswahl</span><span>read-only</span></div>` +
      (matureDecisions.map((item) => decisionCard(item)).join('') || EMPTY_DECISIONS);
  } catch (cause) {
    showError('decisions', cause);
  }
}

function briefItems(items, render, emptyText) {
  if (!Array.isArray(items) || !items.length)
    return `<p class="brief-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul class="brief-list">${items.map((item) => `<li>${render(item)}</li>`).join('')}</ul>`;
}

function departmentCard(agent, item) {
  if (!item) {
    return `<article class="card department-card missing"><div class="eyebrow">Abteilungsleitung</div><h3>${escapeHtml(agent.id)}</h3><div class="department-role">${escapeHtml(agent.role)}</div><div class="empty">Noch kein aktueller Managementbrief in der Projektion.</div></article>`;
  }
  const statusLabels = {
    current: 'Evidenzbasierter Bericht',
    active_without_substantive_progress: 'Aktiv · Wirkung noch nicht belegt',
    empty: 'Erklärter Leerstand',
  };
  const topics = Array.isArray(item.active_topic_refs) ? item.active_topic_refs : [];
  const outcomes = Array.isArray(item.outcomes) ? item.outcomes : [];
  const needs = Array.isArray(item.needs_management) ? item.needs_management : [];
  const risks = Array.isArray(item.risks) ? item.risks : [];
  return `<article class="card department-card brief-${escapeHtml(item.brief_status || 'empty')}">
    <div class="eyebrow">${escapeHtml(statusLabels[item.brief_status] || 'Managementbrief')}</div>
    <h3>${escapeHtml(agent.id)}</h3>
    <div class="department-role">${escapeHtml(agent.role)}</div>
    ${item.current_goal ? `<p><b>Aktuelles Ziel:</b> ${escapeHtml(item.current_goal)}</p>` : ''}
    ${item.empty_state_reason ? `<div class="brief-state">${escapeHtml(item.empty_state_reason)}</div>` : ''}
    <div class="department-stats">
      <div><strong>${topics.length}</strong><span>relevante Themen</span></div>
      <div><strong>${outcomes.filter((outcome) => outcome.progressQualified).length}</strong><span>belegte Fortschritte</span></div>
      <div><strong>${needs.length}</strong><span>Governancefragen</span></div>
    </div>
    <div class="brief-columns">
      <section><h4>Themen</h4>${briefItems(
        topics,
        (topic) =>
          `<b>${escapeHtml(topic.title || topic.topicId)}</b><span>${escapeHtml(
            topic.progressClassification === 'technical_enabler_only'
              ? 'Technischer Enabler · nicht als Fortschritt gewertet'
              : topic.progressClassification === 'evidence_backed_progress'
                ? 'Belegter substantieller Fortschritt'
                : 'Aktiv · Fortschritt noch nicht belegt'
          )}</span>`,
        'Keine aktiven Managementthemen.'
      )}</section>
      <section><h4>Nächste Schritte</h4>${briefItems(
        item.next_actions,
        (action) => escapeHtml(action),
        'Kein strukturierter nächster Schritt ausgewiesen.'
      )}</section>
    </div>
    <section class="department-governance"><h4>Governancefragen</h4>${briefItems(
      needs,
      (decision) =>
        `<b>${escapeHtml(decision.question || 'Governancefrage ohne Titel')}</b>${
          decision.recommendation
            ? `<span>Empfehlung: ${escapeHtml(decision.recommendation)}</span>`
            : '<span>Empfehlung ist noch nicht ausgewiesen.</span>'
        }<div class="context-actions">${taskButton(
          decision.source?.board,
          decision.source?.taskId
        )}${assistantContextButton(
          'decision',
          decision.decisionId,
          decision.question || 'Governancefrage ohne Titel'
        )}</div>`,
      'Keine offene Governancefrage.'
    )}</section>
    ${briefItems(
      outcomes,
      (outcome) =>
        `<b>${escapeHtml(outcome.statement || outcome.type)}</b><span>${escapeHtml(
          outcome.progressQualified
            ? `Belegt · ${formatTime(outcome.occurredAt)}`
            : 'Operatives Ergebnis · nicht als fachlicher Fortschritt gewertet'
        )}</span>`,
      'Keine belegten Ergebnisse im Berichtszeitraum.'
    )}
    <p class="card-meta">Letzter belegter substantieller Fortschritt: ${escapeHtml(
      formatTime(item.last_substantive_progress_at, 'im Berichtszeitraum nicht belegt')
    )}</p>
    <div class="context-actions">${assistantContextButton('department', item.agent_id, agent.id)}</div>
    ${details([
      ['Berichtszeitraum von', formatTime(item.reporting_period_start)],
      ['Berichtszeitraum bis', formatTime(item.reporting_period_end)],
      ['Abhängigkeiten', item.dependencies],
      ['Risiken', risks],
      ['Benötigte Managemententscheidung', needs],
      ['Evidenz', item.evidence_refs],
    ])}
  </article>`;
}

async function loadDepartments() {
  try {
    const data = await api('/api/management/departments');
    const projected = new Map(
      (data.items || []).map((item) => [String(item.agent_id).toLowerCase(), item])
    );
    const configuredNames = new Set(AGENTS.map((agent) => agent.id.toLowerCase()));
    const roster = [
      ...AGENTS,
      ...(data.items || [])
        .filter((item) => !configuredNames.has(String(item.agent_id).toLowerCase()))
        .map((item) => ({ id: item.agent_id, role: 'Zusätzlicher Verantwortungsbereich' })),
    ];
    byId('departments').innerHTML = `<div class="department-grid">${roster
      .map((agent) => departmentCard(agent, projected.get(agent.id.toLowerCase())))
      .join('')}</div>`;
  } catch (cause) {
    showError('departments', cause);
  }
}

async function loadTopics() {
  try {
    const query = byId('topic-search').value.trim();
    const data = await api(`/api/management/topics?limit=100&q=${encodeURIComponent(query)}`);
    byId('topics').innerHTML =
      `<div class="list-head"><span>${data.count} Themen</span><span>Ziel · Stand · nächster Schritt</span></div>` +
      ((data.items || []).map(topicCard).join('') ||
        '<div class="empty">Keine Themen gefunden.</div>');
  } catch (cause) {
    showError('topics', cause);
  }
}

function timelineItem(item) {
  const type = item.timelineType;
  const title =
    type === 'outcome' ? item.statement : type === 'wakeup' ? item.why_scheduled : item.question;
  const time =
    type === 'outcome' ? item.occurred_at : type === 'wakeup' ? item.wake_at : item.updated_at;
  const label =
    type === 'outcome' ? 'Ergebnis' : type === 'wakeup' ? 'Wiedervorlage' : 'Richtungsfrage';
  const detail =
    type === 'outcome'
      ? item.outcome_type
      : type === 'wakeup'
        ? item.next_action_on_wake
        : item.recommendation;
  const objectId =
    type === 'outcome' ? item.outcome_id : type === 'wakeup' ? item.wakeup_id : item.decision_id;
  return `<article class="timeline-item ${escapeHtml(type)}"><div class="timeline-time">${escapeHtml(formatTime(time))} · ${label}</div><h3>${escapeHtml(title || label)}</h3>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}<div class="context-actions">${taskButton(item.source_board, item.source_task_id)}${assistantContextButton(type, objectId, title || label)}</div></article>`;
}

async function loadHistory() {
  try {
    const [outcomes, wakeups, decisions] = await Promise.all([
      api('/api/management/outcomes?limit=100'),
      api('/api/management/wakeups?limit=100'),
      api('/api/management/decisions?limit=100'),
    ]);
    const entries = [
      ...(outcomes.items || []).map((item) => ({ ...item, timelineType: 'outcome' })),
      ...(wakeups.items || []).map((item) => ({ ...item, timelineType: 'wakeup' })),
      ...(decisions.items || [])
        .filter(isMatureDecision)
        .map((item) => ({ ...item, timelineType: 'decision' })),
    ].sort((left, right) => {
      const leftTime = left.occurred_at || left.wake_at || left.updated_at || 0;
      const rightTime = right.occurred_at || right.wake_at || right.updated_at || 0;
      return rightTime - leftTime;
    });
    byId('history').innerHTML = entries.length
      ? `<div class="timeline">${entries.map(timelineItem).join('')}</div>`
      : '<div class="empty">Noch kein Managementverlauf in der Projektion.</div>';
  } catch (cause) {
    showError('history', cause);
  }
}

const loaders = {
  overview: loadOverview,
  decisions: loadDecisions,
  departments: loadDepartments,
  topics: loadTopics,
  history: loadHistory,
};

function openView(view, updateHash = true) {
  const target = loaders[view] ? view : 'overview';
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === target;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.viewPanel === target);
  });
  if (updateHash)
    history.replaceState(null, '', `${location.pathname}${location.search}#${target}`);
  loaders[target]();
  document.querySelector('main').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toast(message) {
  const element = byId('toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('visible'), 1800);
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => openView(button.dataset.view));
});
document.querySelectorAll('[data-assistant-open]').forEach((button) => {
  button.addEventListener('click', () => {
    openAssistant(null).catch((cause) =>
      assistantStatus(`Assistenz nicht verfügbar: ${cause.message}`)
    );
  });
});
byId('assistant-close').addEventListener('click', closeAssistant);
byId('assistant-backdrop').addEventListener('click', closeAssistant);
byId('assistant-context-remove').addEventListener('click', () => {
  selectAssistantContext(null, { announce: true }).catch((cause) =>
    assistantStatus(`Kontext nicht verfügbar: ${cause.message}`)
  );
});
byId('assistant-global').addEventListener('click', () => {
  selectAssistantContext(null, { announce: true })
    .then(() => byId('assistant-text').focus())
    .catch((cause) => assistantStatus(`Kontext nicht verfügbar: ${cause.message}`));
});
byId('assistant-reload').addEventListener('click', () => {
  loadAssistantMessages().catch((cause) =>
    assistantStatus(`Neu laden fehlgeschlagen: ${cause.message}`)
  );
});
byId('assistant-conversation-select').addEventListener('change', (event) => {
  const conversation = assistantState.conversations.find((item) => item.id === event.target.value);
  const context =
    conversation && conversation.objectType
      ? {
          objectType: conversation.objectType,
          objectId: conversation.objectId,
          label: assistantState.contextLabels.get(
            `${conversation.objectType}:${conversation.objectId}`
          ),
        }
      : null;
  selectAssistantContext(context, { announce: true }).catch((cause) =>
    assistantStatus(`Kontext nicht verfügbar: ${cause.message}`)
  );
});
byId('assistant-form').addEventListener('submit', (event) => {
  event.preventDefault();
  sendAssistantMessage();
});
byId('assistant-text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    byId('assistant-form').requestSubmit();
  }
});
document.querySelectorAll('[data-refresh]').forEach((button) => {
  button.addEventListener('click', () => loaders[button.dataset.refresh]());
});
document.addEventListener('click', async (event) => {
  const proposalButton = event.target.closest('[data-assistant-proposal]');
  if (proposalButton) {
    proposalButton.disabled = true;
    const proposalId = proposalButton.dataset.assistantProposal;
    const action = proposalButton.dataset.proposalAction;
    try {
      const body = {};
      if (action === 'confirm' && proposalButton.dataset.assigneeRequired === 'true') {
        const assignee = window.prompt('Welcher Agent soll den Folgeauftrag übernehmen?');
        if (!assignee || !assignee.trim()) {
          assistantStatus('Ausführung abgebrochen: Es wurde kein zuständiger Agent ausgewählt.');
          proposalButton.disabled = false;
          return;
        }
        body.assignee = assignee.trim();
      }
      await assistantRequest(
        `/api/assistant/proposals/${encodeURIComponent(proposalId)}/${encodeURIComponent(action)}`,
        { method: 'POST', body }
      );
      assistantStatus(
        action === 'confirm' ? 'Ausführung belegt und zurückgelesen.' : 'Vorschlag verworfen.'
      );
      await loadAssistantMessages();
    } catch (cause) {
      assistantStatus(`Vorschlag konnte nicht bearbeitet werden: ${cause.message}`);
      proposalButton.disabled = false;
    }
    return;
  }
  const assistantButton = event.target.closest('[data-assistant-context]');
  if (assistantButton) {
    try {
      await openAssistant({
        objectType: assistantButton.dataset.objectType,
        objectId: assistantButton.dataset.objectId,
        label: assistantButton.dataset.objectLabel,
      });
    } catch (cause) {
      assistantStatus(`Kontext nicht verfügbar: ${cause.message}`);
    }
    return;
  }
  const actionButton = event.target.closest('[data-shadow-action]');
  if (actionButton) {
    const container = actionButton.closest('[data-decision-actions]');
    const payload = shadowPayload(actionButton.dataset.shadowAction);
    if (!payload) return;
    actionButton.disabled = true;
    try {
      const result = await previewDecisionAction(
        container.dataset.decisionActions,
        actionButton.dataset.shadowAction,
        payload
      );
      toast(`Nur simuliert: ${result.action} · keine Änderung ausgeführt`);
    } catch (cause) {
      toast(`Simulation fehlgeschlagen: ${cause.message}`);
    } finally {
      actionButton.disabled = false;
    }
    return;
  }
  const copyButton = event.target.closest('[data-copy]');
  if (!copyButton) return;
  try {
    await navigator.clipboard.writeText(copyButton.dataset.copy);
    toast(`Kopiert: ${copyButton.dataset.copy}`);
  } catch (_) {
    toast(`Task: ${copyButton.dataset.copy}`);
  }
});

for (const id of ['legacy-link', 'legacy-link-top', 'legacy-link-footer']) {
  byId(id).href = '/';
}
byId('decision-refresh').addEventListener('click', loadDecisions);
byId('topic-refresh').addEventListener('click', loadTopics);
byId('decision-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadDecisions();
});
byId('topic-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadTopics();
});
window.addEventListener('hashchange', () => openView(location.hash.slice(1), false));
window.addEventListener('keydown', (event) => {
  if (!document.body.classList.contains('assistant-opened')) return;
  if (event.key === 'Escape') {
    closeAssistant();
  }
});

loadMetadata();
openView(location.hash.slice(1) || 'overview', false);
