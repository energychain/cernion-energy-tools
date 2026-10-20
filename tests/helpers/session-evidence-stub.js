'use strict';

const llm = require('../../src/llm-client');
const { complete, validate } = require('./workbench-schema-stub');

function model(schema, raw, classification, internalAnswerField, realistic) {
  const input = JSON.parse(raw);
  let value = {};
  if (input.task === 'evidence_request_kind') value = { contentRequested: true };
  else if (input.task === 'evidence_reference_resolution')
    value = {
      sourceIds:
        input.question.includes('Standort Nord') && !input.question.includes('Temperatur')
          ? input.currentSources.map((entry) => entry.id)
          : [],
    };
  else if (input.cases)
    value = {
      caseIds: input.cases
        .filter((entry) => JSON.stringify(entry).includes('Depot West'))
        .map((entry) => entry.caseId),
    };
  else if (input.nodes) {
    const sources = [input.nodes[0].nodeId];
    value = {
      summary: { text: 'Archivierte Grundlage', sources },
      entities: [],
      timeRanges: [],
      externalLinks: [],
      questionTypes: [
        {
          id: 'read',
          description: realistic
            ? 'Standort Nord Bestand Zuordnung'
            : 'Standort Nord Bestand Einordnung',
          inputs: [],
          skillRefs: [],
          sources,
        },
      ],
    };
  } else if (schema.properties?.timezone)
    value = {
      title: 'Standort Nord',
      description: 'Bestand',
      anchors: ['Standort Nord'],
      timezone: 'Europe/Berlin',
      timeField: 'Datum',
      intervalConvention: 'begin',
      units: { Datum: '', 'Bestand (kg)': 'kg' },
      assumptions: [],
    };
  else if (input.sourceId && input.profile)
    value = {
      sources: [{ alias: 'source', sourceId: input.sourceId }],
      operations: [
        {
          op: 'aggregate',
          groupBy: [],
          metrics: [{ fn: 'max', field: 'Bestand (kg)', as: 'maximum' }],
        },
        { op: 'limit', count: 10 },
      ],
    };
  else if (input.datasets && !input.nodes)
    value = { datasetIds: input.datasets.map((entry) => entry.id) };
  else if (input.untrustedEvidence)
    value = {
      answer: input.untrustedEvidence
        .map(
          (entry) => `${entry.value} (${entry.metadata.sourceLabel}, ${entry.metadata.location}).`
        )
        .join(' '),
    };
  else if (schema.properties?.concern) {
    const north = input.message.includes('Standort Nord');
    value = {
      concern: north
        ? realistic
          ? 'Bestand am Standort Nord'
          : 'Standort Nord'
        : 'Temperatur im Depot West',
      situation: north
        ? 'Für den Bestand am Standort Nord wird die konkrete fachliche Einordnung angefragt.'
        : 'Für die Temperatur im Depot West wird die konkrete fachliche Einordnung angefragt.',
      caseSearch: {
        requested: input.message.includes('Welche Einordnung zur Temperatur'),
        query: input.message,
      },
      turnKind: classification,
      conversationShape: 'knowledge',
      requestedAction: {
        description: internalAnswerField ? 'Prüfung der Einordnung zum Gegenstand durchführen' : '',
        externalEffect: false,
        draftRequested: false,
      },
      missingInformation: [],
      caseMemory: {
        applicable: true,
        topic: north
          ? realistic
            ? 'Bestand am Standort Nord'
            : 'Standort Nord'
          : 'Temperatur im Depot West',
        status: north
          ? realistic
            ? 'Bestand beträgt 80 kg, Zuordnung offen'
            : 'Einordnung des Bestands'
          : 'Neu angefragt',
        openPoints: [],
        assumptions: [],
        risks: [],
        nextSteps: [],
      },
    };
  } else if (input.task === 'turn_controls')
    value = {
      caseSearch: {
        requested: input.message.includes('Welche Einordnung zur Temperatur'),
        query: input.message,
      },
      turnKind: classification === 'work' ? 'work_on_concrete_case' : 'knowledge_or_orientation',
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
  else if (input.currentUserMessage)
    value = {
      basis: '',
      register: 'unchanged',
      concise: 'unchanged',
      questions: 'unchanged',
      wording: [],
      forbiddenTerms: [],
      preferenceOnly: false,
    };
  return validate(schema, complete(schema, value));
}

function installSessionStub({ realistic = false } = {}) {
  const errors = [];
  const controls = { classification: 'work', errors, inputs: [] };
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    try {
      controls.inputs.push(JSON.parse(raw));
      return model(schema, raw, controls.classification, controls.internalAnswerField, realistic);
    } catch (error) {
      errors.push(error.message);
      throw error;
    }
  });
  llm.generateText.mockImplementation(async (raw) => {
    const input = JSON.parse(raw);
    controls.inputs.push(input);
    if (!input.schema) throw new Error('Unexpected unstructured task');
    const north = JSON.stringify(input).includes('Standort Nord');
    if (controls.internalAnswerField || (realistic && north && !input.message?.includes('80 kg'))) {
      const text =
        !controls.internalAnswerField || controls.internalAnswerField === 'situation'
          ? input.situation.situation
          : input.situation.requestedAction.description;
      return JSON.stringify(
        validate(
          input.schema,
          complete(input.schema, {
            interpretation: [
              {
                text: `Guten Tag, ${text}`,
                origin: 'model',
                supported: 'model',
                completedAction: false,
                specific: false,
                evidenceIds: [],
              },
            ],
          })
        )
      );
    }
    return JSON.stringify(
      validate(
        input.schema,
        complete(input.schema, {
          interpretation: north
            ? [
                {
                  text: 'Der Bestand beträgt 80 kg; die Zuordnung ist offen.',
                  origin: 'input',
                  inputQuote: 'Der Bestand beträgt 80 kg.',
                  supported: 'model',
                  completedAction: false,
                  specific: false,
                  evidenceIds: [],
                },
              ]
            : [],
          expectation: [],
          nextSteps: [],
          assumptions: [],
          draft: [],
        })
      )
    );
  });
  llm.generateChat.mockRejectedValue(new Error('Unexpected chat task'));
  return controls;
}
module.exports = { installSessionStub };
