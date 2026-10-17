'use strict';

function selectRoleStatement(primary, refinement) {
  const candidates = [primary, refinement].filter(Boolean);
  return (
    candidates.find((item) => ['other_person', 'mixed'].includes(item.subject)) ||
    candidates.find((item) => item.subject === 'self') ||
    primary
  );
}

function applyRoleContext(situation, message, previous, asked = []) {
  const statement = situation.roleStatement;
  if (!statement || statement.subject !== 'self') return;
  const openQuestion = asked.find(
    (item) =>
      item.kind === 'role' &&
      item.key === statement.answersQuestionKey &&
      item.answered !== true &&
      !previous?.missingInformation?.some(
        (prior) => prior.key === item.key && prior.answered === true
      )
  );
  if (
    (!statement.firstPerson && !openQuestion) ||
    !statement.basis?.trim() ||
    !statement.role?.trim() ||
    !message.includes(statement.basis) ||
    ![statement.role, statement.mandate, statement.goal].every(
      (value) => typeof value === 'string' && (!value || statement.basis.includes(value))
    )
  )
    return;
  situation.conversationContext = {
    ...previous?.conversationContext,
    preference: previous?.conversationContext?.preference || '',
    role: statement.role,
    mandate: statement.mandate,
    goal: statement.goal,
    basis: statement.basis,
    durable: false,
  };
  situation.roleContextUpdated = true;
  if (statement.roleOnly && !situation.requestedOutput?.requested) {
    situation.turnKind = 'knowledge';
    situation.conversationShape = 'orientation';
    situation.requestedAction = { description: '', externalEffect: false, draftRequested: false };
  }
  situation.personAssessment = { applicable: false, observations: [], hypotheses: [], basis: '' };
  if (openQuestion) {
    situation.missingInformation = [
      ...(situation.missingInformation || []).filter((item) => item.key !== openQuestion.key),
      { ...openQuestion, answered: true },
    ];
  }
}

async function readRoleUpdate(p, envelope, pending, options = {}) {
  if (!pending?.conversationContext?.role) return null;
  const understanding = require('./workbench-understanding');
  const preferences =
    await require('./workbench-preference-extraction').extractConversationPreferences(
      envelope.userRequest,
      understanding.llmOptions(p.tenantId),
      {
        conversationContext: pending.conversationContext,
        askedQuestions: pending.askedQuestions || [],
      }
    );
  const previous = {
    participants: [],
    identifiers: [],
    deadlines: [],
    ...require('./workbench-turn-scope').persistentSituation(pending.situation),
    conversationContext: pending.conversationContext,
  };
  if (['orientation', 'knowledge'].includes(pending.lastConversationShape))
    previous.turnKind = 'knowledge';
  // Use the same merged self-subject recognition as an initial role statement.
  const situation = await understanding.understand({
    ...options,
    message: envelope.userRequest,
    previous,
    asked: pending.askedQuestions || [],
    tenantId: p.tenantId,
    preferenceExtraction: preferences,
  });
  return { preferences, situation, updated: situation.roleContextUpdated === true };
}

function roleConfirmation(situation, message, context = situation.conversationContext) {
  if (
    !situation.roleContextUpdated ||
    situation.personAssessment?.applicable ||
    !context?.basis ||
    !message.includes(context.basis)
  )
    return '';
  const details = [
    `Rolle „${context.role}“`,
    context.mandate && `Auftrag „${context.mandate}“`,
    context.goal && `Ziel „${context.goal}“`,
  ]
    .filter(Boolean)
    .join('; ');
  const response = `Ich richte mich auf diesen Arbeitskontext aus: ${details}.\n\n${situation.conversationPreferences?.register === 'Sie' ? 'Sie können' : 'Du kannst'} Rolle, Auftrag und Ziel jederzeit korrigieren.`;
  return require('./workbench-communication').forbiddenWording(
    response,
    situation.conversationPreferences?.forbiddenTerms
  )
    ? ''
    : response;
}

module.exports = { selectRoleStatement, applyRoleContext, readRoleUpdate, roleConfirmation };
