'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'management.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public', 'management.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

function functionSource(name, nextName) {
  const start = script.indexOf(`${name}(`);
  const end = script.indexOf(`\n${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} source`);
  return script.slice(start, end);
}

class ElementHarness {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.textContent = '';
    this.className = '';
    this.scrollTop = 0;
    this.scrollHeight = 100;
  }
  replaceChildren(...children) {
    this.children = children;
  }
  append(...children) {
    this.children.push(...children);
  }
}

test('AP17 browser payloads contain only context IDs or message text plus client ID', () => {
  assert.match(
    script,
    /apiContext[\s\S]*objectType: nextContext\.objectType, objectId: nextContext\.objectId/
  );
  assert.match(script, /body:\s*\{\s*context:\s*apiContext\s*\}/);
  assert.match(script, /body:\s*\{\s*clientMessageId:\s*assistantClientMessageId\(\),\s*text\s*\}/);
  assert.doesNotMatch(
    script,
    /body:\s*\{[^}]*\b(?:title|owner|scope|evidence|payload|toolOutput)\b/
  );
});

test('AP17 creates valid client message UUIDs on internal HTTP without randomUUID', () => {
  const source = functionSource(
    'function assistantClientMessageId',
    'async function sendAssistantMessage'
  );
  const context = vm.createContext({
    Uint8Array,
    Math,
    globalThis: {
      crypto: {
        getRandomValues(bytes) {
          for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
          return bytes;
        },
      },
    },
  });
  vm.runInContext(`${source}\nthis.createId = assistantClientMessageId;`, context);
  assert.match(
    context.createId(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

test('AP17 exposes global and object-scoped context controls', () => {
  assert.ok(count(html, /data-assistant-open/g) >= 2);
  assert.match(script, /openAssistant\(null\)/);
  assert.match(script, /data-assistant-context/);
  assert.match(script, /objectType:\s*assistantButton\.dataset\.objectType/);
  assert.match(script, /objectId:\s*assistantButton\.dataset\.objectId/);
  assert.match(script, /assistant-context-remove/);
  assert.match(html, /id="assistant-global"[^>]*>[\s\S]*Globales Gespräch \/ neues Thema/);
  assert.match(html, /Angehefteter Kontext/);
  assert.match(script, /data-object-label/);
  assert.match(script, /assistantButton\.dataset\.objectLabel/);
  assert.match(script, /assistant-conversation-select/);
});

test('AP17 keeps the global chat free of an empty context chip', () => {
  assert.match(html, /id="assistant-context-row"[^>]*\bhidden\b/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(script, /row\.hidden = !assistantState\.context/);
  assert.match(script, /row\.setAttribute\('aria-hidden', String\(!assistantState\.context\)\)/);
});

test('AP17 constrains the assistant drawer to a narrow mobile viewport', () => {
  assert.match(
    styles,
    /\.assistant-panel\s*\{[\s\S]*max-width:\s*100vw;[\s\S]*overflow-x:\s*hidden;/
  );
  assert.match(styles, /\.assistant-panel > \*\s*\{\s*min-width:\s*0;/);
  assert.match(
    styles,
    /@media \(max-width: 650px\)[\s\S]*\.assistant-context-chip\s*\{\s*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/
  );
  assert.match(
    styles,
    /\.assistant-panel\s*\{[\s\S]*left:\s*0;[\s\S]*right:\s*auto;[\s\S]*width:\s*100vw;/
  );
  assert.match(styles, /\.assistant-backdrop\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100dvh;/);
  assert.match(styles, /\.card h3\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
  assert.match(styles, /\.toast\s*\{[\s\S]*left:\s*14px;[\s\S]*right:\s*auto;/);
  assert.match(styles, /\.assistant-form > div\s*\{\s*flex-wrap:\s*wrap;/);
});

test('assistant history is a readable primary work area', () => {
  assert.match(html, /styles\.css\?v=20261111-chat-layout/);
  assert.match(styles, /width:\s*min\(780px, calc\(100vw - 48px\)\)/);
  assert.match(styles, /'global switcher toolbar'[\s\S]*'messages messages messages'/);
  assert.match(styles, /grid-template-rows:[\s\S]*minmax\(180px, 1fr\)/);
  assert.match(styles, /\.assistant-messages\s*\{[\s\S]*grid-area:\s*messages;/);
  assert.match(styles, /\.assistant-messages\s*\{[\s\S]*scrollbar-gutter:\s*stable;/);
  assert.match(
    styles,
    /\.assistant-message p\s*\{[\s\S]*font-size:\s*15px;[\s\S]*line-height:\s*1\.65;/
  );
  assert.match(
    styles,
    /@media \(max-width: 650px\)[\s\S]*\.assistant-panel\s*\{[\s\S]*height:\s*100dvh;[\s\S]*minmax\(160px, 1fr\)/
  );
});

test('AP17 names write-capable assistant modes without calling them read-only', () => {
  assert.match(html, /id="assistant-mode-label"/);
  assert.match(html, /id="assistant-mode-description"/);
  assert.match(script, /low_risk:[\s\S]*label: 'Assistenz · begrenzte Aktionen'/);
  assert.match(script, /scoped:[\s\S]*label: 'Assistenz · Scope-gedeckt'/);
  assert.match(script, /productive:[\s\S]*label: 'Produktive Assistenz'/);
  assert.match(script, /if \(!config\.writesEnabled\)/);
  assert.match(script, /updateAssistantMode\(\)/);
  assert.match(script, /Produktiver Low-Risk-Betrieb · bereit/);
  assert.match(script, /schreibt das Cockpit den Auftrag nach Kanban/);
});

test('productive assistant refreshes runtime mode and labels executable artifacts truthfully', () => {
  assert.match(script, /async function refreshAssistantConfig\(\)/);
  assert.ok(count(script, /await refreshAssistantConfig\(\)/g) >= 2);
  assert.match(script, /productive \? 'Ausführungsvorschlag' : 'Shadow-Vorschlag'/);
  assert.match(script, /productive \? 'Ausführungsbeleg' : 'Shadow-Beleg'/);
  assert.match(script, /status: 'wartet auf Bestätigung'/);
  assert.match(script, /toLocaleLowerCase\('de-DE'\)\.endsWith\('vorschlag'\)/);
  assert.match(script, /Ausführung vorbereitet · Vorschlag prüfen und „Ausführen“ wählen\./);
  assert.match(script, /Ausgeführt · Kanban-Readback und Übergabebeleg sind protokolliert\./);
});

test('productive assistant presents persisted shadow proposals as awaiting confirmation', () => {
  const context = vm.createContext({
    assistantState: { config: { writesEnabled: true } },
    document: { createElement: (tagName) => new ElementHarness(tagName) },
  });
  vm.runInContext(
    `${functionSource('function assistantArtifactItems', 'function assistantArtifactText')}\n${functionSource('function assistantArtifactText', 'function renderAssistantArtifacts')}\n${functionSource('function renderAssistantArtifacts', 'function assistantActivityStatus')}\nthis.render = renderAssistantArtifacts;`,
    context
  );
  const article = new ElementHarness('article');

  context.render(
    {
      proposal: {
        title: 'Uslar-Planungsannahme übernehmen',
        status: 'shadow',
      },
    },
    article
  );

  assert.equal(article.children.length, 1);
  assert.equal(article.children[0].children[0].textContent, 'Ausführungsvorschlag');
  assert.match(article.children[0].children[1].textContent, /wartet auf Bestätigung/);
  assert.doesNotMatch(article.children[0].children[1].textContent, /shadow/i);
});

test('department cards expose governance questions and proposed next actions', () => {
  assert.match(script, /<h4>Governancefragen<\/h4>/);
  assert.match(script, /decision\.question \|\| 'Governancefrage ohne Titel'/);
  assert.match(script, /assistantContextButton\(\s*'decision'/);
  assert.match(script, /Empfehlung ist noch nicht ausgewiesen/);
  assert.match(script, /item\.next_actions/);
});

test('AP17 switches an open assistant immediately and announces the topic change', () => {
  assert.match(script, /announce:\s*wasOpen && context !== undefined/);
  assert.match(script, /Thema gewechselt ·/);
  assert.match(html, /id="assistant-topic-notice"[\s\S]*role="status"/);
  assert.doesNotMatch(script, /managementShell\.setAttribute\('inert'/);
});

test('AP17 binds sending to the selected conversation and blocks send while switching', () => {
  assert.match(script, /assistantState\.switching \|\| assistantState\.sending/);
  assert.match(script, /const conversationId = assistantState\.conversationId/);
  assert.match(script, /encodeURIComponent\(conversationId\)/);
});

test('AP17 renders optional shadow proposals and receipts without HTML injection', () => {
  assert.match(script, /\['proposal', 'shadowProposals'/);
  assert.match(script, /\['receipt', 'shadowReceipts'/);
  assert.match(script, /shadowProposals/);
  assert.match(script, /shadowReceipts/);
  assert.match(script, /content\.textContent = text/);
  assert.match(script, /dataset\.assistantProposal/);
  assert.match(script, /dataset\.assigneeRequired/);
  assert.match(script, /Welcher Agent soll den Folgeauftrag übernehmen/);
  assert.match(script, /body\.assignee = assignee\.trim\(\)/);
  assert.doesNotMatch(script, /JSON\.stringify\(value\)/);
});

test('AP16 keyboard contract sends explicitly and closes without stealing focus', () => {
  assert.match(script, /event\.key === 'Enter' && \(event\.ctrlKey \|\| event\.metaKey\)/);
  assert.match(script, /requestSubmit\(\)/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /assistantOpener\.focus\(\)/);
});

test('AP16 backdrop starts inert and is toggled with the panel', () => {
  assert.match(html, /id="assistant-backdrop"[^>]*\bhidden\b[^>]*\binert\b[^>]*tabindex="-1"/);
  assert.match(script, /backdrop\.removeAttribute\('hidden'\)/);
  assert.match(script, /backdrop\.removeAttribute\('inert'\)/);
  assert.match(script, /backdrop\.setAttribute\('hidden',\s*''\)/);
  assert.match(script, /backdrop\.setAttribute\('inert',\s*''\)/);
});

test('AP17 non-modal drawer keeps cockpit context controls keyboard reachable', () => {
  assert.match(html, /id="assistant-panel"[\s\S]*aria-modal="false"/);
  assert.doesNotMatch(script, /managementShell\.setAttribute\('inert'/);
  assert.doesNotMatch(script, /event\.key === 'Tab'/);
});

test('AP16 renders assistant text as text and exposes no raw tool output', () => {
  assert.match(script, /content\.textContent = item\.content/);
  assert.doesNotMatch(script, /(?:innerHTML|insertAdjacentHTML)\s*=\s*item\.content/);
  assert.doesNotMatch(`${html}\n${script}`, /raw[_ -]?tool[_ -]?output|toolOutput|tool_calls/i);
});

test('AP16 message loader follows cursors across pages and renders the newest response', async () => {
  const messages = new ElementHarness();
  const status = new ElementHarness();
  const requests = [];
  const pages = [
    { items: [{ role: 'user', content: 'old question' }], nextCursor: 'cursor-one' },
    { items: [{ role: 'assistant', content: 'old answer' }], nextCursor: 'cursor-two' },
    { items: [{ role: 'assistant', content: 'newest response' }], nextCursor: null },
  ];
  const context = vm.createContext({
    ASSISTANT_PAGE_CAP: 100,
    URLSearchParams,
    assistantState: { conversationId: 'conversation/with cursor', config: { mode: 'read_only' } },
    assistantModePresentation: () => ({ ready: 'Read-only · bereit' }),
    assistantActivityStatus: () => 'Read-only · bereit',
    assistantRequest: async (url) => {
      requests.push(url);
      return pages.shift();
    },
    assistantStatus: (text) => {
      status.textContent = text;
    },
    byId: (id) => (id === 'assistant-messages' ? messages : status),
    document: { createElement: (tagName) => new ElementHarness(tagName) },
    renderAssistantArtifacts: () => undefined,
  });
  vm.runInContext(
    `${functionSource('function renderAssistantMessages', 'async function refreshAssistantConversations')}\n${functionSource('async function loadAssistantMessages', 'async function selectAssistantContext')}\nthis.run = loadAssistantMessages;`,
    context
  );

  await context.run();
  assert.equal(requests.length, 3);
  assert.doesNotMatch(requests[0], /cursor=/);
  assert.match(requests[1], /cursor=cursor-one/);
  assert.match(requests[2], /cursor=cursor-two/);
  assert.equal(messages.children.length, 3);
  assert.equal(messages.children.at(-1).children[1].textContent, 'newest response');
  assert.equal(messages.scrollTop, messages.scrollHeight);
  assert.equal(status.textContent, 'Read-only · bereit');
});

test('AP16 message loader enforces the explicit page cap before rendering partial history', async () => {
  let calls = 0;
  let renders = 0;
  const context = vm.createContext({
    ASSISTANT_PAGE_CAP: 2,
    URLSearchParams,
    assistantState: { conversationId: 'conversation-1', config: { mode: 'read_only' } },
    assistantModePresentation: () => ({ ready: 'Read-only · bereit' }),
    assistantActivityStatus: () => 'Read-only · bereit',
    assistantRequest: async (url) => {
      calls += 1;
      if (calls === 2) assert.match(url, /cursor=cursor-1/);
      return { items: [{ role: 'user', content: `page-${calls}` }], nextCursor: `cursor-${calls}` };
    },
    assistantStatus: () => undefined,
    renderAssistantMessages: () => {
      renders += 1;
    },
  });
  vm.runInContext(
    `${functionSource('async function loadAssistantMessages', 'async function selectAssistantContext')}\nthis.run = loadAssistantMessages;`,
    context
  );

  await assert.rejects(() => context.run(), /assistant_message_page_cap/);
  assert.equal(calls, 2);
  assert.equal(renders, 0);
});
