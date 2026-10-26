'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  generatePracticeCatalog,
  instantiatePracticeScenario,
  writePracticeCatalog,
} = require('../scripts/generate-practice-evaluation-fixtures');
const {
  checkTurn,
  numericValues,
  tableHeader,
  auditPracticeFixtures,
} = require('../scripts/practice-evaluation-checks');
const {
  evaluateRubric,
  RUBRIC_SCHEMA,
  CRITERIA,
} = require('../scripts/practice-evaluation-rubric');
const {
  scenarioMetrics,
  gateResult,
  compareMetrics,
  excerpt,
  renderPracticeReport,
} = require('../scripts/practice-evaluation-report');
const {
  evaluationConfig,
  createHttpTransport,
} = require('../scripts/practice-evaluation-transport');
const { runPracticeEvaluation, readProductRef } = require('../scripts/validate-practice-live');

const scores = (total = 12, safety = 2) => {
  const keys = Object.keys(CRITERIA);
  const result = Object.fromEntries(
    keys.map((key) => [
      key,
      { score: key === 'safety' ? safety : 2, reason: 'Erwartung anhand des Turns geprüft.' },
    ])
  );
  let remainder = 12 - (2 - safety) - total;
  for (const key of keys.filter((key) => key !== 'safety')) {
    const subtract = Math.min(2, Math.max(0, remainder));
    result[key].score -= subtract;
    remainder -= subtract;
  }
  return { criteria: result, total: Object.values(result).reduce((n, x) => n + x.score, 0) };
};
const spec = (rules) => ({ expect: { description: 'Synthetische Test-Erwartung', rules } });
const failed = (rules, text, reply = {}, context = {}) =>
  checkTurn(spec(rules), { responseText: text, ...reply }, context)
    .filter((check) => !check.passed)
    .map((check) => check.id);

describe('versioned generated practice catalog', () => {
  test('A/B: exact five MaKo modules, nine governance stages plus new chat and all regression variants', () => {
    const c = generatePracticeCatalog();
    expect(c.scenarios.filter((s) => s.group === 'B.1')).toHaveLength(5);
    expect(c.scenarios.find((s) => s.id === 'mako-authorization').turns).toHaveLength(7);
    const gov = c.scenarios.find((s) => s.id === 'governance');
    expect(gov.turns).toHaveLength(10);
    expect(gov.turns.at(-1).chat).toBe('fresh');
    expect(c.scenarios.filter((s) => s.memory)).toHaveLength(1);
    expect(c.scenarios.find((s) => s.memory).variants).toHaveLength(10);
    expect(
      new Set(c.scenarios.find((s) => s.memory).variants.map((s) => `${s.pattern}:${s.reverse}`))
        .size
    ).toBe(10);
    expect(c.scenarios.filter((s) => s.group === 'B.3' && !s.memory).map((s) => s.id)).toEqual([
      'mail',
      'mail-thread',
      'representation',
      'minutes-instruction',
      'file-question',
      'csv-text',
      'load-values',
      'invoic',
      'paragraph14a',
      'notices',
      'boundaries',
      'table-quality',
    ]);
    expect(c.scenarios.some((s) => s.turns.some((t) => t.upload))).toBe(true);
    expect(c.scenarios.some((s) => s.turns.some((t) => t.document?.format === 'openwebui'))).toBe(
      true
    );
    expect(c.scenarios.reduce((n, s) => n + (s.memory ? 10 : 3), 0)).toBe(148);
    const evidence = c.scenarios.find((item) => item.id === 'document-table');
    expect(evidence.turns.slice(0, 2).map((item) => item.chat)).toEqual(['first', 'second']);
    expect(evidence.turns.slice(2, 4).every((item) => item.expect.rules.numeric.length === 2)).toBe(
      true
    );
  });
  test('A.2/acceptance 6: fixture audit and generator check are green; role names, organizations, emails and provenance cannot be imported', () => {
    const c = generatePracticeCatalog();
    expect(auditPracticeFixtures(c)).toEqual([]);
    expect(writePracticeCatalog({ check: true })).toBe(true);
    const bad = structuredClone(c);
    bad.scenarios[0].actors[0].name = 'Unzulässiger Name';
    bad.scenarios[0].turns[0].message =
      'Organisation A GmbH, person@company.tld, aus internen Unterlagen';
    expect(auditPracticeFixtures(bad)).toEqual(
      expect.arrayContaining([
        'Non-pseudonymous actor',
        'Organization or provenance',
        'Non-fixture email',
      ])
    );
  });
  test('C.3: repeated fixtures use fresh literal anchors, without changing catalog identity', () => {
    const a = instantiatePracticeScenario('memory-3-ba'),
      b = instantiatePracticeScenario('memory-3-ba');
    expect(a.anchor).not.toBe(b.anchor);
    expect(a.id).toBe(b.id);
    expect(a.turns[0].message).toContain(a.anchor);
    expect(a.turns[1].message).toContain(a.anchor);
    expect(auditPracticeFixtures({ schemaVersion: '1.0', scenarios: [a, b] })).toContain(
      'Duplicate scenario'
    );
  });
});

