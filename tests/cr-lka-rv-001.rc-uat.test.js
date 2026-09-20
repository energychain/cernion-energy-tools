'use strict';

// CR-LKA-RV-001 RC UAT harness: in-process Moleculer only, isolated test DBs only.
// NEST is intentionally kept as macro-trace documentation and is not executable UAT here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const { ServiceBroker } = require('moleculer');

const mockGenerateStructured = jest.fn();
jest.mock('../src/llm-client', () => ({
  generateStructured: mockGenerateStructured,
  SchemaType: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
  },
}));

const DecisionFrameService = require('../services/decision-frame.service');
const AgentReceiptsService = require('../services/agent-receipts.service');
const GovernanceService = require('../services/governance.service');
const crLkaSchema = require('../src/stadtwerk-governance-architecture/schema-pack/cr-lka-rv-001.schema.json');
const {
  buildMakoResolutionValueProjection,
  buildAssetToDecisionProjection,
} = require('../src/stadtwerk-governance-architecture/resolution-value-projection');
const {
  buildMakoResolutionControlCase,
  buildAssetToDecisionControlCase,
} = require('../src/stadtwerk-governance-architecture/governance-policy-adapter');
const makoUat = require('../src/stadtwerk-governance-architecture/fixtures/uat/mako-resolution-value.uat.json');
const assetUat = require('../src/stadtwerk-governance-architecture/fixtures/uat/asset-to-decision.uat.json');
const makoRed = require('../src/stadtwerk-governance-architecture/fixtures/red/mako-resolution-value.red.json');
const assetRed = require('../src/stadtwerk-governance-architecture/fixtures/red/asset-to-decision.red.json');

const TEST_TENANT_ID = 'cr-lka-rv-001-rc-v1-test';
const EXPECTED_EXECUTABLE_SCENARIOS = [
  'UAT-MAKO-001',
  'UAT-MAKO-002',
  'UAT-MAKO-003',
  'UAT-MAKO-004',
  'UAT-MAKO-005',
  'UAT-ASSET-001',
  'UAT-ASSET-002',
  'UAT-ASSET-003',
  'UAT-ASSET-004',
];

const ajv = new Ajv2020({ strict: false });
const validateProjection = ajv.compile(crLkaSchema);

function expectValidProjection(projection) {
  const valid = validateProjection(projection);
  if (!valid) {
    throw new Error(
      `CR-LKA projection schema errors: ${JSON.stringify(validateProjection.errors, null, 2)}`
    );
  }
  expect(valid).toBe(true);
}

function scenarioIds(fixture) {
  return fixture.scenarios.map((scenario) => scenario.id);
}

function allExecutableScenarioIds() {
  return [...scenarioIds(makoUat), ...scenarioIds(assetUat)];
}

function makeMakoProjection(extra = {}) {
  return buildMakoResolutionValueProjection({
    ...makoRed.input,
    handoverSources: makoUat.handoverSources,
    ...extra,
  });
}

function makeAssetProjection(extra = {}) {
  return buildAssetToDecisionProjection({
    ...assetRed.input,
    handoverSources: assetUat.handoverSources,
    ...extra,
  });
}

function governanceMetadataFromProjection(projection) {
  return {
    governanceArchitecture: {
      changeRequest: 'CR-LKA-RV-001',
      candidateId: projection.candidateId,
      runCardId: projection.runCardId,
      workedExample: projection.workedExample,
      drl: projection.readiness.drl,
      rcr: projection.readiness.rcr,
      readiness: projection.readiness,
      resolutionValue: projection.resolutionValue,
      allowedActions: projection.allowedActions,
      forbiddenActions: projection.forbiddenActions,
    },
  };
}

function makeDecisionFrameInput({
  projection,
  situation,
  complication,
  question,
  domain = 'operational',
  role = 'regulatory',
}) {
  return {
    situation,
    complication,
    question,
    domain,
    role,
    createdBy: TEST_TENANT_ID,
    metadata: governanceMetadataFromProjection(projection),
  };
}

