/* eslint-disable no-console */

const RUN_E2E = process.env.RUN_PERSONAL_AGENT_E2E === 'true';
const BASE_URL = process.env.PERSONAL_AGENT_E2E_BASE_URL || 'http://127.0.0.1:3900';
const TENANT_ID = 'agentic-hackathon';
const CHAT_PATH = '/api/personal-agent/chat';

const DEFAULT_CHAT_OPTIONS = Object.freeze({
  executionMode: 'auto',
});

const JOURNALIST_ROUTING_TOKENS = ['interface_placeholder', 'mark_unknown_execution_gap'];
const BENCHMARK_ROUTING_TOKENS = ['vnb_kpi_benchmark_comparison'];
const VORSTAND_ROUTING_TOKENS = ['netzfahrplan_fnav_assessment', 'assess_fnav_as_kupferalternative'];

const BENCHMARK_KNOWN_CONTEXT = Object.freeze({
  vnb1Name: 'Stadtwerke Troisdorf',
  vnb2Name: 'TWL Netze',
});

const VORSTAND_KNOWN_CONTEXT = Object.freeze({
  requestedCapacityKW: 10000,
  voltageLevel: 'MS',
  gridOperatorName: 'TWL Netze',
  ownerContact: 'netzplanung@twl.de',
});

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function applySetCookies(cookieJar, headers) {
  const setCookies = getSetCookieValues(headers);
  for (const rawCookie of setCookies) {
    const pair = (rawCookie || '').split(';')[0].trim();
    if (!pair || !pair.includes('=')) {
      continue;
    }
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    cookieJar.set(name, value);
  }
}

function buildCookieHeader(cookieJar) {
  const pairs = [];
  for (const [name, value] of cookieJar.entries()) {
    pairs.push(`${name}=${value}`);
  }
  return pairs.join('; ');
}

function extractReply(payload) {
  if (typeof payload?.reply === 'string') {
    return payload.reply;
  }
  if (typeof payload?.response?.reply === 'string') {
    return payload.response.reply;
  }
  if (typeof payload?.text === 'string') {
    return payload.text;
  }
  return '';
}

function expectNoInternalErrorCodes(reply) {
  expect(reply).not.toMatch(/OBJECT_NOT_FOUND|INVALID_[A-Z_]+|ERR_[A-Z_]+|MOLECULER/i);
}

function expectNoReplyLeaks(reply) {
  expect(reply).not.toMatch(/operatorEvidence|interface_placeholder|interface-placeholder|__step_|ACTION_FAILED|Parameters validation error/i);
}

function expectMentions(reply, words) {
  const lowerReply = reply.toLowerCase();
  const found = words.some((word) => lowerReply.includes(word.toLowerCase()));
  expect(found).toBe(true);
}

function expectHttp200(response) {
  expect(response.status).toBe(200);
}

function expectAutoExecution(payload) {
  expect(payload && typeof payload).toBe('object');
  expect(payload.executionMode).toBe('auto');
  expect(payload.execution && typeof payload.execution).toBe('object');
  expect(typeof payload.execution.status).toBe('string');
  expect(payload.execution.status).not.toBe('skipped');
}

function expectRoutingContains(payload, requiredTokens) {
  expect(payload && typeof payload).toBe('object');
  expect(payload.routing && typeof payload.routing).toBe('object');

  const primaryIntent = String(payload.routing.primaryIntent || '').trim();
  expect(primaryIntent.length).toBeGreaterThan(0);

  const routingText = JSON.stringify(payload.routing).toLowerCase();
  const hasExpectedToken = requiredTokens.some((token) =>
    routingText.includes(String(token).toLowerCase())
  );
  expect(hasExpectedToken).toBe(true);
}

function extractYears(reply) {
  const matches = reply.match(/\b(19|20)\d{2}\b/g);
  if (!matches) {
    return [];
  }
  return matches.map((year) => Number(year));
}

