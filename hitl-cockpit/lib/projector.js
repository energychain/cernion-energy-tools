'use strict';

const crypto = require('node:crypto');
const { hasBusinessProgress, projectAgentBriefs } = require('./agent-brief-projector');
const { classifyTask } = require('./classifier');
const { projectContextLinks } = require('./context-links');
const { projectDigestItems } = require('./digest-projector');
const { projectOutcomes } = require('./outcome-projector');
const { projectTopics } = require('./topic-projector');
const { evaluateWakeup, readWakeupContract } = require('./wakeup-service');

function stableId(kind, board, taskId, suffix = '') {
  const hash = crypto
    .createHash('sha256')
    .update([kind, board, taskId, suffix].join('\0'))
    .digest('hex')
    .slice(0, 24);
  return `${kind}_${hash}`;
}

function sourceTimestamp(task) {
  return Number(task.completed_at || task.started_at || task.created_at || 0);
}

function buildProjection(source, options = {}) {
  let decisions = [];
  const outcomes = [];
  const wakeups = [];
  const objects = [];
  const boards = [];
  const tasks = source.boards.flatMap((board) => board.items);
  const includedTasks = tasks.filter((task) => !classifyTask(task, options).excluded);
  const digestProjection = projectDigestItems(tasks, options);
  const digestItems = digestProjection.items;
  const digestByTask = new Map(
    digestItems.map((item) => [`${item.source_board}\0${item.source_task_id}`, item])
  );
  const topicProjection = projectTopics(includedTasks, options);
  const topics = topicProjection.topics;
  const outcomeProjection = projectOutcomes(includedTasks, options);
  const projectedOutcomesByTask = new Map(
    outcomeProjection.outcomes.map((outcome) => [
      `${outcome.source_board}\0${outcome.source_task_id}`,
      outcome,
    ])
  );

  for (const boardSource of source.boards) {
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(boardSource.items))
      .digest('hex');
    boards.push({
      board: boardSource.board,
      projected_at: Math.max(0, ...boardSource.items.map(sourceTimestamp)),
      source_count: boardSource.items.length,
      source_fingerprint: fingerprint,
    });
  }

  for (const task of tasks) {
    const classification = classifyTask(task, options);
    if (classification.excluded) continue;
    const timestamp = sourceTimestamp(task);
    const wakeupEvaluation =
      String(task.status || '').toLowerCase() === 'scheduled'
        ? evaluateWakeup(task, options)
        : null;
    const wakeupContract = wakeupEvaluation ? readWakeupContract(task) : null;
    const topicId = topicProjection.topicByTask.get(`${task.board}\0${task.id}`);
    objects.push(objectRow('topic', topicId, task));
    const digestItem = digestByTask.get(`${task.board}\0${task.id}`);
    if (digestItem) {
      digestItem.topic_id = topicId || null;
      objects.push(objectRow('digest', digestItem.digest_id, task));
    }

    if (
      String(task.status || '').toLowerCase() !== 'scheduled' &&
      (task.status === 'blocked' || task.block_kind === 'needs_input') &&
      classification.label !== 'SCOPE_COVERED' &&
      (!digestItem || digestItem.disposition === 'escalate')
    ) {
      const materialDigestEscalation = digestItem?.disposition === 'escalate';
      const decisionId = stableId('decision', task.board, task.id);
      decisions.push({
        decision_id: decisionId,
        topic_id: topicId,
        source_board: task.board,
        source_task_id: task.id,
        decision_class: materialDigestEscalation
          ? 'risk_escalation'
          : classification.projectionIncomplete
            ? 'projection_incomplete'
            : task.scopeDecision?.state === 'unclear'
              ? 'scope_violation'
              : 'governance',
        question: String(task.decisionQuestion || task.title || task.id),
        reason_human_required: String(task.block_kind || 'blocked_source_task'),
        recommendation: task.recommendation || null,
        options_json: JSON.stringify(task.options || []),
        consequences_json: JSON.stringify(task.consequences || []),
        deadline: task.deadline || null,
        non_decision_effect: task.nonDecisionEffect || null,
        execution_scope_json: JSON.stringify(
          task.executionScope || task.scopeDecision?.matches || []
        ),
        excluded_scope_json: JSON.stringify(task.excludedScope || []),
        status: task.status,
        classifier_label: materialDigestEscalation ? 'RISK_ESCALATION' : classification.label,
        classifier_reasons_json: materialDigestEscalation
          ? digestItem.reasons_json
          : JSON.stringify(classification.reasons),
        confidence: classification.confidence,
        first_projected_at: timestamp,
        updated_at: timestamp,
      });
      objects.push(objectRow('decision', decisionId, task));
    }

    const projectedOutcome = projectedOutcomesByTask.get(`${task.board}\0${task.id}`);
    if (projectedOutcome) {
      outcomes.push({ ...projectedOutcome, topic_id: topicId });
      objects.push(objectRow('outcome', projectedOutcome.outcome_id, task));
    }

    if (classification.label === 'SCHEDULED') {
      const wakeupId = stableId('wakeup', task.board, task.id);
      wakeups.push({
        wakeup_id: wakeupId,
        source_board: task.board,
        source_task_id: task.id,
        wake_at: wakeupContract.wakeAt,
        why_scheduled: wakeupContract.whyScheduled,
        next_action_on_wake: wakeupContract.nextAction,
        signal_required: wakeupContract.signalRequired,
        auto_close_after: wakeupContract.autoCloseAfter,
        owner_agent: wakeupContract.owner,
        status: wakeupEvaluation.state,
        last_signal_at: wakeupContract.lastSignalAt,
      });
      objects.push(objectRow('wakeup', wakeupId, task));
    }
  }

  const contextProjection = projectContextLinks({
    tasks: includedTasks,
    topics,
    decisions,
    artifactRegistry: options.artifactRegistry,
    roomRegistry: options.roomRegistry,
  });
  decisions = contextProjection.decisions;
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (objects[index].object_type === 'decision') objects.splice(index, 1);
  }
  for (const decision of decisions) {
    for (const ref of JSON.parse(decision.source_refs_json || '[]')) {
      objects.push({
        object_type: 'decision',
        object_id: decision.decision_id,
        source_board: ref.board,
        source_task_id: ref.taskId,
      });
    }
  }

  const progressOutcomesByTopic = new Map();
  for (const outcome of outcomes.filter(hasBusinessProgress)) {
    if (!progressOutcomesByTopic.has(outcome.topic_id))
      progressOutcomesByTopic.set(outcome.topic_id, []);
    progressOutcomesByTopic.get(outcome.topic_id).push(outcome);
  }
  for (const topic of topics) {
    const progressOutcomes = progressOutcomesByTopic.get(topic.topic_id) || [];
    topic.last_substantive_progress_at =
      Math.max(0, ...progressOutcomes.map((outcome) => Number(outcome.occurred_at || 0))) || null;
    topic.impact_statement =
      [...progressOutcomes].sort(
        (left, right) => Number(right.occurred_at || 0) - Number(left.occurred_at || 0)
      )[0]?.statement || null;
  }

  const agentBriefProjection = options.incremental
    ? {
        briefs: [],
        diagnostics: {
          skipped: true,
          reason: 'incremental_projection_requires_full_source_for_agent_briefs',
        },
      }
    : projectAgentBriefs(
        {
          tasks: includedTasks,
          topics,
          outcomes,
          decisions,
          wakeups,
          generatedAt: source.generatedAt,
        },
        options
      );

  return {
    topics,
    decisions,
    outcomes,
    wakeups,
    digestItems,
    agentBriefs: agentBriefProjection.briefs,
    objects,
    boards,
    outcomeDiagnostics: outcomeProjection.rejected,
    topicDiagnostics: topicProjection.diagnostics,
    contextLinkDiagnostics: contextProjection.diagnostics,
    agentBriefDiagnostics: agentBriefProjection.diagnostics,
    digestDiagnostics: digestProjection.diagnostics,
    replaceAgentBriefs: !options.incremental,
    replaceBoards: options.incremental ? [] : source.boards.map((board) => board.board),
    replaceDigestBoards: source.boards.map((board) => board.board),
  };
}

