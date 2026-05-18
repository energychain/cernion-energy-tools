/* eslint-disable no-console */

const RUN_E2E = process.env.RUN_PERSONAL_AGENT_E2E === 'true';
const RUN_VDMI_STEP3_E2E = process.env.RUN_PERSONAL_AGENT_E2E_VDMI_STEP3 === 'true';
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
const describeVdmiStep3E2E = RUN_E2E && RUN_VDMI_STEP3_E2E ? describe : describe.skip;

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

  describe('PA-MT-004 Conversational Onboarding Flow', () => {
    jest.setTimeout(30000);

    const client = createChatClient(BASE_URL);
    let sessionId = null;

    afterAll(() => {
      sessionId = null;
      client.clear();
    });

    it('Turn 1: asks deterministic onboarding question instead of failing execution', async () => {
      const { response, payload } = await client.chat(
        'Bitte Mieterstrom mit ZNP für Rheinallee prüfen',
        sessionId,
        {
          knownContext: {
            communityName: 'Solargemeinschaft Rheinallee',
          },
        }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      expect(payload.execution?.status).toBe('awaiting-onboarding');
      expect(payload.presentationApplied).toBe(true);
      expect(payload.presentationType).toBe('conversational_onboarding');

      const reply = extractReply(payload);
      expect(reply).toMatch(/Projekt-ID|fehlende Angaben|fortsetzen/i);
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });

    it('Turn 2: captures onboarding answer and continues without technical error leakage', async () => {
      const { response, payload } = await client.chat(
        'Projekt-ID znp-rheinallee-01',
        sessionId,
        {
          knownContext: {
            communityName: 'Solargemeinschaft Rheinallee',
          },
        }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      expect(payload.execution?.status).not.toBe('skipped');
      const reply = extractReply(payload);
      expect(reply.length).toBeGreaterThan(10);
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });
  });

  describe('PA-MT-006 CETRed Working Assumptions / T2-T5', () => {
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

  describeVdmiStep3E2E('PA-MT-005 VDMI Step-3 Grid-Connection Decision Governance', () => {
    jest.setTimeout(30000);

    const client = createChatClient(BASE_URL);
    let sessionId = null;

    afterAll(() => {
      sessionId = null;
      client.clear();
    });

    it('routes to decision governance and completes dossier/trace/agentRole with auto-derived V actor', async () => {
      const { response, payload } = await client.chat(
        'Kann der Netzbetreiber ohne formales §17-EnWG-Netzanschlussbegehren eine belastbare Anschluss- oder Kapazitätszusage geben?',
        sessionId,
        {
          knownContext: {
            processType: 'grid-connection-governance',
            taskId: 'network-operator-decision',
          },
        }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      expectRoutingContains(payload, ['vdmi_grid_connection_decision_governance']);
      const routingText = JSON.stringify(payload.routing || {}).toLowerCase();
      expect(routingText).not.toContain('vdmi_asset_validation_governance');

      const executionSteps = Array.isArray(payload.execution?.steps) ? payload.execution.steps : [];
      const dossierStep = executionSteps.find((step) => step.action === 'vdmi.dossier');
      const traceStep = executionSteps.find((step) => step.action === 'vdmi.negotiationTrace');
      const roleStep = executionSteps.find((step) => step.action === 'vdmi.agentRole');

      expect(dossierStep?.status).toBe('completed');
      expect(traceStep?.status).toBe('completed');
      expect(roleStep?.status).toBe('completed');

      const rolePayload = roleStep?.result || {};
      expect(rolePayload?.highestRole || rolePayload?.role).toBe('V');

      const dossierPayload = dossierStep?.result?.dossier || {};
      expect(Array.isArray(dossierPayload.evidenceGaps)).toBe(true);
      expect(dossierPayload.evidenceGaps.length).toBeGreaterThan(0);
      expect(Array.isArray(dossierPayload.forbiddenAssumptions)).toBe(true);
      expect(dossierPayload.forbiddenAssumptions.length).toBeGreaterThan(0);

      const reply = extractReply(payload);
      expect(reply).not.toMatch(/belastbare\s+anschluss-?\/?kapazit[aä]tszusage|anschlusszusage|kapazit[aä]tszusage/i);
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });
  });

  describeVdmiStep3E2E('PA-MT-005 VDMI Step-3 Grid-Connection Decision Governance', () => {
    jest.setTimeout(30000);

    const client = createChatClient(BASE_URL);
    let sessionId = null;

    afterAll(() => {
      sessionId = null;
      client.clear();
    });

    it('routes to decision governance and completes dossier/trace/agentRole with auto-derived V actor', async () => {
      const { response, payload } = await client.chat(
        'Kann der Netzbetreiber ohne formales §17-EnWG-Netzanschlussbegehren eine belastbare Anschluss- oder Kapazitätszusage geben?',
        sessionId,
        {
          knownContext: {
            processType: 'grid-connection-governance',
            taskId: 'network-operator-decision',
          },
        }
      );

      expectHttp200(response);
      expect(payload && typeof payload).toBe('object');
      expectAutoExecution(payload);
      sessionId = payload.sessionId || sessionId;

      expectRoutingContains(payload, ['vdmi_grid_connection_decision_governance']);
      const routingText = JSON.stringify(payload.routing || {}).toLowerCase();
      expect(routingText).not.toContain('vdmi_asset_validation_governance');

      const executionSteps = Array.isArray(payload.execution?.steps) ? payload.execution.steps : [];
      const dossierStep = executionSteps.find((step) => step.action === 'vdmi.dossier');
      const traceStep = executionSteps.find((step) => step.action === 'vdmi.negotiationTrace');
      const roleStep = executionSteps.find((step) => step.action === 'vdmi.agentRole');

      expect(dossierStep?.status).toBe('completed');
      expect(traceStep?.status).toBe('completed');
      expect(roleStep?.status).toBe('completed');

      const rolePayload = roleStep?.result || {};
      expect(rolePayload?.highestRole || rolePayload?.role).toBe('V');

      const dossierPayload = dossierStep?.result?.dossier || {};
      expect(Array.isArray(dossierPayload.evidenceGaps)).toBe(true);
      expect(dossierPayload.evidenceGaps.length).toBeGreaterThan(0);
      expect(Array.isArray(dossierPayload.forbiddenAssumptions)).toBe(true);
      expect(dossierPayload.forbiddenAssumptions.length).toBeGreaterThan(0);

      const reply = extractReply(payload);
      expect(reply).not.toMatch(/belastbare\s+anschluss-?\/?kapazit[aä]tszusage|anschlusszusage|kapazit[aä]tszusage/i);
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });
  });

  describeE2E('PA-MT-007 Multimodal Inhouse Data Upload', () => {
    jest.setTimeout(30000);

    const os = require('os');
    const fs = require('fs');
    const path = require('path');

    const client = createChatClient(BASE_URL);
    let sessionId = null;
    let uploadDir = null;

    beforeAll(() => {
      uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-e2e-inhouse-'));
    });

    afterAll(() => {
      sessionId = null;
      client.clear();
      if (uploadDir) {
        try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch { /* ok */ }
      }
    });

    it('Turn 1: chat with CSV attachment reports fileProcessing ok and persists L3 extract metadata', async () => {
      const csvPath = path.join(uploadDir, 'assets.csv');
      fs.writeFileSync(
        csvPath,
        'AssetID,Kapazitaet_kW,Ort\nA-001,5000,Ludwigshafen\nA-002,3000,Frankenthal\n'
      );

      const body = {
        message: 'Hier ist eine Liste unserer PV-Anlagen. Bitte bestätige den Empfang.',
        executionMode: 'auto',
        fileAttachments: [
          {
            attachmentId: 'fa_assets_001',
            fileName: 'assets.csv',
            mimeType: 'text/csv',
            sizeBytes: fs.statSync(csvPath).size,
            tempPath: csvPath,
          },
        ],
      };

      const response = await fetch(`${BASE_URL}${CHAT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT_ID },
        body: JSON.stringify(body),
      });

      expectHttp200(response);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      sessionId = payload.sessionId;

      // fileProcessing reports ok
      expect(Array.isArray(payload.fileProcessing)).toBe(true);
      expect(payload.fileProcessing).toHaveLength(1);
      expect(payload.fileProcessing[0].status).toBe('ok');
      expect(payload.fileProcessing[0].attachmentId).toBe('fa_assets_001');

      const reply = extractReply(payload);
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);
    });

    it('Turn 2: follow-up references session without raw file content in persisted L3', async () => {
      expect(sessionId).toBeTruthy();

      const { response, payload } = await client.chat(
        'Wie viele Assets haben wir insgesamt laut der hochgeladenen Liste?',
        sessionId
      );

      expectHttp200(response);
      expect(payload.success).toBe(true);
      expect(payload.sessionId).toBe(sessionId);

      const reply = extractReply(payload);
      expectNoInternalErrorCodes(reply);
      expectNoReplyLeaks(reply);

      // Raw content must not appear in the response payload at all
      const payloadJson = JSON.stringify(payload);
      expect(payloadJson).not.toContain('A-001,5000,Ludwigshafen');
      expect(payloadJson).not.toContain('"inhouseData"');
    });
  });
});
