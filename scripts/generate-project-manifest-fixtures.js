'use strict';

const referenceCatalog = ['A', 'B'].map((id) => ({
  id: `practice-${id.toLowerCase()}`,
  label: `Katalog ${id}`,
  action: 'practice-reference.read',
  graphLink: { keyFields: ['Token'], parameter: 'key', resultPath: 'data', resultField: 'key' },
}));
const referenceOperation = {
  action: 'practice-reference.read',
  operationId: 'practice-reference-read',
  agentable: true,
  operationKind: 'data_read',
  consequenceLevel: 'none',
  sideEffects: [],
  writesTo: [],
  domains: [],
  capabilityCandidates: [],
  requiredScopes: ['read-only'],
  parameters: { required: [{ name: 'key' }] },
};
const referenceService = {
  name: 'practice-reference',
  actions: {
    read: {
      params: { key: 'string', tenantId: 'string' },
      handler(ctx) {
        const { principal, deny } = require('../src/domain-router-policy');
        if (principal(ctx).tenantId !== ctx.params.tenantId) deny('Tenant mismatch');
        return {
          data: { key: ctx.params.key, reference: ctx.params.key.endsWith('-A') ? 41 : 43 },
        };
      },
    },
  },
};

function generateProjectScenarios(scenario, turn) {
  return [
    {
      id: 'a',
      subject: 'Standort Nord',
      title: 'Projekt A',
      column: 'Leistung',
      unit: 'kW',
      value: 23,
      reference: 41,
    },
    {
      id: 'b',
      subject: 'Depot West',
      title: 'Projekt B',
      column: 'Bestand',
      unit: 'kg',
      value: 29,
      reference: 43,
    },
  ].flatMap((spec) => {
    const fixture = { ...spec, key: `Bezug-${spec.id.toUpperCase()}` };
    const prefix = `project-${spec.id}`;
    const question = `Wie hoch war das Maximum der ${spec.column} am ${spec.subject} 2025?`;
    const selected = {
      projectEvidence: { selected: true, title: spec.title, file: `${spec.subject}.csv` },
      numeric: [{ value: spec.value, tolerance: 0 }],
    };
    const setup = { projectFixtures: [fixture] };
    return [
      scenario(
        `${prefix}-implicit`,
        'B.4',
        'Projektakte ohne Nennung',
        [
          turn(
            'question',
            question,
            'Abfrage mit sichtbarer Aktenwahl und Datei Fundstelle Hash',
            selected,
            { dataQuestion: true }
          ),
        ],
        setup
      ),
      scenario(
        `${prefix}-mixed`,
        'B.4',
        'Projektakte und Katalog getrennt',
        [
          turn(
            'question',
            `${question} Ergänze den aktuellen Referenzwert aus Katalog ${spec.id.toUpperCase()}.`,
            'Teilantworten aus zwei getrennten abgefragten Quellen',
            {
              ...selected,
              projectEvidence: {
                ...selected.projectEvidence,
                catalog: `Katalog ${spec.id.toUpperCase()}`,
              },
              numeric: [...selected.numeric, { value: spec.reference, tolerance: 0 }],
            },
            { dataQuestion: true }
          ),
        ],
        setup
      ),
      scenario(
        `${prefix}-gap`,
        'B.4',
        'Projektakte mit konkreter Lücke',
        [
          turn(
            'question',
            question.replace('2025', '2030'),
            'Fehlender Zeitraum ohne geschätzte Zahl',
            {
              projectEvidence: { selected: true, gap: true },
              require: ['2030', 'fehlt'],
              forbid: [`Maximum[^.]*: ${spec.value} `],
            },
            { dataQuestion: true }
          ),
        ],
        setup
      ),
      scenario(
        `${prefix}-unrelated`,
        'B.4',
        'Keine passende Projektakte',
        [
          turn(
            'question',
            'Wie ist die Temperatur am Standort C?',
            'Keine Akte und keine Aktenzahl bei fehlendem Bezug',
            { projectEvidence: { selected: false }, forbid: ['Ich habe dafür die Projektakte'] }
          ),
        ],
        setup
      ),
      scenario(
        `${prefix}-correction`,
        'B.4',
        'Falsche Akte korrigieren',
        [
          turn('question', question, 'Erste Aktenwahl sichtbar', selected, { dataQuestion: true }),
          turn('correction', 'falsche Akte', 'Korrektur in bestehender Lernschleife gespeichert', {
            require: ['Korrektur ist gespeichert'],
          }),
          turn(
            'next',
            question,
            'Nächster Turn verwendet die verworfene Akte nicht',
            { projectEvidence: { selected: false }, forbid: ['Ich habe dafür die Projektakte'] },
            { dataQuestion: true }
          ),
        ],
        setup
      ),
    ];
  });
}