function objectRow(objectType, objectId, task) {
  return {
    object_type: objectType,
    object_id: objectId,
    source_board: task.board,
    source_task_id: task.id,
  };
}

function mergeJsonArrays(left, right) {
  const values = [...JSON.parse(left || '[]'), ...JSON.parse(right || '[]')];
  return JSON.stringify(
    Array.from(new Map(values.map((value) => [JSON.stringify(value), value])).values())
  );
}

function reconcileIncrementalTopics(store, data) {
  const existingMappings = store.query(
    "SELECT object_id,source_board,source_task_id FROM projection_objects WHERE object_type='topic'"
  );
  const existingTopics = new Map(
    store.query('SELECT * FROM management_topics').map((topic) => [topic.topic_id, topic])
  );
  const topicBySource = new Map(
    existingMappings.map((row) => [`${row.source_board}\0${row.source_task_id}`, row.object_id])
  );
  const replacements = new Map();

  data.topics = data.topics.map((topic) => {
    const previousIds = new Set(
      JSON.parse(topic.source_task_refs_json)
        .map((ref) => topicBySource.get(`${ref.board}\0${ref.taskId}`))
        .filter(Boolean)
    );
    if (previousIds.size !== 1) return topic;
    const previousId = Array.from(previousIds)[0];
    const previous = existingTopics.get(previousId);
    if (!previous) return topic;
    replacements.set(topic.topic_id, previousId);
    const previousProgress = Number(previous.last_substantive_progress_at || 0);
    const currentProgress = Number(topic.last_substantive_progress_at || 0);
    return {
      ...topic,
      topic_id: previousId,
      impact_statement:
        currentProgress >= previousProgress && topic.impact_statement
          ? topic.impact_statement
          : previous.impact_statement,
      last_substantive_progress_at: Math.max(previousProgress, currentProgress) || null,
      participating_agents_json: mergeJsonArrays(
        previous.participating_agents_json,
        topic.participating_agents_json
      ),
      artifact_refs_json: mergeJsonArrays(previous.artifact_refs_json, topic.artifact_refs_json),
      source_task_refs_json: mergeJsonArrays(
        previous.source_task_refs_json,
        topic.source_task_refs_json
      ),
    };
  });

  for (const decision of data.decisions) {
    decision.topic_id = replacements.get(decision.topic_id) || decision.topic_id;
  }
  for (const outcome of data.outcomes) {
    outcome.topic_id = replacements.get(outcome.topic_id) || outcome.topic_id;
  }
  for (const digestItem of data.digestItems) {
    digestItem.topic_id = replacements.get(digestItem.topic_id) || digestItem.topic_id;
  }
  for (const object of data.objects) {
    if (object.object_type === 'topic') {
      object.object_id = replacements.get(object.object_id) || object.object_id;
    }
  }
}

