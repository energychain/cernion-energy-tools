'use strict';
const { compoundQuestion } = require('../src/workbench-conversation-shape');
function singlePoint(responseText) {
  return !String(responseText)
    .split('\n\n')
    .filter((paragraph) => paragraph.includes('?'))
    .some(compoundQuestion);
}
function temporalGrounded(responseText, facts, situation) {
  // An explicit question offers alternatives; it does not assert either one.
  const statements = (situation?.missingInformation || []).reduce(
    (text, item) => (item.question ? text.replaceAll(item.question, '') : text),
    String(responseText)
  );
  return !require('../src/workbench-answer-filter').unsupportedEarlierDate(statements, facts);
}
function summaryPresent(responseText) {
  const overview = String(responseText)
    .split('Entwurf:')[0]
    .split('\n\n')
    .filter(
      (paragraph) =>
        !/^Ich gehe davon aus|^Den\b/iu.test(paragraph) &&
        !/\b(?:prüfen|übermitteln|einholen|versenden|ermitteln|bitten|überwachen|einleiten|vorbereiten|nachhalten)\.?$/iu.test(
          paragraph.trim()
        )
    )
    .slice(0, 2)
    .join('\n');
  return /Eingangsbestätigung|(?:fachlich|inhaltlich).{0,180}(?:aussteh|steht.{0,40}aus|kein|nicht)|(?:aussteh|kein|nicht).{0,180}(?:fachlich|inhaltlich)/isu.test(
    overview
  );
}

function memoryNoticeCount(reply) {
  return (reply.metadata?.notices || []).filter((item) => item.kind === 'memory').length;
}
module.exports = { singlePoint, temporalGrounded, summaryPresent, memoryNoticeCount };
