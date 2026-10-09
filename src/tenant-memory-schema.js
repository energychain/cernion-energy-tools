'use strict';

const text = { type: 'string', maxLength: 1200 };
const strings = { type: 'array', maxItems: 20, items: text };
const closed = (properties) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const ANCHOR = closed({ value: text, qualifier: text, aliases: strings });
const ASSERTION = closed({
  text,
  basis: text,
  commitment: { type: 'string', enum: ['decided', 'planned', 'assessment'] },
  anchors: { type: 'array', maxItems: 20, items: ANCHOR },
  time: closed({ from: text, until: text, latest: text, earliest: text, date: text }),
  expiresAt: text,
});
const MEMORY_SCHEMA = closed({
  assertions: { type: 'array', maxItems: 5, items: ASSERTION },
  correction: closed({
    kind: { type: 'string', enum: ['none', 'corrected', 'revoked'] },
    basis: text,
    factId: text,
  }),
  query: closed({ requested: { type: 'boolean' }, anchor: text, functionLabel: text }),
});
const ASSESSMENT_SCHEMA = closed({
  relations: {
    type: 'array',
    maxItems: 10,
    items: closed({
      candidateId: text,
      kind: {
        type: 'string',
        enum: ['conflict', 'dependency', 'gap', 'confirmation', 'independent'],
      },
      reason: text,
      uncertainty: { type: 'number', minimum: 0, maximum: 1 },
      evidenceIds: strings,
      question: text,
    }),
  },
  plausibility: {
    type: 'array',
    maxItems: 5,
    items: closed({ reason: text, evidenceIds: strings }),
  },
});
const INSTRUCTION =
  'tenantMemory betrifft ausschließlich neue organisationsrelevante Aussagen der Person in der aktuellen Nachricht: Beschlüsse, organisationsweite Planungen oder Einschätzungen mit Wirkung auf andere Arbeiten. Kein Einzelfall, keine reine Frage, kein Smalltalk, kein Dokumentinhalt, keine Tabellenablage, keine Hintergrundaufgabe. assertions sonst []. basis ist ein wörtliches Belegstück der aktuellen Nachricht, text der unverfälschte Kern. commitment unterscheidet beschlossen, geplant und Einschätzung. anchors enthalten Begriffe in der Schreibweise des Tenants, optional qualifier und belegte Schreibvarianten in aliases; keine globale Eindeutigkeitsprüfung, keine Ankertypen bevorzugen. Zeitangaben wörtlich unter from/until/latest/earliest/date; expiresAt nur ein ausdrücklich genanntes Ende der Gültigkeit als ISO-Datum, kein Fristdatum als Ablauf deuten. Organisationsrelevante Aussagen erhalten turnKind work auch ohne ausdrücklichen Arbeitsauftrag. Keine Aussage aus früheren Turns wiederholen. correction nur bei ausdrücklicher Korrektur oder Widerruf einer festgehaltenen Aussage, basis wörtlich; factId nur wenn genannt, sonst leer (letzte eigene Aussage). Bei Korrektur ersetzende neue Aussage in assertions. query.requested bei Fragen zum Tenant-Gedächtnis; anchor oder functionLabel aus der Frage, sonst leer.';
module.exports = { MEMORY_SCHEMA, ASSESSMENT_SCHEMA, INSTRUCTION };
