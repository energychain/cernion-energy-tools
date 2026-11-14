'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyTask } = require('./classifier');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'agents.json');
const CLOSED_STATES = new Set(['done', 'completed', 'archived', 'cancelled']);
const TECHNICAL_PROGRESS_TYPES = new Set(['release_live']);
const TECHNICAL_ACTIVITY_PATTERNS = [
  /\b(?:cron|queue|worker|scheduler|healthcheck|monitoring|pm2)\b/i,
  /\b(?:deploy(?:ment)?|release|rollback|restart|reboot)\b/i,
  /\b(?:refactor(?:ing)?|lint|build|unit tests?|ci(?:\/cd)?)\b/i,
  /\b(?:server|infrastructure|database migration|schema migration)\b/i,
  /\b(?:pull request|merge request|commit|branch)\b/i,
  /\b(?:technische|technical) (?:aktivität|activity|wartung|maintenance)\b/i,
];

function loadAgentConfig(configPath = DEFAULT_CONFIG_PATH) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config || !Array.isArray(config.agents) || !config.agents.length) {
    throw new Error('agent brief config requires agents');
  }
  return config;
}

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function taskKey(board, taskId) {
  return `${board}\0${taskId}`;
}

function taskText(task) {
  return [
    task.title,
    task.body,
    task.result,
    ...(task.comments || []).map((comment) => comment.body || comment.text),
  ]
    .filter(Boolean)
    .join('\n');
}

function markerValues(text, marker) {
  const expression = new RegExp(`^\\s*${marker}\\s*:\\s*(.+?)\\s*$`, 'gim');
  return Array.from(String(text || '').matchAll(expression), (match) => match[1].trim()).filter(
    Boolean
  );
}

function unique(values) {
  return Array.from(
    new Map(
      values
        .filter((value) => value !== null && value !== undefined && value !== '')
        .map((value) => [JSON.stringify(value), value])
    ).values()
  );
}

