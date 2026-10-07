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
          {
            blocking: true,
            key: 'original_reference',
            question: 'Welche Referenz hat die ursprüngliche Anfrage?',
          },
          { blocking: true, key: 'received_at', question: 'Wann wurde die Anfrage empfangen?' },
          {
            blocking: true,
            key: 'process_version',
            question: 'Welche Prozess- oder Dokumentversion liegt zugrunde?',
          },
          {
            blocking: true,
            key: 'status',
            question: 'Welcher Bearbeitungsstand ist dokumentiert?',
          },
        ],
    requestedAction: {
      description: message,
      externalEffect:
        /senden|send|versend|übermittel|schicke|per mail/i.test(message) &&
        !/nicht|keine|do not/i.test(message),
      draftRequested: !knowledge && !smalltalk,
    },
    turnKind: smalltalk ? 'smalltalk' : knowledge ? 'knowledge' : 'work',
    retrievalTerms: [body],
  };
}

async function generateText(prompt) {
  const { evidence = [], situation } = JSON.parse(prompt);
  const claim = (text, ids = []) => ({
    text,
    evidenceIds: ids,
    completedAction: false,
    supported: ids.length ? 'evidence' : 'model',
    specific: false,
  });
  return JSON.stringify({
    expectation: [
      evidence.length
        ? claim(
            'Das Gegenüber erwartet eine fachliche Rückmeldung zum dokumentierten Bearbeitungsstand.',
            [evidence[0].evidenceId]
          )
        : claim('Das Gegenüber erwartet eine nachvollziehbare Antwort zum Bearbeitungsstand.'),
    ],
    nextSteps: [claim('Prüfe den bisherigen Stand und stimme den nächsten Schritt ab.')],
    draft: situation?.requestedAction?.draftRequested
      ? [
          claim(
            `Betreff: Rückmeldung zu Ihrer Anfrage\nGuten Tag,\nbitte teilen Sie uns den aktuellen Bearbeitungsstand zur Anfrage${situation.identifiers?.[0]?.value ? ' ' + situation.identifiers[0].value : ''} und den nächsten Schritt mit.\nMit freundlichen Grüßen.`
          ),
        ]
      : [],
  });
}
module.exports = { generateStructured, generateText };
