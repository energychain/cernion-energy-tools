'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));
const llm = require('../src/llm-client');
const { validate, complete } = require('./helpers/workbench-schema-stub');
const { instantiatePracticeScenario } = require('../scripts/generate-practice-evaluation-fixtures');
const { createLocalTransport } = require('../scripts/practice-evaluation-transport');
const { checkTurn } = require('../scripts/practice-evaluation-checks');
const { runProjectSkillJob } = require('../src/project-skill-learning');
const env = { ...process.env };
let transport,
  app,
  draftMode = 'good';
const errors = [];

function draft(input) {
  const read = input.successfulPath.reads[0];
  const metric = read.result.plan.operations.find((operation) => operation.op === 'aggregate')
    .metrics[0];
  const meta = {
    id: input.skillId,
    version: 1,
    language: 'cet-script/1',
    intent: 'Größten Wert im Zeitraum lesen',
    inputs: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', format: 'date' },
        to: { type: 'string', format: 'date' },
      },
    },
    outputs: { kind: 'table' },
  };
  const original = { from: '2025-01-01', to: '2026-01-01' };
  const tests = [
    { input: original, expect: { rows: 1, columns: [metric.as], contains: read.result.result } },
  ];
  const table = draftMode === 'foreign' ? 'ds_foreign' : read.record.id;
  const expression = draftMode === 'wrong' ? '0' : `MAX(\u0024{data.col('${metric.field}')})`;
  return {
    program: `export const meta=${JSON.stringify(meta)};export const tests=${JSON.stringify(tests)};export default async function skill(input,cet){ const data=cet.table('${table}');const rows=await cet.sql\u0060SELECT ${expression}${draftMode === 'recomputed' ? ' + 0' : ''} AS "${metric.as}" FROM \u0024{data} WHERE \u0024{data.col('Zeit')} >= \u0024{input.from} AND \u0024{data.col('Zeit')} < \u0024{input.to}\u0060;return cet.result.table(rows);}`,
    inputJson: JSON.stringify(original),
  };
}
function model(schema, raw) {
  const input = JSON.parse(raw);
  let value = {};
  if (input.task === 'project_skill_transfer_question')
    value = { question: 'Wie hoch war das Maximum des Bestands am Depot West 2025?' };
  else if (input.task === 'project_skill_draft') value = draft(input);
  else if (input.task === 'project_skill_input')
    value = { applicable: true, inputJson: JSON.stringify(input.originalInput) };
  else if (input.nodes) {
    const node = input.nodes.find((node) => node.kind === 'dataset') || input.nodes[0];
    const sources = [node.nodeId];
    value = {
      summary: { text: 'Archivierter Messbestand', sources },
      entities: [
        {
          name: input.title.endsWith('A') ? 'Standort Nord' : 'Depot West',
          kind: 'subject',
          sources,
        },
      ],
      timeRanges: input.datasets?.[0]?.period?.from
        ? [{ ...input.datasets[0].period, sources }]
        : [],
      questionTypes: [
        {
          id: 'maximum',
          description: 'Maximum Höchstwert der gemessenen Größe',
          inputs: [],
          skillRefs: [],
          sources,
        },
      ],
      externalLinks: [],
    };
  } else if (schema.properties?.timezone) {
    const field = Object.keys(schema.properties.units.properties).find(
      (name) => !['Zeit', 'Token'].includes(name)
    );
    value = {
      title: input.sourceName || 'Messreihe',
      description: 'Zeitlich dokumentierte Messung',
      anchors: [field.includes('Leistung') ? 'Standort Nord' : 'Depot West'],
      timezone: 'Europe/Berlin',
      timeField: 'Zeit',
      intervalConvention: 'begin',
      units: { [field]: field.includes('Leistung') ? 'kW' : 'kg' },
      assumptions: [],
    };
  } else if (input.sourceId && input.profile) {
    const field = Object.keys(input.semantic.units).find((name) => input.semantic.units[name]);
    value = {
      sources: [{ alias: 'source', sourceId: input.sourceId }],
      operations: [
        { op: 'aggregate', groupBy: [], metrics: [{ fn: 'max', field, as: 'maximum' }] },
        { op: 'limit', count: 10 },
      ],
    };
  } else if (input.untrustedEvidence)
    value = {
      answer: input.untrustedEvidence
        .map((entry) => `${entry.value.split('\n\nHerkunft:')[0]} (${entry.metadata.filename})`)
        .join('\n'),
    };
  else if (input.task === 'evidence_request_kind') value = { contentRequested: true };
  else if (input.task === 'evidence_reference_resolution') value = { sourceIds: [] };
  else if (schema.properties?.concern)
    value = {
      concern: 'Frage einordnen',
      situation: 'Eine andere Größe wird erfragt.',
      turnKind: 'work',
      conversationShape: 'knowledge',
      missingInformation: [],
      requestedAction: { description: '', externalEffect: false, draftRequested: false },
    };
  else if (input.task === 'turn_controls')
    value = {
      turnKind: 'work_on_concrete_case',
      conversationShape: 'knowledge',
      missingInformation: [],
    };
  else if (input.task === 'output_contract')
    value = {
      requestedOutput: {
        requested: 'ordinary_answer',
        basis: '',
        kind: 'other',
        parts: [],
        constraints: [],
        forbiddenTerms: [],
        subjects: [],
      },
    };
  else if (input.task === 'token_roles')
    value = {
      tokens: input.candidates.map(({ index }) => ({
        index,
        category: 'other',
        family: '',
        meaningRequested: false,
      })),
    };
  return validate(schema, complete(schema, value));
}
beforeAll(async () => {
  llm.generateStructured.mockImplementation((schema, raw) => {
    try {
      return model(schema, raw);
    } catch (error) {
      errors.push(error.stack);
      throw error;
    }
  });
  llm.generateText.mockImplementation(async (raw) => {
    const input = JSON.parse(raw);
    if (!input.schema) throw new Error('Unexpected text task');
    return JSON.stringify(
      validate(
        input.schema,
        complete(input.schema, {
          interpretation: [
            {
              text: 'Für die angefragte Temperatur fehlen belegte Daten.',
              origin: 'model',
              supported: 'model',
              completedAction: false,
              specific: false,
              evidenceIds: [],
            },
          ],
          expectation: [],
          nextSteps: [],
          assumptions: [],
          draft: [],
        })
      )
    );
  });
  llm.generateChat.mockRejectedValue(new Error('Unexpected chat task'));
  const harness = require('../scripts/workbench-live-harness');
  const create = harness.createLiveHarness;
  const spy = jest.spyOn(harness, 'createLiveHarness').mockImplementation((...args) => {
    app = create(...args);
    app.workbench.settings.projectSkills = { delayMs: 2 ** 31 - 1, manifestTrigger: false };
    for (const service of app.broker.services)
      service.settings.tenantEvidenceEnrichment = { delayMs: 2 ** 31 - 1 };
    return app;
  });
  try {
    transport = await createLocalTransport({
      budget: require('../scripts/live-validation-budget').installLiveBudget({ limit: 500 }),
    });
  } finally {
    spy.mockRestore();
  }
});
afterAll(async () => {
  await transport?.close();
  process.env = env;
});