function createChatClient(baseUrl) {
  const cookieJar = new Map();

  async function chat(message, sessionId, options = {}) {
    const body = {
      message,
      ...DEFAULT_CHAT_OPTIONS,
      ...options,
    };
    if (sessionId) {
      body.sessionId = sessionId;
    }

    const headers = {
      'content-type': 'application/json',
      'x-tenant-id': TENANT_ID,
    };

    const cookieHeader = buildCookieHeader(cookieJar);
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const response = await fetch(`${baseUrl}${CHAT_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    applySetCookies(cookieJar, response.headers);

    const payload = await response.json();
    return { response, payload };
  }

  function clear() {
    cookieJar.clear();
  }

  return {
    chat,
    clear,
  };
}

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('Multi-Turn Domain Scenarios (personal-agent.chat only)', () => {
  describe('PA-MT-001 Journalist CYA-Fallback', () => {
    jest.setTimeout(30000);

    const client = createChatClient(BASE_URL);
    let sessionId = null;

    afterAll(() => {
      sessionId = null;
      client.clear();
    });

    it('Turn 1: Initiale Recherche', async () => {
      const { response, payload } = await client.chat(
        'Ich recherchiere zur Versorgungssicherheit. Was ist der aktuelle Stand?',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, JOURNALIST_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('interface_placeholder');
      expect(bodyText).toContain('mark_unknown_execution_gap');

      sessionId = payload.sessionId || sessionId;

      const reply = extractReply(payload);
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['stand', 'einschaetzung', 'quelle', 'beleg', 'unsicher']);
      expectNoInternalErrorCodes(reply);

    });

    it('Turn 2: Unsicherheiten klar markieren', async () => {
      const { response, payload } = await client.chat(
        'Bitte nur belastbare Aussagen und kennzeichne Unsicherheiten klar.',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, JOURNALIST_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('interface_placeholder');
      expect(bodyText).toContain('mark_unknown_execution_gap');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['unsicher', 'annahme', 'beleg', 'quelle', 'nicht verifiziert']);
      expectNoInternalErrorCodes(reply);
    });

    it('Turn 3: Zusammenfassung in drei Punkten', async () => {
      const { response, payload } = await client.chat(
        'Fasse die Kernaussagen in drei Punkten zusammen.',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, JOURNALIST_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('interface_placeholder');
      expect(bodyText).toContain('mark_unknown_execution_gap');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expect(reply).toMatch(/1\.|- |•|erstens/i);
      expectNoInternalErrorCodes(reply);
    });

    it('Turn 4: Fazit ohne Spekulationen', async () => {
      const { response, payload } = await client.chat(
        'Gib ein journalistisches Fazit ohne Spekulationen.',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, JOURNALIST_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('interface_placeholder');
      expect(bodyText).toContain('mark_unknown_execution_gap');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expect(reply).not.toMatch(/garantiert|sicher ist|ohne zweifel/i);
      expectNoInternalErrorCodes(reply);
    });
  });

  describe('PA-MT-002 Benchmark Rangliste/Vergleich', () => {
    jest.setTimeout(30000);

    const client = createChatClient(BASE_URL);
    let sessionId = null;
    let turn2Reply = '';

    afterAll(() => {
      sessionId = null;
      turn2Reply = '';
      client.clear();
    });

    it('Turn 1: Vergleich anstoßen', async () => {
      const { response, payload } = await client.chat(
        'Vergleiche zwei VNB hinsichtlich Benchmark, KPI, Anschlussdauer, Digitalisierungsindex und Umsetzungsquote.',
        sessionId,
        { knownContext: BENCHMARK_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, BENCHMARK_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('vnb_kpi_benchmark_comparison');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['vergleich', 'gegenueber', 'schneller', 'langsamer']);
      expectNoInternalErrorCodes(reply);
    });

    it('Turn 2: Zusätzliche Dimensionen', async () => {
      const { response, payload } = await client.chat(
        'Ergänze Digitalisierung und Umsetzungsquote im Vergleich.',
        sessionId,
        { knownContext: BENCHMARK_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, BENCHMARK_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('vnb_kpi_benchmark_comparison');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);
      turn2Reply = reply;

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['digital', 'umsetzungsquote', 'vergleich']);
      expectNoInternalErrorCodes(reply);
    });

    it('Turn 3: Synthese über vorherige Turns', async () => {
      const { response, payload } = await client.chat(
        'Gewichte Anschlussgeschwindigkeit am höchsten und fasse das Ergebnis zusammen.',
        sessionId,
        { knownContext: BENCHMARK_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, BENCHMARK_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('vnb_kpi_benchmark_comparison');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['zusammen', 'gewicht', 'ergebnis', 'vergleich']);
      expectNoInternalErrorCodes(reply);

      if (turn2Reply) {
        const hasCarryOver = /digital|umsetzungsquote/i.test(reply);
        expect(hasCarryOver).toBe(true);
      }
    });

    it('Turn 4: Rangliste oder Vergleich liefern', async () => {
      const { response, payload } = await client.chat(
        'Erstelle eine Rangliste mit kurzer Begründung.',
        sessionId,
        { knownContext: BENCHMARK_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, BENCHMARK_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('vnb_kpi_benchmark_comparison');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['rang', 'platz', 'vergleich', 'begruendung']);
      expectNoInternalErrorCodes(reply);
    });
  });

  describe('PA-MT-003 Vorstand: Anschlussbegehren Rechenzentrum N-1 fNAV', () => {
    jest.setTimeout(30000);

    const client = createChatClient(BASE_URL);
    let sessionId = null;
    let turn1Reply = '';

    afterAll(() => {
      sessionId = null;
      turn1Reply = '';
      client.clear();
    });

    it('Turn 1: Frankfurt Statusabfrage', async () => {
      const { response, payload } = await client.chat(
        'Wir prüfen ein Anschlussbegehren für ein Rechenzentrum mit Netzfahrplan fNAV. Wie ist der Stand?',
        sessionId,
        { knownContext: VORSTAND_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, VORSTAND_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('netzfahrplan_fnav_assessment');
      expect(bodyText).toContain('assess_fnav_as_kupferalternative');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);
      turn1Reply = reply;

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['stand', 'prozess', 'status']);
      expectNoInternalErrorCodes(reply);

    });

    it('Turn 2: N-1 Reserve aus Kontext erklären', async () => {
      const { response, payload } = await client.chat(
        'Was bedeutet das für unsere N-1-Reserve?',
        sessionId,
        { knownContext: VORSTAND_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, VORSTAND_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('netzfahrplan_fnav_assessment');
      expect(bodyText).toContain('assess_fnav_as_kupferalternative');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['n-1', 'reserve', 'auswirkung']);
      expectNoInternalErrorCodes(reply);

      const turn1HasPercent = /\b\d+(?:[.,]\d+)?\s*%\b/.test(turn1Reply);
      if (!turn1HasPercent) {
        expect(reply).not.toMatch(/\b\d+(?:[.,]\d+)?\s*%\b/);
      }
    });

    it('Turn 3: fNAV 5-Jahres-Projektion', async () => {
      const { response, payload } = await client.chat(
        'Projiziere den fNAV für die nächsten 5 Jahre.',
        sessionId,
        { knownContext: VORSTAND_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, VORSTAND_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('netzfahrplan_fnav_assessment');
      expect(bodyText).toContain('assess_fnav_as_kupferalternative');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['fnav', 'trend', 'prognose']);
      expect(reply).toMatch(/\d/);
      expectNoInternalErrorCodes(reply);

      const years = extractYears(reply);
      const outOfRangeYears = years.filter((year) => year < 2026 || year > 2031);
      expect(outOfRangeYears).toHaveLength(0);
    });

    it('Turn 4: Standortwechsel auf München (contextMutation: replace)', async () => {
      const { response, payload } = await client.chat(
        'Wir verlagern das Projekt nach München. Aktualisiere die Prüfung.',
        sessionId,
        { knownContext: VORSTAND_KNOWN_CONTEXT }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      expectRoutingContains(payload, VORSTAND_ROUTING_TOKENS);
      const bodyText = JSON.stringify(payload).toLowerCase();
      expect(bodyText).toContain('netzfahrplan_fnav_assessment');
      expect(bodyText).toContain('assess_fnav_as_kupferalternative');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['muenchen']);
      expect(reply.toLowerCase()).not.toContain('frankfurt');
      expectMentions(reply, ['n-1', 'fnav']);
      expectNoInternalErrorCodes(reply);
    });
  });

  describe('PA-MT-004 CETRed Working Assumptions / T2-T5', () => {
    jest.setTimeout(30000);

    const client = createChatClient(BASE_URL);
    let sessionId = null;

    afterAll(() => {
      sessionId = null;
      client.clear();
    });

    it('Turn 1: erzeugt Due-Diligence-Evidenzfrage mit Working Assumption', async () => {
      const { response, payload } = await client.chat(
        'Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      const reply = extractReply(payload);
      expect(reply).toMatch(/Due Diligence|Netzanschlusszusage|BDEW|Marktlokation/i);
      expect(reply).toMatch(/Annahme|vorläufig|Risikoflag|Evidenz/i);
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });

    it('Turn 2: wiederholt die T1-Frage nicht bei Working-Assumption-Follow-up', async () => {
      const { response, payload } = await client.chat(
        'Arbeite mit der vorläufigen Annahme weiter und nenne die nächsten fachlichen Schritte.',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      const reply = extractReply(payload);
      expect(reply.length).toBeGreaterThan(20);
      expect(reply).toMatch(/Working Assumption|vorläufig|weiterarbeiten|Methodik|Evidenzpunkte/i);
      expect(reply).not.toContain('Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.');
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });

    it('Turn 3: liefert T4-Methodologie statt Placeholder-Antwort', async () => {
      const { response, payload } = await client.chat(
        'Welche Markt- und Regulatorik-Methodik würdest du jetzt anwenden?',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      const reply = extractReply(payload);
      expect(reply).toMatch(/Methodik|Datenquelle|ENTSO-E|Netztransparenz/i);
      expect(reply).not.toContain('Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.');
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });

    it('Turn 4: liefert T5-Risk-Assessment-Struktur mit Condition Precedent', async () => {
      const { response, payload } = await client.chat(
        'Erstelle daraus ein vorläufiges Risk Assessment für den Kreditausschuss.',
        sessionId
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      const reply = extractReply(payload);
      expect(reply).toMatch(/Risk Assessment|Condition Precedent|Due Diligence|Risikoampel/i);
      expect(reply).not.toContain('Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.');
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });
  });
});