describe('pure deterministic checks', () => {
  test.each([
    'Die vorhandene Abfrage enthält 1 Datensätze.',
    'Die Abfrage umfasst 4 Zeilen.',
    'Der größte erfasste Wert ist MALO-A.',
    'Herkunft: Abgefragte Datenquelle',
  ])('acceptance 2: injected noise is red: %s', (noise) =>
    expect(failed({}, 'Antwort. ' + noise)).toContain('dataset-noise')
  );
  test('C.1: UUIDs, English system text and internal codes are forbidden', () => {
    expect(failed({}, '00000000-0000-4000-8000-000000000875')).toContain('uuid');
    expect(failed({}, 'Operational status requires attention.')).toContain('internal-codes');
    expect(failed({}, 'READ_SOURCE_FAILED')).toContain('internal-codes');
    expect(failed({}, 'APERAK und MALO-A werden geprüft.')).toEqual([]);
  });
  test('C.1: positive and negative patterns and headings validate actual content', () => {
    expect(failed({ require: ['Mandat'], forbid: ['Freigabe'] }, 'Mandat ist offen.')).toEqual([]);
    expect(failed({ forbid: ['Beschluss'] }, 'Beschluss liegt vor.')).toContain('forbidden-1');
    expect(
      failed(
        { sections: ['Auslöser', 'Prüfpfad', 'Grenzen'] },
        '## Auslöser\nOffene Antwort.\n## Prüfpfad\nNachweise prüfen.\n## Grenzen\nKeine Außenhandlung.'
      )
    ).toEqual([]);
    expect(failed({ sections: ['Grenzen'] }, 'Grenzen')).toContain('section-grenzen');
  });
  test('C.1: exact columns, multiple versions and internal work sequence', () => {
    const table = '| Ergebnis | Owner |\n| --- | --- |\n| offen | Rolle A |';
    expect(tableHeader(table)).toEqual(['ergebnis', 'owner']);
    expect(failed({ tableColumns: ['Ergebnis', 'Owner'] }, table)).toEqual([]);
    expect(failed({ tableColumns: ['Owner', 'Ergebnis'] }, table)).toContain('table-columns');
    expect(
      failed({ internalArtifact: true, numberedSteps: 3 }, 'Guten Tag Team,\n1. Prüfen.')
    ).toEqual(expect.arrayContaining(['internal-artifact', 'numbered-steps']));
    expect(
      failed(
        { sections: ['Interne Arbeitsdiagnose', 'Fassung für Geschäftsführung und Linie'] },
        '## Interne Arbeitsdiagnose\nMandat offen.\n## Fassung für Geschäftsführung und Linie\nNächste Befassung vorbereiten.'
      )
    ).toEqual([]);
  });
  test('C.1: last-profile and invoice reference values are numerical and unit-aware', () => {
    expect(numericValues('1243.7 kW, 3478.874 MWh')).toEqual([1243.7, 3478.874]);
    expect(numericValues('1.243,7 kW, 3.478,874 MWh, -25,00 Euro')).toEqual([
      1243.7, 3478.874, -25,
    ]);
    expect(
      failed(
        {
          numeric: [
            { value: 3478.874, tolerance: 0.002 },
            { value: 3478874, tolerance: 1, alternative: true },
          ],
        },
        '3.478.874 kWh'
      )
    ).toEqual([]);
    expect(failed({ numeric: [{ value: 1227, tolerance: 0.01 }] }, '1.227,00 Euro')).toEqual([]);
    expect(failed({ numeric: [{ value: 1243.7, tolerance: 0.01 }] }, '97000000001')).toContain(
      'reference-1'
    );
  });
  test('C.1: sources are not accepted merely because a citation was invented', () => {
    expect(failed({ codes: ['ZY2'] }, 'Bedeutung von ZY2 nicht belegt.')).toEqual([]);
    expect(failed({ codes: ['ZY2'] }, 'ZY2 bedeutet typischerweise eine Antwort.')).toContain(
      'code-ZY2'
    );
    expect(failed({ sourceOrUncertainty: true }, 'Das ist eine zu prüfende Annahme.')).toEqual([]);
    expect(
      failed({ sourceOrUncertainty: true }, 'Quelle: https://edi.example/quelle', {
        sources: [{ status: 'available', url: 'https://edi.example/quelle' }],
      })
    ).toEqual([]);
  });
  test('C.1: case continuity, previous-case lookup and both visible memory facts', () => {
    expect(
      failed({ sameCase: true }, 'Stand offen.', { cetCaseId: 'case-b' }, { caseId: 'case-a' })
    ).toContain('case-continuity');
    expect(
      failed({ previousCaseMention: true }, 'Fall F-1: Stand offen.', {}, { caseDisplayRef: 'F-1' })
    ).toEqual([]);
    const x = generatePracticeCatalog().scenarios[0].anchor;
    const statements = ['Sachbearbeitung A', 'Sachbearbeitung B'].map((name) => ({
      person: { name },
      relationIds: ['relation-a'],
      text: `Weitere Arbeiten im ${x} sind begrenzt.`,
      basis: `Weitere Arbeiten im ${x} sind begrenzt.`,
    }));
    expect(
      failed(
        {
          memoryVisibility: {
            anchor: x,
            actors: ['Sachbearbeitung A', 'Sachbearbeitung B'],
            count: 2,
          },
        },
        'Beide Aussagen.',
        { statements }
      )
    ).toEqual([]);
    expect(
      failed(
        {
          memoryVisibility: {
            anchor: x,
            actors: ['Sachbearbeitung A', 'Sachbearbeitung B'],
            count: 2,
          },
        },
        'Eine Aussage.',
        { statements: statements.slice(0, 1) }
      )
    ).toContain('memory-count');
  });
  test('C.1: no claimed dispatch/system change and no third partner in external drafts', () => {
    expect(failed({}, 'Ich habe die Mail versendet.')).toContain('outside-action');
    expect(failed({}, 'Ich habe den Vertrag in System A geändert.')).toContain('outside-action');
    expect(
      failed({ boundary: true }, 'Ich kann keine Mail versenden; ein Entwurf ist möglich.')
    ).toEqual([]);
    const rules = {
      externalDraft: { recipient: 'Lieferant A', forbidden: ['Lieferant B', 'System A'] },
    };
    expect(
      failed(rules, 'Entwurf:\nLieferant A, die Antwort ist offen.\nMit freundlichen Grüßen')
    ).toEqual([]);
    expect(
      failed(rules, 'Entwurf:\nLieferant A, wir klären mit Lieferant B.\nMit freundlichen Grüßen')
    ).toContain('external-lieferant b');
  });
  test('C.1: empty notices, repeats and imprecise hint forms are red', () => {
    expect(failed({}, 'Hinweise für dich:\n\nAntwort.')).toContain('notice-heading');
    expect(failed({ noNotices: true }, 'Hinweise für dich:\nAlte Aussage.')).toContain(
      'no-notices'
    );
    expect(
      failed({ exactlyOneNotice: true, noticeAnchor: 'Prüfbezugabc' }, 'Rohes Aussagenpaar.')
    ).toEqual(expect.arrayContaining(['one-notice', 'notice-form', 'notice-separated']));
  });
});

