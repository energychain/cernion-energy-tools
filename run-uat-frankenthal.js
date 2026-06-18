const axios = require('axios');

const API_URL = 'http://10.0.0.8:3900/api/personal-agent/chat';
const SESSION_ID = 'uat-frankenthal-v5-' + Date.now();
const TENANT_ID = 'uat-tenant-005';

async function runTurn(turnNumber, message) {
  console.log(`\n======================================================`);
  console.log(`TURN ${turnNumber}`);
  console.log(`USER: "${message}"`);
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
    const response = await axios.post(API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = response.data;
    console.log(`[STATUS] Execution Status: ${data.execution?.status || 'N/A'}`);
    console.log(`[PRESENTATION] Applied: ${data.presentationApplied}`);
    console.log(`[PRESENTATION] Type: ${data.presentationType}`);

    if (data.presentation && data.presentation.markdown) {
      console.log(`\n[MARKDOWN OUTPUT]\n${data.presentation.markdown}\n`);
    } else {
      console.log(`\n[RAW REPLY]\n${data.reply}\n`);
    }
    return data;
  } catch (error) {
    console.error(`[ERROR] Turn ${turnNumber} failed:`, error.message);
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

runUAT();
