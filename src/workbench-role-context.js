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

function roleConfirmation(situation, message) {
  if (
    !situation.roleContextUpdated ||
    !situation.roleStatement?.roleOnly ||
    situation.requestedOutput?.requested ||
    situation.personAssessment?.applicable ||
    !message.includes(situation.conversationContext.basis)
  )
    return '';
  const response = `Ich richte mich auf diesen Arbeitskontext aus: „${situation.conversationContext.basis}“\n\n${situation.conversationPreferences?.register === 'Sie' ? 'Sie können' : 'Du kannst'} Rolle, Auftrag und Ziel jederzeit korrigieren.`;
  return require('./workbench-communication').forbiddenWording(
    response,
    situation.conversationPreferences?.forbiddenTerms
  )
    ? ''
    : response;
}

module.exports = { selectRoleStatement, applyRoleContext, roleConfirmation };
