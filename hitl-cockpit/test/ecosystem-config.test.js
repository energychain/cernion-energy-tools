'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const ecosystem = require('../ecosystem.config');

test('PM2 projection loop has reproducible bounded production defaults', () => {
  assert.equal(ecosystem.apps.length, 1);
  const app = ecosystem.apps[0];
  assert.equal(app.name, 'agentos-hitl-projection-loop');
  assert.equal(app.cwd, path.resolve(__dirname, '..'));
  assert.equal(app.script, 'bin/run-projection-loop.js');
  assert.equal(app.autorestart, true);
  assert.ok(app.restart_delay >= 1000);
  assert.ok(Number(app.env.PROJECTION_INTERVAL_SECONDS) <= 180);
  assert.ok(Number(app.env.PROJECTION_BUDGET_SECONDS) <= 100);
  assert.ok(app.kill_timeout > Number(app.env.PROJECTION_BUDGET_SECONDS) * 1000);
  assert.equal(
    Object.keys(app.env).some((key) => /TOKEN|SECRET|PASSWORD|KEY/.test(key)),
    false
  );
});
