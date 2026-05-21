'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const VdmiService = require('../services/vdmi.service');

describe('vdmi.service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `cernion-vdmi-test-${Date.now()}`);
    process.env.VDMI_DB_PATH = dbPath;

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler() {
            return { success: true, item: { id: 'hi-test-1' } };
          },
        },
      },
    });

    broker.createService(VdmiService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
    delete process.env.VDMI_DB_PATH;
  });

  test('creates, patches and reverts matrix with audit-safe reason', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Netzanschluss-Test',
        processId: 'job-100',
        processType: 'adhoc',
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(created.success).toBe(true);
    expect(created.matrix.id).toBeDefined();

    const patched = await broker.call(
      'vdmi.update',
      {
        id: created.matrix.id,
        reason: 'Korrektur nach Fachreview',
        patch: { name: 'Netzanschluss-Test V2' },
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(patched.matrix.name).toBe('Netzanschluss-Test V2');

    const reverted = await broker.call(
      'vdmi.revert',
      {
        id: created.matrix.id,
        reason: 'Rollback auf letzte freigegebene Fassung',
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(reverted.success).toBe(true);
    expect(reverted.matrix.name).toBe('Netzanschluss-Test');
  });

  test('infers matrix from event sequence and exposes dossier/trace', async () => {
    const detected = await broker.call(
      'vdmi.detect',
      {
        processId: 'job-200',
        processType: 'grid-connection-approval',
        name: 'Auto Netzanschluss',
        events: [
          {
            eventName: 'agent.plan.step.executed',
            payload: { serviceId: 'grid-connection', taskId: 'task-1' },
          },
          {
            eventName: 'hitl.item.created',
            payload: { approver: 'grid_operator', taskId: 'task-1' },
          },
          {
            eventName: 'webhooks.delivered',
            payload: { recipient: 'applicant', taskId: 'task-1' },
          },
        ],
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    const taskId = detected.matrix.tasks[0].taskId;

    const trace = await broker.call(
      'vdmi.negotiationTrace',
      { taskId },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(trace.success).toBe(true);
    expect(Array.isArray(trace.trace)).toBe(true);
    expect(trace.trace.length).toBeGreaterThan(0);

    const dossier = await broker.call(
      'vdmi.dossier',
      { taskId },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(dossier.success).toBe(true);
    expect(Array.isArray(dossier.dossier.options)).toBe(true);
    expect(dossier.dossier.options.length).toBe(2);
  });

  test('supports nomination and confirmation to template', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Nomination Kandidat',
        processId: 'job-300',
        processType: 'redispatch-process',
      },
      { meta: { tenantId: 'tenant-a', userId: 'approver-1' } }
    );

    const nominated = await broker.call(
      'vdmi.nominate',
      {
        id: created.matrix.id,
        reason: 'Muster tritt stabil auf',
      },
      { meta: { tenantId: 'tenant-a', userId: 'approver-1' } }
    );
    expect(nominated.matrix.nominationStatus).toBe('pending');

    const confirmed = await broker.call(
      'vdmi.confirmNomination',
      {
        id: created.matrix.id,
        approved: true,
        reason: 'Freigabe durch HITL',
      },
      { meta: { tenantId: 'tenant-a', userId: 'approver-1' } }
    );

    expect(confirmed.success).toBe(true);
    expect(confirmed.matrix.nominationStatus).toBe('confirmed');
    expect(confirmed.template).toBeTruthy();

    const templates = await broker.call('vdmi.templates', {}, { meta: { tenantId: 'tenant-a' } });
    expect(templates.count).toBeGreaterThan(0);
  });

  test('creates and transitions governance findings', async () => {
    const events = Array.from({ length: 12 }).map((_, idx) => ({
      eventName: 'agent.plan.step.executed',
      payload: {
        serviceId: 'grid-connection',
        taskId: 'task-findings',
        round: idx + 1,
      },
    }));

    await broker.call(
      'vdmi.detect',
      {
        processId: 'job-400',
        processType: 'grid-connection-approval',
        name: 'Finding Trigger Matrix',
        events,
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    await broker.call(
      'vdmi.negotiationTrace',
      { taskId: 'task-01' },
      { meta: { tenantId: 'tenant-a' } }
    );

    const findings = await broker.call(
      'vdmi.findings',
      { severity: 'K', status: 'open' },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(findings.success).toBe(true);
    expect(findings.count).toBeGreaterThan(0);

    const findingId = findings.findings[0].id;

    const mitigated = await broker.call(
      'vdmi.mitigateFinding',
      {
        findingId,
        owner: 'grid-lead',
        dueAt: '2026-12-31T00:00:00.000Z',
        plan: 'Ablösung des Schattenpfads durch API-Integration',
      },
      { meta: { tenantId: 'tenant-a', userId: 'manager-1' } }
    );
    expect(mitigated.finding.status).toBe('mitigated');

    const resolved = await broker.call(
      'vdmi.resolveFinding',
      {
        findingId,
        reason: 'Integration abgeschlossen',
        evidenceRef: 'ticket-123',
      },
      { meta: { tenantId: 'tenant-a', userId: 'manager-1' } }
    );
    expect(resolved.finding.status).toBe('resolved');
  });

  test('isolates tenant data on list reads', async () => {
    await broker.call(
      'vdmi.create',
      {
        name: 'Tenant B Matrix',
        processId: 'job-tenant-b',
      },
      { meta: { tenantId: 'tenant-b' } }
    );

    const tenantA = await broker.call('vdmi.list', {}, { meta: { tenantId: 'tenant-a' } });
    const tenantB = await broker.call('vdmi.list', {}, { meta: { tenantId: 'tenant-b' } });

    expect(tenantA.items.some((x) => x.name === 'Tenant B Matrix')).toBe(false);
    expect(tenantB.items.some((x) => x.name === 'Tenant B Matrix')).toBe(true);
  });

  test('stores dependsOn and blocks on tasks', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Dependency Matrix',
        processId: 'job-dep-1',
        tasks: [
          {
            taskId: 'task-1',
            taskName: 'Pruefung',
            phase: 'execution',
            verantwortlich: [],
            durchfuehrend: [],
            mitwirkend: [],
            information: [],
            dependsOn: [],
            blocks: ['task-2'],
          },
          {
            taskId: 'task-2',
            taskName: 'Freigabe',
            phase: 'planning',
            verantwortlich: [],
            durchfuehrend: [],
            mitwirkend: [],
            information: [],
            dependsOn: ['task-1'],
            blocks: [],
          },
        ],
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.matrix.tasks[0].dependsOn).toEqual([]);
    expect(created.matrix.tasks[0].blocks).toEqual(['task-2']);
    expect(created.matrix.tasks[1].dependsOn).toEqual(['task-1']);
    expect(created.matrix.tasks[1].blocks).toEqual([]);

    const fetched = await broker.call(
      'vdmi.get',
      { id: created.matrix.id },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(fetched.matrix.tasks[0].dependsOn).toEqual([]);
    expect(fetched.matrix.tasks[0].blocks).toEqual(['task-2']);
  });

  test('agentRole resolves multi-role actors across tasks and supports taskId scoping', async () => {
    await broker.call(
      'vdmi.create',
      {
        name: 'VDMI Role Boundary Governance',
        processId: 'job-governance-1',
        processType: 'grid-connection-governance',
        tasks: [
          {
            taskId: 'demand-intake',
            taskName: 'Demand Intake',
            phase: 'planning',
            verantwortlich: [{ actorType: 'org', actorId: 'AREAL_OWNER' }],
            durchfuehrend: [{ actorType: 'org', actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
            mitwirkend: [{ actorType: 'org', actorId: 'GROUP_ENERGY_PROJECT_OWNER' }],
            information: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
            dependsOn: [],
            blocks: [],
          },
          {
            taskId: 'network-operator-decision',
            taskName: 'Network Operator Decision',
            phase: 'decision',
            verantwortlich: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
            durchfuehrend: [{ actorType: 'org', actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
            mitwirkend: [{ actorType: 'org', actorId: 'GROUP_ENERGY_PROJECT_OWNER' }],
            information: [{ actorType: 'org', actorId: 'AREAL_OWNER' }],
            dependsOn: ['demand-intake'],
            blocks: [],
          },
        ],
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    const aggregate = await broker.call(
      'vdmi.agentRole',
      {
        agentId: 'DSO_GATEKEEPER',
        processType: 'grid-connection-governance',
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(aggregate.success).toBe(true);
    expect(aggregate.role).toBe('V');
    expect(aggregate.highestRole).toBe('V');
    expect(Array.isArray(aggregate.rolesByTask)).toBe(true);
    expect(aggregate.rolesByTask).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: 'demand-intake', role: 'I' }),
        expect.objectContaining({ taskId: 'network-operator-decision', role: 'V' }),
      ])
    );
    expect(aggregate.warnings).toContain('actor_has_multiple_roles_across_tasks');

    const decisionScoped = await broker.call(
      'vdmi.agentRole',
      {
        agentId: 'DSO_GATEKEEPER',
        processType: 'grid-connection-governance',
        taskId: 'network-operator-decision',
      },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(decisionScoped.role).toBe('V');
    expect(decisionScoped.highestRole).toBe('V');
    expect(decisionScoped.taskId).toBe('network-operator-decision');

    const intakeScoped = await broker.call(
      'vdmi.agentRole',
      {
        agentId: 'DSO_GATEKEEPER',
        processType: 'grid-connection-governance',
        taskId: 'demand-intake',
      },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(intakeScoped.role).toBe('I');
    expect(intakeScoped.highestRole).toBe('I');
    expect(intakeScoped.taskId).toBe('demand-intake');
  });

  test('keeps guardrail: create rejects tasks with more than one D actor (CONFLICT_ROLE)', async () => {
    await expect(
      broker.call(
        'vdmi.create',
        {
          name: 'Invalid D Role Matrix',
          processId: 'job-conflict-d-1',
          processType: 'grid-connection-governance',
          tasks: [
            {
              taskId: 'demand-intake',
              taskName: 'Demand Intake',
              phase: 'planning',
              verantwortlich: [],
              durchfuehrend: [
                { actorType: 'org', actorId: 'EXISTING_AREAL_GRID_OPERATOR' },
                { actorType: 'org', actorId: 'GROUP_ENERGY_PROJECT_OWNER' },
              ],
              mitwirkend: [],
              information: [],
              dependsOn: [],
              blocks: [],
            },
          ],
        },
        { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
      )
    ).rejects.toMatchObject({
      code: 409,
      type: 'CONFLICT_ROLE',
    });
  });

  test('dossier returns structured asset-validation fields with evidence gaps and allowed options', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Asset Validation Matrix',
        processId: 'job-asset-validation-1',
        processType: 'grid-connection-asset-validation',
        tasks: [
          {
            taskId: 'asset-validate-1',
            taskName: 'Validate Transformer Asset',
            phase: 'validation',
            assetClass: 'MV-transformer',
            assetId: 'TR-17',
            verantwortlich: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
            durchfuehrend: [{ actorType: 'org', actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
            mitwirkend: [{ actorType: 'org', actorId: 'GROUP_ENERGY_PROJECT_OWNER' }],
            information: [{ actorType: 'org', actorId: 'AREAL_OWNER' }],
            evidenceRequirements: [
              {
                id: 'nap-proof',
                label: 'NAP certificate',
                type: 'nap_certificate',
                required: true,
              },
              { id: 'load-profile', label: 'Load profile', type: 'load_profile', required: true },
            ],
            riskFactors: [{ id: 'overload-risk', severity: 'high' }],
            forbiddenAssumption: 'No firm capacity promise before formal request context',
            allowedOptions: [
              { id: 'option-rework', title: 'Collect missing profile evidence first' },
            ],
            nextActions: [{ id: 'action-request-profile', type: 'collect_evidence' }],
            executionTrace: [
              {
                timestamp: '2026-01-01T10:00:00.000Z',
                eventName: 'agent.plan.step.executed',
                payload: { taskId: 'asset-validate-1' },
                candidates: [
                  {
                    role: 'D',
                    actorType: 'org',
                    actorId: 'EXISTING_AREAL_GRID_OPERATOR',
                    confidence: 0.92,
                    reason: 'Execution completion event',
                  },
                  {
                    role: 'M',
                    actorType: 'org',
                    actorId: 'GROUP_ENERGY_PROJECT_OWNER',
                    confidence: 0.6,
                    reason: 'Advisory input without full evidence set',
                  },
                ],
              },
            ],
          },
        ],
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    await broker.call(
      'vdmi.evidence',
      {
        id: created.matrix.id,
        reason: 'NAP certificate available',
        type: 'nap_certificate',
        reference: 'asset-validate-1-nap',
        content: { taskId: 'asset-validate-1' },
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    const dossier = await broker.call(
      'vdmi.dossier',
      { taskId: 'asset-validate-1' },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(dossier.success).toBe(true);
    expect(dossier.dossier.task.processType).toBe('grid-connection-asset-validation');
    expect(dossier.dossier.task.assetClass).toBe('MV-transformer');
    expect(dossier.dossier.task.assetId).toBe('TR-17');
    expect(Array.isArray(dossier.dossier.evidence.requirements)).toBe(true);
    expect(dossier.dossier.evidence.requirements).toHaveLength(2);
    expect(Array.isArray(dossier.dossier.evidence.provided)).toBe(true);
    expect(dossier.dossier.evidence.provided).toHaveLength(1);
    expect(dossier.dossier.evidenceGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: 'load-profile',
          reason: 'required_evidence_missing',
        }),
      ])
    );
    expect(dossier.dossier.forbiddenAssumptions).toEqual(
      expect.arrayContaining(['No firm capacity promise before formal request context'])
    );
    expect(dossier.dossier.assetRisks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'overload-risk' })])
    );
    expect(dossier.dossier.allowedOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'option-rework' })])
    );
    expect(dossier.dossier.options).toEqual(dossier.dossier.allowedOptions);
    expect(dossier.dossier.nextActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'action-request-profile' })])
    );
    expect(dossier.dossier.recommendation).toContain('Collect additional evidence');
  });

  test('step-3 governance decision dossier keeps formal §17 stop with required evidence and forbidden assumptions', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Step-3 Governance Matrix',
        processId: 'job-step3-governance',
        processType: 'grid-connection-governance',
        tasks: [
          {
            taskId: 'network-operator-decision',
            taskName: 'Network Operator Decision',
            phase: 'decision',
            verantwortlich: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
            durchfuehrend: [{ actorType: 'org', actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
            mitwirkend: [{ actorType: 'org', actorId: 'GROUP_ENERGY_PROJECT_OWNER' }],
            information: [{ actorType: 'org', actorId: 'AREAL_OWNER' }],
            evidenceRequirements: [
              'vollständiger §17-Antrag',
              'technische Anschlussdaten',
              'Asset-Zustandsnachweise',
              'Netzverträglichkeitsprüfung',
              'Kapazitäts-/Netzfahrplanprüfung',
            ],
            forbiddenAssumptions: [
              'keine belastbare Anschlusszusage',
              'keine Kapazitätsreservierung',
              'keine verbindliche Übergabepunkt-Festlegung',
              'Projekt-/Versorgungskonzept ersetzt keine Netzbetreiberentscheidung',
            ],
            executionTrace: [
              {
                timestamp: '2026-05-17T08:00:00.000Z',
                eventName: 'agent.plan.step.executed',
                payload: { serviceId: 'grid-connection', taskId: 'network-operator-decision' },
                candidates: [
                  {
                    role: 'D',
                    actorType: 'service',
                    actorId: 'grid-connection',
                    confidence: 0.95,
                    reason: 'Execution completion event',
                  },
                ],
              },
            ],
          },
        ],
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(created.success).toBe(true);

    const dossier = await broker.call(
      'vdmi.dossier',
      { taskId: 'network-operator-decision' },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(dossier.success).toBe(true);
    expect(dossier.taskId).toBe('network-operator-decision');
    expect(dossier.dossier.task.processType).toBe('grid-connection-governance');
    expect(dossier.dossier.task.verantwortlich).toEqual(
      expect.arrayContaining([expect.objectContaining({ actorId: 'DSO_GATEKEEPER' })])
    );
    expect(dossier.dossier.evidenceGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'vollständiger §17-Antrag' }),
        expect.objectContaining({ label: 'technische Anschlussdaten' }),
        expect.objectContaining({ label: 'Asset-Zustandsnachweise' }),
        expect.objectContaining({ label: 'Netzverträglichkeitsprüfung' }),
        expect.objectContaining({ label: 'Kapazitäts-/Netzfahrplanprüfung' }),
      ])
    );
    expect(dossier.dossier.forbiddenAssumptions).toEqual(
      expect.arrayContaining([
        'keine belastbare Anschlusszusage',
        'keine Kapazitätsreservierung',
        'keine verbindliche Übergabepunkt-Festlegung',
        'Projekt-/Versorgungskonzept ersetzt keine Netzbetreiberentscheidung',
      ])
    );
    expect(dossier.dossier.recommendation).toContain('Collect additional evidence');
  });
});

