'use strict';

const llm = require('../../src/llm-client');
const { complete, validate } = require('./workbench-schema-stub');

function model(schema, raw, classification) {
  const input = JSON.parse(raw);
  let value = {};
  if (input.task === 'evidence_request_kind') value = { contentRequested: true };
  else if (input.task === 'evidence_reference_resolution')
    value = {
      sourceIds:
        input.question.includes('Standort Nord') && input.previousSourceIds.length
          ? input.currentSources.map((entry) => entry.id)
          : [],
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
          description: 'Standort Nord Bestand Einordnung',
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
      concern: north ? 'Standort Nord' : 'Depot West',
      situation: 'Der Benutzer möchte vorhandene Angaben einordnen.',
      turnKind: classification,
      conversationShape: 'knowledge',
      requestedAction: { description: '', externalEffect: false, draftRequested: false },
      missingInformation: [],
      caseMemory: {
        applicable: true,
        topic: north ? 'Standort Nord' : 'Depot West',
        status: 'Einordnung des Bestands',
        openPoints: [],
        assumptions: [],
        risks: [],
        nextSteps: [],
      },
    };
  } else if (input.task === 'turn_controls')
    value = {
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

function installSessionStub() {
  const errors = [];
  const controls = { classification: 'work', errors };
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    try {
      return model(schema, raw, controls.classification);
    } catch (error) {
      errors.push(error.message);
      throw error;
    }
  });
  llm.generateText.mockImplementation(async (raw) => {
    const input = JSON.parse(raw);
    if (!input.schema) throw new Error('Unexpected unstructured task');
    const north = JSON.stringify(input).includes('Standort Nord');
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
