'use strict';

// Classification comes from the semantic situation, never from phrase matching.
function kind(situation) {
  return (
    situation.conversationShape ||
    (situation.responseMode === 'conversation'
      ? 'assistance'
      : ['knowledge', 'smalltalk'].includes(situation.turnKind)
        ? 'knowledge'
        : 'task')
  );
}
function forbiddenMeta(text) {
  return /\b(?:der Nutzer|den Nutzer|der Anfragende|den Anfragenden|es wird erwartet|es wird angenommen)\b/iu.test(
    text
  );
}
function imperativeQuestion(text) {
  return /(?:^|[.!\n]\s*)(?:bitte\s+)?(?:nenne|nenn|kläre\s+(?:den\s+)?(?:anwendungsfall|dein|deine)|klaere\s+(?:den\s+)?(?:anwendungsfall|dein|deine)|teile\s+mit|gib\s+(?:mir\s+)?an)\b/iu.test(
    text
  );
}
function naturalQuestion(text) {
  return (
    (String(text).match(/\?/g) || []).length === 1 &&
    !imperativeQuestion(text) &&
    !compoundQuestion(text)
  );
}
function compoundQuestion(text) {
  // A coordinated second predicate asks another independent question. Lists of
  // choices ("Überblick und Prüfung oder Entwurf") have no second predicate.
  return /\b(?:und|sowie)\s+(?:[\p{L}\p{N}-]+\s+){0,3}(?:verfüg\p{L}*|beträg\p{L}*|betragen|lieg\p{L}*|sind|w[eu]rd\p{L}*|ist|hat|haben|besteh\p{L}*|wann|welche\p{L}*|wie|wer|wo)\b/iu.test(
    text
  );
}

// Other contributors may add a case-selection or memory question. Give it priority,
// and retain only the question actually shown, so hidden questions can be asked later.
function singleQuestion(text, questions = [], priority = '') {
  const selected = priority || questions[0]?.question || '';
  let kept = false;
  const responseText = String(text)
    .split(/\n\n/)
    .filter((paragraph) => {
      if (!paragraph.includes('?')) return !forbiddenMeta(paragraph);
      if (!naturalQuestion(paragraph) || kept) return false;
      if (selected && !paragraph.includes(selected)) return false;
      kept = true;
      return true;
    })
    .join('\n\n');
  return { responseText, questions: kept && !priority ? questions.slice(0, 1) : [] };
}
module.exports = {
  kind,
  forbiddenMeta,
  imperativeQuestion,
  naturalQuestion,
  compoundQuestion,
  singleQuestion,
};
