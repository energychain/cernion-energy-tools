'use strict';

const TOOL_REGISTRY_VERSION = 'cernion.workbench.tool-registry.v1';

const TOOL_REGISTRY = [
  {
    toolId: 'web_fetch',
    title: 'Fetch public web resource',
    toolClass: 'web_fetch',
    sideEffectClass: 'read_only_external',
    requiredRoles: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_PLANNING', 'ROLE_UTILITY_HQ'],
    evidenceOutputType: 'public_web_page',
    description: 'Fetch a public URL as supporting Workbench evidence. No browser automation.',
  },
  {
    toolId: 'web_browse',
    title: 'Browse public web context',
    toolClass: 'web_browse',
    sideEffectClass: 'read_only_external',
    requiredRoles: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_PLANNING', 'ROLE_UTILITY_HQ'],
    evidenceOutputType: 'public_web_page',
    description: 'Read-only public browsing placeholder governed by CET policy.',
  },
  {
    toolId: 'mail_search',
    title: 'Search tenant mailbox',
    toolClass: 'mail_search',
    sideEffectClass: 'read_only_external',
    requiredRoles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_EDM', 'ROLE_GRID_OPERATOR'],
    evidenceOutputType: 'market_partner_protocol',
    description: 'Search tenant-bound mail sources. Credentials remain outside LLM context.',
  },
  {
    toolId: 'mail_read',
    title: 'Read tenant mail message',
    toolClass: 'mail_read',
    sideEffectClass: 'read_only_external',
    requiredRoles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_EDM', 'ROLE_GRID_OPERATOR'],
    evidenceOutputType: 'market_partner_protocol',
    description: 'Read one approved tenant mail message as Workbench evidence. No send/reply.',
  },
  {
    toolId: 'mail_send',
    title: 'Send tenant mail message',
    toolClass: 'mail_send',
    sideEffectClass: 'external_business_effect',
    requiredRoles: ['ROLE_MARKET_COMMUNICATION'],
    evidenceOutputType: 'market_partner_protocol',
    description:
      'Outbound mail is intentionally blocked unless a future CET RBAC/HITL path enables it.',
  },
  {
    toolId: 'document_fetch',
    title: 'Fetch document reference',
    toolClass: 'document_fetch',
    sideEffectClass: 'internal_cet_state',
    requiredRoles: ['ROLE_GRID_OPERATOR', 'ROLE_UTILITY_HQ', 'ROLE_MARKET_COMMUNICATION'],
    evidenceOutputType: 'generic_document',
    description: 'Attach an existing document reference to a Workbench case.',
  },
  {
    toolId: 'api_lookup',
    title: 'CET API lookup',
    toolClass: 'api_lookup',
    sideEffectClass: 'internal_cet_state',
    requiredRoles: ['ROLE_GRID_OPERATOR', 'ROLE_UTILITY_HQ', 'ROLE_MARKET_COMMUNICATION'],
    evidenceOutputType: 'generic_document',
    description: 'Run a governed internal CET lookup and attach the result summary.',
  },
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
