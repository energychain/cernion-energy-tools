#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  getSidecarTool,
  listSidecarTools,
  validateToolDefinition,
} = require('../../src/agent-sidecar-tool-manifest');
const { buildPolicyBlocked } = require('../../src/agent-sidecar-policy');
const { evaluateReceiptPlan } = require('../../src/agent-receipts-evaluation');
const { validateReceipt } = require('../../src/agent-receipts-schema');
const { stableHash } = require('../../src/agent-receipts-registry');

const PROJECT = 'AgentOps Receipt QA Smoke';
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'reports');

function demoActionRegistry() {
  return {
    'grid-operations.marketPartners': {
      service: 'grid-operations',
      action: 'grid-operations.marketPartners',
      paramsSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
    'grid-operations.vnbLookup': {
      service: 'grid-operations',
      action: 'grid-operations.vnbLookup',
      paramsSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          city: { type: 'string' },
          bdew: { type: 'string' },
          vnbName: { type: 'string' },
        },
        required: [],
      },
    },
  };
}

function withRegistrySignatures(registry) {
  const result = {};
  for (const [action, info] of Object.entries(registry)) {
    result[action] = {
      ...info,
      signature: stableHash({ action: info.action, paramsSchema: info.paramsSchema }),
    };
  }
  return result;
}

function demoReceipt(overrides = {}) {
  return {
    receiptId: 'agentops-vnb-resolution-v1',
    title: 'AgentOps VNB resolution receipt',
    description:
      'Build Week fixture proving that an agent plan resolves network-operator evidence before answering.',
    domain: 'grid-operations',
    tags: ['build-week', 'agentops', 'receipt'],
    matching: {
      domains: ['grid-operations'],
      triggerTerms: ['vnb', 'netzbetreiber', 'zuständig'],
      requiredEntities: [],
      workflowTypes: ['vnb_identification'],
    },
    requiredInputs: ['city'],
    toolPlan: {
      steps: [
        {
          action: 'grid-operations.marketPartners',
          description: 'Resolve the responsible market partner before downstream VNB checks.',
          requiredScopes: ['locationScope'],
          paramMapping: {
            query: { source: 'context', contextField: 'city' },
            limit: { source: 'default', defaultKey: 'limit', value: 3 },
          },
          evidence: {
            requiredOutputFields: ['data.items'],
          },
        },
        {
          action: 'grid-operations.vnbLookup',
          description:
            'Use an operator-scoped lookup only after the market partner identity has been resolved.',
          requiredScopes: ['operatorScope'],
          paramMapping: {
            city: { source: 'context', contextField: 'city' },
            bdew: { source: 'context', contextField: 'bdew' },
          },
          evidence: {
            requiredOutputFields: ['data.bdew', 'data.mastrId'],
          },
        },
      ],
      defaults: { limit: 3 },
    },
    evidencePolicy: { requireVerifiedToolObservation: true },
    responsePolicy: { onUnverified: 'ask-for-missing-evidence' },
    knowledgeEvidencePolicy: { required: false },
    metadata: {
      buildWeekFixture: true,
      oldWork: 'Cernion receipt/sidecar primitives existed before Build Week.',
      newWork: 'This smoke harness packages those primitives as a one-command Developer Tools QA report.',
    },
    ...overrides,
  };
}

function missingActionReceipt() {
  return demoReceipt({
    receiptId: 'agentops-missing-action-v1',
    title: 'AgentOps missing action receipt',
    toolPlan: {
      steps: [
        {
          action: 'billing.approveInvoice',
          description: 'Unsafe/non-existing action fixture; the harness must block it.',
          evidence: { requiredOutputFields: ['approval.id'] },
        },
      ],
    },
  });
}

function pass(id, message, details = {}) {
  return { id, status: 'pass', message, details };
}

function fail(id, message, details = {}) {
  return { id, status: 'fail', message, details };
}

function checkManifestReadOnly() {
  const tools = listSidecarTools();
  const invalid = tools
    .map((tool) => ({ tool, validation: validateToolDefinition(tool) }))
    .filter(({ tool, validation }) =>
      !validation.valid || tool.requiredScope !== 'read-only' || tool.sideEffects !== 'none'
    );

  if (tools.length > 0 && tools.length <= 5 && invalid.length === 0) {
    return pass('manifest.readOnlyTools', 'Curated Sidecar manifest is read-only and bounded.', {
      toolCount: tools.length,
      tools: tools.map((tool) => tool.name),
      sideEffects: Array.from(new Set(tools.map((tool) => tool.sideEffects))),
    });
  }

  return fail('manifest.readOnlyTools', 'Sidecar manifest contains unsafe or invalid tools.', {
    toolCount: tools.length,
    invalid: invalid.map(({ tool, validation }) => ({ name: tool.name, errors: validation.errors })),
  });
}

