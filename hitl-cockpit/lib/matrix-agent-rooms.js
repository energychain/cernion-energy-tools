'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOM_REF_PATTERN = /^!\S{6,}:[a-z0-9.-]+$/i;
const DEFAULT_ROOM_NAMES = Object.freeze({
  Rhajaina: 'Assistenz',
  Felix: 'Geschäftsentwicklung',
  Anja: 'Finance',
  Viki: 'Strategy / Market',
  Cori: 'B2C Corrently',
  DevOps: 'Software Dev',
  Infrastructure: 'Infrastructure',
});

function safeRoomRef(value) {
  const roomRef = typeof value === 'string' ? value.trim() : '';
  const normalized = roomRef.normalize('NFKC').toLowerCase();
  if (!ROOM_REF_PATTERN.test(roomRef) || /(?:private|secret|restricted|twl)/i.test(normalized)) {
    throw new Error('matrix_agent_room_invalid');
  }
  return roomRef;
}

function readJsonFile(file, maxBytes = 256 * 1024) {
  const resolved = path.resolve(file);
  const linkStat = fs.lstatSync(resolved);
  if (linkStat.isSymbolicLink()) throw new Error('matrix_agent_rooms_invalid');
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('matrix_agent_rooms_invalid');
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('matrix_agent_rooms_invalid');
  }
  return value;
}

function loadMatrixAgentRooms(options = {}) {
  const agents = options.agents || readJsonFile(options.agentsPath);
  const source =
    options.matrixAgentRooms ||
    readJsonFile(options.roomsPath || '/home/clawd/.hermes/matrix-agent-rooms.json');
  const rooms = source.rooms && typeof source.rooms === 'object' ? source.rooms : source;
  const roomNames = { ...DEFAULT_ROOM_NAMES, ...(options.roomNames || {}) };
  const result = {};
  for (const agent of agents.agents || []) {
    if (!agent || typeof agent.id !== 'string') continue;
    const aliases = [agent.id, ...(Array.isArray(agent.aliases) ? agent.aliases : [])]
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean);
    const injected = aliases.map((alias) => source[alias]).find(Boolean) || source[agent.id];
    const roomRef = injected || rooms[roomNames[agent.id]];
    if (!roomRef) throw new Error('matrix_agent_room_missing');
    const validated = safeRoomRef(roomRef);
    for (const alias of aliases) result[alias] = validated;
  }
  return Object.freeze(result);
}

module.exports = { DEFAULT_ROOM_NAMES, loadMatrixAgentRooms, safeRoomRef };