function makeCrLkaMatrices(makoProjection, assetProjection) {
  return [
    {
      id: 'matrix-cr-lka-rv-001-mako',
      name: 'CR-LKA-RV-001 MaKo Resolution Value RC UAT',
      status: 'active',
      tasks: [
        {
          taskId: 'uat-mako-role-boundary',
          taskName: 'MaKo/M2C clarification to qualitative resolution value',
          controlCase: 'custom:mako_resolution_value',
          verantwortlich: [{ actorType: 'role', actorId: 'ROLE_MAKO_OWNER' }],
          durchfuehrend: [{ actorType: 'role', actorId: 'ROLE_BILLING' }],
          mitwirkend: [{ actorType: 'role', actorId: 'ROLE_FINANCE' }],
          information: [{ actorType: 'role', actorId: 'ROLE_COMPLIANCE' }],
          evidenceRequirements: makoProjection.resolutionValue[0].requiredEvidence.map((id) => ({
            id,
            label: id,
            required: true,
          })),
          decisionPolicy: { onMissingEvidence: 'clarification' },
          metadata: governanceMetadataFromProjection(makoProjection),
        },
      ],
    },
    {
      id: 'matrix-cr-lka-rv-001-asset',
      name: 'CR-LKA-RV-001 Asset to Decision RC UAT',
      status: 'active',
      tasks: [
        {
          taskId: 'uat-asset-role-boundary',
          taskName: 'Asset signal to non-committee-ready decision dossier',
          controlCase: 'asset_transformation',
          verantwortlich: [{ actorType: 'role', actorId: 'ROLE_ASSET_OWNER' }],
          durchfuehrend: [
            { actorType: 'role', actorId: 'ROLE_NETZPLANUNG' },
            { actorType: 'role', actorId: 'ROLE_CONTROLLING' },
          ],
          mitwirkend: [{ actorType: 'role', actorId: 'ROLE_REGULATORY' }],
          information: [{ actorType: 'role', actorId: 'ROLE_MANAGEMENT' }],
          evidenceRequirements: assetProjection.resolutionValue[0].requiredEvidence.map((id) => ({
            id,
            label: id,
            required: true,
          })),
          decisionPolicy: { onMissingEvidence: 'clarification' },
          metadata: governanceMetadataFromProjection(assetProjection),
        },
      ],
    },
  ];
}

