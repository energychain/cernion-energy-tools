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

class CernionMCPClient {
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
      // Create HTTP streaming transport
      this.transport = new StreamableHTTPClientTransport(new URL(this.baseUrl));

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
          retries--;
          if (retries > 0) {
            // Wait before retry (exponential backoff)
            await new Promise((resolve) => setTimeout(resolve, (4 - retries) * 1000));
            // Recreate transport for retry
            this.transport = new StreamableHTTPClientTransport(new URL(this.baseUrl));
          }
        }
      }

      throw lastError;
    } catch (error) {
      throw new Error(`Failed to connect to Cernion MCP: ${error.message}`);
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
      const { content, isError, _meta, ...additionalData } = response;

      // Check if this is an async job response (contains job_id or jobId)
      if (content && content.length > 0 && content[0].text) {
        try {
          const parsedContent = JSON.parse(content[0].text);

          // If response contains a job_id, poll for the result
          if (parsedContent.job_id || parsedContent.jobId) {
            const jobId = parsedContent.job_id || parsedContent.jobId;
            return await this.pollJobResult(jobId);
          }
        } catch (e) {
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
            } catch (e) {
              // Not JSON or parse error - return as-is (fail-safe)
              return item;
            }
          }
          return item;
        });
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
          message: error.message,
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
  async pollJobResult(jobId, maxAttempts = 30, delayMs = 1000) {
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
              } catch (parseError) {
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
              } catch (parseError) {
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
                message: jobStatus.error || jobStatus.message || 'Job execution failed',
                jobId,
              },
            };
          }
          // If status is 'queued' or 'running', continue polling
        }
      } catch (error) {
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
          message: error.message,
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
   * Create a new session-based client for a single request
   * This implements the "one session per request" pattern
   * @param {string} toolName - Tool to call
   * @param {object} params - Tool parameters
   * @param {string} customToken - Optional custom token (overrides CERNION_TOKEN from env)
   * @returns {Promise<object>} Tool response
   */
  static async callWithNewSession(toolName, params = {}, customToken = null) {
    const token = customToken || process.env.CERNION_TOKEN;
    if (!token) {
      return {
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'CERNION_TOKEN environment variable not set and no custom token provided',
        },
      };
    }

    const client = new CernionMCPClient(token);
    try {
      await client.connect();
      const result = await client.callTool(toolName, params);
      return result;
    } finally {
      await client.disconnect();
    }
  }
}

module.exports = CernionMCPClient;