test.each(['a', 'b'])(
  'generated project %s learns and uses CET-Skript against its own SQLite through the real harness',
  async (id) => {
    draftMode = 'good';
    errors.length = 0;
    const fixture = instantiatePracticeScenario(`project-skill-${id}`);
    const run = await transport.startRun(fixture),
      context = {},
      failures = [],
      replies = [];
    for (const turn of fixture.turns) {
      const reply = await transport.send(run, turn);
      replies.push({ id: turn.id, reply });
      failures.push(
        ...checkTurn(turn, reply, context)
          .filter((check) => !check.passed)
          .map((check) => ({ turn: turn.id, ...check }))
      );
    }
    const skills = await app.workbench.store.listProjectSkillRecords(run.tenantId);
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      lifecycle: 'retired',
      usage: { count: 1, corrections: 2 },
      origin: 'learned',
    });
    expect(skills[0].validation.checks.every((check) => check.passed)).toBe(true);
    expect(skills[0].validation.additionalExpected.rows).not.toEqual(skills[0].baseline.expected);
    expect(
      replies.find((entry) => entry.id === 'third').reply.evidence[0].metadata.provenance
    ).not.toEqual({});
  }
);

test.each(['wrong', 'foreign'])('generated %s draft never becomes active', async (mode) => {
  draftMode = mode;
  errors.length = 0;
  const fixture = instantiatePracticeScenario('project-skill-a');
  const run = await transport.startRun(fixture);
  for (const turn of fixture.turns.slice(0, 2)) await transport.send(run, turn);
  while (
    app.workbench.projectSkillWorker?.pending.size ||
    app.workbench.projectSkillWorker?.running
  )
    await runProjectSkillJob(app.workbench);
  const skills = await app.workbench.store.listProjectSkillRecords(run.tenantId);
  expect(errors).toEqual([]);
  expect(skills).toHaveLength(1);
  expect(skills[0].lifecycle).toBe('draft');
  expect(skills[0].validation.checks.some((check) => !check.passed)).toBe(true);
});

