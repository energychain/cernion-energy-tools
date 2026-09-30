'use strict';

const TOOL_REGISTRY_VERSION = 'cernion.workbench.tool-registry.v1';

const ROLE_SETS = {
  gridEvidence: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_PLANNING', 'ROLE_UTILITY_HQ'],
  makoEvidence: ['ROLE_MARKET_COMMUNICATION', 'ROLE_EDM', 'ROLE_GRID_OPERATOR'],
  internalLookup: ['ROLE_GRID_OPERATOR', 'ROLE_UTILITY_HQ', 'ROLE_MARKET_COMMUNICATION'],
};

function defineTool(
  toolId,
  title,
  toolClass,
  sideEffectClass,
  requiredRoles,
  evidenceOutputType,
  description
) {
  return {
    toolId,
    title,
    toolClass,
    sideEffectClass,
    requiredRoles,
    evidenceOutputType,
    description,
  };
}

const TOOL_REGISTRY = [
  defineTool(
    'web_fetch',
    'Fetch public web resource',
    'web_fetch',
    'read_only_external',
    ROLE_SETS.gridEvidence,
    'public_web_page',
    'Fetch a public URL as supporting Workbench evidence. No browser automation.'
  ),
  defineTool(
    'web_browse',
    'Browse public web context',
    'web_browse',
    'read_only_external',
    ROLE_SETS.gridEvidence,
    'public_web_page',
    'Read-only public browsing placeholder governed by CET policy.'
  ),
  defineTool(
    'mail_search',
    'Search tenant mailbox',
    'mail_search',
    'read_only_external',
    ROLE_SETS.makoEvidence,
    'market_partner_protocol',
    'Search tenant-bound mail sources. Credentials remain outside LLM context.'
  ),
  defineTool(
    'mail_read',
    'Read tenant mail message',
    'mail_read',
    'read_only_external',
    ROLE_SETS.makoEvidence,
    'market_partner_protocol',
    'Read one approved tenant mail message as Workbench evidence. No send/reply.'
  ),
  defineTool(
    'mail_send',
    'Send tenant mail message',
    'mail_send',
    'external_business_effect',
    ['ROLE_MARKET_COMMUNICATION'],
    'market_partner_protocol',
    'Outbound mail is intentionally blocked unless a future CET RBAC/HITL path enables it.'
  ),
  defineTool(
    'document_fetch',
    'Fetch document reference',
    'document_fetch',
    'internal_cet_state',
    ROLE_SETS.internalLookup,
    'generic_document',
    'Attach an existing document reference to a Workbench case.'
  ),
  defineTool(
    'api_lookup',
    'CET API lookup',
    'api_lookup',
    'internal_cet_state',
    ROLE_SETS.internalLookup,
    'generic_document',
    'Run a governed internal CET lookup and attach the result summary.'
  ),
];

function safeTool(tool, governance = null) {
  return {
    toolId: tool.toolId,
    title: tool.title,
    toolClass: tool.toolClass,
    sideEffectClass: tool.sideEffectClass,
    requiredRoles: tool.requiredRoles || [],
    evidenceOutputType: tool.evidenceOutputType,
    description: tool.description,
    governanceBoundary: 'CET-governed; external/business effects blocked unless explicitly enabled',
    allowedByGovernance: governance?.allowed ?? undefined,
    blockedReason: governance?.blockedReason || undefined,
  };
}

function getWorkbenchTool(toolId) {
  return TOOL_REGISTRY.find((tool) => tool.toolId === toolId) || null;
}

function listWorkbenchTools() {
  return TOOL_REGISTRY.slice();
}

function simulateToolOutput(tool, input = {}) {
  const subject = input.url || input.query || input.documentId || input.messageId || tool.toolId;
  return {
    outputSummary: `${tool.title}: governed placeholder result for ${subject}`,
    safeDisplayText: `CET-governed ${tool.toolClass} result recorded as supporting evidence.`,
    rawOutputStored: false,
  };
}

module.exports = {
  TOOL_REGISTRY_VERSION,
  TOOL_REGISTRY,
  getWorkbenchTool,
  listWorkbenchTools,
  safeTool,
  simulateToolOutput,
};
