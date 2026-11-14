'use strict';

module.exports = {
  apps: [
    {
      name: 'agentos-hitl-projection-loop',
      script: 'bin/run-projection-loop.js',
      cwd: __dirname,
      interpreter: process.execPath,
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 110000,
      env: {
        PROJECTION_INTERVAL_SECONDS: '120',
        PROJECTION_BUDGET_SECONDS: '100',
        PROJECTION_BACKOFF_SECONDS: '30',
      },
    },
  ],
};
