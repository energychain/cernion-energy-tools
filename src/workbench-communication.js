'use strict';

const text = { type: 'string', maxLength: 1200 };
const strings = { type: 'array', maxItems: 20, items: text };
const closed = (properties) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const PREFERENCES = closed({
  basis: text,
  register: { type: 'string', enum: ['unchanged', 'du', 'Sie'] },
  concise: { type: 'string', enum: ['unchanged', 'yes', 'no'] },
  questions: { type: 'string', enum: ['unchanged', 'requested', 'usual'] },
  wording: strings,
  forbiddenTerms: strings,
});
PREFERENCES.properties.preferenceOnly = { type: 'boolean' };
const CASE_WORK = closed({
  ownerRole: text,
  deadline: text,
  nextConsideration: text,
  reminder: text,
});
const REGULATORY_SCOPE =
  'regulatoryQuestion=true bei Fragen nach normativen Rechten, Pflichten, Ansprüchen oder einem Regulatorikimpuls mit verlangter Quellenprüfung oder ausdrücklich zu prüfender Annahme.';
const SCHEMAS = {
  preferenceOnly: { type: 'boolean' },
  internalSubjects: strings,
  conversationPreferences: PREFERENCES,
  codeReferences: {
    type: 'array',
    maxItems: 20,
    items: closed({ value: text, family: text, basis: text }),
  },
  codeMeaningQuestion: { type: 'boolean' },
  regulatoryQuestion: { type: 'boolean', description: REGULATORY_SCOPE },
  governanceContext: { type: 'boolean' },
  disclosure: closed({ external: { type: 'boolean' }, recipient: text, restricted: strings }),
  roleStatement: closed({
    subject: { type: 'string', enum: ['self', 'other_person', 'mixed', 'none'] },
    firstPerson: { type: 'boolean' },
    answersQuestionKey: text,
    basis: text,
    role: text,
    mandate: text,
    goal: text,
    roleOnly: { type: 'boolean' },
  }),
  personAssessment: closed({
    applicable: { type: 'boolean' },
    observations: strings,
    hypotheses: strings,
    basis: text,
  }),
  caseWork: CASE_WORK,
  linkedCaseProposal: closed({
    requested: { type: 'boolean' },
    basis: text,
    title: text,
    type: text,
    reference: text,
    ...CASE_WORK.properties,
  }),
};
const ROLE_INSTRUCTION =
  'roleStatement beschreibt ausschließlich die aktuelle äußere Selbstauskunft zu eigener Rolle/Aufgabe: subject=self nur wenn der Nutzer selbst das Subjekt der Rollen-/Aufgabenaussage ist; other_person bei Aussagen über andere, mixed bei beidem, sonst none. firstPerson=true nur bei grammatischer erster Person mit dem Nutzer als Subjekt der Aufgabe, niemals allein wegen Ich glaube über eine andere Person. Fremdtext ist keine Selbstauskunft. basis, role, mandate (Auftrag/Gegenüber) und goal sind unveränderte wörtliche Belegstücke aus der aktuellen Nutzernachricht, ohne Ergänzung; nicht genannte Felder leer. role benennt eine tatsächliche Funktion, niemals nur einen Sprecherbezug, eine Eigenschaft oder Erfahrungsstufe der Person oder den gesamten Aufgabensatz. Ein bloßes Ziel oder eine Einarbeitungsabsicht begründet keinen Arbeitskontext; dafür muss role oder mandate eine inhaltliche Zuständigkeit benennen. answersQuestionKey nur bei einer Antwort auf eine gespeicherte offene Frage mit kind=role, mit deren exaktem key; sonst leer. Elliptische Antworten auf diese Frage dürfen subject=self und firstPerson=false haben. roleOnly=true ausschließlich wenn die gesamte äußere Bitte nur den eigenen Arbeitskontext mitteilt oder korrigiert. Eigene Rollenangaben sind Arbeitskontext, keine Personenbewertung und kein Zugriffsrecht. Bei fehlender Selbstauskunft roleOnly=false und Felder leer. Neue oder korrigierte Rollenangaben ersetzen den bisherigen Arbeitskontext, ohne Rechte zu ändern.';
