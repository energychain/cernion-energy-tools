'use strict';

// Background reflections per conversation: at most one runs; a turn that ends meanwhile leaves
// one follow-up (the latest replaces an earlier waiting one), which runs when the current one
// finishes. Shared by the workbench and the personal agent.
function createReflectionQueue() {
  const running = new Map();
  const waiting = new Map();

  function schedule(key, run) {
    if (running.has(key)) {
      waiting.set(key, run);
      return running.get(key);
    }
    const job = Promise.resolve()
      .then(run)
      .finally(() => {
        running.delete(key);
        const next = waiting.get(key);
        if (next) {
          waiting.delete(key);
          schedule(key, next);
        }
      });
    running.set(key, job);
    return job;
  }

  // Resolves when the conversation has no running or waiting reflection (tests, shutdown).
  async function settled(key) {
    while (running.has(key)) await running.get(key).catch(() => {});
  }

  return { schedule, settled, isRunning: (key) => running.has(key) };
}

module.exports = { createReflectionQueue };
