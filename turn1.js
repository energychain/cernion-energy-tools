const axios = require('axios');
const API_BASE = 'http://127.0.0.1:3925';
async function run() {
  try {
    const payload = {
      message: "Wir haben hier bei der Stadtwerke Göttingen AG (Netzgesellschaft) eine Netzanschlussanfrage für das neue Projekt 'Leinetal-Campus'. Es geht um 15 MW Kapazität, primär für ein Rechenzentrum und eine 3 MW Wärmepumpe zur Abwärmenutzung. Kannst du bei der Prüfung unterstützen?",
      sessionId: 'uat-goettingen-stepbystep-001',
      executionMode: 'auto',
      knownContext: {
        tenantId: 'uat-tenant-goettingen-002',
        agentId: 'Stadtwerke_Goettingen_Netz'
      }
    };
    const startRes = await axios.post(`${API_BASE}/api/personal-agent/chat`, payload);
    const jobId = startRes.data.jobId;
    console.log("JobId:", jobId);
    if (!jobId) { console.log(startRes.data); return; }
    
    while(true) {
      const statusRes = await axios.get(`${API_BASE}/api/jobs/${jobId}/status`);
      const status = statusRes.data.status;
      console.log("Status:", status);
      if (status === 'completed') {
        const resultRes = await axios.get(`${API_BASE}/api/jobs/${jobId}/result`);
        console.log("\n--- RESULT ---");
        console.log(JSON.stringify(resultRes.data, null, 2));
        break;
      } else if (status === 'error' || status === 'failed') {
        console.log("Error state:", statusRes.data);
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    console.error("Crash/Error:", e.response?.data || e.message);
  }
}
run();