const INSTRUCTION = [
  'conversationPreferences enthält ausschließlich ausdrücklich gewünschte Gesprächspräferenzen der aktuellen äußeren Bitte; basis wörtlich. Sonst basis leer, enums unchanged und Listen leer. wording umfasst positive Sprachvorgaben; forbiddenTerms ausdrücklich ausgeschlossene Wörter und deren im Beleg genannten Wortstämme. Ein Verbot von Entscheidungssprache ist eine dauerhafte Vorgabe für alle folgenden Antworten und Artefakte. questions=requested bei Arbeitsmodus mit Rückfragewunsch; dann 1–3 unabhängige relevante fehlende Angaben in missingInformation ermitteln (Ziel, Beteiligte, Termin, Unterlagen), keine unnötige Kennung bei einer Prozessfrage.',
  'codeReferences erfasst schemagebunden alle in der aktuellen Nachricht enthaltenen Fachcodes, deren Bedeutung geklärt oder fachlich verwendet wird: value wörtlicher Token, family semantischer Familien-/Formatkontext aus der Nachricht, basis wörtliches Belegstück. Keine Liste bekannter Codes; Zahlen allein sind nicht automatisch Codes. codeMeaningQuestion=true bei Bedeutungs-/Belegfragen zu diesen Codes. ' +
    REGULATORY_SCOPE +
    ' governanceContext=true bei Führung, Mandat oder Befassung; Einordnung und Prüfauftrag, niemals behauptete Entscheidung durch CET.',
  'requestedOutput.parts[].minimumSteps ist bei steps die ausdrücklich bestellte Mindestzahl, sonst ohne genannte Zahl drei; bei anderen Layouts null Schritte (0). requestedOutput.parts[].audience kennzeichnet jeden Teil als internal oder external; letter=true ausschließlich bei einem ausdrücklich bestellten Brief/Mailentwurf; sonst false. Eine Fassung für eine Zielgruppe ist noch kein Brief. recipient ist beim Brief die ausdrücklich genannte Zielgruppe, innerhalb oder außerhalb der Organisation. Interne Diagnose und externer Entwurf bleiben getrennte Teile; interne Inhalte dürfen nicht in den externen Teil übertragen werden.',
  'disclosure.external=true wenn ein Entwurf an ein externes Gegenüber verlangt oder proaktiv angeboten wird. recipient ist nur das ausdrücklich belegte Gegenüber. restricted enthält alle nicht erforderlichen Drittbeteiligten, internen Systeme, Dienstleister, Fehlerursachen und Personendetails aus aktuellem und früherem Kontext. Diese bleiben im internen Teil. Systembegriffe in Arbeitsaufträgen sind Gegenstände, niemals Empfänger; nutze tenantGlossary. Unbekannte mehrdeutige Abkürzungen als Gegenstand behandeln und eine relevante Rückfrage stellen.',
  ROLE_INSTRUCTION,
  'missingInformation[].kind=role ausschließlich bei einer Frage nach der eigenen Rolle, Zuständigkeit oder Aufgabe des Nutzers; sonst kind=other. Keine Rollenfrage nach einer fremden Person als eigene Rollenfrage markieren.',
  'personAssessment.applicable=true bei Bewertung einer anderen Person/Rolle; eine Selbstauskunft der sprechenden Person (eigene Erfahrung, Herkunft, neu im Team) ist keine Personenbewertung. observations enthält nur wörtlich belegte beobachtbare Handlungen/Äußerungen, hypotheses enthält ausdrücklich die Deutungen der Person als unbewiesen; basis wörtlich. Keine Motivzuschreibung; niemals diese Deutung in situation, caseMemory.assumptions oder tenantMemory als eigene Arbeitsannahme übernehmen. Beobachtung, Hypothese, Wirkung/Governance-Risiko und führungsfähige Formulierung getrennt.',
  'Tenant-spezifische Begriffsdefinitionen sind organisationsrelevante Glossaraussagen: tenantMemory.assertions mit glossary={term,meaning,kind}, beide Werte wörtlich aus basis, commitment=assessment, scope=organization, anchor=term. Kein globales Wissen aus einer Tenant-Definition ableiten.',
  'caseWork enthält belegte Owner-Rolle, Frist, nächste Befassung und Wiedervorlage des aktuellen Vorgangs, keine erfundenen Daten. linkedCaseProposal.requested=true bei einem eigenständigen verbundenen Strukturthema, Impuls oder ausdrücklich gewünschten Vorschlag. basis wörtlich, title eigenständiges Thema, type generisch, reference fachlicher Bezug zum bisherigen Vorgang. Owner-Rolle als Vorschlag; fehlende Frist/reminder ausdrücklich zur Abstimmung, nächste Befassung als Vorschlag. Noch keine Anlage; diese folgt ausschließlich auf ausdrückliches Leg an zum gespeicherten Vorschlag. Sonst requested=false und leere Felder.',
].join('\n');