function checkUnknownToolBlocked() {
  const toolName = 'hitl.approve';
  const tool = getSidecarTool(toolName);
  const blocked = tool ? null : buildPolicyBlocked('unknown_tool', { toolName });
  if (blocked?.error === 'sidecar_policy_blocked' && blocked.reason === 'unknown_tool') {
    return pass('sidecar.unknownToolBlocked', 'Unknown or direct HITL-style tools fail closed.', blocked);
  }
  return fail('sidecar.unknownToolBlocked', 'Unknown tool did not fail closed.', { toolName, tool });
}

function checkForbiddenTargetBlocked() {
  const unsafeTool = {
    name: 'cernion.unsafe_demo',
    targetAction: 'hitl.approve',
    safetyClass: 'advisory_reasoning',
    requiredScope: 'read-only',
    tenantPolicy: 'context_tenant_must_match_auth_tenant',
    rolePolicy: ['ROLE_UTILITY_HQ'],
    hitlPolicy: 'must_not_create_or_resolve_human_approval',
    responseContract: 'blocked_fixture',
    sideEffects: 'none',
    description: 'Unsafe fixture used to prove policy blocking.',
  };
  const validation = validateToolDefinition(unsafeTool);
  const blocked = validation.valid
    ? null
    : buildPolicyBlocked('forbidden_target_action', {
        targetAction: unsafeTool.targetAction,
        validationErrors: validation.errors,
      });

  if (blocked?.reason === 'forbidden_target_action') {
    return pass(
      'sidecar.forbiddenTargetBlocked',
      'Forbidden write/admin/HITL target actions are detected before execution.',
      blocked
    );
  }
  return fail('sidecar.forbiddenTargetBlocked', 'Forbidden target action was not detected.', {
    validation,
  });
}

function validateDemoReceipt(receipt) {
  const validation = validateReceipt(receipt);
  if (!validation.valid) {
    return { validation, normalized: receipt };
  }
  return { validation, normalized: validation.normalized };
}

function evaluate(receipt, context) {
  const actionRegistry = withRegistrySignatures(demoActionRegistry());
  return evaluateReceiptPlan(receipt, {
    actionRegistry,
    context,
    knowledgeEvidence: {
      status: 'available',
      hits: [
        {
          id: 'build-week-fixture-1',
          source: 'synthetic-fixture',
          summary: 'Synthetic evidence fixture for judge-safe offline smoke tests.',
        },
      ],
      trace: { queryCount: 1, queries: ['responsible network operator evidence'] },
    },
  });
}

function checkReceiptSchemaRegistry() {
  const { validation, normalized } = validateDemoReceipt(demoReceipt());
  if (!validation.valid) {
    return fail('receipt.schemaRegistryCheck', 'Demo receipt schema validation failed.', {
      errors: validation.errors,
    });
  }
  const result = evaluate(normalized, {
    city: 'Wiesloch',
    domain: 'grid-operations',
    workflowType: 'vnb_identification',
    question: 'Wer ist der zuständige VNB in Wiesloch?',
  });
  const first = result.plannedToolCalls[0];
  if (first?.selectedAction === 'grid-operations.marketPartners' && first.status === 'ready') {
    return pass('receipt.schemaRegistryCheck', 'Receipt maps context to the live action schema.', {
      receiptId: result.receiptId,
      selectedAction: first.selectedAction,
      params: first.params,
      executable: result.executable,
      actionCount: result.actionRegistrySummary.actionCount,
    });
  }
  return fail('receipt.schemaRegistryCheck', 'Receipt did not map to expected action schema.', result);
}

function checkReceiptEvidenceRequirements() {
  const { normalized } = validateDemoReceipt(demoReceipt());
  const result = evaluate(normalized, {
    city: 'Wiesloch',
    domain: 'grid-operations',
    workflowType: 'vnb_identification',
  });
  const requirement = result.evidenceRequirements[0];
  if (requirement?.requiredOutputFields?.includes('data.items')) {
    return pass('receipt.evidenceRequirements', 'Receipt exposes required evidence fields.', {
      action: requirement.action,
      requiredOutputFields: requirement.requiredOutputFields,
      knowledgeEvidenceStatus: result.knowledgeEvidenceStatus,
      knowledgeEvidenceTrace: result.knowledgeEvidenceTrace,
    });
  }
  return fail('receipt.evidenceRequirements', 'Evidence requirements missing from evaluation.', result);
}

