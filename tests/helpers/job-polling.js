'use strict';

/**
 * Job Polling Helper for Tests
 *
 * Utility for waiting for async job completion with intermediate progress visibility.
 * Simplifies test flows that exercise long-running operations (60–120s expected).
 *
 * Usage:
 *   const job = await waitForJobCompletion(jobId, {
 *     maxWaitMs: 300000,
 *     pollIntervalMs: 5000,
 *     onProgress: (job) => console.log(`Progress: ${job.percent}%`)
 *   });
 */

const jobStore = require('../../src/job-store');

/**
 * Wait for a job to complete (or error) with optional progress callback.
 *
 * @param {string} jobId - Job ID to wait for
 * @param {Object} [options={}] - Polling options
 * @param {number} [options.maxWaitMs=300000] - Max time to wait in milliseconds
 * @param {number} [options.pollIntervalMs=5000] - How often to poll in milliseconds
 * @param {Function} [options.onProgress] - Callback called on each poll: (job) => void
 * @returns {Promise<Object>} Completed job record
 * @throws {Error} if job not found or timeout exceeded
 */
async function waitForJobCompletion(jobId, options = {}) {
  const { maxWaitMs = 300000, pollIntervalMs = 5000, onProgress = null } = options;

  if (!jobId) {
    throw new Error('jobId is required');
  }

  const startedAt = Date.now();
  let lastJob = null;

  while (Date.now() - startedAt < maxWaitMs) {
    const job = jobStore.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    lastJob = job;

    // Invoke progress callback if provided
    if (typeof onProgress === 'function') {
      try {
        onProgress({
          jobId,
          status: job.status,
          phase: job.phase,
          percent: job.percent,
          logs: Array.isArray(job.logs) ? job.logs : [],
          error: job.error || null,
        });
      } catch (err) {
        // Silently ignore callback errors to not break polling
      }
    }

    // Job completed or error
    if (['completed', 'error'].includes(job.status)) {
      return job;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout exceeded
  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  const lastPhase = lastJob?.phase || 'unknown';
  const lastPercent = lastJob?.percent || 0;
  throw new Error(
    `Job ${jobId} did not complete within ${maxWaitMs}ms ` +
      `(elapsed: ${elapsedS}s, last phase: ${lastPhase}, progress: ${lastPercent}%)`
  );
}

/**
 * Get all logs from a job for inspection.
 * Useful for debugging or asserting on progress events.
 *
 * @param {string} jobId
 * @returns {Array} Logs array or empty array if not found
 */
function getJobLogs(jobId) {
  const job = jobStore.getJob(jobId);
  if (!job) return [];
  return Array.isArray(job.logs) ? job.logs : [];
}

/**
 * Find a log entry by phase.
 * Useful for asserting that a specific phase was logged.
 *
 * @param {string} jobId
 * @param {string} phase
 * @returns {Object|null} Log entry or null if not found
 */
function findLogByPhase(jobId, phase) {
  const logs = getJobLogs(jobId);
  return logs.find((log) => log.phase === phase) || null;
}

/**
 * Get all log phases in order.
 * Useful for understanding the execution flow.
 *
 * @param {string} jobId
 * @returns {Array<string>} Array of phases
 */
function getLogPhases(jobId) {
  return getJobLogs(jobId).map((log) => log.phase);
}

module.exports = {
  waitForJobCompletion,
  getJobLogs,
  findLogByPhase,
  getLogPhases,
};