async function learn(fixture) {
  draftMode = 'good';
  errors.length = 0;
  const run = await transport.startRun(fixture);
  for (const turn of fixture.turns.slice(0, 2)) await transport.send(run, turn);
  return run;
}
function callFor(run) {
  const meta = require('../scripts/practice-evaluation-transport').actorMeta(run, run.actors[0]);
  return (name, params, extraMeta = {}) =>
    app.broker.call(name, params, { meta: { ...structuredClone(meta), ...extraMeta } });
}

test('real data-change event degrades the saved cases; later turns cannot use the old check', async () => {
  const fixture = instantiatePracticeScenario('project-skill-a');
  const run = await learn(fixture),
    call = callFor(run);
  const active = (await app.workbench.store.listProjectSkillRecords(run.tenantId))[0];
  expect(active.lifecycle).toBe('active');
  const rows = await call('datapoint.datasetCatalog', { operation: 'list' });
  const record = rows.find((row) => row.provenance.projectId === active.projectId);
  const dataset = app.broker.getLocalService('dataset');
  const pool = await require('../src/project-dataset-pool').datasetPoolFor(dataset, record);
  const column = record.columns.findIndex((field) => field.type === 'number');
  pool
    .tenant(run.tenantId)
    .prepare(`UPDATE ${pool.table(record.id)} SET c${column} = 99`)
    .run();
  const meta = require('../scripts/practice-evaluation-transport').actorMeta(run, run.actors[0]);
  await app.broker.emit(
    'project.graph.changed.v1',
    { tenantId: run.tenantId, projectId: active.projectId, version: 2, nodes: 1, edges: 0 },
    { meta }
  );
  // The redesign intentionally fails its comparison; the prior skill must remain unusable.
  draftMode = 'wrong';
  await app.drainProjectSkills();
  const skills = await app.workbench.store.listProjectSkillRecords(run.tenantId);
  expect(skills.find((skill) => skill.skillId === active.skillId).lifecycle).toBe('degraded');
  expect(skills.some((skill) => skill.origin === 'corrected' && skill.lifecycle === 'draft')).toBe(
    true
  );
  const reply = await transport.send(run, { ...fixture.turns[0], id: 'after-change' });
  expect(reply.learnedSkill).toBeUndefined();
  expect(reply.responseText).not.toContain('nach meinem gelernten Check');
  expect(reply.responseText).toContain('99');
  expect(errors).toEqual([]);
});

test('transfer through the correction loop creates and validates a separate destination draft', async () => {
  const fixture = instantiatePracticeScenario('project-skill-a');
  fixture.projectFixtures.push(instantiatePracticeScenario('project-skill-b').projectFixtures[0]);
  const run = await learn(fixture),
    call = callFor(run);
  const source = (await app.workbench.store.listProjectSkillRecords(run.tenantId))[0];
  expect(source.lifecycle).toBe('active');
  await call('shared-service-learning.apply', {
    target: 'projectSkill',
    correctionId: 'transfer-test',
    correction: {
      projectId: source.projectId,
      skillId: source.skillId,
      kind: 'transfer',
      destinationProjectId: run.projects[1],
    },
  });
  await app.drainProjectSkills();
  const skills = await app.workbench.store.listProjectSkillRecords(run.tenantId);
  const destination = skills.find((skill) => skill.projectId === run.projects[1]);
  expect(destination).toMatchObject({
    lifecycle: 'active',
    origin: 'corrected',
    derivedFrom: [source.skillId],
  });
  expect(destination.skillId).not.toBe(source.skillId);
  expect(destination.program).not.toBe(source.program);
  expect(destination.baseline.expected).not.toEqual(source.baseline.expected);
  expect(destination.validation.checks.every((check) => check.passed)).toBe(true);
  expect(errors).toEqual([]);
});