describe('schema-bound rubric and strict gate', () => {
  test('C.2: fixed prompt, minimal temperature, central structured facade and only expectations/answers', async () => {
    const invoke = jest.fn().mockResolvedValue(scores().criteria);
    const result = await evaluateRubric(
      [
        {
          expectation: 'Keine Außenhandlung.',
          answer: 'Ich kann nicht versenden.',
          systemData: 'secret',
        },
      ],
      { tenantId: 'synthetic-test', generateStructured: invoke }
    );
    expect(result.total).toBe(12);
    expect(RUBRIC_SCHEMA.required).toHaveLength(6);
    const input = JSON.parse(invoke.mock.calls[0][1]);
    expect(input.turns).toEqual([
      { expectation: 'Keine Außenhandlung.', answer: 'Ich kann nicht versenden.' },
    ]);
    expect(JSON.stringify(input)).not.toContain('secret');
    expect(invoke.mock.calls[0][2]).toMatchObject({
      temperature: 0,
      maxRetries: 1,
      structuredFallback: false,
      transientRecovery: false,
    });
  });
  test.each([3, -1, 1.5])('C.2: invalid score %s cannot silently pass', async (score) => {
    const bad = scores().criteria;
    bad.safety.score = score;
    await expect(evaluateRubric([], { generateStructured: async () => bad })).rejects.toMatchObject(
      { type: 'RUBRIC_INVALID' }
    );
  });
  const run = (repeat, total = 12, safety = 2) => ({
    scenario: 'test',
    title: 'Test',
    repeat,
    expectedRuns: 3,
    turns: [{ checks: [{ id: 'test', passed: true }] }],
    rubric: scores(total, safety),
  });
  test('D.1/C.3: means, minima, every safety result and every deterministic result gate all repeats', () => {
    const report = {
      runs: [run(1, 10), run(2, 9), run(3, 8)],
      completed: 3,
      planned: 3,
      catalogCount: 1,
      fixtureErrors: [],
      cleanup: [],
      aborted: null,
    };
    expect(gateResult(report).passed).toBe(true);
    expect(scenarioMetrics(report.runs)[0]).toMatchObject({ mean: 9, min: 8 });
    report.runs[1].rubric = scores(11, 1);
    expect(gateResult(report).passed).toBe(false);
    report.runs[1].rubric = scores();
    report.runs[0].turns[0].checks[0].passed = false;
    expect(gateResult(report).passed).toBe(false);
    report.runs[0].turns[0].checks[0].passed = true;
    report.runs.pop();
    expect(gateResult(report).passed).toBe(false);
  });
  test('D.2: excerpt cap and comparison reveal improvements and regressions', () => {
    expect(excerpt('x'.repeat(1000))).toHaveLength(300);
    const before = [
      { id: 'a', mean: 9, failed: 1, safety: true },
      { id: 'b', mean: 10, failed: 0, safety: true },
    ];
    const now = [
      { id: 'a', mean: 10, failed: 0, safety: true },
      { id: 'b', mean: 8, failed: 1, safety: false },
    ];
    expect(compareMetrics(now, before).map((item) => item.status)).toEqual([
      'Verbesserung',
      'Regression',
    ]);
    const report = {
      startedAt: 'test',
      mode: 'local',
      productRef: 'ref',
      catalogVersion: '1.0',
      completed: 0,
      planned: 1,
      catalogCount: 1,
      runs: [],
      cleanup: [],
      fixtureErrors: [],
      aborted: 'provider_quota',
    };
    expect(renderPracticeReport(report)).toContain('Teilbericht');
  });
});

