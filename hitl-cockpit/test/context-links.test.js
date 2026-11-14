'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  decisionMarker,
  deduplicateDecisions,
  isPrivateArtifact,
  isPrivateTask,
  projectContextLinks,
} = require('../lib/context-links');
const { buildProjection } = require('../lib/projector');

function task(board, id, overrides = {}) {
  return {
    id,
    board,
    title: `Task ${id}`,
    body: '',
    result: '',
    assignee: 'Felix',
    status: 'blocked',
    block_kind: 'needs_input',
    created_at: 1700000000,
    comments: [],
    attachments: [],
    ...overrides,
  };
}

function decision(source, overrides = {}) {
  return {
    decision_id: `decision_${source.id}`,
    topic_id: 'topic_case',
    source_board: source.board,
    source_task_id: source.id,
    decision_class: 'governance',
    question: 'Soll das verbindliche Angebot mit dem dokumentierten Preis jetzt versendet werden?',
    reason_human_required: 'binding offer',
    recommendation: null,
    options_json: '[]',
    consequences_json: '[]',
    status: source.status,
    first_projected_at: source.created_at,
    updated_at: source.created_at,
    ...overrides,
  };
}

const topic = {
  topic_id: 'topic_case',
  owner_agent: 'Felix',
  sensitivity: 'internal',
  source_task_refs_json: '[]',
  artifact_refs_json: '[]',
  matrix_room_ref: null,
};

test('explicit decision identity deduplicates Matrix and Kanban sources', () => {
  const id = 'decision_shared_2026_001';
  const kanban = task('sales', 't_kanban01', { decision_id: id });
  const matrix = task('matrix-intake', 't_matrix01', {
    body: decisionMarker(id),
    matrix_event_id: '$event-one',
  });
  const result = deduplicateDecisions(
    [decision(kanban), decision(matrix)],
    [kanban, matrix],
    [topic]
  );
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].decision_id, id);
  assert.equal(JSON.parse(result.decisions[0].source_refs_json).length, 2);
  assert.deepEqual(
    JSON.parse(result.decisions[0].source_refs_json)
      .map((ref) => ref.channel)
      .sort(),
    ['kanban', 'matrix']
  );
  assert.equal(result.diagnostics.duplicateGroups, 1);
});

test('a resolved Matrix source closes the same canonical decision', () => {
  const id = 'decision_shared_2026_002';
  const open = task('sales', 't_open0001', { decision_id: id });
  const answer = task('matrix-intake', 't_answer01', {
    body: `${decisionMarker(id)}\nOption A gewählt.`,
    status: 'done',
    completed_at: 1700000500,
    matrix_event_id: '$event-two',
  });
  const result = deduplicateDecisions([decision(open)], [open, answer], [topic]);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].status, 'resolved');
  assert.equal(JSON.parse(result.decisions[0].source_refs_json).length, 2);
  assert.equal(result.diagnostics.resolvedByOtherSource, 1);
});

test('short or merely similar questions remain separate without a strong identity', () => {
  const left = task('sales', 't_left0001');
  const right = task('sales', 't_right001');
  const result = deduplicateDecisions(
    [
      decision(left, { question: 'Angebot freigeben?' }),
      decision(right, { question: 'Angebot freigeben?' }),
    ],
    [left, right],
    [topic]
  );
  assert.equal(result.decisions.length, 2);
  assert.equal(result.diagnostics.duplicateGroups, 0);
});

test('topic context links use configured Fachraum and only non-private artifacts', () => {
  const source = task('sales', 't_case0001', {
    title: 'CET Pilot #CETPilotNord',
    status: 'ready',
  });
  const projectedTopic = {
    ...topic,
    source_task_refs_json: JSON.stringify([{ board: source.board, taskId: source.id }]),
  };
  const result = projectContextLinks({
    tasks: [source],
    topics: [projectedTopic],
    decisions: [],
    roomRegistry: {
      rooms: {
        Geschäftsentwicklung: '!general:matrix.example.org',
        'Geschäftsentwicklung · #CETPilotNord': '!special:matrix.example.org',
        'TWL-Netze · #CETPilotNord': '!private:matrix.example.org',
      },
    },
    artifactRegistry: {
      artifacts: [
        {
          id: 'a_public',
          kanban_task: source.id,
          title: 'Arbeitsstand',
          nextcloud_path: 'Cernion/Arbeitsstand.md',
          sensitivity: 'internal',
          domain: 'cernion',
        },
        {
          id: 'a_twl_raw',
          kanban_task: source.id,
          title: 'Vertraulicher Rohstand',
          nextcloud_path: 'TWL-Netze/Intern/Rohstand.md',
          sensitivity: 'twl-private',
          domain: 'twl-netze',
        },
      ],
    },
  });
  assert.equal(projectedTopic.matrix_room_ref, '!special:matrix.example.org');
  assert.deepEqual(
    JSON.parse(projectedTopic.artifact_refs_json).map((item) => item.id),
    ['a_public']
  );
  assert.equal(JSON.stringify(result).includes('Vertraulicher Rohstand'), false);
  assert.equal(result.diagnostics.linkedRooms, 1);
  assert.equal(result.diagnostics.linkedArtifacts, 1);
});

