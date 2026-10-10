const axios = require('axios');
const { uatBaseUrl, jobPath, logRecord } = require('./src/operator-cli-security');
const client = axios.create({ maxRedirects: 0, timeout: 30000 });
const API_BASE = uatBaseUrl(process.env.UAT_API_BASE_URL);
async function run() {
  try {
    const payload = {
      message:
        "Wir haben hier bei der Stadtwerke Göttingen AG (Netzgesellschaft) eine Netzanschlussanfrage für das neue Projekt 'Leinetal-Campus'. Es geht um 15 MW Kapazität, primär für ein Rechenzentrum und eine 3 MW Wärmepumpe zur Abwärmenutzung. Kannst du bei der Prüfung unterstützen?",
      sessionId: 'uat-goettingen-stepbystep-001',
      executionMode: 'auto',
      knownContext: {
        tenantId: 'uat-tenant-goettingen-002',
        agentId: 'Stadtwerke_Goettingen_Netz',
      },
    };
    const startRes = await client.post(`${API_BASE}/api/personal-agent/chat`, payload);
    const jobId = startRes.data.jobId;
    console.log(logRecord('job-started', jobId));
    if (!jobId) {
      console.log(logRecord('missing-job-id', startRes.data));
      return;
    }

    while (true) {
      const statusRes = await client.get(`${API_BASE}${jobPath(jobId, 'status')}`);
      const status = statusRes.data.status;
      console.log(logRecord('job-status', status));
      if (status === 'completed') {
        const resultRes = await client.get(`${API_BASE}${jobPath(jobId, 'result')}`);
        console.log('\n--- RESULT ---');
        console.log(logRecord('job-result', resultRes.data));
        break;
      } else if (status === 'error' || status === 'failed') {
        console.log(logRecord('job-error', statusRes.data));
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (e) {
    console.error(logRecord('request-failed', e.response?.data || e.message));
  }
}
run().catch((error) => {
  console.error(logRecord('uat-failed', error.message));
  process.exitCode = 1;
});