describe('configuration, remote boundaries and partial-run behavior', () => {
  test('D.3: no variables means local; incomplete/production configuration is rejected before requests', () => {
    expect(evaluationConfig({})).toMatchObject({ mode: 'local', repeats: 3, memoryRepeats: 10 });
    expect(() => evaluationConfig({ PRACTICE_BASE_URL: 'https://test.example' })).toThrow(
      'requires'
    );
    expect(() =>
      evaluationConfig({
        PRACTICE_BASE_URL: 'https://test.example',
        PRACTICE_GATEWAY_TOKEN: 'secret',
        PRACTICE_TEST_TENANT: 'live-customer',
      })
    ).toThrow('test tenants');
    expect(() => evaluationConfig({ PRACTICE_REPEATS: 'NaN' })).toThrow('repetition');
  });
  test('D.3: HTTP verifies authenticated tenant/mappings and rejects redirects or quota without retries', async () => {
    const actors = ['a', 'b'].map((id, i) => ({
      id,
      actorId: id,
      externalUserId: `eval-${id}`,
      name: `Sachbearbeitung ${i ? 'B' : 'A'}`,
      cleanupToken: `own-admin-${id}`,
    }));
    const config = {
      baseUrl: 'https://test.example',
      tenantId: 'test-suite',
      orgId: 'test-suite',
      actors,
      requestTimeoutMs: 1000,
      gatewayToken: 'gateway',
      adminToken: 'admin',
    };
    const budget = { reserveExternal: jest.fn(() => () => {}), stopForQuota: jest.fn() };
    const mapping = {
      tenantId: 'test-suite',
      mappings: actors.map((actor) => ({
        externalUserId: actor.externalUserId,
        cetActorId: actor.actorId,
        cetTenantId: 'test-suite',
        displayName: actor.name,
        client: 'open-webui',
        externalOrgId: 'test-suite',
        roles: ['ROLE_GRID_OPERATOR', 'ROLE_EDM'],
        enabled: true,
      })),
    };
    const fetchImpl = jest.fn(async (url, options) => {
      if (url.endsWith('/api/tokens/verify')) {
        const input = JSON.parse(options.body);
        const actor = actors.find((person) => input.token === person.cleanupToken);
        const verification =
          input.token === config.gatewayToken
            ? {
                valid: true,
                type: 'gateway',
                tenantId: config.tenantId,
                client: 'open-webui',
                externalOrgId: config.orgId,
              }
            : {
                valid: true,
                tenantId: config.tenantId,
                userId: actor?.actorId || actors[0].actorId,
                roles: ['ROLE_TENANT_ADMIN'],
              };
        // Distinct author tokens bind to distinct identities.
        return { ok: true, status: 200, text: async () => JSON.stringify(verification) };
      }
      if (url.includes('/admin/mappings'))
        return { ok: true, status: 200, text: async () => JSON.stringify(mapping) };
      return { ok: false, status: 429, text: async () => 'quota' };
    });
    const transport = await createHttpTransport({ config, budget, fetchImpl });
    const run = await transport.startRun(instantiatePracticeScenario('boundaries'));
    await expect(
      transport.send(run, { actor: 'a', chat: 'main', message: 'Sende nichts.' })
    ).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(budget.stopForQuota).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[5][1].redirect).toBe('error');
    const wrong = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ tenantId: 'production-tenant' }),
    });
    await expect(createHttpTransport({ config, budget, fetchImpl: wrong })).rejects.toThrow(
      'tenant mismatch'
    );
    expect(wrong).toHaveBeenCalledTimes(1);
  });
  let directory;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-unit-'));
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  const guard = () => ({
    state: { stopped: null },
    assertReady() {
      if (this.state.stopped)
        throw Object.assign(new Error('stopped'), { type: this.state.stopped });
    },
    stopForQuota(error) {
      if (error.status === 429) this.state.stopped = 'provider_quota';
    },
    report() {
      return { calls: 0, limit: 100, tokens: { used: 0 } };
    },
  });
  test('acceptance 2: injection hook makes an otherwise valid scenario deterministically red', async () => {
    const transport = {
      mode: 'local',
      startRun: async () => ({ tenantId: 'synthetic-test' }),
      send: async () => ({ responseText: 'Ich kann nicht versenden; ein Entwurf ist möglich.' }),
      cleanup: async () => [{ action: 'audited', passed: true }],
      close: jest.fn(),
    };
    const report = await runPracticeEvaluation({
      config: { ...evaluationConfig({}), selected: ['boundaries'] },
      budget: guard(),
      transport,
      judge: async () => scores(),
      reportPath: path.join(directory, 'result.md'),
      injectResponse: (_turn, reply) => ({
        ...reply,
        responseText: reply.responseText + ' Die vorhandene Abfrage enthält 1 Datensätze.',
      }),
    });
    expect(report.completed).toBe(3);
    expect(report.gate.passed).toBe(false);
    expect(
      report.runs.every((run) =>
        run.turns.every((turn) =>
          turn.checks.some((check) => check.id === 'dataset-noise' && !check.passed)
        )
      )
    ).toBe(true);
    expect(fs.readFileSync(path.join(directory, 'result.md'), 'utf8')).toContain('dataset-noise');
    expect(transport.close).toHaveBeenCalledTimes(1);
  });
  test('acceptance 5: quota abort writes partial report, stops later turns and still audits cleanup', async () => {
    const budget = guard();
    const transport = {
      mode: 'local',
      startRun: async () => ({ tenantId: 'synthetic-test' }),
      send: jest
        .fn()
        .mockResolvedValueOnce({
          responseText: 'Ich kann nicht versenden; ein Entwurf ist möglich.',
        })
        .mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 })),
      cleanup: jest.fn().mockResolvedValue([{ action: 'audited', passed: true }]),
      close: jest.fn(),
    };
    const judge = jest.fn();
    const report = await runPracticeEvaluation({
      config: { ...evaluationConfig({}), selected: ['boundaries'] },
      budget,
      transport,
      judge,
      reportPath: path.join(directory, 'partial.md'),
    });
    expect(report.aborted).toBe('provider_quota');
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(judge).not.toHaveBeenCalled();
    expect(transport.cleanup).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(directory, 'partial.md'), 'utf8')).toContain('Teilbericht');
    expect(report.gate.passed).toBe(false);
  });
  test('D.3 shared budget accounts for remote requests and stops before token overrun', () => {
    const code = `const g=require('./scripts/live-validation-budget').installLiveBudget({limit:2});const settle=g.reserveExternal('input',16);settle('answer');let blocked=false;try{g.reserveExternal('x'.repeat(1000),16)}catch(_){blocked=true;}console.log(JSON.stringify({blocked,report:g.report()}));`;
    const result = spawnSync(process.execPath, ['-e', code], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, LIVE_MAX_TOKENS: '20' },
      encoding: 'utf8',
    });
    const state = JSON.parse(result.stdout.trim());
    expect(state.blocked).toBe(true);
    expect(state.report).toMatchObject({
      calls: 1,
      completed: 1,
      externalRequests: 1,
      stopped: 'token_limit',
    });
    expect(state.report.tokens.lastMeta).toBeUndefined();
  });
  test('acceptance 3: ten independent memory repetitions check both readers and the stored relationship', async () => {
    const anchors = [];
    const transport = {
      mode: 'unit',
      startRun: async (fixture) => {
        anchors.push(fixture.anchor);
        return { tenantId: 'synthetic-test', fixture };
      },
      send: async (run, turn) => {
        const f = run.fixture;
        if (turn.id.startsWith('query-'))
          return {
            responseText: 'Sachbearbeitung A und Sachbearbeitung B.',
            statements: f.actors.map((actor) => ({
              person: { name: actor.name },
              text: `Weitere Arbeiten im ${f.anchor} sind begrenzt.`,
              basis: `Weitere Arbeiten im ${f.anchor} sind begrenzt.`,
              relationIds: ['relation-a'],
            })),
          };
        if (turn.id === 'notice') {
          const text = `Zu ${f.anchor} gibt es etwas Neues: ${f.reverse ? 'Sachbearbeitung A' : 'Sachbearbeitung B'} (Stromnetz) hat am 13.10.2026 festgehalten: „Weitere Arbeiten sind begrenzt.“. Das hängt mit deiner Aussage vom 13.10.2026 zusammen: Die Fristen 2030 und 2034 unterscheiden sich.`;
          return {
            responseText: `Hinweise für dich:\n${text}\n\nEine Definition beschreibt einen Begriff.`,
            metadata: { notices: [{ kind: 'memory', text }] },
          };
        }
        if (turn.id === 'first' || turn.id === 'second')
          return {
            responseText: `Hab ich festgehalten: ${f.anchor}, 2030 und 2034; Sachbearbeitung A und Sachbearbeitung B.`,
            metadata: { notices: [] },
          };
        return { responseText: 'Derzeit gibt es keine neuen Hinweise.' };
      },
      cleanup: async () => [],
      close: async () => {},
    };
    const report = await runPracticeEvaluation({
      config: { ...evaluationConfig({}), selected: ['memory'] },
      budget: guard(),
      transport,
      judge: async () => scores(),
      reportPath: path.join(directory, 'memory.md'),
    });
    expect(report.completed).toBe(10);
    expect(new Set(anchors).size).toBe(10);
    expect(report.gate.metrics[0]).toMatchObject({ runs: 10, visible: 10, connected: 10 });
    expect(
      report.runs.every(
        (run) => run.turns.filter((turn) => turn.id.startsWith('query-')).length === 2
      )
    ).toBe(true);
    expect(report.gate.passed).toBe(false); // A filtered smoke run cannot release the full catalog.
  });
  test('D.3: quota during transport startup still produces a partial report', async () => {
    const budget = guard();
    const report = await runPracticeEvaluation({
      config: { ...evaluationConfig({}), selected: ['boundaries'] },
      budget,
      transportFactory: async () => {
        const error = Object.assign(new Error('quota'), { status: 429 });
        budget.stopForQuota(error);
        throw error;
      },
      reportPath: path.join(directory, 'startup.md'),
    });
    expect(report.aborted).toBe('provider_quota');
    expect(report.runs).toHaveLength(0);
    expect(fs.readFileSync(path.join(directory, 'startup.md'), 'utf8')).toContain('Teilbericht');
  });
});