function buildClassificationAudit(source, options = {}) {
  const rows = [];
  for (const task of source.boards.flatMap((board) => board.items)) {
    const classification = classifyTask(task, options);
    if (classification.excluded) continue;
    rows.push({
      source_board: task.board,
      source_task_id: task.id,
      projected_at: sourceTimestamp(task),
      label: classification.label,
      reasons_json: JSON.stringify(classification.reasons),
      confidence: classification.confidence,
      classifier_version: classification.classifierVersion,
      overridden_by: null,
      override_reason: null,
    });
  }
  return rows;
}

function project(store, source, options = {}) {
  const data = buildProjection(source, options);
  if (options.incremental) {
    reconcileIncrementalTopics(store, data);
  } else {
    const failedBoards = new Set(source.errors.map((error) => error.board));
    const existingBoards = store
      .query('SELECT board FROM projection_boards')
      .map((row) => row.board);
    data.replaceBoards = Array.from(
      new Set([
        ...data.replaceBoards,
        ...existingBoards.filter((board) => !failedBoards.has(board)),
      ])
    ).sort();
  }
  const result = store.applyProjection(data);
  return { ...result, errors: source.errors, projection: data };
}

function classifyShadow(store, source, options = {}) {
  const rows = buildClassificationAudit(source, options);
  const result = store.writeClassificationAudit(rows);
  return { ...result, errors: source.errors };
}

module.exports = {
  buildClassificationAudit,
  buildProjection,
  classifyShadow,
  project,
  reconcileIncrementalTopics,
  stableId,
};