function checkSafeMissingInput() {
  const { normalized } = validateDemoReceipt(demoReceipt());
  const result = evaluate(normalized, {
    city: 'Wiesloch',
    domain: 'grid-operations',
    workflowType: 'vnb_identification',
  });
  const second = result.plannedToolCalls[1];
  if (second?.status === 'scope-blocked') {
    return pass('receipt.safeMissingInput', 'Operator-scoped step blocks until required evidence exists.', {
      action: second.selectedAction,
      status: second.status,
      scopeViolations: second.scopeViolations,
      executable: result.executable,
    });
  }
  return fail('receipt.safeMissingInput', 'Missing operator scope did not block the downstream step.', {
    plannedToolCalls: result.plannedToolCalls,
  });
}

function checkMissingActionBlocked() {
  const { validation, normalized } = validateDemoReceipt(missingActionReceipt());
  if (!validation.valid) {
    return fail('receipt.missingActionBlocked', 'Missing-action fixture should remain schema-valid.', {
      errors: validation.errors,
    });
  }
  const result = evaluate(normalized, { city: 'Wiesloch', domain: 'grid-operations' });
  const first = result.plannedToolCalls[0];
  if (first?.status === 'missing-action' && first.errors?.[0]?.code === 'RECEIPT_ACTION_NOT_FOUND') {
    return pass('receipt.missingActionBlocked', 'Unknown live action is reported as a safe failure.', {
      action: first.action,
      status: first.status,
      errors: first.errors,
      executable: result.executable,
    });
  }
  return fail('receipt.missingActionBlocked', 'Missing action was not reported as safe failure.', result);
}

function runAgentOpsReceiptSmoke() {
  const checks = [
    checkManifestReadOnly(),
    checkUnknownToolBlocked(),
    checkForbiddenTargetBlocked(),
    checkReceiptSchemaRegistry(),
    checkReceiptEvidenceRequirements(),
    checkSafeMissingInput(),
    checkMissingActionBlocked(),
  ];
  const failed = checks.filter((check) => check.status !== 'pass').length;
  const passed = checks.length - failed;
  return {
    project: PROJECT,
    track: 'OpenAI Build Week Developer Tools',
    generatedAt: new Date().toISOString(),
    verdict: failed === 0 ? 'pass' : 'fail',
    summary: { passed, failed, total: checks.length },
    checks,
  };
}

function formatDetails(details) {
  const text = JSON.stringify(details, null, 2);
  return text.length > 1600 ? `${text.slice(0, 1600)}\n… truncated …` : text;
}

function formatMarkdownReport(report) {
  const lines = [
    `# ${report.project}`,
    '',
    `**Track:** ${report.track}`,
    `**Generated:** ${report.generatedAt}`,
    `**Verdict: ${report.verdict.toUpperCase()}**`,
    '',
    '## Why this matters for OpenAI Build Week Developer Tools',
    '',
    'AgentOps Receipt packages existing Cernion Sidecar and Agent Receipt primitives into a one-command QA harness for governed tool-using agents. It demonstrates deterministic checks for right tool, right schema, read-only policy boundaries, evidence requirements and safe failures before an agent receives production tools.',
    '',
    '## Summary',
    '',
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Total: ${report.summary.total}`,
    '',
    '## Checks',
    '',
  ];

  for (const check of report.checks) {
    lines.push(`### ${check.status === 'pass' ? 'PASS' : 'FAIL'} ${check.id}`);
    lines.push('');
    lines.push(check.message);
    lines.push('');
    lines.push('```json');
    lines.push(formatDetails(check.details || {}));
    lines.push('```');
    lines.push('');
  }

  lines.push('## Judge-safe defaults');
  lines.push('');
  lines.push('- Uses synthetic fixtures; no live customer data.');
  lines.push('- Does not require production tokens for the offline smoke path.');
  lines.push('- Sidecar tools remain read-only with `sideEffects: "none"`.');
  lines.push('- Consequential/HITL/write-style actions are represented only as blocked fixtures.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeReports(report, outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'agentops-receipt-smoke.json');
  const markdownPath = path.join(outputDir, 'agentops-receipt-smoke.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, formatMarkdownReport(report));
  return { jsonPath, markdownPath };
}

function parseArgs(argv) {
  const args = { write: true, outputDir: DEFAULT_OUTPUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-write') args.write = false;
    if (arg === '--output-dir') {
      args.outputDir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = runAgentOpsReceiptSmoke();
  for (const check of report.checks) {
    process.stdout.write(`${check.status.toUpperCase()} ${check.id} — ${check.message}\n`);
  }
  process.stdout.write(`\nVerdict: ${report.verdict.toUpperCase()} (${report.summary.passed}/${report.summary.total} passed)\n`);
  if (args.write) {
    const paths = writeReports(report, args.outputDir);
    process.stdout.write(`Report written:\n- ${paths.markdownPath}\n- ${paths.jsonPath}\n`);
  }
  return report.verdict === 'pass' ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  demoActionRegistry,
  demoReceipt,
  formatMarkdownReport,
  runAgentOpsReceiptSmoke,
  writeReports,
};
