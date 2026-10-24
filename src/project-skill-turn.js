'use strict';

const { learnedSkillScope, answerSkills } = require('./workbench-project-skills');
async function projectSkillTurn(service, ctx, { p, envelope, pending }) {
  const scope = learnedSkillScope(envelope.userRequest);
  if (scope)
    return {
      state: 'assistance',
      nonBinding: true,
      ...(await answerSkills(ctx, scope)),
      sources: [],
    };
  const selection = pending?.projectSkillSelection;
  if (!selection) return null;
  const text = envelope.userRequest.trim();
  const retire = /^(?:bitte\s+)?(?:(?:diesen?\s+)?(?:skill|check)\s+)?stilllegen[.!\s]*$/iu.test(
    text
  );
  const incorrect = /^(?:das\s+)?passt nicht[.!\s]*$/iu.test(text);
  if (!retire && !incorrect) return null;
  await ctx.call('shared-service-learning.apply', {
    target: 'projectSkill',
    correction: { ...selection, kind: retire ? 'retire' : 'incorrect' },
  });
  await require('./workbench-conversation').saveTurn(service.conversationsDb, p, envelope, {
    projectSkillSelection: retire ? null : selection,
  });
  return {
    state: 'assistance',
    nonBinding: true,
    responseText: retire
      ? 'Der gelernte Check ist stillgelegt. Die Korrektur ist im Journal gespeichert.'
      : 'Die Korrektur ist im Journal gespeichert. Der Check ist herabgestuft und wird neu entworfen; bis zur bestandenen Prüfung nutze ich ihn nicht.',
    sources: [],
  };
}
module.exports = { projectSkillTurn };