test('existing skill listing/get and journal enforce current project membership; project deletion cleans the register', async () => {
  const fixture = instantiatePracticeScenario('project-skill-a');
  const run = await learn(fixture),
    call = callFor(run);
  const skill = (await app.workbench.store.listProjectSkillRecords(run.tenantId))[0];
  await call('project-file.update', {
    projectId: skill.projectId,
    members: [run.actors[0].actorId],
  });
  const outsider = {
    apiToken: {
      id: 'synthetic-outsider',
      tenantId: run.tenantId,
      roles: ['ROLE_GRID_OPERATOR'],
      scope: 'read-only',
    },
  };
  await expect(
    call('workbench.skills.get', { skillId: skill.skillId }, outsider)
  ).rejects.toMatchObject({ code: 404 });
  await expect(
    call('workbench.skills.list', { projectId: skill.projectId }, outsider)
  ).rejects.toMatchObject({ code: 404 });
  const functionId = require('../src/function-model')
    .getFunctionModel()
    .functions.find((fn) => fn.capabilities.includes('project_skill_learning')).functionId;
  const hidden = await call('journal.byFunction', { functionId }, outsider);
  expect(hidden.every((entry) => !entry.refs.some((ref) => ref.kind === 'projectSkill'))).toBe(
    true
  );
  expect(hidden.every((entry) => !entry.summary.includes(skill.title))).toBe(true);
  const visible = await call('workbench.skills.list', { projectId: skill.projectId });
  expect(visible.items.map((entry) => entry.skillId)).toContain(skill.skillId);
  await call('project-file.delete', { projectId: skill.projectId });
  expect(await app.workbench.store.listProjectSkillRecords(run.tenantId)).toEqual([]);
});

test('a new ordinary answer ends the previous skill correction context', async () => {
  const fixture = instantiatePracticeScenario('project-skill-a');
  const run = await learn(fixture);
  await transport.send(
    run,
    fixture.turns.find((turn) => turn.id === 'third')
  );
  await transport.send(
    run,
    fixture.turns.find((turn) => turn.id === 'unrelated')
  );
  const correction = await transport.send(run, {
    actor: 'a',
    chat: 'main',
    id: 'ordinary-correction',
    message: 'passt nicht',
  });
  const skill = (await app.workbench.store.listProjectSkillRecords(run.tenantId))[0];
  expect(skill.lifecycle).toBe('active');
  expect(skill.usage.corrections).toBe(0);
  expect(correction.responseText).not.toContain('herabgestuft');
});

test('an incorrect-result correction cannot reactivate the same evidence through rewritten arithmetic', async () => {
  const fixture = instantiatePracticeScenario('project-skill-a');
  const run = await learn(fixture),
    call = callFor(run);
  const source = (await app.workbench.store.listProjectSkillRecords(run.tenantId))[0];
  await call('shared-service-learning.apply', {
    target: 'projectSkill',
    correctionId: 'incorrect-proof',
    correction: { projectId: source.projectId, skillId: source.skillId, kind: 'incorrect' },
  });
  draftMode = 'recomputed';
  await app.drainProjectSkills();
  const skills = await app.workbench.store.listProjectSkillRecords(run.tenantId);
  expect(skills.find((skill) => skill.skillId === source.skillId).lifecycle).toBe('degraded');
  const successor = skills.find((skill) => skill.derivedFrom?.includes(source.skillId));
  expect(successor.lifecycle).toBe('draft');
  expect(successor.validation.checks[0]).toMatchObject({
    passed: false,
    code: 'Corrected evidence path is unchanged',
  });
  expect(successor.program).toContain(' + 0');
});
