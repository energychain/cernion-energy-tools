'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const defaultRules = require('../config/topic-rules.json');

const PRIVATE_SENSITIVITIES = new Set(['twl-private', 'private', 'secret', 'restricted']);

function readArtifactRegistry(registryPath) {
  if (!registryPath) return { artifacts: [], diagnostics: { available: false } };
  try {
    const descriptor = fs.openSync(registryPath, 'r');
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } finally {
      fs.closeSync(descriptor);
    }
    if (!parsed || !Array.isArray(parsed.artifacts)) throw new Error('invalid_root_schema');
    return {
      artifacts: parsed.artifacts,
      diagnostics: { available: true, artifactCount: parsed.artifacts.length },
    };
  } catch (error) {
    return {
      artifacts: [],
      diagnostics: { available: false, error: error.code || error.message },
    };
  }
}

function taskKey(task) {
  return `${task.board}\0${task.id}`;
}

function taskText(task) {
  return [
    task.title,
    task.body,
    task.result,
    task.project_id,
    ...(task.comments || []).map((comment) => comment.body || comment.text),
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableTopicId(seed) {
  return `topic_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

function explicitHashtags(task, rules) {
  const ignored = new Set((rules.ignoredHashtags || []).map(normalizeToken));
  const tags = taskText(task).match(/#[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) || [];
  return Array.from(
    new Set(
      tags.map((tag) => normalizeToken(tag.slice(1))).filter((tag) => tag && !ignored.has(tag))
    )
  ).sort();
}

function parentReferences(task) {
  const references = [];
  const pattern =
    /(?:parent(?:[_ -]?task)?|source[_ -]?task|parent[_ -]?id)\s*[:=#-]?\s*(t_[a-z0-9_-]{6,})/gi;
  for (const match of taskText(task).matchAll(pattern)) references.push(match[1].toLowerCase());
  for (const field of ['parent_task_id', 'parentTaskId', 'source_task_id']) {
    if (typeof task[field] === 'string' && /^t_[a-z0-9_-]{6,}$/i.test(task[field])) {
      references.push(task[field].toLowerCase());
    }
  }
  return Array.from(new Set(references));
}

function conversationReferences(task, rules) {
  const minimumLength = Number(rules.minimumReferenceLength || 6);
  const prefixes = (rules.referencePrefixes || []).map((value) => String(value).toLowerCase());
  const references = [];
  const text = taskText(task);
  const pattern = new RegExp(
    `\\b(${prefixes.join('|')})(?:[_-]?id)?\\s*[:=#]\\s*([a-z0-9][a-z0-9._/-]{${Math.max(1, minimumLength - 1)},})`,
    'gi'
  );
  for (const match of text.matchAll(pattern)) {
    const reference = normalizeToken(match[2]);
    if (/\d/.test(reference)) references.push(`reference:${reference}`);
  }
  const project = normalizeToken(task.project_id);
  if (
    project.length >= minimumLength &&
    /\d/.test(project) &&
    !['default', 'general', 'internal'].includes(project)
  ) {
    references.push(`project:${project}`);
  }
  return Array.from(new Set(references)).sort();
}

function titleFingerprint(task, rules) {
  const normalized = normalizeToken(task.title).replace(/-/g, ' ').trim();
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 3);
  if (tokens.length < Number(rules.minimumFingerprintTokens || 4)) return null;
  return `${task.board}\0${normalizeToken(task.assignee || 'Rhajaina')}\0${tokens.join('-')}`;
}

function artifactBindings(registry) {
  const byTask = new Map();
  for (const artifact of registry?.artifacts || []) {
    if (!artifact || PRIVATE_SENSITIVITIES.has(String(artifact.sensitivity || '').toLowerCase()))
      continue;
    const taskId = String(artifact.kanban_task || '').trim();
    const topic = normalizeToken(String(artifact.topic || '').replace(/^#/, ''));
    if (!taskId || !topic) continue;
    if (!byTask.has(taskId)) byTask.set(taskId, new Set());
    byTask.get(taskId).add(topic);
  }
  return byTask;
}

class UnionFind {
  constructor(keys, maximumSize) {
    this.parent = new Map(keys.map((key) => [key, key]));
    this.size = new Map(keys.map((key) => [key, 1]));
    this.maximumSize = maximumSize;
  }

  find(key) {
    const parent = this.parent.get(key);
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(left, right) {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return true;
    const combined = this.size.get(a) + this.size.get(b);
    if (this.maximumSize && combined > this.maximumSize) return false;
    const root = a < b ? a : b;
    const child = a < b ? b : a;
    this.parent.set(child, root);
    this.size.set(root, combined);
    return true;
  }
}

function connectByExactKey(tasks, valuesForTask, union, reasonByPair, reason, options = {}) {
  const groups = new Map();
  for (const task of tasks) {
    const key = taskKey(task);
    for (const value of valuesForTask(task)) {
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(key);
    }
  }
  for (const [value, keys] of groups) {
    if (keys.length < 2) continue;
    if (options.maximumGroupSize && keys.length > options.maximumGroupSize) {
      options.uncertainMatches?.push({
        reason: `${reason}_too_broad`,
        matchKey: value,
        candidateCount: keys.length,
        autoMerged: false,
      });
      continue;
    }
    for (const key of keys.slice(1)) {
      if (union.union(keys[0], key)) {
        reasonByPair.push({ left: keys[0], right: key, reason, value });
      } else {
        options.uncertainMatches?.push({
          reason: `${reason}_would_exceed_topic_size`,
          matchKey: value,
          autoMerged: false,
        });
      }
    }
  }
}

function strictestSensitivity(tasks) {
  const values = tasks.map((task) => String(task.sensitivity || 'internal').toLowerCase());
  if (values.some((value) => PRIVATE_SENSITIVITIES.has(value))) return 'restricted';
  if (values.includes('confidential')) return 'confidential';
  if (values.includes('public-candidate')) return 'public-candidate';
  return 'internal';
}

function combinedState(tasks, rules) {
  const states = tasks.map((task) => String(task.status || 'unknown').toLowerCase());
  const priorities = rules.statePriority || [];
  return states.sort((a, b) => {
    const left = priorities.indexOf(a);
    const right = priorities.indexOf(b);
    return (left < 0 ? 999 : left) - (right < 0 ? 999 : right);
  })[0];
}

function sourceTimestamp(task) {
  return Number(task.completed_at || task.started_at || task.created_at || 0);
}

function projectTopics(tasks, options = {}) {
  const rules = { ...defaultRules, ...(options.topicRules || {}) };
  const sortedTasks = [...tasks].sort((a, b) => taskKey(a).localeCompare(taskKey(b)));
  const byKey = new Map(sortedTasks.map((task) => [taskKey(task), task]));
  const byId = new Map();
  for (const task of sortedTasks) {
    const id = String(task.id).toLowerCase();
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(taskKey(task));
  }
  const union = new UnionFind(Array.from(byKey.keys()), Number(rules.maximumTopicSize || 50));
  const mergedBy = [];
  const uncertainMatches = [];

  connectByExactKey(
    sortedTasks,
    (task) => explicitHashtags(task, rules),
    union,
    mergedBy,
    'hashtag',
    {
      maximumGroupSize: Number(rules.maximumHashtagGroupSize || 50),
      uncertainMatches,
    }
  );

  for (const task of sortedTasks) {
    for (const parentId of parentReferences(task)) {
      const candidates = byId.get(parentId) || [];
      if (candidates.length === 1) {
        if (union.union(taskKey(task), candidates[0])) {
          mergedBy.push({
            left: candidates[0],
            right: taskKey(task),
            reason: 'parent_reference',
            value: parentId,
          });
        } else {
          uncertainMatches.push({
            reason: 'parent_reference_would_exceed_topic_size',
            parentId,
            autoMerged: false,
          });
        }
      }
    }
  }

  const artifacts = artifactBindings(options.artifactRegistry);
  connectByExactKey(
    sortedTasks,
    (task) => Array.from(artifacts.get(String(task.id)) || []),
    union,
    mergedBy,
    'artifact_registry',
    { uncertainMatches }
  );

  for (const task of sortedTasks) {
    if (task.scopeDecision?.state !== 'covered') continue;
    for (const match of task.scopeDecision.matches || []) {
      const exact = byKey.get(`${match.sourceBoard}\0${match.sourceTaskId}`);
      if (!exact) continue;
      if (union.union(taskKey(task), taskKey(exact))) {
        mergedBy.push({
          left: taskKey(exact),
          right: taskKey(task),
          reason: 'scope_source_task',
          value: match.scopeId,
        });
      } else {
        uncertainMatches.push({
          reason: 'scope_source_task_would_exceed_topic_size',
          scopeId: match.scopeId,
          autoMerged: false,
        });
      }
    }
  }

  connectByExactKey(
    sortedTasks,
    (task) => conversationReferences(task, rules),
    union,
    mergedBy,
    'conversation_reference',
    { uncertainMatches }
  );

  const fingerprints = new Map();
  for (const task of sortedTasks) {
    const fingerprint = titleFingerprint(task, rules);
    if (!fingerprint) continue;
    if (!fingerprints.has(fingerprint)) fingerprints.set(fingerprint, []);
    fingerprints.get(fingerprint).push(taskKey(task));
  }
  for (const [fingerprint, keys] of fingerprints) {
    if (keys.length < 2) continue;
    if (rules.autoMergeExactFingerprint === true) {
      for (const key of keys.slice(1)) union.union(keys[0], key);
    } else {
      uncertainMatches.push({
        reason: 'same_board_owner_title_fingerprint',
        fingerprint,
        sourceTaskRefs: keys.map((key) => {
          const task = byKey.get(key);
          return { board: task.board, taskId: task.id };
        }),
        autoMerged: false,
      });
    }
  }

  const groups = new Map();
  for (const task of sortedTasks) {
    const root = union.find(taskKey(task));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(task);
  }

  const topicByTask = new Map();
  const topics = Array.from(groups.values()).map((members) => {
    members.sort(
      (a, b) => sourceTimestamp(a) - sourceTimestamp(b) || taskKey(a).localeCompare(taskKey(b))
    );
    const primary = members[0];
    const refs = members.map((task) => ({ board: task.board, taskId: task.id }));
    const seed = refs
      .map((ref) => `${ref.board}/${ref.taskId}`)
      .sort()
      .join('\0');
    const topicId = stableTopicId(seed);
    for (const task of members) topicByTask.set(taskKey(task), topicId);
    const participants = Array.from(
      new Set(members.map((task) => String(task.assignee || 'Rhajaina')).filter(Boolean))
    ).sort();
    const newest = [...members].sort((a, b) => sourceTimestamp(b) - sourceTimestamp(a))[0];
    const artifactRefs = Array.from(
      new Set(
        members.flatMap((task) =>
          (task.attachments || []).map((attachment) => `attachment:${attachment.id}`)
        )
      )
    );
    const wakeup = newest.wakeup || {};
    return {
      topic_id: topicId,
      title: String(primary.title || primary.id),
      business_goal: null,
      owner_agent: String(primary.assignee || 'Rhajaina'),
      participating_agents_json: JSON.stringify(participants),
      current_state: combinedState(members, rules),
      next_step: wakeup.nextAction || wakeup.next_action_on_wake || null,
      expected_progress_at: Number(wakeup.wakeAt || wakeup.wake_at || 0) || null,
      impact_statement: null,
      last_substantive_progress_at: Math.max(...members.map(sourceTimestamp)) || null,
      matrix_room_ref: null,
      artifact_refs_json: JSON.stringify(artifactRefs),
      source_task_refs_json: JSON.stringify(refs),
      sensitivity: strictestSensitivity(members),
      updated_at: sourceTimestamp(newest),
    };
  });

  return {
    topics,
    topicByTask,
    diagnostics: {
      sourceTasks: sortedTasks.length,
      topics: topics.length,
      aggregatedTopics: topics.filter((topic) => JSON.parse(topic.source_task_refs_json).length > 1)
        .length,
      mergedTaskCount: sortedTasks.length - topics.length,
      mergeEvidence: mergedBy,
      uncertainMatches,
      uncertainAutoMergeCount: 0,
    },
  };
}

module.exports = {
  conversationReferences,
  explicitHashtags,
  parentReferences,
  projectTopics,
  readArtifactRegistry,
  stableTopicId,
  titleFingerprint,
};
