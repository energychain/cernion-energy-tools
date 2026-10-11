'use strict';

const { Errors } = require('moleculer');
const { parseOpenWebUIContext } = require('./openwebui-context');
const { maxInputChars } = require('./workbench-thread');

function documentInput(input) {
  if (typeof input !== 'string') return { question: input, documents: [] };
  const maxDocuments = Number(process.env.WORKBENCH_DOCUMENT_MAX_CHARS || 4000000);
  if (!Number.isSafeInteger(maxDocuments) || maxDocuments <= 0)
    throw new Error('Invalid document budget');
  // Bound the transport before parsing; retain every character of each source body.
  if (input.length > maxDocuments + maxInputChars() + 64000)
    throw new Errors.MoleculerClientError(
      `Das Dokument oder der Eingabetext ist zu groß. Die Aufnahmegrenze beträgt ${maxDocuments.toLocaleString('de-DE')} Zeichen. Bitte teile das Dokument auf oder sende einen kleineren Ausschnitt.`,
      422,
      'WORKBENCH_DOCUMENT_LIMIT'
    );
  const parsed = parseOpenWebUIContext(input);
  if (!parsed.documents.length && !require('./workbench-thread').isThreadInput(parsed.question)) {
    const lines = parsed.question.split(/\r?\n/);
    const trailingQuestion =
      /\?\s*$/.test(lines.at(-1)) && !/[;\t|]/.test(lines.at(-1)) ? lines.pop() : '';
    const tableText = lines.join('\n');
    if (require('./dataset-input').parseDatasetText(tableText).length) {
      parsed.documents.push({ name: 'Eingefügte Tabelle', text: tableText, id: null });
      parsed.question = trailingQuestion || 'Tabelle auswerten.';
    }
  }
  if (parsed.documents.reduce((sum, doc) => sum + doc.text.length, 0) > maxDocuments)
    throw new Errors.MoleculerClientError(
      `Das Dokument ist zu groß. Die Aufnahmegrenze beträgt ${maxDocuments.toLocaleString('de-DE')} Zeichen. Bitte teile das Dokument auf oder sende einen kleineren Ausschnitt.`,
      422,
      'WORKBENCH_DOCUMENT_LIMIT'
    );
  return {
    ...parsed,
    question: parsed.question || (parsed.documents.length ? 'Dokument aufnehmen.' : ''),
  };
}

function isReviewRequest(question) {
  return /\b(?:bewert\w*|prüf\w*|pruef\w*|review|peer[ -]?review|stellungnahme|gutachten|plausib\w*|realistisch|stimmig)\b/i.test(
    String(question)
  );
}

function documentReference(question) {
  const match = String(question).match(/\b(Seite|Page|Kapitel|Chapter)\s+(\d+(?:\.\d+)*)\b/i);
  return match ? { page: /seite|page/i.test(match[1]), number: match[2] } : null;
}

function documentDraftRequested(question) {
  const text = String(question);
  if (/\b(?:kein(?:en)?|ohne|nicht)\s+(?:einen?\s+)?(?:Entwurf|draft)\b/i.test(text)) return false;
  return (
    require('./workbench-understanding').isDraftRequest(text) ||
    /\b(?:schreib\w*|erstell\w*|formulier\w*|verfass\w*|write|create)\s+(?:mir\s+)?(?:bitte\s+)?(?:einen?\s+|a\s+|den\s+)?(?:Review[ -]?)?(?:Entwurf|draft)\b|\b(?:Entwurf\s+bitte|draft\s+please)\b/i.test(
      text
    )
  );
}

module.exports = { documentInput, isReviewRequest, documentReference, documentDraftRequested };
