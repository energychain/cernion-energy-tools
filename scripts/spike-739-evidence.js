#!/usr/bin/env node
'use strict';

// Run the unmodified PA collectors, never a replacement retrieval implementation.
const collectors = require('../services/personal-agent/methods-part-01-of-11');
const { extractCopilotAnalysisSignals } = require('../services/personal-agent/shared');
const question =
  'Mail eines Lieferanten an einen Netzbetreiber: Überfällige Antwort auf Netzanmeldung, Marktlokation 99000000001, Frist überschritten. Kannst du mir helfen?';
const calls = [];
const article = {
  id: 'document-1',
  title: 'Netzanmeldung klären',
  url: 'https://example.invalid/knowledge/1',
  score: 0.91,
  excerpt: 'Anmeldung und Eingangsbestätigung anhand der Referenz prüfen.',
};
const ctx = {
  meta: { tenantId: 'spike-anonymous' },
  async call(name) {
    calls.push(name);
    if (name === 'knowledge-rag.query')
      return {
        results: [
          { id: 'unrelated', score: 0.58, summary: 'Windturbinen: Wartung von Rotorblättern' },
        ],
      };
    if (name === 'datapoint.list') return { datapoints: [] };
    if (name === 'willi-mako.resolveStructure')
      return {
        success: true,
        data: { sources: [article, article], noCallBoundaries: ['No dispatch'] },
      };
    throw new Error(`Unexpected source: ${name}`);
  },
};

(async () => {
  const results = await Promise.all([
    collectors.collectCopilotKnowledgeEvidence.call(collectors, ctx, { question }),
    collectors.collectCopilotMakoKnowledgeEvidence.call(collectors, ctx, { question }),
    collectors.collectCopilotDatapointEvidence.call(collectors, ctx, { queryTerms: [question] }),
    collectors.collectCopilotPlanningEvidence.call(collectors, ctx, {
      analysisSignals: extractCopilotAnalysisSignals(question),
    }),
  ]);
  const edifactControl = await collectors.collectCopilotMakoKnowledgeEvidence.call(
    collectors,
    ctx,
    { question: 'APERAK Fehlercode bei Anmeldung erklären' }
  );
  console.log(JSON.stringify({ question, results, calls, edifactControl }, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
