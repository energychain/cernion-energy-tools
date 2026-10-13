'use strict';

const { internalToolText } = require('./workbench-tool-answer');

// Fail closed at the notice boundary. No model call is needed to deliver a notice.
function humanNoticeText(text) {
  if (!text || internalToolText(text)) return false;
  if (
    /\b(?:internal|review|proposal|requires|blocking|breaches|warnings|handover|process|pending|failed)\b/iu.test(
      text
    )
  )
    return false;
  if (/\b(?:Sie|Ihnen|Ihr(?:e|en|em|er|es)?)\b/u.test(text)) return false;
  return /\b(?:der|die|das|ist|sind|wird|werden|dein\p{L}*|du|für|eine?\p{L}*|kein\p{L}*|bei|mit|bis|am|auf|hat|haben|offen)\b/iu.test(
    text
  );
}

function needsFunctionChoices(message, reply = {}) {
  return (
    /\b(?:welche|zeige?|nenn\p{L}*|passende?|verfügbare?)\b.{0,70}\b(?:Funktionen?|Abläufe|Ablauf)\b/iu.test(
      message
    ) || Boolean(reply.requiresFunctionChoice)
  );
}

function queryDetailsOnly(message) {
  return /^(?:bitte\s+)?(?:zeig\w*(?:\s+mir)?\s+(?:den|die)\s+)?(?:rechenweg|details|abfrageblock|berechnungsschritte)[.!?\s]*$/iu.test(
    String(message).trim()
  );
}

function requestsQueryDetails(message) {
  return /\b(?:Rechenweg|Abfrageblock|Berechnungsschritte|Details)\b/iu.test(message);
}

function unsolicitedAdvice(text, message = '') {
  if (
    /\b(?:empfiehl|empfehl\p{L}*|nächste\p{L}* Schritt\p{L}*|weiter\p{L}* Analys\p{L}*)\b/iu.test(
      message
    )
  )
    return false;
  return /\b(?:bei Bedarf|gegebenenfalls|ggf\.?|optional)\b.{0,100}\b(?:prüf\p{L}*|analys\p{L}*|klär\p{L}*|könn\p{L}*|weiter\p{L}*)\b|\b(?:prüf\p{L}*|analys\p{L}*|klär\p{L}*)\b.{0,60}\b(?:bei Bedarf|gegebenenfalls|ggf\.?|optional)\b|\b(?:für|zu) weitere\p{L}* Analys\p{L}*/iu.test(
    text
  );
}

function withoutUnsolicitedAdvice(text, message = '') {
  const original = String(text || '');
  const sentences = original.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/u);
  const kept = sentences.filter((sentence) => !unsolicitedAdvice(sentence, message));
  return kept.length === sentences.length ? original : kept.join(' ');
}

function completeDraft(text, displayName = '') {
  const name =
    typeof displayName === 'string' && !internalToolText(displayName) ? displayName.trim() : '';
  return String(text || '')
    .replace(/\[([^\]\n]+)\]/gu, (_all, value) => {
      const label = value.replace(/^…\s*/, '').trim();
      if (
        /^(?:Name|Ihr Name(?:\s*[/|]\s*(?:Team|Abteilung))?|dein Name|Absender(?:name)?|Unterschrift|Signatur)$/iu.test(
          label
        )
      )
        return name || '[… Anzeigename]';
      const translated = label.replace(
        /\b(?:reference(?:[ _]?number)?|date|signature|missing|document|information)\b/giu,
        (word) =>
          ({
            reference: 'Referenz',
            referencenumber: 'Referenznummer',
            date: 'Datum',
            signature: 'Signatur',
            missing: 'Fehlende',
            document: 'Unterlage',
            information: 'Angabe',
          })[word.replace(/[ _]/g, '').toLowerCase()] || 'Angabe'
      );
      const words = (translated || 'Fehlende Angabe')
        .replaceAll('_', ' ')
        .toLocaleLowerCase('de-DE');
      return `[… ${words.charAt(0).toLocaleUpperCase('de-DE')}${words.slice(1)}]`;
    })
    .replace(
      /((?:Mit freundlichen Grüßen|Freundliche Grüße|Viele Grüße|Beste Grüße)[,!]?[ \t]*\n)[^\n]+(?:\n(?!\n)[^\n]+)*(?=\n\n|$)/gu,
      (all, greeting) => (name ? `${greeting}${name}` : all)
    )
    .replace(
      /((?:Mit freundlichen Grüßen|Freundliche Grüße|Viele Grüße|Beste Grüße)[,!]?\s*)(?=\n\n|$)/gu,
      (all) => (name ? `${all.trimEnd()}\n${name}` : all)
    );
}

function mappedDisplayName(mapping, meta = {}) {
  if (mapping)
    return mapping.displayName || mapping.name || mapping.actorId || mapping.openWebuiUserId || '';
  const auth = meta.authUser || meta.apiToken || {};
  return auth.displayName || auth.name || '';
}

module.exports = {
  humanNoticeText,
  needsFunctionChoices,
  requestsQueryDetails,
  queryDetailsOnly,
  unsolicitedAdvice,
  withoutUnsolicitedAdvice,
  completeDraft,
  mappedDisplayName,
};
