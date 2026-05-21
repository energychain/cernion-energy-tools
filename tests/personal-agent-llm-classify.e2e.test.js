/**
 * E2E tests: LLM-basierte ChatMode-Klassifikation — Walldorf & Burgbernheim Szenarien
 *
 * Diese Tests laufen opt-in gegen einen laufenden Dev-Server (Port 3900).
 * Wenn kein Server verfügbar ist, werden alle Tests übersprungen.
 *
 * Ausführen: NODE_ENV=test node --experimental-vm-modules node_modules/.bin/jest \
 *              tests/personal-agent-llm-classify.e2e.test.js --testTimeout=30000
 */

const http = require('http');

const RUN_E2E = process.env.RUN_PERSONAL_AGENT_E2E_LIVE === 'true';
const BASE_URL = process.env.PA_E2E_BASE_URL || 'http://localhost:3900';
const TIMEOUT_MS = 20000;

async function postChat(sessionId, message, opts = {}) {
  const body = JSON.stringify({
    message,
    sessionId,
    executionMode: opts.executionMode || 'auto',
    ...(opts.chatMode ? { chatMode: opts.chatMode } : {}),
  });

  return new Promise((resolve, reject) => {
    const url = new URL('/api/personal-agent/chat', BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(process.env.PA_E2E_TOKEN
            ? { Authorization: `Bearer ${process.env.PA_E2E_TOKEN}` }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('E2E request timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function isServerAvailable() {
  try {
    await postChat('__ping__', '__ping__');
    return true;
  } catch {
    return false;
  }
}

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await isServerAvailable();
  if (!serverAvailable) {
    console.warn(
      '[E2E] Dev-Server nicht erreichbar unter ' + BASE_URL + ' — Tests werden übersprungen.'
    );
  }
}, 10000);

function skipIfNoServer() {
  if (!serverAvailable) {
    pending('Dev-Server nicht verfügbar');
  }
}

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('LLM ChatMode Klassifikation — E2E Szenarien', () => {
  describe('Walldorf Szenario', () => {
    const sessionId = `e2e-walldorf-${Date.now()}`;

    it('Turn 1: Ladepark-Erwähnung → consultation', async () => {
      skipIfNoServer();
      const res = await postChat(sessionId, 'Ich möchte einen Ladepark anschließen.');
      expect([200, 202]).toContain(res.status);
      const data = res.body;
      expect(data.success).toBe(true);
      // Consultation mode: status = 'consulting' oder kein execution-Ergebnis
      expect(data.chatMode).toBe('consultation');
    }, TIMEOUT_MS);

    it('Turn 2: "BDEW-Code ist unbekannt" → consultation (kein execution)', async () => {
      skipIfNoServer();
      const res = await postChat(sessionId, 'Stadtwerke Walldorf, der BDEW-Code ist unbekannt.');
      expect([200, 202]).toContain(res.status);
      const data = res.body;
      expect(data.success).toBe(true);
      // KRITISCH: Statement darf NICHT execution triggern
      expect(data.chatMode).toBe('consultation');
      expect(data.status).not.toBe('awaiting-onboarding');
      expect(data.routing?.chatModeSource).not.toBe('heuristic'); // LLM oder default
    }, TIMEOUT_MS);

    it('Turn 3: "Prüfe jetzt den MaStR-Eintrag" → execution', async () => {
      skipIfNoServer();
      const res = await postChat(sessionId, 'Prüfe jetzt den MaStR-Eintrag für Stadtwerke Walldorf.');
      expect([200, 202]).toContain(res.status);
      const data = res.body;
      expect(data.success).toBe(true);
      expect(data.chatMode).toBe('execution');
    }, TIMEOUT_MS);
  });

  describe('Burgbernheim Szenario', () => {
    const sessionId = `e2e-burgbernheim-${Date.now()}`;

    it('Turn 1: Hintergrund-Beschreibung → consultation', async () => {
      skipIfNoServer();
      const res = await postChat(
        sessionId,
        'Ich betreibe eine PV-Anlage in Burgbernheim und werde bereits regelmäßig abgeregelt.'
      );
      expect([200, 202]).toContain(res.status);
      const data = res.body;
      expect(data.success).toBe(true);
      // Problemschilderung → consultation
      expect(data.chatMode).toBe('consultation');
    }, TIMEOUT_MS);

    it('Turn 2: "Ich werde bereits regelmäßig abgeregelt" → consultation', async () => {
      skipIfNoServer();
      const res = await postChat(sessionId, 'Ich werde bereits regelmäßig abgeregelt.');
      expect([200, 202]).toContain(res.status);
      const data = res.body;
      expect(data.success).toBe(true);
      expect(data.chatMode).toBe('consultation');
    }, TIMEOUT_MS);
  });

  describe('Explicit API chatMode override', () => {
    const sessionId = `e2e-override-${Date.now()}`;

    it('explicit chatMode=execution forces execution regardless of LLM', async () => {
      skipIfNoServer();
      const res = await postChat(
        sessionId,
        'Der BDEW-Code ist 9900123456789.',
        { chatMode: 'execution' }
      );
      expect([200, 202]).toContain(res.status);
      const data = res.body;
      expect(data.success).toBe(true);
      expect(data.chatMode).toBe('execution');
      expect(data.routing?.chatModeSource).toBe('api');
    }, TIMEOUT_MS);
  });
});