async function prepareProjectFixtures(app, run, scenario, meta) {
  const call = (name, params) => app.broker.call(name, params, { meta: structuredClone(meta) });
  run.projects = [];
  run.projectPreparation = [];
  for (const fixture of scenario.projectFixtures || []) {
    const project = await call('project-file.create', { title: fixture.title });
    run.projects.push(project.projectId);
    const timestamps = fixture.timestamps || ['2025-01-01T00:00:00', '2025-01-01T01:00:00'];
    const bytes = Buffer.from(
      `Zeit,${fixture.column} [${fixture.unit}],Token\n${timestamps[0]},17,${fixture.key}\n${timestamps[1]},${fixture.value},${fixture.key}\n`
    );
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    const upload = await call('project-upload.start', {
      projectId: project.projectId,
      name: `${fixture.subject}.csv`,
      size: bytes.length,
      hash,
    });
    await call('project-upload.chunk', { uploadId: upload.uploadId, index: 0, hash, bytes });
    const job = await call('project-upload.complete', { uploadId: upload.uploadId });
    const deadline = Date.now() + 120000;
    let state;
    do {
      state = require('../src/job-store').getJob(job.jobId);
      if (['completed', 'error'].includes(state.status)) break;
      if (Date.now() >= deadline) throw new Error('Practice project ingest timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (true);
    if (state.status === 'error') throw new Error('Practice project ingest failed');
    for (const name of ['project-graph', 'project-manifest']) {
      const service = app.broker.getLocalService(name);
      await Promise.all(
        [...(service.graphRuns?.values() || service.runs?.values() || [])].map(
          (task) => task.promise
        )
      );
    }
    // Production owns fallback generation; fixtures only record its quality status.
    await call('project-manifest.get', { projectId: project.projectId });
    const candidate = (await call('project-manifest.candidates', {})).find(
      (entry) => entry.projectId === project.projectId
    );
    run.projectPreparation.push({
      projectId: project.projectId,
      ...(candidate?.generation || {
        status: 'degraded',
        reason: 'missing_candidate',
        fallback: false,
      }),
    });
  }
}

function projectEvidenceChecks(rule, reply, text) {
  const evidence = reply.evidence || [];
  const selected = Boolean(reply.projectSelection?.projectId);
  const checks = [
    {
      id: 'project-selection',
      passed: selected === rule.selected,
      reason: 'Aktenwahl passt zur erwarteten Sichtbarkeit',
    },
  ];
  if (!rule.selected)
    return [
      ...checks,
      {
        id: 'project-no-evidence',
        passed: !evidence.some((entry) => entry.metadata?.projectId),
        reason: 'Keine Evidenz aus einer unpassenden Akte',
      },
    ];
  checks.push({
    id: 'project-visible-choice',
    passed: /Ich habe dafür die Projektakte „[^“]+“ herangezogen/u.test(text),
    reason: 'Korrigierbare Aktenwahl sichtbar',
  });
  if (rule.file)
    checks.push({
      id: 'project-provenance',
      passed:
        evidence.some(
          (entry) =>
            entry.source === 'dataset.query' &&
            entry.metadata?.filename === rule.file &&
            /^[a-f0-9]{64}$/u.test(entry.metadata?.hash) &&
            entry.metadata?.nodeId &&
            entry.metadata?.location &&
            entry.value.includes('Fundstelle:') &&
            entry.value.includes('Hash:')
        ) && text.includes(rule.file),
      reason: 'Zahl aus Query mit Datei Fundstelle und Hash',
    });
  if (rule.catalog)
    checks.push({
      id: 'project-separated-catalog',
      passed:
        evidence.some((entry) => entry.source === 'practice-reference.read') &&
        text.toLocaleLowerCase().includes(rule.catalog.toLocaleLowerCase()) &&
        /Projektakte/iu.test(text),
      reason: 'Katalogteil aus wirklichem lesenden Endpunkt getrennt',
    });
  if (rule.gap)
    checks.push({
      id: 'project-gap',
      passed: Boolean(reply.gaps?.length) && !evidence.length,
      reason: 'Konkrete Datenlücke ohne Zahl',
    });
  return checks;
}

module.exports = {
  generateProjectScenarios,
  prepareProjectFixtures,
  projectEvidenceChecks,
  referenceCatalog,
  referenceOperation,
  referenceService,
};
