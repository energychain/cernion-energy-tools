/**
 * Async Job Poller for MCP Tools
 *
 * Handles automatic polling of async MCP jobs until completion.
 * Some MCP tools (e.g., cernion_redispatch_export, cernion_grid_data)
 * return job IDs for long-running operations that require polling.
 */

const CernionMCPClient = require('./mcp-client');

/**
 * Poll an async job until completion
 *
 * @param {string} jobId - Job ID to poll
 * @param {object} options - Polling options
 * @param {number} options.maxWaitTime - Maximum time to wait in ms (default: 600000 = 10 minutes)
 * @param {number} options.pollInterval - Polling interval in ms (default: 2000 = 2 seconds)
 * @param {function} options.onStatusUpdate - Callback for status updates
 * @param {string} options.token - Optional custom token for MCP authentication
 * @returns {Promise<object>} - Job result
 */
async function pollJobUntilComplete(jobId, options = {}) {
  const {
    maxWaitTime = 600000, // 10 minutes default
    pollInterval = 2000, // 2 seconds default
    onStatusUpdate = null,
    token = null,
  } = options;

  const startTime = Date.now();
  let lastStatus = null;

  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Check job status
      const statusResponse = await CernionMCPClient.callWithNewSession(
        'cernion_job_status',
        {
          job_id: jobId,
        },
        token
      );

      const status = statusResponse.status || statusResponse.state;

      // Call status update callback if provided and status changed
      if (onStatusUpdate && status !== lastStatus) {
        onStatusUpdate({
          jobId,
          status,
          elapsed: Date.now() - startTime,
          response: statusResponse,
        });
        lastStatus = status;
      }

      // Check if job is complete
      if (status === 'succeeded' || status === 'completed' || status === 'success') {
        // Job completed - fetch result
        const resultResponse = await CernionMCPClient.callWithNewSession(
          'cernion_job_result',
          {
            job_id: jobId,
          },
          token
        );

        return {
          success: true,
          data: resultResponse.data || resultResponse.result || resultResponse,
          metadata: {
            jobId,
            status: 'succeeded',
            totalWaitTime: Date.now() - startTime,
            completedAt: new Date().toISOString(),
          },
        };
      }

      if (status === 'failed' || status === 'error') {
        // Job failed
        return {
          success: false,
          error: {
            message: 'Job failed during execution',
            jobId,
            status,
            details: statusResponse,
          },
          metadata: {
            jobId,
            status,
            totalWaitTime: Date.now() - startTime,
            failedAt: new Date().toISOString(),
          },
        };
      }

      // Job still running - wait before next poll
      await sleep(pollInterval);
    } catch (error) {
      // Error checking status
      if (Date.now() - startTime >= maxWaitTime) {
        return {
          success: false,
          error: {
            message: 'Job polling timeout',
            jobId,
            maxWaitTime,
            lastError: error.message,
          },
          metadata: {
            jobId,
            status: 'timeout',
            totalWaitTime: Date.now() - startTime,
          },
        };
      }

      // Wait before retrying
      await sleep(pollInterval);
    }
  }

  // Timeout
  return {
    success: false,
    error: {
      message: 'Job polling timeout - job did not complete within maximum wait time',
      jobId,
      maxWaitTime,
      lastStatus,
    },
    metadata: {
      jobId,
      status: 'timeout',
      totalWaitTime: maxWaitTime,
    },
  };
}

/**
 * Detect if an MCP response contains a job ID requiring polling
 *
 * @param {object} response - MCP response
 * @returns {string|null} - Job ID if async job, null otherwise
 */
function detectAsyncJob(response) {
  // Check common job ID fields
  if (response.jobId) return response.jobId;
  if (response.job_id) return response.job_id;
  if (response.data?.jobId) return response.data.jobId;
  if (response.data?.job_id) return response.data.job_id;
  if (response.metadata?.jobId) return response.metadata.jobId;
  if (response.metadata?.job_id) return response.metadata.job_id;

  // Check for status indicators of async job
  if (
    response.status === 'queued' ||
    response.status === 'running' ||
    response.status === 'processing'
  ) {
    // Look for ID in various fields
    return response.id || response.taskId || response.requestId || null;
  }

  return null;
}

/**
 * Call MCP tool and automatically poll if it returns an async job
 *
 * @param {string} toolName - MCP tool name
 * @param {object} params - Tool parameters
 * @param {object} pollOptions - Polling options (optional)
 * @param {string} token - Optional custom token for MCP authentication
 * @returns {Promise<object>} - Final result (after polling if needed)
 */
async function callWithAutoPoll(toolName, params, pollOptions = {}, token = null) {
  // Call the MCP tool
  const response = await CernionMCPClient.callWithNewSession(toolName, params, token);

  // Check if response indicates async job
  const jobId = detectAsyncJob(response);

  if (jobId) {
    // Async job detected - poll until complete
    console.log(`[AsyncJobPoller] Detected async job: ${jobId} for tool: ${toolName}`);

    const result = await pollJobUntilComplete(jobId, {
      ...pollOptions,
      token, // Pass token through to polling
      onStatusUpdate: (update) => {
        console.log(
          `[AsyncJobPoller] Job ${jobId} status: ${update.status} (elapsed: ${update.elapsed}ms)`
        );
        if (pollOptions.onStatusUpdate) {
          pollOptions.onStatusUpdate(update);
        }
      },
    });

    return result;
  }

  // Not an async job - return response directly
  return response;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  pollJobUntilComplete,
  detectAsyncJob,
  callWithAutoPoll,
};
