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
  return (String(text).match(/\?/g) || []).length === 1 && !imperativeQuestion(text);
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
module.exports = { kind, forbiddenMeta, imperativeQuestion, naturalQuestion, singleQuestion };
