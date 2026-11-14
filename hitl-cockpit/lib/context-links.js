'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const PRIVATE_BOARDS = new Set(['twl-netze-private']);
const PRIVATE_SENSITIVITIES = new Set([
  'twl-private',
  'twl-netze-private',
  'private',
  'private-quarantine',
  'secret',
  'restricted',
  'mixed-sensitive',
]);
const TERMINAL_STATUSES = new Set([
  'done',
  'completed',
  'closed',
  'resolved',
  'rejected',
  'cancelled',
  'archived',
]);
const OWNER_ROOMS = Object.freeze({
  Rhajaina: 'Assistenz',
  Felix: 'Geschäftsentwicklung',
  Anja: 'Finance',
  Viki: 'Strategy / Market',
  Cori: 'B2C Corrently',
  DevOps: 'Software Dev',
  Infrastructure: 'Infrastructure',
});
const NEXTCLOUD_FILES_URL = 'https://nextcloud.stromdao.de/nextcloud/index.php/apps/files/';

function normalizeToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function taskText(task) {
  return [
    task.title,
    task.body,
    task.result,
    task.decisionQuestion,
    ...(task.comments || []).map((comment) => comment.body || comment.text),
  ]
    .filter(Boolean)
    .join('\n');
}

function isSanitizedBridge(value) {
  const text = typeof value === 'string' ? value : taskText(value || {});
  return (
    /\b(?:STEERING_SIGNAL|SANITIZED_EXPORT|SANITIZED_BRIDGE)\b/i.test(text) ||
    value?.sanitizedForBridge === true
  );
}

function hasPrivateOriginMarker(task) {
  const text = taskText(task || {});
  return (
    /\bTWL[_ -]?PRIVATE(?:[_ -]?(?:REFLECTION|CONTEXT|DATA|RAW))?\b/i.test(text) ||
    /\btwl-netze-private\b/i.test(text)
  );
}

function isPrivateTask(task) {
  const board = String(task?.board || '').toLowerCase();
  const sensitivity = String(task?.sensitivity || '').toLowerCase();
  const domain = String(task?.domain || task?.tenant || '').toLowerCase();
  if (
    PRIVATE_BOARDS.has(board) ||
    PRIVATE_SENSITIVITIES.has(sensitivity) ||
    hasPrivateOriginMarker(task)
  )
    return true;
  if (task?.sensitivityUnclear === true) return true;
  if (board === 'twl-netze-bridge') return !isSanitizedBridge(task);
  return /(^|[-_/])twl(?:-netze)?($|[-_/])/.test(domain) && !isSanitizedBridge(task);
}

function isPrivateArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') return true;
  const sensitivity = String(artifact.sensitivity || '').toLowerCase();
  const domain = String(artifact.domain || '').toLowerCase();
  const artifactPath = String(artifact.nextcloud_path || artifact.path || '').toLowerCase();
  if (PRIVATE_SENSITIVITIES.has(sensitivity)) return true;
  const twlOrigin =
    /(^|[-_/])twl(?:-netze)?($|[-_/])/.test(domain) || /(^|\/)twl-netze(?:\/|$)/.test(artifactPath);
  return twlOrigin && artifact.sanitized_for_bridge !== true;
}

function readRoomRegistry(registryPath) {
  if (!registryPath) return { rooms: {}, diagnostics: { available: false } };
  try {
    const descriptor = fs.openSync(registryPath, 'r');
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } finally {
      fs.closeSync(descriptor);
    }
    const rooms = parsed && parsed.rooms;
    if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms)) {
      throw new Error('invalid_room_registry');
    }
    return { rooms, diagnostics: { available: true, roomCount: Object.keys(rooms).length } };
  } catch (error) {
    return {
      rooms: {},
      diagnostics: { available: false, error: error.code || error.message },
    };
  }
}

function validRoomId(value) {
  return typeof value === 'string' && /^![^\s:]{6,}:[a-z0-9.-]+$/i.test(value);
}

