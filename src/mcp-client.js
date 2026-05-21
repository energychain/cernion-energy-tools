/**
 * Cernion MCP Client Utility
 *
 * Handles connections to Cernion MCP server using the MCP SDK
 * Supports HTTP streaming transport
 *
 * JSON Parsing Feature:
 * - Automatically parses JSON strings returned in MCP tool responses
 * - If content[0].text contains valid JSON, it's parsed and:
 *   1. Added as content[0].json field (for backward compatibility)
 *   2. Merged into top-level response (for clean API responses)
 * - Fail-safe: If JSON parsing fails, original text is preserved
 * - Enhances API usability by eliminating need for client-side JSON parsing
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const metrics = require('./metrics');
const tracing = require('./tracing');
const { getObservabilityContext } = require('./observability-context');

class CernionMCPClient {
  // ─── Static retry configuration ─────────────────────────────────────────────

  /**
   * Maximum retry attempts when a call fails with a quota / rate-limit error.
   * Retries use exponential backoff: 1 s → 2 s → 4 s.
   */
  static MAX_QUOTA_RETRIES = 3;

  /** Base back-off in ms for quota retries (doubles each attempt). */
  static QUOTA_RETRY_BASE_MS = 1000;

  /**
   * Returns true when the error message indicates a server-side quota or
   * rate-limit rejection (case-insensitive partial match).
   * @param {string} msg
   * @private
   */
  static _isQuotaError(msg) {
    const s = (msg || '').toLowerCase();
    return s.includes('quota') || s.includes('rate limit') || s.includes('too many requests');
  }

  /**
   * Redact sensitive token-like values from propagated error messages.
   * @param {string} message
   * @returns {string}
   * @private
   */
  static _sanitizeErrorMessage(message) {
    if (!message) return message;
    let sanitized = String(message);
    sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
    sanitized = sanitized.replace(
      /([?&](?:token|api[_-]?key|secret|password)=)[^&\s]+/gi,
      '$1[REDACTED]'
    );
    sanitized = sanitized.replace(
      /(https?:\/\/mcp\.cernion\.de\/)[^/\s]+(\/mcp)/gi,
      '$1[REDACTED]$2'
    );
    return sanitized;
  }

  /**
   * Execute one MCP tool call: connect → callTool → disconnect.
   * No queue, no retry – used by callWithNewSession which wraps both.
   * @private
   */
  static async _executeCall(toolName, params, token) {
    const client = new CernionMCPClient(token);
    try {
      await client.connect();
      return await client.callTool(toolName, params);
    } finally {
      await client.disconnect();
    }
  }

  // ─── Constructor ────────────────────────────────────────────────────────────

  constructor(token) {
    if (!token) {
      throw new Error('CERNION_TOKEN is required');
    }
    this.token = token;
    this.baseUrl = `https://mcp.cernion.de/${token}/mcp`;
    this.client = null;
    this.transport = null;
  }

  /**
   * Initialize and connect to MCP server
   */
  async connect() {
    try {
      // Create HTTP streaming transport with increased timeout
      this.transport = new StreamableHTTPClientTransport(
        new URL(this.baseUrl),
        { timeout: 120000 } // 120 seconds timeout for long-running tools like vnb_lookup
      );

      // Create MCP client
      this.client = new Client(
        {
          name: 'cernion-energy-tools',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      // Connect to server with retry logic
      let retries = 3;
      let lastError;

      while (retries > 0) {
        try {
          await this.client.connect(this.transport);
          return true;
        } catch (error) {
          lastError = error;
          // Quota/rate-limit errors are handled by callWithNewSession's outer retry loop.
          // Break immediately so we don't waste 3×exponential-backoff here.
          if (CernionMCPClient._isQuotaError(error.message)) break;
          retries--;
          if (retries > 0) {
            // Wait before retry (exponential backoff)
            await new Promise((resolve) => setTimeout(resolve, (4 - retries) * 1000));
            // Recreate transport for retry with same timeout
            this.transport = new StreamableHTTPClientTransport(new URL(this.baseUrl), {
              timeout: 120000,
            });
          }
        }
      }

      throw lastError;
    } catch (error) {
      throw new Error(
        `Failed to connect to Cernion MCP: ${CernionMCPClient._sanitizeErrorMessage(error.message)}`
      );
    }
  }

  /**
   * Call a tool on the MCP server
   * @param {string} toolName - Name of the tool to call
   * @param {object} params - Tool parameters
   * @returns {Promise<object>} Tool response
   */
  async callTool(toolName, params = {}) {
    if (!this.client) {
      await this.connect();
    }

    try {
      const response = await this.client.callTool({
        name: toolName,
        arguments: params,
      });

      // Extract actual data from response
      // MCP tools can return data in content array or as additional fields
      const { content, ...additionalData } = response;

      // Check for async job in additional data fields
      const jobIdFromAdditional =
        additionalData?.job_id ||
        additionalData?.jobId ||
        additionalData?.data?.job_id ||
        additionalData?.data?.jobId ||
        additionalData?.result?.job_id ||
        additionalData?.result?.jobId;

      if (jobIdFromAdditional) {
        return await this.pollJobResult(jobIdFromAdditional);
      }

      // Check if this is an async job response (contains job_id or jobId)
      if (content && content.length > 0 && content[0].text) {
        try {
          const parsedContent = JSON.parse(content[0].text);

          // If response contains a job_id, poll for the result
          if (parsedContent.job_id || parsedContent.jobId) {
            const jobId = parsedContent.job_id || parsedContent.jobId;
            return await this.pollJobResult(jobId);
          }
        } catch {
          // Not JSON or no job_id, continue with normal processing
        }
      }

      // If there's actual data in additional fields (like statistics, data, result, etc.)
      // use that, otherwise use content array
      const hasAdditionalData = Object.keys(additionalData).length > 0;

      // Parse JSON strings in content array and add as separate field
      let processedContent = content;
      if (content && Array.isArray(content) && content.length > 0) {
        processedContent = content.map((item) => {
          if (item.type === 'text' && item.text) {
            try {
              // Try to parse as JSON
              const parsedJson = JSON.parse(item.text);
              // If successful, add parsed object as 'json' field
              return {
                ...item,
                json: parsedJson,
              };
            } catch {
              // Not JSON or parse error - return as-is (fail-safe)
              return item;
            }
          }
          return item;
        });
      }

      // Check for async job in parsed content JSON
      if (
        processedContent &&
        processedContent.length > 0 &&
        processedContent[0].json &&
        (processedContent[0].json.job_id || processedContent[0].json.jobId)
      ) {
        const jobId = processedContent[0].json.job_id || processedContent[0].json.jobId;
        return await this.pollJobResult(jobId);
      }

      // If parsed JSON exists and looks like the main response, use it directly
      if (
        processedContent &&
        processedContent.length === 1 &&
        processedContent[0].json &&
        !hasAdditionalData
      ) {
        return {
          success: true,
          ...processedContent[0].json,
          metadata: {
            toolName,
            timestamp: new Date().toISOString(),
          },
        };
      }

      return {
        success: true,
        data: hasAdditionalData ? additionalData : processedContent,
        metadata: {
          toolName,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.code || 'TOOL_CALL_ERROR',
          message: CernionMCPClient._sanitizeErrorMessage(error.message),
          toolName,
        },
      };
    }
  }

  /**
   * Poll for async job result
   * @param {string} jobId - Job ID to poll
   * @returns {Promise<object>} Job result
   */
  async pollJobResult(jobId, maxAttempts = 600, delayMs = 1000) {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        // Call cernion_job_result to get job result
        const response = await this.client.callTool({
          name: 'cernion_job_result',
          arguments: { jobId },
        });

        const { content } = response;

        if (content && content.length > 0 && content[0].text) {
          const jobStatus = JSON.parse(content[0].text);

          // Check job status
          if (jobStatus.status === 'succeeded' || jobStatus.status === 'completed') {
            // Job succeeded! Try to extract data from jobStatus.content first
            if (
              jobStatus.content &&
              Array.isArray(jobStatus.content) &&
              jobStatus.content.length > 0 &&
              jobStatus.content[0].text
            ) {
              try {
                const actualData = JSON.parse(jobStatus.content[0].text);
                return {
                  success: true,
                  data: actualData,
                  metadata: {
                    jobId,
                    status: jobStatus.status,
                    timestamp: new Date().toISOString(),
                  },
                };
              } catch {
                // If JSON parse fails, return raw text
                return {
                  success: true,
                  data: jobStatus.content[0].text,
                  metadata: {
                    jobId,
                    status: jobStatus.status,
                    timestamp: new Date().toISOString(),
                  },
                };
              }
            }

            // Fallback: try result or data fields
            const resultData = jobStatus.result || jobStatus.data || jobStatus;

            // Check if result has content array with text (common pattern for async jobs)
            if (
              resultData.content &&
              Array.isArray(resultData.content) &&
              resultData.content.length > 0 &&
              resultData.content[0].text
            ) {
              try {
                const actualData = JSON.parse(resultData.content[0].text);
                return {
                  success: true,
                  data: actualData,
                  metadata: {
                    jobId,
                    status: jobStatus.status,
                    timestamp: new Date().toISOString(),
                  },
                };
              } catch {
                // If parsing fails, return as-is
              }
            }

            return {
              success: true,
              data: resultData,
              metadata: {
                jobId,
                status: jobStatus.status,
                timestamp: new Date().toISOString(),
              },
            };
          } else if (jobStatus.status === 'failed' || jobStatus.status === 'error') {
            return {
              success: false,
              error: {
                code: 'JOB_FAILED',
                message: CernionMCPClient._sanitizeErrorMessage(
                  jobStatus.error || jobStatus.message || 'Job execution failed'
                ),
                jobId,
              },
            };
          }
          // If status is 'queued' or 'running', continue polling
        }
      } catch {
        // Continue polling on error (job might not be ready yet)
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempts++;
    }

    return {
      success: false,
      error: {
        code: 'JOB_TIMEOUT',
        message: `Job ${jobId} did not complete within ${(maxAttempts * delayMs) / 1000} seconds`,
        jobId,
      },
    };
  }

  /**
   * List available tools
   * @returns {Promise<Array>} List of available tools
   */
  async listTools() {
    if (!this.client) {
      await this.connect();
    }

    try {
      const response = await this.client.listTools();
      return {
        success: true,
        tools: response.tools,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'LIST_TOOLS_ERROR',
          message: CernionMCPClient._sanitizeErrorMessage(error.message),
        },
      };
    }
  }

  /**
   * Close connection
   */
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }

  /**
   * Create a new session-based client for a single request.
   *
   * Concurrent calls are allowed — the process-wide serial queue introduced in
   * CR-25 has been removed (CR-26) because the server-side quota issue that
   * motivated it was fixed by the Cernion team (2026-03-06). Serialising calls
   * caused each pipeline stage to wait ~10 s per queued call, exceeding the
   * 30 s callBroker timeout.
   *
   * **Quota retry** – if the server returns a quota/rate-limit error the call
   * is retried up to MAX_QUOTA_RETRIES times with exponential back-off
   * (QUOTA_RETRY_BASE_MS × 2^attempt: 1 s → 2 s → 4 s).
   *
   * @param {string} toolName
   * @param {object} [params={}]
   * @param {string|null} [customToken=null] - Overrides CERNION_TOKEN env var.
   * @param {object} [options={}] - Optional { jobId } for progress logging.
   * @returns {Promise<object>} Tool response
   */
  static async callWithNewSession(toolName, params = {}, customToken = null, options = {}) {
    const startedAt = Date.now();
    const token = customToken || process.env.CERNION_TOKEN;
    const jobId = options?.jobId || null;

    return tracing.withSpan(
      `mcp.${toolName}`,
      {
        kind: tracing.SpanKind.CLIENT,
        parentCarrier: getObservabilityContext().traceCarrier || null,
        attributes: {
          'cernion.tool': toolName,
          'cernion.component': 'mcp-client',
        },
      },
      async (span) => {
        if (!token) {
          const error = {
            success: false,
            error: {
              code: 'MISSING_TOKEN',
              message: 'CERNION_TOKEN environment variable not set and no custom token provided',
            },
          };
          tracing.setError(span, new Error(error.error.message));
          metrics.recordMcpRequest({
            tool: toolName,
            status: 'error',
            durationMs: Date.now() - startedAt,
          });
          return error;
        }

        // Log MCP call start if jobId provided
        if (jobId) {
          const jobStore = require('./job-store');
          const timeUntil = jobStore.getTimeUntilDeadline(jobId);
          jobStore.appendLog(jobId, `mcp_${toolName}_start`, 0, `Calling MCP tool ${toolName}...`, {
            tool: toolName,
            deadlineExceeded: jobStore.isDeadlineExceeded(jobId),
            timeUntilDeadlineMs: timeUntil,
          });
        }

        let lastError;
        for (let attempt = 0; attempt <= CernionMCPClient.MAX_QUOTA_RETRIES; attempt++) {
          if (attempt > 0) {
            const backoffMs = CernionMCPClient.QUOTA_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            tracing.addEvent(span, 'mcp.quota_retry', {
              attempt: attempt + 1,
              backoff_ms: backoffMs,
            });

            // Log retry if jobId provided
            if (jobId) {
              const jobStore = require('./job-store');
              jobStore.appendLog(jobId, `mcp_${toolName}_retry`, 0,
                `MCP retry attempt ${attempt + 1} after ${backoffMs}ms...`, {
                tool: toolName,
                attempt: attempt + 1,
                backoffMs,
              });
            }

            await new Promise((r) => setTimeout(r, backoffMs));
          }
          try {
            const result = await CernionMCPClient._executeCall(toolName, params, token);
            if (CernionMCPClient._isQuotaError(result?.error?.message)) {
              lastError = new Error(result.error.message);
              continue;
            }

            const elapsedMs = Date.now() - startedAt;
            // Log MCP call success if jobId provided
            if (jobId && result?.success !== false) {
              const jobStore = require('./job-store');
              jobStore.appendLog(jobId, `mcp_${toolName}_complete`, 0,
                `MCP tool ${toolName} completed in ${elapsedMs}ms`, {
                tool: toolName,
                elapsedMs,
                success: true,
              });
            }

            tracing.setOk(span);
            metrics.recordMcpRequest({
              tool: toolName,
              status: result?.success === false ? 'error' : 'success',
              durationMs: elapsedMs,
            });
            return result;
          } catch (err) {
            lastError = err;
            if (!CernionMCPClient._isQuotaError(err.message)) {
              const elapsedMs = Date.now() - startedAt;

              // Log MCP call error if jobId provided
              if (jobId) {
                const jobStore = require('./job-store');
                jobStore.appendLog(jobId, `mcp_${toolName}_error`, 0,
                  `MCP error after ${elapsedMs}ms: ${err.message}`, {
                  tool: toolName,
                  elapsedMs,
                  error: err.message,
                });
              }

              tracing.setError(span, err);
              metrics.recordMcpRequest({
                tool: toolName,
                status: 'error',
                durationMs: elapsedMs,
              });
              throw new Error(CernionMCPClient._sanitizeErrorMessage(err.message));
            }
          }
        }

        const elapsedMs = Date.now() - startedAt;

        // Log quota exhaustion if jobId provided
        if (jobId) {
          const jobStore = require('./job-store');
          jobStore.appendLog(jobId, `mcp_${toolName}_quota_exhausted`, 0,
            `MCP quota exhausted after ${elapsedMs}ms and ${CernionMCPClient.MAX_QUOTA_RETRIES} retries`, {
            tool: toolName,
            elapsedMs,
            retries: CernionMCPClient.MAX_QUOTA_RETRIES,
          });
        }

        tracing.setError(
          span,
          new Error(lastError?.message || 'Quota exhausted after all retry attempts')
        );
        metrics.recordMcpRequest({
          tool: toolName,
          status: 'quota_exhausted',
          durationMs: elapsedMs,
        });
        return {
          success: false,
          error: {
            code: 'QUOTA_EXHAUSTED',
            message: CernionMCPClient._sanitizeErrorMessage(
              lastError?.message || 'Quota exhausted after all retry attempts'
            ),
            toolName,
          },
        };
      }
    );
  }
}

module.exports = CernionMCPClient;
