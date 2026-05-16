/* eslint-disable no-console */

const RUN_E2E = process.env.RUN_PERSONAL_AGENT_E2E === 'true';
const BASE_URL = process.env.PERSONAL_AGENT_E2E_BASE_URL || 'http://127.0.0.1:3000';
const TENANT_ID = 'agentic-hackathon';
const CHAT_PATH = '/api/personal-agent/chat';

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

function expectMentions(reply, words) {
  const lowerReply = reply.toLowerCase();
  const found = words.some((word) => lowerReply.includes(word.toLowerCase()));
  expect(found).toBe(true);
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

  async function chat(message, sessionId) {
    const body = { message };
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

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

      sessionId = payload.sessionId || sessionId;

      const reply = extractReply(payload);
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['stand', 'einschaetzung', 'quelle', 'beleg', 'unsicher']);
      expectNoInternalErrorCodes(reply);

      // Intent-Metadaten sind ggf. nicht exponiert; dann inhaltlich validieren.
      if (payload.capability || payload.intent?.capability) {
        const capabilityText = JSON.stringify(payload).toLowerCase();
        expect(capabilityText).toContain('cya');
      }
    });

    it('Turn 2: Unsicherheiten klar markieren', async () => {
      const { response, payload } = await client.chat(
        'Bitte nur belastbare Aussagen und kennzeichne Unsicherheiten klar.',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

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

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

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

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

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
        'Vergleiche bitte zwei Netzbetreiber hinsichtlich Anschlussgeschwindigkeit.',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['vergleich', 'gegenueber', 'schneller', 'langsamer']);
      expectNoInternalErrorCodes(reply);
    });

    it('Turn 2: Zusätzliche Dimensionen', async () => {
      const { response, payload } = await client.chat(
        'Ergaenze Digitalisierung und Umsetzungsquote im Vergleich.',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);
      turn2Reply = reply;

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['digital', 'umsetzungsquote', 'vergleich']);
      expectNoInternalErrorCodes(reply);
    });

    it('Turn 3: Synthese über vorherige Turns', async () => {
      const { response, payload } = await client.chat(
        'Gewichte Anschlussgeschwindigkeit hoechst und fasse das Ergebnis zusammen.',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

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
        'Erstelle eine Rangliste mit kurzer Begruendung.',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

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
        'Wir pruefen ein Anschlussbegehren fuer ein Rechenzentrum in Frankfurt. Wie ist der Stand?',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);
      turn1Reply = reply;

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['stand', 'prozess', 'status']);
      expectNoInternalErrorCodes(reply);

      if (payload.capability || payload.intent?.capability || payload.routing?.primaryIntent) {
        const capabilityText = JSON.stringify(payload).toLowerCase();
        expect(capabilityText).toContain('grid-connection');
      }
    });

    it('Turn 2: N-1 Reserve aus Kontext erklären', async () => {
      const { response, payload } = await client.chat(
        'Was bedeutet das fuer unsere N-1 Reserve?',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

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
        'Projiziere den fNAV fuer die naechsten 5 Jahre.',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

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
        'Wir verlagern das Projekt nach Muenchen. Aktualisiere die Pruefung.',
        sessionId
      );

      expect(response.status).toBeLessThan(500);
      expect(payload && typeof payload).toBe('object');

      sessionId = payload.sessionId || sessionId;
      const reply = extractReply(payload);

      expect(reply.length).toBeGreaterThan(20);
      expectMentions(reply, ['muenchen']);
      expect(reply.toLowerCase()).not.toContain('frankfurt');
      expectMentions(reply, ['n-1', 'fnav']);
      expectNoInternalErrorCodes(reply);
    });
  });
});