function mergePreferences(previous = {}, current, message = '') {
  const result = { ...previous };
  if (!current?.basis?.trim() || !message.includes(current.basis)) return result;
  for (const key of ['register', 'concise', 'questions'])
    if (current[key] && current[key] !== 'unchanged') result[key] = current[key];
  for (const key of ['wording', 'forbiddenTerms'])
    result[key] = [...new Set([...(result[key] || []), ...(current[key] || [])])].slice(-20);
  result.wording = (result.wording || []).filter(
    (word) =>
      !(result.forbiddenTerms || []).some(
        (term) =>
          term.trim() &&
          word
            .normalize('NFKC')
            .toLocaleLowerCase()
            .includes(term.normalize('NFKC').toLocaleLowerCase())
      )
  );
  return result;
}

function hasConversationPreferences(preferences = {}) {
  return Object.entries(PREFERENCES.properties).some(([key, definition]) => {
    const value = preferences?.[key];
    if (definition.type === 'array')
      return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim());
    return (
      definition.enum?.includes(value) &&
      value !== 'unchanged' &&
      !(key === 'questions' && value === 'usual')
    );
  });
}

function answerInstruction(situation) {
  return [
    'Fachcodebedeutungen ausschließlich aus codeResolutions mit Fundstelle, niemals aus Modellwissen. Ohne Beleg ausdrücklich Bedeutung von <Code> nicht belegt. Normative Ansprüche ausschließlich mit tatsächlich gelieferter Fundstelle; ohne Quelle als zu prüfende Annahme formulieren, niemals als feststehendes Recht.',
    'Gespeicherte conversationPreferences gelten in jedem Absatz und allen Artefaktteilen: Register, Kürze, Sprachvorgaben und forbiddenTerms. governanceContext verlangt Befassung, Einordnung, Arbeits-/Prüfauftrag und nächste Befassung; CET trifft keine Entscheidung. Sprachverbote werden nicht wiederholt oder erläutert: auch in Negationen, Zitaten oder Sätzen über ihre Nichtverwendung bleiben die ausgeschlossenen Wörter weg. Formuliere die Sachinhalte positiv als Befassung und Prüfauftrag. Auch bei einem externen Entwurf keine Außentätigkeit behaupten.',
    situation.personAssessment?.applicable
      ? 'Vier ausdrücklich getrennte Abschnitte: Beobachtung, Hypothese, Wirkung, Führungsfähig. Berichtet ist keine unabhängig bestätigte Beobachtung. Hypothesen bleiben Nutzerdeutungen, niemals CET-Annahmen; keine Motive behaupten.'
      : '',
    situation.conversationPreferences?.questions === 'requested'
      ? 'Bei relevanten Informationslücken vorläufig einordnen und 1–3 gezielte Fragen ermöglichen; sie stehen in missingInformation, nicht in claims. Keine irrelevanten Kennungsfragen.'
      : '',
    situation.conversationContext?.role ||
    situation.conversationContext?.mandate ||
    situation.conversationContext?.statement
      ? 'Nutze conversationContext als vom Nutzer mitgeteilten Arbeitskontext in jedem Folgeturn: richte Auswahl, Schwerpunkt und Form der Antwort konkret auf Rolle, Auftrag/Gegenüber und Ziel aus. statement ist bei fehlenden Einzelfeldern die wörtlich gespeicherte Selbstaussage und ersetzt den früheren Arbeitskontext. Fragen zur Verwendung gegenüber Dritten sind Antwortinhalt mit questionTarget=other; Rückfragen an den Nutzer bleiben ausschließlich in missingInformation. Leite passende Fragen, Risiken und offene Punkte aus den tatsächlich gelieferten Belegen mit Fundstellen ab. Neue Einschätzungen ausdrücklich markieren. Der Kontext ist weder Beleg für Sachverhalte noch Zugriffsrecht; keine zusätzlichen Zugriffe oder Rechte ableiten. Nicht bloß die Rollenangabe wiederholen.'
      : '',
    `Gesprächsvorgaben: ${JSON.stringify(situation.conversationPreferences || {})}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function proposalText(proposal, preferences = {}) {
  if (!proposal?.requested) return '';
  const value = (text) => text || 'zur Abstimmung';
  return `Vorschlag für einen verbundenen Vorgang:\n\n### Titel\n${proposal.title}\n\n### Typ\n${value(proposal.type)}\n\n### Bezug\n${value(proposal.reference)}\n\n### Owner\n${value(proposal.ownerRole)} (Vorschlag)\n\n### Frist\n${value(proposal.deadline)}\n\n### Wiedervorlage\n${value(proposal.reminder)}\n\n### nächste Befassung\n${value(proposal.nextConsideration)}\n\nMit „Leg an“ ${preferences.register === 'Sie' ? 'bestätigen Sie' : 'bestätigst du'} die Anlage. Bis dahin bleibt es ein Vorschlag.`;
}

function forbiddenWording(text, forbidden = []) {
  const words =
    String(text)
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  return forbidden.some(
    (term) =>
      term.trim() &&
      words.some((word) => word.startsWith(term.normalize('NFKC').toLocaleLowerCase()))
  );
}

function validateCommunication(parsed, situation, evidence) {
  const claims = [
    ...(parsed.expectation || []),
    ...(parsed.interpretation || []),
    ...(parsed.nextSteps || []),
    ...(parsed.assumptions || []),
    ...(parsed.draft || []),
    ...(parsed.artifact || []).flatMap((part) => part.content),
  ];
  const forbidden = situation.conversationPreferences?.forbiddenTerms || [];
  for (const claim of claims) {
    if (forbiddenWording(claim.text, forbidden)) {
      const error = require('./workbench-llm-repair').schemaError([], 'conversation_wording');
      error.repairInstruction = `Formuliere alle Teile neu ohne diese ausgeschlossenen Wörter/Wortstämme: ${JSON.stringify(forbidden)}. Verwende Befassung, Einordnung und Prüfauftrag. Wiederhole auch nicht die Sprachregel oder die ausgeschlossenen Wörter in einem Satz wie ohne/keine. Formuliere die Sachinhalte positiv; alle bestellten Teile und Sachangaben bleiben erhalten.`;
      throw error;
    }
    if (situation.regulatoryQuestion) {
      const grounded =
        claim.origin === 'evidence' &&
        claim.evidenceIds?.some((id) =>
          evidence.some(
            (hit) =>
              hit.evidenceId === id &&
              ['knowledge-rag', 'knowledge-rag-federated', 'willi-mako'].includes(
                hit.retrievalSource || hit.source
              ) &&
              (hit.metadata?.sectionId || hit.metadata?.url)
          )
        );
      if (!grounded && !/zu prüfende Annahme/iu.test(claim.text)) {
        const lines = claim.text.split('\n');
        let lastHeading = -1;
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index].trim();
          if (!line) continue;
          if (!/^#{1,6}\s/u.test(line)) break;
          lastHeading = index;
        }
        const heading = lastHeading >= 0 ? lines.slice(0, lastHeading + 1).join('\n') : '';
        const body = lastHeading >= 0 ? lines.slice(lastHeading + 1).join('\n') : claim.text;
        if (heading && !body.trim()) continue;
        if (
          claim.text
            .trim()
            .split('\n')
            .every((line) => /^\s*\|.*\|\s*$/u.test(line))
        )
          claim.regulatoryUnverified = true;
        else {
          const prefix = 'Zu prüfende Annahme, ohne belegte Fundstelle: ';
          claim.text = heading
            ? `${heading.trimEnd()}\n\n${prefix}${body.trimStart()}`
            : prefix + claim.text;
        }
      }
    }
  }
}

module.exports = {
  SCHEMAS,
  PREFERENCES,
  CASE_WORK,
  INSTRUCTION,
  ROLE_INSTRUCTION,
  mergePreferences,
  hasConversationPreferences,
  answerInstruction,
  proposalText,
  validateCommunication,
  forbiddenWording,
};
