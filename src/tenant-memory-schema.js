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
  basis: {
    ...text,
    description:
      'Zusammenhängendes wörtliches Zitat aus der aktuellen Nachricht. Unverändert kopieren; niemals zusammenfassen oder umformulieren.',
  },
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
MEMORY_SCHEMA.properties.functionLabel = {
  ...text,
  description:
    'Funktion der mitteilenden Person in deutschem Klartext, nur aus Nachricht oder Mapping, sonst leer. Keine technischen Funktionslabels.',
};
MEMORY_SCHEMA.properties.assertions.description =
  'Alle neuen organisationsrelevanten Mitteilungen erfassen, auch fachlich zweifelhafte oder regelwidrige. Festhalten dokumentiert die Aussage der Person und bestätigt nicht deren Richtigkeit. Plausibilität wird separat geprüft.';
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
// Structured effect summaries make indirect dependencies explicit before the final judgment.
// Optional locally to keep existing facade fixtures and stored judgments compatible.
ASSESSMENT_SCHEMA.properties = {
  effects: {
    type: 'array',
    maxItems: 10,
    items: closed({
      candidateId: text,
      possibleConsequence: text,
      affectedWork: text,
      availabilityLimit: text,
    }),
  },
  ...ASSESSMENT_SCHEMA.properties,
};
const INSTRUCTION =
  'Festhalten und fachliche Zustimmung sind unabhängig: Erfasse organisationsrelevante Mitteilungen auch dann in tenantMemory.assertions, wenn du ihnen fachlich widersprichst oder sie als unplausibel einschätzt. Niemals wegen eines fachlichen Einwands assertions leeren. Gib die behauptete Einschränkung unverfälscht als Aussage der Person wieder; die spätere Prüfung ergänzt den Plausibilitätshinweis. functionLabel benennt die Funktion auf Deutsch aus der Nachricht oder dem Mapping, sonst leer. tenantMemory betrifft ausschließlich neue organisationsrelevante Aussagen der Person in der aktuellen Nachricht: Beschlüsse, Planungen, Kapazitätsgrenzen oder Einschätzungen mit Wirkung auf andere oder künftige Arbeiten. Eine örtlich begrenzte Aussage ist organisationsrelevant, wenn sie mehrere künftige Vorgänge, andere Funktionen oder die Planung betrifft; sie muss nicht die gesamte Organisation betreffen. Nur ein einzelner erledigter Vorgang ohne solche Wirkung ist ein Einzelfall. Keine reine Frage, kein Smalltalk, kein Dokumentinhalt, keine Tabellenablage, keine Hintergrundaufgabe. assertions sonst []. basis ist ein wörtliches Belegstück der aktuellen Nachricht, text der unverfälschte Kern. commitment unterscheidet beschlossen, geplant und Einschätzung. anchors enthalten Begriffe in der Schreibweise des Tenants, optional qualifier und belegte Schreibvarianten in aliases; qualifier nur als ausdrücklich genannter Teil des Ankernamens, nie als Kategorie der Aussage oder Arbeitsbereich; keine globale Eindeutigkeitsprüfung, keine Ankertypen bevorzugen. Zeitangaben wörtlich unter from/until/latest/earliest/date; expiresAt nur ein ausdrücklich genanntes Ende der Gültigkeit als ISO-Datum, kein Fristdatum als Ablauf deuten. Organisationsrelevante Aussagen erhalten turnKind work auch ohne ausdrücklichen Arbeitsauftrag. Keine Aussage aus früheren Turns wiederholen. correction nur bei ausdrücklicher Korrektur oder Widerruf einer festgehaltenen Aussage, basis wörtlich; factId nur wenn genannt, sonst leer (letzte eigene Aussage). Bei Korrektur ersetzende neue Aussage in assertions. query.requested bei Fragen zum Tenant-Gedächtnis; anchor oder functionLabel aus der Frage, sonst leer.';
module.exports = { MEMORY_SCHEMA, ASSESSMENT_SCHEMA, INSTRUCTION };