function normalizeAgent(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function agentDirectory(config) {
  const byAlias = new Map();
  for (const agent of config.agents) {
    for (const alias of unique([agent.id, ...(agent.aliases || [])])) {
      byAlias.set(normalizeAgent(alias), agent.id);
    }
  }
  return byAlias;
}

function canonicalAgent(value, directory) {
  return directory.get(normalizeAgent(value)) || null;
}

function isTechnicalActivity(task) {
  const text = taskText(task);
  return TECHNICAL_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBusinessProgress(outcome) {
  if (!outcome || TECHNICAL_PROGRESS_TYPES.has(outcome.outcome_type)) {
    return Boolean(
      outcome &&
      (String(outcome.counterparty || '').trim() || String(outcome.economic_relevance || '').trim())
    );
  }
  return true;
}

function sourceTimestamp(task) {
  return Number(task.completed_at || task.started_at || task.created_at || 0);
}

function topicTimestamp(topic) {
  return Number(topic.updated_at || topic.last_substantive_progress_at || 0);
}

function isActiveTopic(topic, now) {
  const state = String(topic.current_state || '').toLowerCase();
  if (CLOSED_STATES.has(state)) return false;
  if (state !== 'scheduled') return true;
  return Number(topic.expected_progress_at || 0) > 0 && Number(topic.expected_progress_at) <= now;
}

function topicMembers(topic, tasksByKey) {
  return parseJson(topic.source_task_refs_json)
    .map((ref) => tasksByKey.get(taskKey(ref.board, ref.taskId || ref.task_id)))
    .filter(Boolean);
}

function topicAgents(topic, directory) {
  const owner = canonicalAgent(topic.owner_agent, directory);
  if (owner) return [owner];
  return unique(
    parseJson(topic.participating_agents_json).map((value) => canonicalAgent(value, directory))
  );
}

function outcomePublicView(outcome) {
  return {
    outcomeId: outcome.outcome_id,
    topicId: outcome.topic_id,
    type: outcome.outcome_type,
    statement: outcome.statement,
    occurredAt: outcome.occurred_at,
    counterparty: outcome.counterparty || null,
    economicRelevance: outcome.economic_relevance || null,
    evidenceRefs: parseJson(outcome.evidence_refs_json),
    progressQualified: hasBusinessProgress(outcome),
  };
}

function isMatureDecision(decision) {
  return Boolean(
    decision &&
    decision.decision_class !== 'projection_incomplete' &&
    decision.question &&
    decision.reason_human_required &&
    decision.recommendation &&
    parseJson(decision.options_json).length &&
    parseJson(decision.consequences_json).length &&
    decision.non_decision_effect
  );
}

function isOpenMaterialRiskEscalation(decision) {
  if (!decision || CLOSED_STATES.has(String(decision.status || '').toLowerCase())) return false;
  return (
    decision.classifier_label === 'RISK_ESCALATION' ||
    decision.decision_class === 'risk_escalation' ||
    decision.decision_class === 'scope_violation'
  );
}

function isBriefRelevantDecision(decision) {
  return isMatureDecision(decision) || isOpenMaterialRiskEscalation(decision);
}

function decisionPublicView(decision) {
  return {
    decisionId: decision.decision_id,
    topicId: decision.topic_id,
    question: decision.question,
    recommendation: decision.recommendation || null,
    decisionClass: decision.decision_class,
    classifierLabel: decision.classifier_label,
    deadline: decision.deadline || null,
    source: { board: decision.source_board, taskId: decision.source_task_id },
  };
}

function topicPublicView(topic, technicalOnly, progressAt) {
  return {
    topicId: topic.topic_id,
    title: topic.title,
    state: topic.current_state,
    nextStep: topic.next_step || null,
    artifacts: parseJson(topic.artifact_refs_json),
    updatedAt: topic.updated_at,
    progressClassification: technicalOnly
      ? 'technical_enabler_only'
      : progressAt
        ? 'evidence_backed_progress'
        : 'active_without_evidenced_progress',
  };
}

function structuredValues(tasks, markers) {
  return unique(
    tasks.flatMap((task) => {
      const text = taskText(task);
      return markers.flatMap((marker) => markerValues(text, marker));
    })
  );
}

function suggestedNextActions(agent, relevantTopics, managementNeeds) {
  const governanceSuggestions = managementNeeds.map((decision) =>
    decision.recommendation
      ? `Vorschlag: ${decision.recommendation}`
      : `Vorschlag: Governancefrage klären: ${decision.question}`
  );
  if (governanceSuggestions.length) return governanceSuggestions;

  const topicSuggestions = relevantTopics.map((item) => {
    const title = item.topic.title || item.topic.topic_id;
    const state = String(item.topic.current_state || '').toLowerCase();
    return state === 'blocked'
      ? `Vorschlag: Blockade bei „${title}“ klären und den fallabschließenden nächsten Schritt dokumentieren.`
      : `Vorschlag: „${title}“ priorisiert bearbeiten und den fallabschließenden nächsten Schritt mit Termin dokumentieren.`;
  });
  if (topicSuggestions.length) return topicSuggestions;

  return [
    agent.defaultNextAction ||
      'Vorschlag: Lage im Verantwortungsbereich prüfen und den wichtigsten nächsten Schritt oder einen erklärten Leerstand dokumentieren.',
  ];
}

function topicScore(topic, context) {
  const outcomes = context.outcomesByTopic.get(topic.topic_id) || [];
  const topicDecisions = context.decisionsByTopic.get(topic.topic_id) || [];
  const decisions = topicDecisions.filter(isBriefRelevantDecision);
  const hasAttentionWorthyRisk = topicDecisions.some(isOpenMaterialRiskEscalation);
  const members = topicMembers(topic, context.tasksByKey);
  const noiseOnly =
    !hasAttentionWorthyRisk &&
    members.length > 0 &&
    members.every((task) => {
      const classification = classifyTask(task, context.classifierOptions);
      return classification.excluded || classification.label === 'NOISE';
    });
  const technicalOnly = members.length > 0 && members.every(isTechnicalActivity);
  const qualifiedOutcomes = outcomes.filter(hasBusinessProgress);
  const newestProgress = Math.max(0, ...qualifiedOutcomes.map((item) => Number(item.occurred_at)));
  const score =
    (decisions.length ? 100 : 0) +
    (qualifiedOutcomes.length ? 80 : 0) +
    (topic.next_step ? 30 : 0) +
    (technicalOnly ? 0 : 20);
  return {
    topic,
    members,
    outcomes,
    decisions,
    noiseOnly,
    technicalOnly: technicalOnly && !qualifiedOutcomes.length,
    progressAt: newestProgress || null,
    score,
    sortAt: newestProgress || topicTimestamp(topic),
  };
}

function projectAgentBriefs(input, options = {}) {
  const config = options.agentConfig || loadAgentConfig(options.agentConfigPath);
  const directory = agentDirectory(config);
  const tasks = input.tasks || [];
  const topics = input.topics || [];
  const outcomes = input.outcomes || [];
  const decisions = input.decisions || [];
  const wakeups = input.wakeups || [];
  const tasksByKey = new Map(tasks.map((task) => [taskKey(task.board, task.id), task]));
  const topicById = new Map(topics.map((topic) => [topic.topic_id, topic]));
  const outcomesByTopic = new Map();
  const decisionsByTopic = new Map();
  const wakeupsByOwner = new Map();

  for (const outcome of outcomes) {
    if (!outcomesByTopic.has(outcome.topic_id)) outcomesByTopic.set(outcome.topic_id, []);
    outcomesByTopic.get(outcome.topic_id).push(outcome);
  }
  for (const decision of decisions) {
    if (!decisionsByTopic.has(decision.topic_id)) decisionsByTopic.set(decision.topic_id, []);
    decisionsByTopic.get(decision.topic_id).push(decision);
  }
  for (const wakeup of wakeups) {
    const owner = canonicalAgent(wakeup.owner_agent, directory);
    if (!owner) continue;
    if (!wakeupsByOwner.has(owner)) wakeupsByOwner.set(owner, []);
    wakeupsByOwner.get(owner).push(wakeup);
  }

  const fallbackNow = Math.max(
    0,
    ...tasks.map(sourceTimestamp),
    ...topics.map(topicTimestamp),
    ...outcomes.map((outcome) => Number(outcome.occurred_at || 0))
  );
  const now = Number(
    options.now || input.generatedAt || fallbackNow || Math.floor(Date.now() / 1000)
  );
  const reportingPeriodDays = Number(config.reportingPeriodDays || 7);
  const reportingStart = now - reportingPeriodDays * 86400;
  const maximumTopics = Math.max(2, Math.min(5, Number(config.maximumTopicsPerBrief || 5)));
  const context = { tasksByKey, outcomesByTopic, decisionsByTopic, classifierOptions: options };
  const diagnostics = {
    configuredAgents: config.agents.length,
    technicalOnlyTopics: 0,
    progressQualifiedOutcomes: 0,
    technicalOutcomesNotCountedAsProgress: 0,
    emptyBriefs: 0,
    activeWithoutSubstantiveProgress: 0,
  };

  const briefs = config.agents.map((agent) => {
    const allRelevantTopics = topics.filter((topic) =>
      topicAgents(topic, directory).includes(agent.id)
    );
    const relevantTopics = allRelevantTopics
      .filter((topic) => isActiveTopic(topic, now))
      .map((topic) => topicScore(topic, context))
      .filter((item) => !item.noiseOnly || item.decisions.length > 0)
      .sort((left, right) => right.score - left.score || right.sortAt - left.sortAt)
      .slice(0, maximumTopics);

    diagnostics.technicalOnlyTopics += relevantTopics.filter((item) => item.technicalOnly).length;
    const allRelevantTopicIds = new Set(allRelevantTopics.map((topic) => topic.topic_id));
    const periodOutcomes = outcomes
      .filter((outcome) => allRelevantTopicIds.has(outcome.topic_id))
      .filter((outcome) => Number(outcome.occurred_at || 0) >= reportingStart)
      .sort((left, right) => Number(right.occurred_at) - Number(left.occurred_at));
    const progressOutcomes = periodOutcomes.filter(hasBusinessProgress);
    diagnostics.progressQualifiedOutcomes += progressOutcomes.length;
    diagnostics.technicalOutcomesNotCountedAsProgress +=
      periodOutcomes.length - progressOutcomes.length;

    const managementNeeds = relevantTopics
      .flatMap((item) => item.decisions)
      .map(decisionPublicView);
    const risks = managementNeeds.filter(
      (decision) =>
        decision.classifierLabel === 'RISK_ESCALATION' ||
        decision.decisionClass === 'scope_violation'
    );
    const memberTasks = unique(relevantTopics.flatMap((item) => item.members));
    const dependencies = structuredValues(memberTasks, ['DEPENDENCY', 'ABHÄNGIGKEIT']);
    const explicitRisks = structuredValues(memberTasks, ['RISK', 'RISIKO']);
    const explicitNextActions = unique([
      ...relevantTopics.map((item) => item.topic.next_step),
      ...structuredValues(memberTasks, ['NEXT_ACTION', 'NEXT_STEP', 'NÄCHSTER_SCHRITT']),
      ...(wakeupsByOwner.get(agent.id) || []).map((wakeup) => wakeup.next_action_on_wake),
    ]);
    const nextActions = (
      explicitNextActions.length
        ? explicitNextActions
        : suggestedNextActions(agent, relevantTopics, managementNeeds)
    ).slice(0, 8);
    const evidenceRefs = unique(
      periodOutcomes.flatMap((outcome) => parseJson(outcome.evidence_refs_json))
    );
    const lastSubstantiveProgressAt =
      Math.max(0, ...progressOutcomes.map((outcome) => Number(outcome.occurred_at || 0))) || null;
    const nonTechnicalTopics = relevantTopics.filter((item) => !item.technicalOnly);

    let briefStatus = 'current';
    let emptyStateReason = null;
    if (!relevantTopics.length && !periodOutcomes.length && !managementNeeds.length) {
      briefStatus = 'empty';
      emptyStateReason =
        'Keine aktiven Managementthemen oder belegten Ergebnisse im Berichtszeitraum.';
      diagnostics.emptyBriefs += 1;
    } else if (!lastSubstantiveProgressAt) {
      briefStatus = 'active_without_substantive_progress';
      emptyStateReason = relevantTopics.every((item) => item.technicalOnly)
        ? 'Es liegt technische Aktivität vor, aber kein belegter fachlicher oder wirtschaftlicher Fortschritt.'
        : 'Aktive Themen sind sichtbar, aber im Berichtszeitraum ist kein belegter substantieller Fortschritt vorhanden.';
      diagnostics.activeWithoutSubstantiveProgress += 1;
    }

    const explicitGoals = structuredValues(memberTasks, ['BUSINESS_GOAL', 'GESCHÄFTSZIEL']);
    const currentGoal =
      explicitGoals[0] ||
      nonTechnicalTopics.find((item) => item.topic.business_goal)?.topic.business_goal ||
      agent.mandateGoal ||
      null;

    return {
      agent_id: agent.id,
      reporting_period_start: reportingStart,
      reporting_period_end: now,
      current_goal: currentGoal,
      active_topic_refs_json: JSON.stringify(
        relevantTopics.map((item) =>
          topicPublicView(item.topic, item.technicalOnly, item.progressAt)
        )
      ),
      outcomes_json: JSON.stringify(periodOutcomes.map(outcomePublicView)),
      next_actions_json: JSON.stringify(nextActions),
      dependencies_json: JSON.stringify(dependencies),
      risks_json: JSON.stringify([
        ...explicitRisks.map((risk) => ({ statement: risk, source: 'explicit_task_marker' })),
        ...risks,
      ]),
      needs_management_json: JSON.stringify(managementNeeds),
      last_substantive_progress_at: lastSubstantiveProgressAt,
      evidence_refs_json: JSON.stringify(evidenceRefs),
      brief_status: briefStatus,
      empty_state_reason: emptyStateReason,
      updated_at: Math.max(
        reportingStart,
        ...relevantTopics.map((item) => topicTimestamp(item.topic)),
        ...periodOutcomes.map((outcome) => Number(outcome.occurred_at || 0)),
        ...managementNeeds.map((decision) =>
          Number(topicById.get(decision.topicId)?.updated_at || reportingStart)
        )
      ),
    };
  });

  return { briefs, diagnostics };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  canonicalAgent,
  hasBusinessProgress,
  isTechnicalActivity,
  loadAgentConfig,
  projectAgentBriefs,
};
