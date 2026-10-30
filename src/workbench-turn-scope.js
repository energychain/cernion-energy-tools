'use strict';

// Current-message metadata, never facts about the continuing work item.
// turnKind and proactive draftRequested describe the work item and remain stable.
const TURN_SCOPED_FIELDS = Object.freeze([
  'preferenceOnly',
  'codeReferences',
  'codeMeaningQuestion',
  'regulatoryQuestion',
  'personAssessment',
  'roleStatement',
  'roleContextUpdated',
  'personAssessmentOutput',
  'disclosure',
  'linkedCaseProposal',
  'requestedOutput',
  'caseSearch',
  'caseMemory.resolvedItems',
  'dataNeeds',
  'dataQuestion',
  'followupKind',
  'conversationShape',
  'selfKnowledge',
  'requestedAction.externalEffect',
  'tenantMemory',
  'noticesRequested',
  'answerFeedback',
]);

function persistentSituation(situation) {
  if (!situation) return situation;
  const result = { ...situation };
  for (const path of TURN_SCOPED_FIELDS) {
    const [field, nested] = path.split('.');
    if (nested && result[field]) {
      result[field] = { ...result[field] };
      delete result[field][nested];
    } else if (!nested) delete result[field];
  }
  return result;
}

module.exports = { TURN_SCOPED_FIELDS, persistentSituation };
