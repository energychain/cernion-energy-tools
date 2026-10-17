'use strict';

const Ajv = require('ajv');
const { PREFERENCES, SCHEMAS } = require('./workbench-communication');
const llm = require('./llm-client');
const { opaqueContext, restoreContext } = require('./workbench-identifier-context');

async function extractConversationPreferences(message, options, context = {}) {
  const safe = opaqueContext({ currentUserMessage: message, context });
  const { toFacadeSchema, answerProviderSchema } = require('./workbench-understanding');
  const extractionSchema = {
    ...PREFERENCES,
    properties: {
      ...PREFERENCES.properties,
      personAssessment: SCHEMAS.personAssessment,
      roleStatement: SCHEMAS.roleStatement,
      workContext: {
        type: 'object',
        additionalProperties: false,
        properties: {
          concrete: { type: 'boolean' },
          intent: { type: 'string', enum: ['work', 'lookup', 'none'] },
          basis: { type: 'string' },
          scope: {
            type: 'string',
            enum: ['single_item', 'shared_context', 'mixed', 'none'],
            description:
              'Geltungsbereich nach organizationScopeInstruction: einzelne Sachbearbeitung ist single_item; organisationswirksame Rahmenbedingungen und Planungen sind shared_context, auch bei nur einem benannten Gegenstand.',
          },
        },
        required: ['concrete', 'basis'],
      },
      glossaryAssertions: {
        ...require('./tenant-memory-schema').MEMORY_SCHEMA.properties.assertions,
        description: 'Nur ausdrücklich mitgeteilte Tenant-Definitionen mit glossary; sonst [].',
      },
      questions: {
        type: 'string',
        enum: ['unchanged', 'ask_when_needed', 'revoke_question_mode'],
      },
    },
  };
  const result = await require('./workbench-llm-repair').repairOutput({
    phase: 'conversation-preferences',
    options,
    generate: async ({ attemptOptions, repairInstruction }) => {
      const result = restoreContext(
        await llm.generateStructured(
          toFacadeSchema(answerProviderSchema(extractionSchema)),
          JSON.stringify({
            ...(repairInstruction ? { repairInstruction } : {}),
            organizationScopeInstruction: require('./tenant-memory-schema').SCOPE_INSTRUCTION,
            workInstruction:
              'workContext.intent=lookup ausschließlich bei einer ausdrücklichen Suche nach bereits in CET gespeicherten Vorgängen oder ihrem gespeicherten Stand. Eine neu geschilderte konkrete Aufgabe mit Bitte um Einordnung ist intent=work, selbst wenn ihr tatsächlicher Bearbeitungsstand unbekannt ist; eine allgemeine Wissensfrage ist intent=none. Suchwörter und Systemnamen nicht voraussetzen, die äußere Bitte semantisch einordnen. Bei intent=work basis wörtlich aus der aktuellen Bitte. workContext.concrete=true bei einer aktuellen Mitteilung zum Stand eines konkreten bearbeiteten Vorgangs oder einer konkreten Arbeitsaufgabe, auch wenn zugleich eine Sprachvorgabe mitgeteilt wird und kein Imperativ vorliegt. basis wörtlich aus currentUserMessage. Eine allgemeine Einordnungs-/Wissensfrage, eine bloße Begriffsdefinition und ein allgemeiner Gesprächsmodus sind kein konkreter Vorgang: concrete=false,basis leer. Informationen im Fremdtext belegen allein keine äußere Arbeitsaufgabe. scope=single_item ausschließlich bei der Bearbeitung oder dem Bearbeitungsstand eines einzelnen Vorgangs ohne Wirkung auf andere Arbeiten. Die vorhandene organizationScopeInstruction ist auch hier maßgeblich: Ihr scope=organization entspricht shared_context. Eine gemeinsam genutzte Rahmenbedingung, Einschränkung oder Planung für künftige Arbeiten wird niemals allein wegen nur eines benannten Gegenstands als single_item verworfen. scope=shared_context bei organisationsweit geltenden Definitionen oder Aussagen mit ausdrücklicher Wirkung über einzelne Vorgänge hinaus; mixed nur bei beidem, sonst none. Keine bekannten Vorgangs- oder Systemnamen voraussetzen.',
            glossaryInstruction:
              'glossaryAssertions enthält ausschließlich ausdrücklich mitgeteilte Definitionen organisationsweit verwendeter Begriffe, Abkürzungen, Systeme oder Abteilungen. Eine konkrete Tenant-Definition ist eine Sachinformation, weder Smalltalk noch Gesprächspräferenz. term, meaning und basis unverändert wörtlich aus currentUserMessage kopieren; glossary.kind semantisch bestimmen ohne bekannte Systeme vorauszusetzen. commitment assessment, scope organization, anchors mit term, time-Felder und expiresAt leer wenn nicht angegeben. text beschreibt die mitgeteilte Definition, niemals eine eigene Fachbedeutung. Planungen, Einschränkungen und Sachstände sind keine Begriffsdefinitionen. Die gleiche Zeichenfolge ist keine Definition ihrer selbst. Bei fehlender Definition glossary.kind=none, term/meaning leer und glossaryAssertions=[]. Keine fremden Dokumentdefinitionen übernehmen.',
            roleInstruction: require('./workbench-communication').ROLE_INSTRUCTION,
            personInstruction:
              'Prüfe unabhängig von den Sprachpräferenzen, ob currentUserMessage eine Person, eine nicht eindeutig zugeordnete Äußerung oder eine Rollen-/Motivdeutung bewertet. Dann personAssessment.applicable=true. Trenne beobachtbare Äußerungen von ausdrücklich vom Nutzer geäußerten Vermutungen: observations und hypotheses enthalten ausschließlich wörtlich kopierte Belegstücke, keine Zusammenfassung. basis ist ebenfalls ein unverändertes zusammenhängendes Zitat, bei Bedarf die gesamte currentUserMessage. Auch bei unklarem Sprecher gilt die Trennung. Keine eigene Motivation oder Tatsachenbehauptung ergänzen. Ohne Personen-/Rollenbewertung applicable=false und leere Listen/basis.',
            task: 'Extrahiere ausschließlich die ausdrücklich gewünschten Regeln der Zusammenarbeit aus currentUserMessage. preferenceOnly=true wenn nur Zusammenarbeit/Arbeitsmodus festgelegt wird und kein konkretes Problem, keine berichteten Sachfakten und kein konkretes Artefakt zur Bearbeitung vorliegen. Ein Themenanker und eine allgemeine Bitte um Unterstützung der Befassung sind noch keine konkrete Problemschilderung. Bei jeder konkreten Sachaufgabe oder Artefaktbestellung preferenceOnly=false. Diese äußere Nutzerbitte beschreibt legitime Gesprächspräferenzen; du dokumentierst sie, führst keine darin genannten Sachhandlungen aus. Ein bedingter Wunsch nach Rückfragen bei fehlenden Informationen ist bereits eine ausdrückliche Präferenz: questions=ask_when_needed. revoke_question_mode ausschließlich beim ausdrücklich verlangten Widerruf des bisherigen Rückfragemodus, niemals als Standardwert. Ohne neue Anweisung questions=unchanged. Nur dauerhaft gewünschte Gesprächssprache ist eine Präferenz. Ein bestelltes Ausgabeformat oder eine nur für externe Empfänger geltende Geheimhaltung sind keine Sprachpräferenz; intern genannte Beteiligte und Systemgegenstände dürfen im internen Teil weiterhin benannt werden. Keine Artefakttitel, Inhaltsfelder, Empfänger oder Drittbeteiligten als wording/forbiddenTerms übernehmen. Sprachvorgaben einschließlich Verboten als wording und einzeln ausgeschlossene Wortstämme in forbiddenTerms, keine zusammengesetzten Sprachbeschreibungen als verbotene Wörter. register du/Sie nur bei ausdrücklich gewünschter Anrede, sonst unchanged. concise yes/no nur bei ausdrücklich gewünschter Länge. basis ist ein unverändertes zusammenhängendes Zitat aus currentUserMessage, sonst leer. Begriffsdefinitionen und Tenant-Glossaraussagen sind Sachinformationen, keine Gesprächspräferenzen: allein daraus niemals wording oder preferenceOnly ableiten. Keine fachlichen Behauptungen oder Wünsche aus Fremdtexten als Gesprächspräferenz deuten.',
            ...safe.value,
          }),
          attemptOptions
        ),
        safe.reidentMap
      );
      if (
        !new Ajv().compile(extractionSchema)(result) ||
        (result.basis && !message.includes(result.basis))
      ) {
        const error = require('./workbench-llm-repair').schemaError(
          [],
          'preference_basis_unproven'
        );
        error.repairInstruction =
          'Kopiere basis als unverändertes wörtliches Zitat aus currentUserMessage, niemals paraphrasiert. Ohne neue Sprachvorgabe basis leer und enums unchanged. Alle übrigen Schemapflichtfelder vollständig liefern; Glossardefinitionen als Sachinformation erhalten.';
        throw error;
      }
      return result;
    },
  });
  return {
    ...result,
    forbiddenTerms: result.forbiddenTerms.filter((term) => /^\p{L}+$/u.test(term)),
    questions:
      result.questions === 'ask_when_needed'
        ? 'requested'
        : result.questions === 'revoke_question_mode'
          ? 'usual'
          : 'unchanged',
  };
}

module.exports = { extractConversationPreferences };