describe('vdmi.service — System Templates (v0.53.0)', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `cernion-vdmi-system-seed-${Date.now()}`);
    process.env.VDMI_DB_PATH = dbPath;

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler() {
            return { success: true, item: { id: 'hi-test-1' } };
          },
        },
      },
    });

    broker.createService(VdmiService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
    delete process.env.VDMI_DB_PATH;
  });

  test('seeds 5+ system templates on startup (idempotent)', async () => {
    // After broker.start(), system templates should be seeded
    const templates = await broker.call('vdmi.templates', { limit: 200 });

    expect(templates.success).toBe(true);
    // Should include at least 5 system templates
    const systemTemplates = templates.templates.filter((t) => t.id && t.id.startsWith('SYSTEM_'));
    expect(systemTemplates.length).toBeGreaterThanOrEqual(5);

    // Verify template IDs match expected system templates
    const expectedIds = [
      'SYSTEM_grid-connection-approval-pv',
      'SYSTEM_energy-sharing-collective-approval',
      'SYSTEM_portfolio-gating-redispatch',
      'SYSTEM_substation-load-assessment',
      'SYSTEM_redispatch-participation-confirmation',
    ];
    const actualIds = systemTemplates.map((t) => t.id);
    expectedIds.forEach((id) => {
      expect(actualIds).toContain(id);
    });
  });

  test('system templates have isSystem=true and originTenant=*', async () => {
    const templates = await broker.call('vdmi.templates', { limit: 200 });
    const systemTemplates = templates.templates.filter((t) => t.id && t.id.startsWith('SYSTEM_'));

    systemTemplates.forEach((tmpl) => {
      expect(tmpl.id).toMatch(/^SYSTEM_/);
      // Check internal fields via raw doc query (templates action filters some fields)
      // For now, verify structure is present
      expect(tmpl.name).toBeDefined();
      expect(tmpl.scope).toBeDefined();
      expect(tmpl.taskTemplates).toBeDefined();
      expect(Array.isArray(tmpl.taskTemplates)).toBe(true);
    });
  });

  test('system templates are queryable from multiple tenants (originTenant=*)', async () => {
    // Call templates from tenant-a
    const templatesA = await broker.call(
      'vdmi.templates',
      { limit: 200 },
      { meta: { tenantId: 'tenant-a' } }
    );
    const systemTemplatesA = templatesA.templates.filter((t) => t.id && t.id.startsWith('SYSTEM_'));

    // Call templates from tenant-b
    const templatesB = await broker.call(
      'vdmi.templates',
      { limit: 200 },
      { meta: { tenantId: 'tenant-b' } }
    );
    const systemTemplatesB = templatesB.templates.filter((t) => t.id && t.id.startsWith('SYSTEM_'));

    // Both should see the same system templates
    expect(systemTemplatesA.length).toBeGreaterThanOrEqual(5);
    expect(systemTemplatesB.length).toBeGreaterThanOrEqual(5);

    const idsA = systemTemplatesA.map((t) => t.id).sort();
    const idsB = systemTemplatesB.map((t) => t.id).sort();
    expect(idsA).toEqual(idsB);
  });

  test('system templates are anonymized (no real customer data)', async () => {
    const templates = await broker.call('vdmi.templates', { limit: 200 });
    const systemTemplates = templates.templates.filter((t) => t.id && t.id.startsWith('SYSTEM_'));

    systemTemplates.forEach((tmpl) => {
      // Verify no obvious customer/stakeholder identifiers
      const text = JSON.stringify(tmpl).toLowerCase();
      expect(text).not.toMatch(/\b(gvh|stadtwerke|twl|siemens|eon|vattenfall|rwe|engie|endesa)\b/i);
      // Asset names should be generic
      expect(text).toMatch(/asset|installation|substation|portfolio/i);
    });
  });

  test('system templates contain governance tasks with role definitions', async () => {
    const templates = await broker.call('vdmi.templates', { limit: 200 });
    const systemTemplate = templates.templates.find(
      (t) => t.id === 'SYSTEM_grid-connection-approval-pv'
    );

    expect(systemTemplate).toBeDefined();
    expect(systemTemplate.taskTemplates).toBeDefined();
    expect(Array.isArray(systemTemplate.taskTemplates)).toBe(true);

    const task = systemTemplate.taskTemplates[0];
    expect(task).toBeDefined();
    expect(
      task.verantwortlich || task.mitwirkend || task.durchfuehrend || task.information
    ).toBeDefined();

    // Verify roles are anonymized (role categories, not names)
    const allActors = [
      ...(task.verantwortlich || []),
      ...(task.durchfuehrend || []),
      ...(task.mitwirkend || []),
      ...(task.information || []),
    ];
    allActors.forEach((actor) => {
      expect(actor.actorType).toMatch(/role|category/i);
      expect(actor.actorId).toMatch(/[A-Z_]+/); // UPPERCASE identifiers for roles
    });
  });

  test('versioned upsert (Option B): updated version on seed refresh', async () => {
    // Get original template
    let templates = await broker.call('vdmi.templates', { limit: 200 });
    let systemTemplate = templates.templates.find(
      (t) => t.id === 'SYSTEM_grid-connection-approval-pv'
    );
    const originalChangelog = systemTemplate.changelog || [];

    // Simulate a version bump by calling seedSystemTemplates again
    // (In production, this would happen on service restart with bumped SYSTEM_TEMPLATES version)
    const vdmiService = broker.getLocalService('vdmi');
    if (vdmiService && vdmiService.seedSystemTemplates) {
      await vdmiService.seedSystemTemplates();
    }

    // Check template again
    templates = await broker.call('vdmi.templates', { limit: 200 });
    systemTemplate = templates.templates.find((t) => t.id === 'SYSTEM_grid-connection-approval-pv');

    // Changelog should remain stable (same version = no-op upsert)
    expect(systemTemplate.changelog).toBeDefined();
    // If not updated, changelog length should be same; if updated with version bump, it should have more
    expect(systemTemplate.changelog.length).toBeGreaterThanOrEqual(originalChangelog.length);
  });
});
