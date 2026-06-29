const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const FlexibilityConductorRoleModelService = require('../services/flexibility-conductor-role-model.service');

describe('flexibility-conductor-role-model service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...FlexibilityConductorRoleModelService,
      settings: {
        ...FlexibilityConductorRoleModelService.settings,
        dbPath: path.join(os.tmpdir(), `fcrm-test-db-${Date.now()}`),
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const meta = { tenantId: 'tenant-a' };

  function completeDecisionRights() {
    return {
      forecastIntake: { accountable: 'Netzbetrieb', responsible: 'Forecast Desk' },
      fnavBoundary: { accountable: 'Netzplanung', responsible: 'Anschlusswesen' },
      controlCommandPolicy: { accountable: 'Leitwarte', responsible: 'Flex Operations' },
      softwareMonitoring: { accountable: 'OT Betrieb', responsible: 'Plattformbetrieb' },
      commercialValuation: { accountable: 'Controlling', responsible: 'Assetmanagement' },
      escalationHandover: { accountable: 'Betriebsleitung', responsible: 'HITL Koordination' },
    };
  }

  function readyParams(overrides = {}) {
    return {
      processId: 'flex-role:process-001',
      flexAssetScope: {
        scopeId: 'scope-low-voltage-flex-001',
        voltageLevel: 'NS',
        assetTypes: ['steuerbare-waermepumpe', 'wallbox'],
      },
      decisionRights: completeDecisionRights(),
      operationalTasks: [
        'forecast-intake',
        'fnav-contract-boundary',
        'control-command-policy',
        'software-monitoring',
        'commercial-valuation',
        'escalation-handover',
      ],
      dataSources: [
        'flex',
        'grid-connection',
        'grid-operations',
        'forecast-engine',
        'finance-agent',
      ],
      controlCommandBoundary:
        'Dossier may describe allowed and forbidden actions but must not issue control commands',
      softwareMonitoringOwner: 'OT Plattformbetrieb',
      commercialValueOwner: 'Assetmanagement/Controlling',
      escalationPath: ['Flex Operations', 'Betriebsleitung', 'HITL Koordination'],
      interfaces: {
        lowVoltage: 'NS Flexibilitaetsbetrieb',
        assetManagement: 'Assetstrategie',
        regulatoryValuation: 'Regulierungsmanagement',
      },
      sourceActions: [
        'flex.listDevices',
        'grid-connection.fnavValidate',
        'finance-agent.analyze',
        'vdmi.create',
        'hitl.create',
        'presentation.generate',
      ],
      ...overrides,
    };
  }

  test('evaluate stores a ready role-model evidence record without control execution', async () => {
    const result = await broker.call('flexibility-conductor-role-model.evaluate', readyParams(), {
      meta,
    });

    expect(result.roleModelId).toMatch(/^fcrm:/);
    expect(result.evidenceStatus).toBe('ready');
    expect(result.validationFindings.some((f) => f.finding === 'FCRM_ROLE_MODEL_READY')).toBe(true);
    expect(result.sourceActions).toContain('flex.listDevices');
    expect(result.forbiddenAutomaticActions).toEqual(
      expect.arrayContaining(['control-command-delivery', 'dispatch-activation', 'hitl-approval'])
    );
  });

  test('evaluate blocks when role owners, control boundary and escalation path are missing', async () => {
    const result = await broker.call(
      'flexibility-conductor-role-model.evaluate',
      readyParams({
        processId: 'flex-role:blocked-001',
        flexAssetScope: {},
        decisionRights: {
          forecastIntake: { accountable: 'Netzbetrieb' },
        },
        controlCommandBoundary: '',
        softwareMonitoringOwner: '',
        commercialValueOwner: '',
        escalationPath: [],
        sourceActions: [],
      }),
      { meta }
    );

    expect(result.evidenceStatus).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.finding)).toEqual(
      expect.arrayContaining([
        'FCRM_DECISION_RIGHTS_MISSING',
        'FCRM_CONTROL_BOUNDARY_MISSING',
        'FCRM_ESCALATION_PATH_MISSING',
        'FCRM_ROLE_MODEL_BLOCKED',
      ])
    );
    expect(result.missingDataPoints).toEqual(
      expect.arrayContaining([
        'flex_asset_scope',
        'decision_rights_owner',
        'control_command_policy',
        'software_monitoring_owner',
        'commercial_value_owner',
        'escalation_path',
        'source_action_references',
      ])
    );
    expect(result.positiveFollowUps).toContainEqual({
      missingDataPoint: 'control_command_policy',
      enablesDossierAddition: 'adds explicit boundary for allowed and forbidden control actions',
    });
  });

  test('listModels, getModel and getStatus expose tenant-scoped dossier-safe evidence', async () => {
    const created = await broker.call(
      'flexibility-conductor-role-model.evaluate',
      readyParams({ processId: 'flex-role:status-001' }),
      { meta }
    );

    const list = await broker.call(
      'flexibility-conductor-role-model.listModels',
      { processId: 'flex-role:status-001' },
      { meta }
    );
    expect(list.models.some((model) => model._id === created.roleModelId)).toBe(true);

    const model = await broker.call(
      'flexibility-conductor-role-model.getModel',
      { roleModelId: created.roleModelId },
      { meta }
    );
    expect(model.processId).toBe('flex-role:status-001');

    const status = await broker.call(
      'flexibility-conductor-role-model.getStatus',
      { processId: 'flex-role:status-001' },
      { meta }
    );
    expect(status.found).toBe(true);
    expect(status.answerFacts.roleCoverage.controlCommandPolicy.accountable).toBe('Leitwarte');
    expect(status.sourceActions).toContain('vdmi.create');
    expect(status.forbiddenAutomaticActions).toContain('device-status-update');
  });

  test('getStatus returns dossier-safe not-found state', async () => {
    const status = await broker.call(
      'flexibility-conductor-role-model.getStatus',
      { processId: 'flex-role:missing' },
      { meta }
    );

    expect(status).toEqual({
      found: false,
      processId: 'flex-role:missing',
      message: 'No flexibility conductor role-model evidence is available for this tenant yet',
    });
  });

  test('getModel hides models from other tenants', async () => {
    const created = await broker.call(
      'flexibility-conductor-role-model.evaluate',
      readyParams({ processId: 'flex-role:tenant-secret' }),
      { meta }
    );

    await expect(
      broker.call(
        'flexibility-conductor-role-model.getModel',
        { roleModelId: created.roleModelId },
        { meta: { tenantId: 'tenant-b' } }
      )
    ).rejects.toMatchObject({ code: 404, type: 'ROLE_MODEL_NOT_FOUND' });
  });
});
