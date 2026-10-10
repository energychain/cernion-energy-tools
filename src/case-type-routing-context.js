'use strict';

const EMPTY_ROUTING_CONTEXT = Object.freeze({
  case_type_candidates: [],
  clarification_questions: [],
  evidence_requirements: [],
  next_best_actions: [],
  allowed_tools: [],
  assistance_principle: null,
});

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildCaseTypeRoutingContext(recommendation = {}) {
  const routing = recommendation.caseTypeRouting || recommendation;
  const candidates = Array.isArray(routing.candidates) ? routing.candidates : [];
  if (!candidates.length) return { ...EMPTY_ROUTING_CONTEXT };
  const primary = routing.primary || candidates[0];
  return {
    case_type_candidates: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      maturity: candidate.maturity,
      confidence: candidate.confidence,
      rawScore: candidate.rawScore,
    })),
    primary_case_type: primary
      ? {
          id: primary.id,
          title: primary.title,
          maturity: primary.maturity,
          confidence: primary.confidence,
        }
      : null,
    clarification_questions: unique(
      candidates.flatMap((candidate) => candidate.clarificationQuestions || [])
    ),
    evidence_requirements: unique(
      candidates.flatMap((candidate) => candidate.evidenceRequirements || [])
    ),
    next_best_actions: unique(candidates.flatMap((candidate) => candidate.nextBestActions || [])),
    allowed_tools: unique(
      (recommendation.recommendedPlan || [])
        .map((step) => step && step.action)
        .concat(
          (recommendation.operationCandidates || []).map(
            (operation) => operation && (operation.action || operation.operationId)
          )
        )
    ),
    assistance_principle: routing.assistancePrinciple || null,
  };
}

function renderCaseTypeRoutingPromptLines(caseTypeRoutingContext = EMPTY_ROUTING_CONTEXT) {
  const lines = [];
  const candidates = caseTypeRoutingContext.case_type_candidates || [];
  if (!candidates.length) return lines;
  lines.push('Case-type routing context:');
  lines.push(
    `- Primary case type: ${caseTypeRoutingContext.primary_case_type?.id || candidates[0].id}`
  );
  lines.push(`- Candidate case types: ${candidates.map((candidate) => candidate.id).join(', ')}`);
  if (caseTypeRoutingContext.clarification_questions?.length) {
    lines.push(
      `- Clarification questions: ${caseTypeRoutingContext.clarification_questions.join(' | ')}`
    );
  }
  if (caseTypeRoutingContext.evidence_requirements?.length) {
    lines.push(`- Evidence boundary: ${caseTypeRoutingContext.evidence_requirements.join(' | ')}`);
  }
  if (caseTypeRoutingContext.next_best_actions?.length) {
    lines.push(`- Next best actions: ${caseTypeRoutingContext.next_best_actions.join(' | ')}`);
  }
  lines.push(
    '- Do not treat missing final evidence as missing helpfulness; structure the case, hold uncertainty and propose the next safe step.'
  );
  return lines;
}

module.exports = {
  EMPTY_ROUTING_CONTEXT,
  buildCaseTypeRoutingContext,
  renderCaseTypeRoutingPromptLines,
};