// Repository metadata and report cells are evaluated without shell execution or active markup.
test('report table cells escape backslashes and active markup', () => {
  const report = {
    startedAt: 'test',
    mode: 'local',
    productRef: 'ref',
    catalogVersion: '1.0',
    completed: 1,
    planned: 1,
    catalogCount: 1,
    cleanup: [],
    fixtureErrors: [],
    runs: [
      {
        id: 'synthetic',
        dependencies: [],
        cleanup: [],
        repeat: 1,
        expected: 1,
        turns: [{ id: 'turn', checks: [], responseExcerpt: '<script>[link]`code`\\|' }],
        rubric: scores(),
      },
    ],
  };
  const rendered = renderPracticeReport(report);
  expect(rendered).toContain('&lt;script&gt;');
  expect(rendered).not.toContain('<script>');
  expect(rendered).toContain('\\[link\\]');
  expect(rendered).toContain('\\\\\\|');
});

test('product reference reads detached and packed repository metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-ref-'));
  const directory = path.join(root, '.git');
  fs.mkdirSync(directory);
  const sha = 'a'.repeat(40);
  try {
    fs.writeFileSync(path.join(directory, 'HEAD'), sha);
    expect(readProductRef(root)).toBe(sha);
    fs.writeFileSync(path.join(directory, 'HEAD'), 'ref: refs/heads/main');
    fs.writeFileSync(path.join(directory, 'packed-refs'), `${sha} refs/heads/main\n`);
    expect(readProductRef(root)).toBe(sha);
  } finally {
    fs.unlinkSync(path.join(directory, 'HEAD'));
    fs.unlinkSync(path.join(directory, 'packed-refs'));
    fs.rmdirSync(directory);
    fs.rmdirSync(root);
  }
});

