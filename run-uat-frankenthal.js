const axios = require('axios');
const { uatBaseUrl, logRecord } = require('./src/operator-cli-security');
const client = axios.create({ maxRedirects: 0, timeout: 30000 });

const API_BASE = uatBaseUrl(process.env.UAT_API_BASE_URL);
const SESSION_ID = 'uat-frankenthal-v5-' + Date.now();
const TENANT_ID = 'uat-tenant-005';

async function runTurn(turnNumber, message) {
  console.log(`\n======================================================`);
  console.log(`TURN ${turnNumber}`);
  console.log(logRecord('user', { message }));
  console.log(`======================================================\n`);

  const payload = {
    message,
    sessionId: SESSION_ID,
    executionMode: 'auto',
    knownContext: {
      tenantId: TENANT_ID,
    },
  };

  try {
    const response = await client.post(`${API_BASE}/api/personal-agent/chat`, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = response.data;
    console.log(logRecord('execution-status', data.execution?.status || 'N/A'));
    console.log(logRecord('presentation-applied', data.presentationApplied));
    console.log(logRecord('presentation-type', data.presentationType));

    if (data.presentation && data.presentation.markdown) {
      console.log(logRecord('markdown', data.presentation.markdown));
    } else {
      console.log(logRecord('reply', data.reply));
    }
    return data;
  } catch (error) {
    console.error(logRecord('turn-failed', { turnNumber, message: error.message }));
  }
}

async function runUAT() {
  console.log(`Starting UAT Session: ${SESSION_ID}`);
  await runTurn(
    1,
    'Ich bin Analyst bei einer Bank und prüfe gerade ein Batteriespeicher-Projekt. Kannst du mir helfen, das zu bewerten?'
  );
  await runTurn(
    2,
    'Standort ist Frankenthal (Pfalz), Industriegebiet. Kapazität 12 MW. Netzbetreiber soll laut Prospekt STROMDAO Netze sein.'
  );
  await runTurn(
    3,
    'Okay, danke für die Korrektur. Gehen wir von den Stadtwerken Frankenthal aus. Was ist der nächste formale Schritt für die Anschlusszusage nach dem EnWG, wenn wir das finanzieren wollen?'
  );
  await runTurn(4, 'Erstelle mir daraus ein One-Pager Risk Assessment für unser Kreditkomitee.');
}

runUAT().catch((error) => {
  console.error(logRecord('uat-failed', error.message));
  process.exitCode = 1;
});
