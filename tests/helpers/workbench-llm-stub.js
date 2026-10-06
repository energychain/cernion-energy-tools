'use strict';

// Deterministic facade responses for transport/store tests; no provider/key/network.
async function generateStructured(_schema, prompt) {
  const { message, previous, catalog, messages = [] } = JSON.parse(prompt);
  const knowledge =
    /^(?:Eine unklare Nachricht)$/.test(message) ||
    /^(?:what (?:does|is|are)|was (?:ist|sind|bedeutet)|erkläre)/i.test(message);
  const smalltalk = /^(?:hallo|hi|hello|danke)[.!\s]*$/i.test(message);
  const followup =
    /^(?:entwurf bitte|draft please|antwort per mail|warum|weitere|nummer|ja|ok)/i.test(message);
  const source =
    followup && previous
      ? `${previous.concern}\n${previous.situation}`
      : /^(?:ja|yes|kannst du mir helfen)[,.!?\s]*$/i.test(message) && messages.length
        ? messages.at(-1)
        : message;
  const { classifyDomain } = require('../../src/domain-router');
  const classification = await classifyDomain({
    userRequest: source,
    knownContext: {},
    actorRoles: ['ROLE_GRID_OPERATOR'],
  });
  const domain = classification.primaryDomain;
  const body = source
    .replace(/^Weitergeleitete Mail[^:]*:\s*/i, '')
    .replace(/\s*Kannst du mir helfen\?$/i, '')
    .trim();
  return {
    concern: body.slice(0, 1000),
    situation: body.slice(0, 1000),
    participants: ['Anfragende Person', 'Gegenüber'],
    identifiers: (source.match(/\[MASKED-[^\]]+\]|99000000001/g) || []).map((value) => ({
      kind: 'Referenz',
      value,
    })),
    deadlines: source.includes('Frist überschritten')
      ? [{ value: 'Frist überschritten', basis: 'Frist überschritten' }]
      : [],
    hypotheses: catalog.domains.includes(domain)
      ? [{ kind: 'domain', id: domain, confidence: 0.9 }]
      : [],
    missingInformation: smalltalk
      ? []
      : [
          { key: 'original_reference', question: 'Welche Referenz hat die ursprüngliche Anfrage?' },
          { key: 'received_at', question: 'Wann wurde die Anfrage empfangen?' },
          {
            key: 'process_version',
            question: 'Welche Prozess- oder Dokumentversion liegt zugrunde?',
          },
          { key: 'status', question: 'Welcher Bearbeitungsstand ist dokumentiert?' },
        ],
    requestedAction: {
      description: message,
      externalEffect:
        /senden|send|versend|übermittel|schicke|per mail/i.test(message) &&
        !/nicht|keine|do not/i.test(message),
      draftRequested: /entwurf bitte|draft please/i.test(message),
    },
    turnKind: smalltalk ? 'smalltalk' : knowledge ? 'knowledge' : 'work',
    retrievalTerms: [body],
  };
}

async function generateText(prompt) {
  const { evidence = [], situation } = JSON.parse(prompt);
  return JSON.stringify({
    expectation: evidence.length
      ? [{ text: evidence[0].value.replace(/\?/g, '.'), evidenceIds: [evidence[0].evidenceId] }]
      : [],
    nextSteps: [],
    draft: situation?.requestedAction?.draftRequested
      ? 'Interner Antwortentwurf: [Geprüfte Angaben ergänzen].'
      : '',
  });
}
module.exports = { generateStructured, generateText };