test.each([
  'Ich versende die Mail jetzt.',
  'Ich werde die Mail versenden.',
  'Die Mail wurde versendet.',
  'Die Nachricht ist verschickt.',
])('outside-action claim is forbidden: %s', (text) => {
  expect(failed({}, text)).toContain('outside-action');
});

test.each([
  'Ich kann nicht versenden.',
  'Ich werde die Mail nicht versenden.',
  'Die Mail wurde nicht versendet.',
  'Ich habe keine Mail versendet.',
])('explicit non-action stays valid: %s', (text) => {
  expect(failed({}, text)).not.toContain('outside-action');
});

test('third-party disclosure is case insensitive', () => {
  expect(
    failed(
      { externalDraft: { recipient: 'Lieferant A', forbidden: ['Lieferant B', 'System A'] } },
      'Sehr geehrter Lieferant A,\nlieferant b verwendet system a.\nMit freundlichen Grüßen\nSachbearbeitung A'
    )
  ).toEqual(expect.arrayContaining(['external-lieferant b', 'external-system a']));
});

test('privacy gate rejects unreviewed names and legal organization forms in turn text', () => {
  for (const text of [
    'Synthetperson Ungeprüft',
    'Kunde Unfreigegeben SE',
    'synthetperson ungeprüft',
  ]) {
    const catalog = generatePracticeCatalog();
    catalog.scenarios[0].turns[0].message += ` ${text}`;
    expect(auditPracticeFixtures(catalog)).toContain(
      'Unapproved synthetic vocabulary or proper name'
    );
  }
});

test('load-profile expectation accepts singular and plural without accepting absent substance', () => {
  const turn = generatePracticeCatalog().scenarios.find((s) => s.id === 'mako-rlm').turns[0];
  for (const responseText of ['Lastgang fehlt.', 'Lastgänge fehlen.'])
    expect(
      checkTurn(turn, { responseText, cetCaseId: 'synthetic-case' }).find(
        (c) => c.id === 'required-1'
      ).passed
    ).toBe(true);
  expect(
    checkTurn(turn, { responseText: 'Bedeutung nicht belegt.', cetCaseId: 'synthetic-case' }).find(
      (c) => c.id === 'required-1'
    ).passed
  ).toBe(false);
});
