'use strict';

// Conversational requests use the same effect kinds as operation governance.
// These are action verbs, independent of any subject area or delivery channel.
function classifyRequestedEffect(message) {
  const text = String(message || '').trim();
  const sentences = text.split(/[.!?\n]+/);
  if (
    sentences.some(
      (sentence) =>
        /(?<!\p{L})(send|deliver|transmit|submit|publish|sende[n]?|schick(?:e|en)?|versend(?:e|en)?|übermitt(?:le|eln)|veröffentliche[n]?)(?!\p{L})/iu.test(
          sentence
        ) && !/\b(no|not|never|nicht|nie|kein\w*)\b/i.test(sentence)
    )
  )
    return 'external_effect';
  if (/\b(draft|entwurf|entwerfen|formulieren)\b/i.test(text)) return 'draft_write';
  return 'advisory_plan';
}

module.exports = { classifyRequestedEffect };
