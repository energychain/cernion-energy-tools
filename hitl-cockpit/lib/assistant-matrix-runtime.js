'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseEnvFile(file) {
  const values = {};
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function matrixEndpoint(homeserver, pathname) {
  const base = new URL(homeserver);
  if (
    base.protocol !== 'https:' &&
    base.hostname !== '127.0.0.1' &&
    base.hostname !== 'localhost'
  ) {
    throw new Error('matrix_homeserver_insecure');
  }
  return new URL(pathname, `${base.origin}/`).toString();
}

function createAssistantMatrixRuntime(options = {}) {
  const profileHome = path.resolve(
    options.profileHome ||
      process.env.ASSISTANT_MATRIX_PROFILE_HOME ||
      '/home/clawd/.hermes/profiles/rhajaina'
  );
  const env = parseEnvFile(path.join(profileHome, '.env'));
  const homeserver = String(env.MATRIX_HOMESERVER || '').trim();
  const accessToken = String(env.MATRIX_ACCESS_TOKEN || '').trim();
  if (!homeserver || !accessToken) throw new Error('matrix_profile_not_configured');

  async function request(method, pathname, body) {
    const response = await fetch(matrixEndpoint(homeserver, pathname), {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`matrix_http_${response.status}`);
    return response.json();
  }

  return {
    async sender({ roomRef, content, handoffId }) {
      const transactionId = crypto
        .createHash('sha256')
        .update(`assistant:${handoffId}`)
        .digest('hex');
      return request(
        'PUT',
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomRef)}/send/m.room.message/${transactionId}`,
        content
      );
    },
    async readback({ roomRef, eventId }) {
      return request(
        'GET',
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomRef)}/event/${encodeURIComponent(eventId)}`
      );
    },
    async sync({ since = null, timeoutMs = 0, limit = 20 } = {}) {
      const timeout = Math.max(0, Math.min(30000, Number(timeoutMs) || 0));
      const timelineLimit = Math.max(1, Math.min(50, Number(limit) || 20));
      const filter = JSON.stringify({
        room: {
          timeline: { limit: timelineLimit, types: ['m.room.message'] },
          state: { types: [], lazy_load_members: true },
          ephemeral: { types: [] },
          account_data: { types: [] },
        },
        presence: { types: [] },
        account_data: { types: [] },
      });
      const query = new URLSearchParams({ timeout: String(timeout), filter });
      if (since) query.set('since', String(since));
      const response = await request('GET', `/_matrix/client/v3/sync?${query.toString()}`);
      const events = [];
      for (const [roomId, room] of Object.entries(response.rooms?.join || {})) {
        for (const event of room.timeline?.events || []) {
          if (event.type !== 'm.room.message' || typeof event.content?.body !== 'string') continue;
          events.push({
            roomId,
            eventId: event.event_id,
            sender: event.sender,
            body: event.content.body,
            replyToEventId: event.content['m.relates_to']?.['m.in_reply_to']?.event_id || null,
          });
        }
      }
      return { nextBatch: response.next_batch || null, events };
    },
  };
}

module.exports = { createAssistantMatrixRuntime, matrixEndpoint, parseEnvFile };
