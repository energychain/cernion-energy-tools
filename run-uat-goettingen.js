const axios = require('axios');

const API_BASE = 'http://10.0.0.8:3900';
const SESSION_ID = 'uat-goettingen-v2-' + Date.now();
const TENANT_ID = 'uat-tenant-goettingen-002';

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      agentId: 'Stadtwerke_Goettingen_Netz',
    },
  };

  try {
    const startRes = await axios.post(`${API_BASE}/api/personal-agent/chat`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!startRes.data.jobId) {
      console.log(`[ERROR] No jobId returned. Response:`, startRes.data);
      return;
    }

    const jobId = startRes.data.jobId;
    console.log(`[JOB STARTED] JobId: ${jobId}`);

    let resultData = null;
    let attempts = 0;
    while (attempts < 30) {
      const statusRes = await axios.get(`${API_BASE}/api/jobs/${jobId}/status`);
      const status = statusRes.data.status;
      if (status === 'completed') {
        const resultRes = await axios.get(`${API_BASE}/api/jobs/${jobId}/result`);
        resultData = resultRes.data;
        break;
      } else if (status === 'failed') {
        console.error(`[ERROR] Job failed.`);
        return;
      }
      await delay(2000);
      attempts++;
    }

    if (!resultData) {
      console.log(`[ERROR] Job timed out.`);
      return;
    }

    // Check where the final response is
    const reply =
      resultData.reply ||
      resultData.result?.reply ||
      resultData.synthesisText ||
      resultData.result?.synthesisText ||
      resultData.result?.presentation?.markdown ||
      JSON.stringify(resultData.result, null, 2);

    const presentationApplied =
      resultData.presentationApplied || resultData.result?.presentationApplied;
    const presentationType = resultData.presentationType || resultData.result?.presentationType;
    const markdown = resultData.presentation?.markdown || resultData.result?.presentation?.markdown;

    console.log(`[PRESENTATION] Applied: ${presentationApplied}`);
    console.log(`[PRESENTATION] Type: ${presentationType}`);

    if (presentationApplied && markdown) {
      console.log(`\n[MARKDOWN OUTPUT]\n${markdown}\n`);
    } else {
      console.log(`\n[RAW REPLY]\n${reply}\n`);
    }
    return resultData;
  } catch (error) {
    console.error(`[ERROR] Turn ${turnNumber} failed:`, error.response?.data || error.message);
  }
}

async function runUAT() {
  console.log(`Starting UAT Session (Göttingen - Niedersachsen): ${SESSION_ID}`);

  await runTurn(
    1,
    "Wir haben hier bei der Stadtwerke Göttingen AG (Netzgesellschaft) eine Netzanschlussanfrage für das neue Projekt 'Leinetal-Campus'. Es geht um 15 MW Kapazität, primär für ein Rechenzentrum und eine 3 MW Wärmepumpe zur Abwärmenutzung. Kannst du bei der Prüfung unterstützen?"
  );

  await runTurn(
    2,
    'Der Anschluss soll auf der 20-kV-Mittelspannungsebene erfolgen. Unser technischer Planer sagt, das zuständige Umspannwerk operiert am N-1 Limit. Ein konventioneller Ausbau dauert 4 Jahre und kostet 3,5 Mio. Euro CAPEX. Er will den Antrag aus Kapazitätsgründen ablehnen. Geht das rechtlich nach §17 EnWG so einfach?'
  );

  await runTurn(
    3,
    'Guter Punkt zur flexiblen Netzanschlussvereinbarung (fNAV). Der kaufmännische Bereich will ohnehin hohe CAPEX/Stranded Assets vermeiden und die Netzentgelte sofort sichern. Wie sieht der genaue Prozess (Rollen und Verantwortlichkeiten) aus, um diesen Konflikt zwischen Technik (will ablehnen) und Kaufmännischem Bereich (will fNAV) aufzulösen?'
  );

  await runTurn(
    4,
    'Erstelle mir daraus eine VDMI-Matrix (Verantwortlich, Durchführend, Mitwirkend, Informiert) für den finalen Entscheidungsprozess und die Umsetzung dieses fNAV für den Leinetal-Campus.'
  );
}

runUAT();