function explicitHashtags(task) {
  return Array.from(
    new Set(
      (taskText(task).match(/#[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) || []).map((tag) =>
        normalizeToken(tag.slice(1))
      )
    )
  );
}

function roomForTopic(topic, members, roomRegistry) {
  const rooms = roomRegistry?.rooms || {};
  const safeMembers = members.filter((task) => !isPrivateTask(task));
  if (!safeMembers.length) return null;

  const explicit = safeMembers
    .flatMap((task) => [
      task.matrix_room_ref,
      task.matrixRoomRef,
      task.matrix_room_id,
      task.room_id,
    ])
    .find(validRoomId);
  if (explicit) return explicit;

  const hashtags = new Set(safeMembers.flatMap(explicitHashtags));
  for (const [name, roomId] of Object.entries(rooms)) {
    if (!validRoomId(roomId) || /^TWL-Netze(?:\s|$)/i.test(name)) continue;
    const match = name.match(/#([\p{L}\p{N}_-]{3,})/u);
    if (match && hashtags.has(normalizeToken(match[1]))) return roomId;
  }

  const roomName = OWNER_ROOMS[topic.owner_agent];
  const roomId = roomName ? rooms[roomName] : null;
  return validRoomId(roomId) ? roomId : null;
}

function nextcloudArtifactUrl(value) {
  const artifactPath = String(value || '')
    .trim()
    .replace(/^\/+/, '');
  if (!artifactPath || artifactPath.includes('\0') || artifactPath.split('/').includes('..')) {
    return null;
  }
  const parts = artifactPath.split('/').filter(Boolean);
  if (!parts.length) return null;
  const filename = parts.pop();
  const url = new URL(NEXTCLOUD_FILES_URL);
  url.searchParams.set('dir', `/${parts.join('/')}`);
  url.searchParams.set('scrollto', filename);
  return url.toString();
}

function safeArtifactReference(artifact) {
  const nextcloudPath = String(artifact.nextcloud_path || '');
  return {
    id: String(artifact.id || ''),
    kind: String(artifact.kind || ''),
    title: String(artifact.title || ''),
    nextcloudPath,
    href: nextcloudArtifactUrl(nextcloudPath),
    status: String(artifact.status || ''),
  };
}

function artifactReferencesForTopic(topic, members, artifactRegistry) {
  const taskIds = new Set(members.map((task) => String(task.id)));
  const hashtags = new Set(members.flatMap(explicitHashtags));
  const references = [];
  for (const artifact of artifactRegistry?.artifacts || []) {
    if (isPrivateArtifact(artifact)) continue;
    const taskMatch = taskIds.has(String(artifact.kanban_task || ''));
    const topicMatch = hashtags.has(normalizeToken(String(artifact.topic || '').replace(/^#/, '')));
    if (!taskMatch && !topicMatch) continue;
    const reference = safeArtifactReference(artifact);
    if (!reference.id) continue;
    references.push(reference);
  }
  return Array.from(new Map(references.map((item) => [item.id, item])).values()).sort((a, b) =>
    a.id.localeCompare(b.id)
  );
}

function extractDecisionId(task) {
  for (const value of [task.decision_id, task.decisionId]) {
    if (typeof value === 'string' && /^decision_[a-z0-9_-]{8,96}$/i.test(value)) return value;
  }
  const match = taskText(task).match(/\bDECISION_ID\s*[:=]\s*(decision_[a-z0-9_-]{8,96})\b/i);
  return match ? match[1] : null;
}

function normalizedQuestion(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9äöüß ]+/g, '')
    .trim();
}

function strongQuestionIdentity(decision, task, topic) {
  const question = normalizedQuestion(decision.question);
  const tokens = question.split(/\s+/).filter((token) => token.length >= 3);
  if (question.length < 32 || tokens.length < 5) return null;
  const resource = normalizeToken(
    task.decision_resource || task.resource_id || task.project_id || task.case_id || ''
  );
  const sensitivity = String(topic?.sensitivity || task.sensitivity || 'internal').toLowerCase();
  return [decision.topic_id, decision.decision_class, sensitivity, resource, question].join('\0');
}

function hashedDecisionId(identity) {
  return `decision_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function decisionIdentity(decision, task, topic) {
  const explicitId = extractDecisionId(task);
  if (explicitId)
    return { key: `explicit:${explicitId}`, decisionId: explicitId, strength: 'explicit' };
  const strong = strongQuestionIdentity(decision, task, topic);
  if (strong)
    return { key: `strong:${strong}`, decisionId: hashedDecisionId(strong), strength: 'strong' };
  return {
    key: `source:${task.board}\0${task.id}`,
    decisionId: decision.decision_id,
    strength: 'source',
  };
}

function completeness(decision) {
  return [
    decision.recommendation,
    decision.non_decision_effect,
    JSON.parse(decision.options_json || '[]').length,
    JSON.parse(decision.consequences_json || '[]').length,
  ].filter(Boolean).length;
}

function sourceRef(task) {
  return {
    board: String(task.board),
    taskId: String(task.id),
    channel: task.matrix_event_id || task.matrixEventId ? 'matrix' : 'kanban',
    matrixEventId: task.matrix_event_id || task.matrixEventId || null,
  };
}

function deduplicateDecisions(decisions, tasks, topics) {
  const taskByKey = new Map(
    tasks.filter((task) => !isPrivateTask(task)).map((task) => [`${task.board}\0${task.id}`, task])
  );
  const topicById = new Map(topics.map((topic) => [topic.topic_id, topic]));
  const groups = new Map();
  const diagnostics = {
    duplicateGroups: 0,
    mergedSources: 0,
    resolvedByOtherSource: 0,
    uncertainGroups: [],
  };

  for (const decision of decisions) {
    const task = taskByKey.get(`${decision.source_board}\0${decision.source_task_id}`);
    if (!task) continue;
    const identity = decisionIdentity(decision, task, topicById.get(decision.topic_id));
    if (!groups.has(identity.key)) groups.set(identity.key, { identity, entries: [] });
    groups.get(identity.key).entries.push({ decision, task });
  }

  const terminalByExplicitId = new Map();
  for (const task of taskByKey.values()) {
    const explicitId = extractDecisionId(task);
    if (!explicitId || !TERMINAL_STATUSES.has(String(task.status || '').toLowerCase())) continue;
    if (!terminalByExplicitId.has(explicitId)) terminalByExplicitId.set(explicitId, []);
    terminalByExplicitId.get(explicitId).push(task);
  }

  const output = [];
  for (const group of groups.values()) {
    const ranked = [...group.entries].sort(
      (left, right) =>
        completeness(right.decision) - completeness(left.decision) ||
        Number(left.decision.first_projected_at || 0) -
          Number(right.decision.first_projected_at || 0) ||
        `${left.task.board}/${left.task.id}`.localeCompare(`${right.task.board}/${right.task.id}`)
    );
    const primary = ranked[0];
    const refs = ranked.map((entry) => sourceRef(entry.task));
    const explicitTerminals =
      group.identity.strength === 'explicit'
        ? terminalByExplicitId.get(group.identity.decisionId) || []
        : [];
    for (const task of explicitTerminals) refs.push(sourceRef(task));
    const uniqueRefs = Array.from(
      new Map(refs.map((ref) => [`${ref.board}\0${ref.taskId}`, ref])).values()
    );
    const resolved = explicitTerminals.length > 0;
    if (ranked.length > 1) {
      diagnostics.duplicateGroups += 1;
      diagnostics.mergedSources += ranked.length - 1;
    }
    if (resolved) diagnostics.resolvedByOtherSource += 1;
    output.push({
      ...primary.decision,
      decision_id:
        group.identity.strength === 'source'
          ? primary.decision.decision_id
          : group.identity.decisionId,
      status: resolved ? 'resolved' : primary.decision.status,
      source_refs_json: JSON.stringify(uniqueRefs),
      updated_at: Math.max(
        ...ranked.map((entry) => Number(entry.decision.updated_at || 0)),
        ...explicitTerminals.map((task) => Number(task.completed_at || task.created_at || 0))
      ),
    });
  }

  return { decisions: output, diagnostics };
}

function projectContextLinks({ tasks, topics, decisions, artifactRegistry, roomRegistry }) {
  const safeTasks = tasks.filter((task) => !isPrivateTask(task));
  const taskByKey = new Map(safeTasks.map((task) => [`${task.board}\0${task.id}`, task]));
  for (const topic of topics) {
    const members = JSON.parse(topic.source_task_refs_json || '[]')
      .map((ref) => taskByKey.get(`${ref.board}\0${ref.taskId || ref.task_id}`))
      .filter(Boolean);
    topic.matrix_room_ref = roomForTopic(topic, members, roomRegistry);
    topic.artifact_refs_json = JSON.stringify(
      artifactReferencesForTopic(topic, members, artifactRegistry)
    );
  }
  const decisionProjection = deduplicateDecisions(decisions, safeTasks, topics);
  return {
    decisions: decisionProjection.decisions,
    diagnostics: {
      linkedRooms: topics.filter((topic) => topic.matrix_room_ref).length,
      linkedArtifacts: topics.reduce(
        (sum, topic) => sum + JSON.parse(topic.artifact_refs_json || '[]').length,
        0
      ),
      ...decisionProjection.diagnostics,
    },
  };
}

function decisionMarker(decisionId) {
  if (!/^decision_[a-z0-9_-]{8,96}$/i.test(String(decisionId || ''))) {
    throw new Error('invalid_decision_id');
  }
  return `DECISION_ID: ${decisionId}`;
}

module.exports = {
  decisionIdentity,
  decisionMarker,
  deduplicateDecisions,
  extractDecisionId,
  isPrivateArtifact,
  isPrivateTask,
  isSanitizedBridge,
  nextcloudArtifactUrl,
  projectContextLinks,
  readRoomRegistry,
  roomForTopic,
};
