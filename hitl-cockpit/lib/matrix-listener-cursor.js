'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Durable `next_batch` checkpoint for the Matrix result listener.
//
// Written atomically (temp file + rename) so a crash between writes can
// never leave a half-written, unparsable cursor file. On first run, or if
// the file is missing/corrupt, the listener starts from `since: null`,
// which is the Matrix sync contract for "give me the current position but
// do not replay history" when combined with a fresh server-side sync.
function createMatrixListenerCursor(options = {}) {
  const file = path.resolve(
    options.file || path.join(process.env.HOME || '/home/clawd', '.hermes', 'agent-os', 'matrix-result-listener-cursor.json')
  );

  function read() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { since: null };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.since === 'string' && parsed.since) {
        return { since: parsed.since };
      }
      return { since: null };
    } catch (_error) {
      // A corrupt cursor must never crash the listener; resync from "now".
      return { since: null };
    }
  }

  function write(since) {
    if (since != null && typeof since !== 'string') {
      throw new Error('matrix_listener_cursor_invalid');
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const payload = `${JSON.stringify({ since: since || null, updatedAt: new Date().toISOString() }, null, 2)}\n`;
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, payload, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  return { file, read, write };
}

module.exports = { createMatrixListenerCursor };