test('owner room lookup tolerates normalized lowercase Kanban assignees', () => {
  const source = task('operations', 't_lowercase_owner', {
    assignee: 'rhajaina',
    status: 'ready',
  });
  const projectedTopic = {
    ...topic,
    owner_agent: 'rhajaina',
    source_task_refs_json: JSON.stringify([{ board: source.board, taskId: source.id }]),
  };
  projectContextLinks({
    tasks: [source],
    topics: [projectedTopic],
    decisions: [],
    roomRegistry: { rooms: { Assistenz: '!assistenz:example.org' } },
    artifactRegistry: { artifacts: [] },
  });
  assert.equal(projectedTopic.matrix_room_ref, '!assistenz:example.org');
});

test('TWL-private tasks, raw bridge tasks and TWL artifacts are blocked at projection boundary', () => {
  assert.equal(isPrivateTask(task('twl-netze-private', 't_private1')), true);
  assert.equal(isPrivateTask(task('twl-netze-bridge', 't_raw00001')), true);
  assert.equal(
    isPrivateTask(
      task('twl-netze-bridge', 't_safe0001', { title: '[STEERING_SIGNAL] Abstrakter Hinweis' })
    ),
    false
  );
  assert.equal(
    isPrivateArtifact({
      domain: 'twl-netze',
      sensitivity: 'internal',
      nextcloud_path: 'TWL-Netze/AgentOS/raw.md',
    }),
    true
  );
});

test('private-origin markers remain excluded after forwarding to a general board', () => {
  const forwarded = task('agenticcoo-for-dec', 't_forward1', {
    title: '[FOR-DEC][TWL_PRIVATE_REFLECTION] Sanitized-looking management prompt',
    body: 'SANITIZED_BRIDGE: abstract signal without raw source text',
  });
  assert.equal(isPrivateTask(forwarded), true);

  const projection = buildProjection(
    { errors: [], boards: [{ board: forwarded.board, items: [forwarded] }] },
    { artifactRegistry: { artifacts: [] }, roomRegistry: { rooms: {} } }
  );
  assert.equal(projection.topics.length, 0);
  assert.equal(projection.decisions.length, 0);
  assert.equal(projection.digestItems.length, 0);
  assert.equal(JSON.stringify(projection.agentBriefs).includes('TWL_PRIVATE_REFLECTION'), false);
});

test('full projection contains no raw TWL titles, paths, room ids or decision questions', () => {
  const publicTask = task('sales', 't_public01', {
    title: 'Öffentliche Richtungsfrage #PublicCase',
    decision_id: 'decision_public_2026_01',
  });
  const rawTask = task('twl-netze-private', 't_private1', {
    title: 'TWL Rohfall Person X',
    decisionQuestion: 'TWL vertrauliche Frage?',
  });
  const projection = buildProjection(
    {
      errors: [],
      boards: [
        { board: 'sales', items: [publicTask] },
        { board: 'twl-netze-private', items: [rawTask] },
      ],
    },
    {
      roomRegistry: {
        rooms: {
          Geschäftsentwicklung: '!sales:matrix.example.org',
          'TWL-Netze': '!twlsecret:matrix.example.org',
        },
      },
      artifactRegistry: {
        artifacts: [
          {
            id: 'a_twl_secret',
            kanban_task: publicTask.id,
            title: 'TWL geheimer Titel',
            nextcloud_path: 'TWL-Netze/Geheim/akte.md',
            sensitivity: 'twl-private',
            domain: 'twl-netze',
          },
        ],
      },
    }
  );
  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    'TWL Rohfall Person X',
    'TWL vertrauliche Frage',
    'TWL geheimer Titel',
    'TWL-Netze/Geheim',
    '!twlsecret:matrix.example.org',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
