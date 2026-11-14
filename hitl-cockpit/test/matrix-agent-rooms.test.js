'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { loadMatrixAgentRooms, safeRoomRef } = require('../lib/matrix-agent-rooms');

test('loads trusted fallback rooms for Anja, Cori and Infrastructure through ids and aliases', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-agent-rooms-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentsPath = path.join(root, 'agents.json');
  const roomsPath = path.join(root, 'rooms.json');
  fs.writeFileSync(
    agentsPath,
    JSON.stringify({
      agents: [
        { id: 'Anja', aliases: ['finance-agent'] },
        { id: 'Cori', aliases: ['corrently'] },
        { id: 'Infrastructure', aliases: ['infra'] },
      ],
    })
  );
  fs.writeFileSync(
    roomsPath,
    JSON.stringify({
      rooms: {
        Finance: '!finance1:matrix.example.org',
        'B2C Corrently': '!corrently1:matrix.example.org',
        Infrastructure: '!infra001:matrix.example.org',
      },
    })
  );
  const mapping = loadMatrixAgentRooms({ agentsPath, roomsPath });
  assert.equal(mapping.anja, '!finance1:matrix.example.org');
  assert.equal(mapping['finance-agent'], mapping.anja);
  assert.equal(mapping.cori, '!corrently1:matrix.example.org');
  assert.equal(mapping.corrently, mapping.cori);
  assert.equal(mapping.infrastructure, '!infra001:matrix.example.org');
  assert.equal(mapping.infra, mapping.infrastructure);
});

test('accepts injected alias mappings and rejects invalid, sensitive and TWL rooms', () => {
  const agents = { agents: [{ id: 'Anja', aliases: ['finance-agent'] }] };
  const mapping = loadMatrixAgentRooms({
    agents,
    matrixAgentRooms: { 'finance-agent': '!safeRoom:matrix.example.org' },
  });
  assert.equal(mapping.anja, '!safeRoom:matrix.example.org');
  for (const room of [
    'not-a-room',
    '!private1:matrix.example.org',
    '!twlroom1:matrix.example.org',
  ]) {
    assert.throws(() => safeRoomRef(room), /matrix_agent_room_invalid/);
  }
});

test('requires a trusted fallback for every configured agent', () => {
  assert.throws(
    () =>
      loadMatrixAgentRooms({
        agents: { agents: [{ id: 'Felix', aliases: ['felix'] }] },
        matrixAgentRooms: {},
      }),
    /matrix_agent_room_missing/
  );
});