describe('CR-LKA-RV-001 RC UAT harness', () => {
  let broker;
  let dbRoot;
  let makoProjection;
  let assetProjection;

  beforeAll(async () => {
    dbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-lka-rv-001-rc-uat-'));
    makoProjection = makeMakoProjection();
    assetProjection = makeAssetProjection();

    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'willi-mako',
      actions: {
        resolveStructure: {
          handler() {
            return {
              success: true,
              data: {
                topic: 'CR-LKA-RV-001 MaKo structure context',
                sources: [],
                structuralHints: [],
                validationCandidates: [],
                noCallBoundaries: ['advisory structure context only; no EDIFACT send'],
                confidence: 'low',
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'vdmi',
      actions: {
        list: {
          handler(ctx) {
            expect(ctx.meta.tenantId).toBe(TEST_TENANT_ID);
            return { items: makeCrLkaMatrices(makoProjection, assetProjection) };
          },
        },
      },
    });

    broker.createService({
      ...AgentReceiptsService,
      settings: {
        ...AgentReceiptsService.settings,
        dbPath: path.join(dbRoot, 'agent-receipts'),
      },
    });
    broker.createService({
      ...DecisionFrameService,
      settings: {
        ...DecisionFrameService.settings,
        dbPath: path.join(dbRoot, 'decision-frames'),
      },
    });
    broker.createService({
      ...GovernanceService,
      settings: {
        ...GovernanceService.settings,
        decisionAuditDbPath: path.join(dbRoot, 'governance-decision-audit'),
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    if (broker) await broker.stop();
    if (dbRoot) fs.rmSync(dbRoot, { recursive: true, force: true });
  });

  test('loads exactly the nine executable MaKo and Asset UAT scenarios from fixtures', () => {
    expect(allExecutableScenarioIds()).toEqual(EXPECTED_EXECUTABLE_SCENARIOS);
    expect(makoUat.scenarios).toHaveLength(5);
    expect(assetUat.scenarios).toHaveLength(4);
  });

  test('NEST remains a macro-trace boundary and is not registered as executable UAT', () => {
    // Boundary assertion: NEST trace is a macro trace only; this harness intentionally executes MaKo/Asset cases only.
    expect(allExecutableScenarioIds()).toHaveLength(9);
    expect(allExecutableScenarioIds().some((id) => id.includes('NEST'))).toBe(false);
  });

  test('UAT-MAKO-001 APERAK blocks billing: qualitative value, HITL, Decision Frame, and draft receipt seed', async () => {
    expectValidProjection(makoProjection);
    expect(makoProjection.resolutionValue[0]).toMatchObject({
      dimension: 'cashflow_acceleration',
      evidenceStatus: 'partial',
      confidence: 'low',
    });
    expect(makoProjection.hitlBoundary.requiresHitl).toBe(true);
    expect(makoProjection.forbiddenActions).toEqual(
      expect.arrayContaining([
        'approve_invoice',
        'send_market_partner_reply',
        'change_master_data',
        'state_final_cashflow_amount',
      ])
    );

    const created = await broker.call(
      'decision-frame.create',
      makeDecisionFrameInput({
        projection: makoProjection,
        situation: 'APERAK blocks a disputed M2C billing case in the RC UAT tenant.',
        complication:
          'Confirmed amount, market partner confirmation, and owner approval are still missing.',
        question: 'Which evidence is required before billing or cashflow finalization?',
        domain: 'operational',
        role: 'regulatory',
      }),
      { meta: { tenantId: TEST_TENANT_ID } }
    );
    expect(created.status).toBe('draft');
    expect(created.metadata.governanceArchitecture.changeRequest).toBe('CR-LKA-RV-001');

    const updated = await broker.call('decision-frame.update', {
      frameId: created.frameId,
      answer: 'Draft only: request missing evidence and escalate consequential actions to HITL.',
      metadata: created.metadata,
    });
    expect(updated.answer).toContain('Draft only');

    const exportedJson = await broker.call('decision-frame.exportSummary', {
      frameId: created.frameId,
      format: 'json',
    });
    expect(exportedJson.frame.metadata.governanceArchitecture.workedExample).toBe(
      'mako_m2c_resolution_value'
    );

    const exportedMarkdown = await broker.call('decision-frame.exportSummary', {
      frameId: created.frameId,
      format: 'markdown',
    });
    expect(exportedMarkdown.content).toContain('CR-LKA-RV-001');
    expect(exportedMarkdown.content).toContain('send_market_partner_reply');

    const receipt = await broker.call('agent-receipts.get', { id: 'mako-resolution-value-v1' });
    expect(receipt.data).toMatchObject({ receiptId: 'mako-resolution-value-v1', status: 'draft' });
  });

  test('UAT-MAKO-002 MSCONS gap without amount cannot become a final cashflow claim', () => {
    const projection = makeMakoProjection({
      missingEvidence: ['mscons_gap', 'confirmed_invoice_amount'],
    });
    expectValidProjection(projection);
    expect(projection.resolutionValue[0].forbiddenClaims).toContain('final_cashflow_amount');
    expect(projection.forbiddenActions).toContain('state_final_cashflow_amount');
    expect(projection.resolutionValue[0].qualitativeImpact).toMatch(/qualitative only/i);
  });

  test('UAT-MAKO-003 repeated mapping error is represented as evidence gap, not finalization behavior', () => {
    const projection = makeMakoProjection({
      missingEvidence: [
        'repeated_mapping_error',
        'data_quality_root_cause',
        'process_learning_owner',
      ],
    });
    expectValidProjection(projection);
    expect(projection.evidenceState.missingEvidence).toEqual(
      expect.arrayContaining([
        'repeated_mapping_error',
        'data_quality_root_cause',
        'process_learning_owner',
      ])
    );
    expect(projection.hitlBoundary.pendingConfirmationActions).toEqual(
      expect.arrayContaining(['repeated_mapping_error', 'billing_or_cashflow_finalization'])
    );
    expect(projection.forbiddenActions).toContain('state_final_cashflow_amount');
  });

  test('UAT-MAKO-004 market-partner reply remains draft and pending confirmation', async () => {
    const projection = makeMakoProjection({ missingEvidence: ['market_partner_reply_owner'] });
    expect(projection.forbiddenActions).toContain('send_market_partner_reply');
    expect(projection.hitlBoundary.pendingConfirmationActions).toContain(
      'external_market_partner_reply'
    );

    const created = await broker.call(
      'decision-frame.create',
      makeDecisionFrameInput({
        projection,
        situation: 'A market-partner response draft exists for the disputed MaKo clearing case.',
        complication:
          'External sending remains consequential and requires explicit human confirmation.',
        question: 'Who must confirm before any external market-partner reply is sent?',
        domain: 'operational',
        role: 'regulatory',
      })
    );
    expect(created.status).toBe('draft');
  });

  test('UAT-MAKO-005 role workbench separates MaKo, Billing, Finance, and Compliance read-only views', async () => {
    const roles = ['ROLE_MAKO_OWNER', 'ROLE_BILLING', 'ROLE_FINANCE', 'ROLE_COMPLIANCE'];

    for (const role of roles) {
      const projection = await broker.call(
        'governance.roleWorkbenchProjection',
        { role },
        { meta: { tenantId: TEST_TENANT_ID } }
      );
      const item = projection.items.find(
        (candidate) => candidate.rowId === 'uat-mako-role-boundary'
      );
      expect(projection.sideEffects).toBe('none');
      expect(item).toBeDefined();
      expect(item.governanceArchitecture).toMatchObject({
        changeRequest: 'CR-LKA-RV-001',
        sideEffects: 'none',
        candidateId: 'CRC001',
      });
      expect(item.governanceArchitecture.roleBoundary.role).toBe(role);
      expect(item.governanceArchitecture.forbiddenActions).toContain('send_market_partner_reply');
      expect(item.governanceArchitecture.allowedActions).not.toContain('send_market_partner_reply');
    }
  });

  test('UAT-ASSET-001 asset signal becomes evidence receipt and not committee recommendation', async () => {
    expectValidProjection(assetProjection);
    expect(assetProjection.forbiddenActions).toContain('recommend_final_investment_decision');
    expect(assetProjection.resolutionValue[0].forbiddenClaims).toContain(
      'final_investment_decision_recommendation'
    );

    const receipt = await broker.call('agent-receipts.get', { id: 'asset-to-decision-v1' });
    expect(receipt.data).toMatchObject({ receiptId: 'asset-to-decision-v1', status: 'draft' });
    expect(receipt.data.metadata).toEqual(
      expect.objectContaining({ changeRequest: 'CR-LKA-RV-001', candidateId: 'CRC004' })
    );
  });

  test('UAT-ASSET-002 budget impact remains an assumption without controlling evidence', () => {
    const projection = makeAssetProjection({
      missingEvidence: ['budget_assumption', 'controlling_evidence'],
    });
    expectValidProjection(projection);
    expect(projection.forbiddenActions).toContain('state_budget_commitment');
    expect(projection.resolutionValue[0]).toMatchObject({
      dimension: 'forecast_budget_confidence',
      evidenceStatus: 'partial',
      confidence: 'low',
    });
    expect(projection.resolutionValue[0].forbiddenClaims).toContain('budget_commitment_state');
  });

  test('UAT-ASSET-003 role projection shows Asset, Netzplanung, Controlling, Regulatorik, and Geschäftsführung boundaries', async () => {
    const roles = [
      'ROLE_ASSET_OWNER',
      'ROLE_NETZPLANUNG',
      'ROLE_CONTROLLING',
      'ROLE_REGULATORY',
      'ROLE_MANAGEMENT',
    ];

    for (const role of roles) {
      const projection = await broker.call(
        'governance.roleWorkbenchProjection',
        { role },
        { meta: { tenantId: TEST_TENANT_ID } }
      );
      const item = projection.items.find(
        (candidate) => candidate.rowId === 'uat-asset-role-boundary'
      );
      expect(projection.sideEffects).toBe('none');
      expect(item).toBeDefined();
      expect(item.governanceArchitecture).toMatchObject({
        changeRequest: 'CR-LKA-RV-001',
        sideEffects: 'none',
        candidateId: 'CRC004',
      });
      expect(item.governanceArchitecture.roleBoundary.role).toBe(role);
      expect(item.governanceArchitecture.forbiddenActions).toEqual(
        expect.arrayContaining([
          'recommend_final_investment_decision',
          'state_budget_commitment',
          'mark_committee_ready',
        ])
      );
    }

    const financeProjection = await broker.call(
      'governance.roleWorkbenchProjection',
      { role: 'ROLE_FINANCE' },
      { meta: { tenantId: TEST_TENANT_ID } }
    );
    expect(
      financeProjection.items.find((candidate) => candidate.rowId === 'uat-asset-role-boundary')
    ).toBeUndefined();
  });

  test('UAT-ASSET-004 readiness remains below committee-ready and Decision Frame export preserves metadata', async () => {
    const projection = makeAssetProjection({
      missingEvidence: ['alternative_options', 'decision_owner'],
    });
    expectValidProjection(projection);
    expect(projection.readiness.committeeReady).toBe(false);
    expect(projection.forbiddenActions).toContain('mark_committee_ready');

    const created = await broker.call(
      'decision-frame.create',
      makeDecisionFrameInput({
        projection,
        situation: 'An asset condition signal is available for the RC UAT decision dossier.',
        complication:
          'Alternatives and decision ownership are missing, so readiness stays below committee-ready.',
        question: 'Which evidence is missing before committee readiness can be considered?',
        domain: 'financial',
        role: 'finance',
      }),
      { meta: { tenantId: TEST_TENANT_ID } }
    );

    const exported = await broker.call('decision-frame.exportSummary', {
      frameId: created.frameId,
      format: 'json',
    });
    expect(exported.frame.metadata.governanceArchitecture).toMatchObject({
      candidateId: 'CRC004',
      workedExample: 'asset_to_decision',
      readiness: { committeeReady: false },
    });
  });

  test('governance policy evaluates MaKo clarification and Asset human-decision boundaries in-process', async () => {
    const makoPolicy = await broker.call('governance.evaluatePolicy', {
      controlCase: buildMakoResolutionControlCase({
        missingEvidence: makoRed.input.missingEvidence,
      }),
      context: {},
    });
    expect(makoPolicy).toMatchObject({
      allowed: false,
      reason: 'clarification_required',
      requiresClarification: true,
      sideEffects: 'none',
    });

    const assetPolicy = await broker.call('governance.evaluatePolicy', {
      controlCase: buildAssetToDecisionControlCase({ missingEvidence: [] }),
      context: { highFinancialImpact: true, evidence: {} },
    });
    expect(assetPolicy).toMatchObject({
      allowed: false,
      reason: 'human_decision_required',
      requiresHumanDecision: true,
      sideEffects: 'none',
    });
  });

  test('draft receipt seeds are readable, status draft, and forced select rejects draft unless explicitly allowed', async () => {
    const mako = await broker.call('agent-receipts.get', { id: 'mako-resolution-value-v1' });
    const asset = await broker.call('agent-receipts.get', { id: 'asset-to-decision-v1' });
    expect(mako.data.status).toBe('draft');
    expect(asset.data.status).toBe('draft');

    await expect(
      broker.call('agent-receipts.select', {
        message: 'Use the CR-LKA MaKo resolution value draft receipt.',
        forceReceipt: 'mako-resolution-value-v1',
      })
    ).rejects.toMatchObject({ type: 'RECEIPT_DRAFT_NOT_ALLOWED' });
  });
});
