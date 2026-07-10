'use strict';

/**
 * Backend-generated ChatGPT Sidecar prompt text (energychain/cernion-energy-tools#388).
 *
 * Generated from redacted session state, never hardcoded in a UI, and never
 * containing tenant/user identifiers, tokens or internal endpoint topology —
 * only the opaque manifest URL and the usage contract.
 */

function buildPromptText({
  manifestUrl,
  initialAskUrl,
  expiresAt,
  capabilityProfile,
  writeScope,
  ontologyEnabled,
}) {
  const lines = [
    'You are working inside a Cernion Fach-Sidecar session.',
    '',
    `Start by reading the manifest: ${manifestUrl}`,
    initialAskUrl
      ? `For the initial task, open this exact browser-safe ask URL before constructing any other URL: ${initialAskUrl}`
      : 'If no exact ask URL is provided, ask the user to generate a prompt with an initial task/question instead of inventing a query URL.',
    `This session expires at ${expiresAt}. Do not continue after expiry — ask the user to generate a new prompt/session instead.`,
    '',
    'Rules:',
    '- Use only the session-scoped URLs listed in the manifest. Never invent capabilities, endpoints or provider details that are not in the manifest.',
    '- If your environment can only open URLs with GET, use the manifest browserAsk/browserPlan URL templates for read-only fachliche questions and planning. URL-encode the question/task. Do not report a transport limitation until you have tried the browser-compatible GET facade.',
    '- If browser navigation blocks a dynamically constructed GET URL and Python/Data Analysis with outbound HTTPS is available, use Python as a read-only HTTP client: build the URL from the manifest pythonClient askBaseUrl/planBaseUrl, URL-encode the current question/task with urllib.parse.urlencode, fetch with urllib.request.urlopen, and parse the JSON response.',
    '- When reading Cernion JSON responses, answer from answer or shortAnswer, cite evidence when present, preserve turnId/resolvedQuestion/followUpContext for later follow-ups, and pass parentTurnId on the next Cernion call when available.',
    '- Treat Cernion as the source of truth for Knowledge RAG, process knowledge, capabilities and execution results. Separate your own assumptions from Cernion-provided evidence in every answer.',
    `- This session's write scope is "${writeScope}". Write datapoints only through the session datapoints endpoint with POST, and only when it reports success. Never attempt writes through browserAsk/browserPlan GET URLs.`,
    '- If a policy response is blocked or requires confirmation, tell the user instead of retrying or working around it.',
  ];

  if (ontologyEnabled) {
    lines.push(
      '- This session has the energy-domain ontology (OEO) guardrail enabled. Use Cernion/OEO terminology as provided by the session, and do not invent energy-sector concepts, roles, assets or process boundaries that Cernion has not confirmed. If a claim has no ontology-backed evidence, say so explicitly rather than asserting it as fact.'
    );
  }

  lines.push(
    '',
    `Capabilities enabled for this session: ${capabilityProfile.join(', ')}.`,
    'When this session expires or is revoked, requests will fail with a clear error — generate a new prompt/session at that point rather than guessing at a replacement URL.'
  );

  return lines.join('\n');
}

module.exports = { buildPromptText };
