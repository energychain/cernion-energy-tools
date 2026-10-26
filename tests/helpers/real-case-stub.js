'use strict';

const llm = require('../../src/llm-client');
const { complete, validate } = require('./workbench-schema-stub');

function installRealCaseStub() {
  const controls = { inputs: [], schemas: [], errors: [], turn: '' };
  const roleFor = (message) => {
    const value = {
      subject: 'none',
      firstPerson: false,
      answersQuestionKey: '',
      basis: '',
      role: '',
      mandate: '',
      goal: '',
      roleOnly: false,
    };
    if (message.startsWith('Ich soll mich'))
      return {
        ...value,
        subject: 'self',
        firstPerson: true,
        basis: message.split('.')[0] + '.',
        role: controls.turn === 'sentence' ? message.split('.')[0] + '.' : 'Ich',
        goal: controls.turn === 'sentence' ? '' : 'in das Thema einarbeiten',
      };
    if (message.startsWith('Ich übernehme'))
      return {
        ...value,
        subject: 'self',
        firstPerson: true,
        basis: message,
        role: 'Governance/Aufsicht',
        mandate: 'im Gremium A durch Fragen',
        goal: 'aktuelle Probleme und Risiken für das Ergebnis der Organisation A in den kommenden Jahren vermeiden',
        roleOnly: true,
      };
    if (message.startsWith('Ich bin'))
      return {
        ...value,
        subject: 'self',
        firstPerson: true,
        basis: message,
        role: 'Aufsicht',
        mandate: 'Gremium A',
      };
    return value;
  };
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    controls.inputs.push(input);
    controls.schemas.push({ schema, task: input.task });
    const message = input.currentUserMessage || input.message || '';
    let value = {};
    if (input.task === 'working_context_fields') {
      const { role, mandate, goal } = roleFor(message);
      value = { role, mandate, goal };
    } else if (input.task === 'evidence_request_kind')
      value = { contentRequested: !input.question.startsWith('Bitte ablegen') };
    else if (input.task === 'evidence_reference_resolution')
      value = {
        sourceIds: input.question.startsWith('Bitte ablegen')
          ? []
          : input.currentSources.map((source) => source.id),
      };
    else if (input.datasets && !input.nodes)
      value = { datasetIds: input.datasets.map((entry) => entry.id) };
    else if (input.nodes) {
      const sources = [input.nodes[0].nodeId];
      value = {
        summary: { text: 'Dokumentierter Bestand', sources },
        entities: [{ name: 'Projekt Nord', kind: 'subject', sources }],
        questionTypes: [
          {
            id: 'read',
            description: 'Bestand Zuordnung Prüfung',
            inputs: [],
            skillRefs: [],
            sources,
          },
        ],
        timeRanges: [],
        externalLinks: [],
      };
    } else if (schema.properties?.timezone)
      value = {
        title: 'Export-A',
        description: 'Erfasster Bestand',
        anchors: [],
        timezone: 'Europe/Berlin',
        timeField: 'Datum',
        intervalConvention: 'begin',
        units: { Datum: '', Klasse: '', 'Bestand (kg)': 'kg' },
        assumptions: [],
      };
    else if (input.sourceId && input.profile)
      value = {
        sources: [{ alias: 'source', sourceId: input.sourceId }],
        operations: [
          { op: 'aggregate', groupBy: [], metrics: [{ fn: 'count', as: 'rows' }] },
          { op: 'limit', count: 10 },
        ],
      };
    else if (input.untrustedEvidence)
      value = {
        answer: input.untrustedEvidence
          .map((entry) => {
            const quantities = [...new Set(entry.value.match(/\b\d+ kg\b/gu) || [])];
            return `In ${entry.metadata.sourceLabel} (${entry.metadata.location}) sind ${quantities.join(', ')} belegt${entry.value.includes('Zuordnung') ? '; die Zuordnung ist offen' : ''}.`;
          })
          .join(' '),
      };
    else if (input.sections)
      value = {
        answer:
          'Die Autoren können den Bestand von 80 kg belegen (Arbeitsstand-A, Bestand). Für das Gremium bleibt die Zuordnung offen und zu klären (Arbeitsstand-A, Prüfung).',
      };
    else if (schema.properties?.concern)
      value = {
        concern: message.includes('Standort West') ? 'Standort West' : 'Projekt Nord',
        situation: 'Der Nutzer möchte den internen Stand einordnen.',
        turnKind: 'work',
        conversationShape: 'task',
        requestedAction: { description: '', externalEffect: false, draftRequested: false },
        roleStatement: roleFor(message),
        caseMemory: {
          applicable: true,
          topic: message.includes('Standort West') ? 'Standort West' : 'Projekt Nord',
          status: 'Der Nutzer möchte den internen Stand einordnen.',
          openPoints: [],
          assumptions: [],
          risks: [],
          nextSteps: [],
        },
      };
    else if (input.currentUserMessage)
      value = {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: false,
        roleStatement: roleFor(message),
      };
    else if (input.task === 'turn_controls')
      value = {
        turnKind: 'work_on_concrete_case',
        conversationShape: 'task',
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
    try {
      return validate(schema, complete(schema, value));
    } catch (error) {
      controls.errors.push(error.message);
      throw error;
    }
  });
  llm.generateText.mockImplementation(async (raw, options) => {
    const input = JSON.parse(raw);
    controls.inputs.push(input);
    const text =
      'Die Autoren können den Bestand von 80 kg belegen (Arbeitsstand-A, Bestand). Für das Gremium bleibt die Zuordnung offen und zu klären (Arbeitsstand-A, Prüfung).';
    const evidence = input.evidence || [];
    return JSON.stringify(
      validate(
        options.responseSchema,
        complete(options.responseSchema, {
          interpretation: [
            {
              text,
              questionTarget: 'other',
              origin: evidence.length ? 'evidence' : 'model',
              supported: evidence.length ? 'evidence' : 'model',
              specific: false,
              completedAction: false,
              evidenceIds: evidence.length ? [evidence[0].evidenceId] : [],
            },
          ],
        })
      )
    );
  });
  llm.generateChat.mockRejectedValue(new Error('Unexpected chat task'));
  return controls;
}
module.exports = { installRealCaseStub };
