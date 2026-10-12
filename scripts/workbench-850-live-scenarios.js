'use strict';

const { getFunctionModel } = require('../src/function-model');
const fixtures = require('../tests/fixtures/workbench-850.generated.json');

// Synthetic source inside the isolated live broker, never an external inbox.
async function seedInternalReview(broker, tenantId, actorId) {
  const functionId = getFunctionModel().functions[0].functionId;
  const ref = `synthetic-review-${actorId}`;
  if (!broker.getLocalService('shared-service-agent'))
    broker.createService({
      name: 'shared-service-agent',
      methods: {
        readDocument: async (tenantId) => ({ tenantId, agents: [] }),
        resolvedAgents: (agents) => agents,
      },
    });
  const source = broker.getLocalService('shared-service-agent');
  const original = source.readDocument.bind(source);
  source.readDocument = async (requestedTenant) => {
    const doc = await original(requestedTenant);
    if (requestedTenant !== tenantId) return doc;
    return {
      ...doc,
      agents: [
        ...doc.agents,
        {
          agentId: ref,
          functionId,
          proposals: [
            {
              ref,
              recipients: [actorId],
              summary: fixtures.internalNotice,
              internalReview: true,
              outcome: null,
            },
          ],
        },
      ],
    };
  };
  const notices = broker.getLocalService('notices');
  await notices.serialize(async () => {
    const doc = await notices.read(tenantId, actorId);
    const sequence = ++doc.sequence;
    doc.queue.push({
      kind: 'proposal',
      ref: `V-${sequence}`,
      sequence,
      turn: doc.turn,
      eventKey: ref,
      objectRef: ref,
      agentId: ref,
      functionId,
      modelSourceHash: notices.model.sourceHash,
    });
    await notices.save(doc);
  });
  return ref;
}

async function withheldReviewCheck(broker, tenantId, actorId, eventKey) {
  const doc = await broker.getLocalService('notices').read(tenantId, actorId);
  return (
    doc.queue.some((item) => item.eventKey === eventKey) &&
    !doc.history.some((item) => item.eventKey === eventKey) &&
    doc.audit?.some((item) => item.eventKey === eventKey && item.delivered === false)
  );
}

async function validatePolishContent({ send, minutes, mail, report, actor = 'ben' }) {
  const summary = await send(
    actor,
    `<context><source name="synthetic-minutes.txt">${minutes}</source></context><user_query>${fixtures.summaryQuestion}</user_query>`
  );
  report.checks.polish850_2 = !/Optional passende Funktion|evidence queue/iu.test(
    summary.responseText
  );
  const draftChat = 'synthetic-850-draft';
  await send(actor, mail, draftChat);
  const draft = await send(actor, fixtures.draftQuestion, draftChat);
  report.checks.polish850_7 =
    /(?:Grüßen|Grüße)\s+ben/u.test(draft.responseText) && !/\[Name\]/u.test(draft.responseText);
}

async function validatePolishDataset({ send, report, actor = 'ben' }) {
  const csv = require('./generate-dataset-fixtures').generateDatasetFixture();
  const file = await require('../src/file-channel-extract').extractOriginal({
    extension: 'csv',
    name: 'synthetic-850.csv',
    contentBase64: Buffer.from(csv).toString('base64'),
  });
  for (const [channel, content] of [
    ['text', csv],
    ['file', file.text],
  ]) {
    const conversation = `synthetic-850-${channel}`;
    const first = await send(
      actor,
      `<context><source name="synthetic-850.csv">${content}</source></context><user_query>${fixtures.peakQuestion}</user_query>`,
      conversation
    );
    const followup = await send(actor, fixtures.peakQuestion, conversation);
    report.checks[`polish850_4_${channel}`] = [first, followup].every(
      (result) =>
        (result.responseText.match(/1\.243,7\s*kW/gu) || []).length === 1 &&
        result.responseText.includes('Herkunft:') &&
        !/Die Abfrage umfasst|bei Bedarf|Für weitere Analysen/iu.test(result.responseText)
    );
  }
}
module.exports = {
  seedInternalReview,
  withheldReviewCheck,
  validatePolishContent,
  validatePolishDataset,
};
