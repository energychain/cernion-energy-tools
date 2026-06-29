'use strict';

/**
 * File Ingest Monitor Service (v0.62)
 *
 * Generic file/CSV monitoring with embedded schema registry.
 * Provides per-monitor health status (green/yellow/red) with FIM_* finding codes.
 *
 * Issues: #216
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  FIM_FILE_MISSING,
  FIM_FILE_STALE,
  FIM_ERROR_FOLDER_PRESENT,
  FIM_REQUIRED_COLUMNS_MISSING,
  FIM_MONITOR_HEALTHY,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'File Ingest Monitor';
const SCHEMA_PREFIX = 'fim-schema:';
const MONITOR_PREFIX = 'fim-monitor:';

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'file-ingest-monitor',

  settings: {
    dbPath: process.env.FILE_INGEST_MONITOR_DB_PATH || './data/file-ingest-monitor',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['docType'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`File Ingest Monitor DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    // ── Schema Registry ───────────────────────────────────────────────────

    /**
     * @openapi
     * /api/file-ingest-schemas:
     *   post:
     *     tags: [File Ingest Monitor]
     *     summary: Create a CSV/file schema definition
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name]
     *             properties:
     *               name: { type: string }
     *               delimiter: { type: string, default: ',' }
     *               encoding: { type: string, default: 'utf-8' }
     *               requiredColumns: { type: array, items: { type: string } }
     *               optionalColumns: { type: array, items: { type: string } }
     *               headerRowIndex: { type: integer, default: 0 }
     *               dateLocale: { type: string }
     *               decimalLocale: { type: string }
     *               version: { type: string }
     *     responses:
     *       200:
     *         description: Created schema
     */
    createSchema: {
      rest: 'POST /schemas',
      params: {
        name: { type: 'string' },
        delimiter: { type: 'string', optional: true, default: ',' },
        encoding: { type: 'string', optional: true, default: 'utf-8' },
        requiredColumns: { type: 'array', optional: true, default: [], items: 'string' },
        optionalColumns: { type: 'array', optional: true, default: [], items: 'string' },
        headerRowIndex: { type: 'number', optional: true, default: 0, convert: true },
        dateLocale: { type: 'string', optional: true },
        decimalLocale: { type: 'string', optional: true },
        version: { type: 'string', optional: true, default: '1.0.0' },
      },
      openapi: {
        summary: 'Create a CSV/file schema definition',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          name,
          delimiter,
          encoding,
          requiredColumns,
          optionalColumns,
          headerRowIndex,
          dateLocale,
          decimalLocale,
          version,
        } = ctx.params;

        const schemaId = `${SCHEMA_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: schemaId,
          docType: 'fim-schema',
          tenantId,
          name,
          delimiter,
          encoding,
          requiredColumns,
          optionalColumns,
          headerRowIndex,
          dateLocale: dateLocale || null,
          decimalLocale: decimalLocale || null,
          version,
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        this.logger.info(`FIM schema created: ${schemaId}`);
        return doc;
      },
    },

    /**
     * @openapi
     * /api/file-ingest-schemas:
     *   get:
     *     tags: [File Ingest Monitor]
     *     summary: List file ingest schemas
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: List of schemas
     */
    listSchemas: {
      rest: 'GET /schemas',
      params: {
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List file ingest schemas',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'query', name: 'limit', schema: { type: 'number' } }],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { limit } = ctx.params;
        const result = await this.db.find({
          selector: { tenantId, docType: 'fim-schema' },
          limit,
        });
        return { schemas: result.docs };
      },
    },

    /**
     * @openapi
     * /api/file-ingest-schemas/{schemaId}:
     *   get:
     *     tags: [File Ingest Monitor]
     *     summary: Get schema by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: schemaId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Schema document
     *       404:
     *         description: Not found
     */
    getSchema: {
      rest: 'GET /schemas/:schemaId',
      params: { schemaId: { type: 'string' } },
      openapi: {
        summary: 'Get schema by ID',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'schemaId', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.schemaId);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Schema not found', 404, 'SCHEMA_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    // ── Monitor Management ────────────────────────────────────────────────

    /**
     * @openapi
     * /api/file-ingest-monitors:
     *   post:
     *     tags: [File Ingest Monitor]
     *     summary: Register a file ingest monitor
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [name, watchPath]
     *             properties:
     *               name: { type: string }
     *               watchPath: { type: string }
     *               schemaId: { type: string }
     *               schemaVersion: { type: string }
     *               stalenessWindowMinutes: { type: integer, default: 60 }
     *               direction: { type: string, enum: [inbound, outbound, bidirectional] }
     *               sourcePriority: { type: integer, minimum: 1, maximum: 10 }
     *               errorFolderPath: { type: string }
     *               flowId: { type: string }
     *               ownerRef: { type: string }
     *     responses:
     *       200:
     *         description: Created monitor
     */
    createMonitor: {
      rest: 'POST /monitors',
      params: {
        name: { type: 'string' },
        watchPath: { type: 'string' },
        schemaId: { type: 'string', optional: true },
        schemaVersion: { type: 'string', optional: true },
        stalenessWindowMinutes: { type: 'number', optional: true, default: 60, convert: true },
        direction: {
          type: 'enum',
          values: ['inbound', 'outbound', 'bidirectional'],
          optional: true,
          default: 'inbound',
        },
        sourcePriority: {
          type: 'number',
          optional: true,
          default: 5,
          min: 1,
          max: 10,
          convert: true,
        },
        errorFolderPath: { type: 'string', optional: true },
        flowId: { type: 'string', optional: true },
        ownerRef: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Register a file ingest monitor',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          name,
          watchPath,
          schemaId,
          schemaVersion,
          stalenessWindowMinutes,
          direction,
          sourcePriority,
          errorFolderPath,
          flowId,
          ownerRef,
        } = ctx.params;

        const monitorId = `${MONITOR_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: monitorId,
          docType: 'fim-monitor',
          tenantId,
          name,
          watchPath,
          schemaId: schemaId || null,
          schemaVersion: schemaVersion || null,
          stalenessWindowMinutes,
          direction,
          sourcePriority,
          errorFolderPath: errorFolderPath || null,
          flowId: flowId || null,
          ownerRef: ownerRef || null,
          createdAt: nowIso(),
          lastScan: null,
        };

        await this.db.put(doc);
        this.logger.info(`FIM monitor created: ${monitorId}`);
        return doc;
      },
    },

    /**
     * @openapi
     * /api/file-ingest-monitors:
     *   get:
     *     tags: [File Ingest Monitor]
     *     summary: List file ingest monitors
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: List of monitors
     */
    listMonitors: {
      rest: 'GET /monitors',
      params: {
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List file ingest monitors',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'query', name: 'limit', schema: { type: 'number' } }],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { limit } = ctx.params;
        const result = await this.db.find({
          selector: { tenantId, docType: 'fim-monitor' },
          limit,
        });
        return { monitors: result.docs };
      },
    },

    /**
     * @openapi
     * /api/file-ingest-monitors/{id}:
     *   get:
     *     tags: [File Ingest Monitor]
     *     summary: Get monitor by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Monitor document
     *       404:
     *         description: Not found
     */
    getMonitor: {
      rest: 'GET /monitors/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get monitor by ID',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Monitor not found', 404, 'MONITOR_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    /**
     * @openapi
     * /api/file-ingest-monitors/{id}:
     *   delete:
     *     tags: [File Ingest Monitor]
     *     summary: Delete monitor by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Deleted
     *       404:
     *         description: Not found
     */
    deleteMonitor: {
      rest: 'DELETE /monitors/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Delete monitor by ID',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Monitor not found', 404, 'MONITOR_NOT_FOUND');
          }
          throw err;
        }
        await this.db.remove(doc);
        return { success: true, id: ctx.params.id };
      },
    },

    /**
     * @openapi
     * /api/file-ingest-monitors/{id}/scan:
     *   post:
     *     tags: [File Ingest Monitor]
     *     summary: Run a scan on the monitored path
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Scan result
     */
    scan: {
      rest: 'POST /monitors/:id/scan',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Run a scan on the monitored path',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        let monitor;
        try {
          monitor = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Monitor not found', 404, 'MONITOR_NOT_FOUND');
          }
          throw err;
        }

        const now = Date.now();
        const scannedAt = new Date(now).toISOString();
        const findings = [];
        let files = [];

        // Check if watch path exists
        if (!fs.existsSync(monitor.watchPath)) {
          findings.push({
            finding: FIM_FILE_MISSING,
            severity: 'error',
            message: `Watch path does not exist: ${monitor.watchPath}`,
          });

          const scanResult = {
            scannedAt,
            status: 'red',
            findings,
            files: [],
          };

          const updated = { ...monitor, lastScan: scanResult };
          await this.db.put(updated);
          return scanResult;
        }

        // List files
        let entries = [];
        try {
          entries = fs.readdirSync(monitor.watchPath);
        } catch (err) {
          findings.push({
            finding: FIM_FILE_MISSING,
            severity: 'error',
            message: `Cannot read watch path: ${err.message}`,
          });

          const scanResult = {
            scannedAt,
            status: 'red',
            findings,
            files: [],
          };
          const updated = { ...monitor, lastScan: scanResult };
          await this.db.put(updated);
          return scanResult;
        }

        const stalenessMs =
          (monitor.stalenessWindowMinutes != null ? monitor.stalenessWindowMinutes : 60) *
          60 *
          1000;

        // Load schema if schemaId is set
        let schema = null;
        if (monitor.schemaId) {
          try {
            schema = await this.db.get(monitor.schemaId);
          } catch (_e) {
            // schema not found — proceed without validation
          }
        }

        for (const entry of entries) {
          const filePath = path.join(monitor.watchPath, entry);
          let stat;
          try {
            stat = fs.statSync(filePath);
          } catch (_e) {
            continue;
          }
          if (!stat.isFile()) continue;

          const mtimeMs = stat.mtimeMs;
          const fingerprint = `${stat.size}-${mtimeMs}`;
          const isStale = now - mtimeMs > stalenessMs;

          const fileEntry = {
            name: entry,
            path: filePath,
            size: stat.size,
            mtime: new Date(mtimeMs).toISOString(),
            fingerprint,
            status: 'OK',
          };

          if (isStale) {
            fileEntry.status = 'STALE';
            findings.push({
              finding: FIM_FILE_STALE,
              severity: 'warning',
              message: `File is stale (last modified ${fileEntry.mtime}): ${entry}`,
              file: entry,
            });
          }

          // Schema column validation — read first line only for CSV
          if (schema && schema.requiredColumns && schema.requiredColumns.length > 0) {
            const ext = path.extname(entry).toLowerCase();
            if (ext === '.csv' || ext === '.txt' || ext === '') {
              try {
                const firstLine = readFirstLine(filePath);
                if (firstLine !== null) {
                  const delimiter = schema.delimiter || ',';
                  const headerCols = firstLine
                    .split(delimiter)
                    .map((c) => c.trim().replace(/^["']|["']$/g, ''));
                  const missingCols = schema.requiredColumns.filter(
                    (col) => !headerCols.includes(col)
                  );
                  if (missingCols.length > 0) {
                    fileEntry.status = 'SCHEMA_MISMATCH';
                    findings.push({
                      finding: FIM_REQUIRED_COLUMNS_MISSING,
                      severity: 'error',
                      message: `Required columns missing in ${entry}: ${missingCols.join(', ')}`,
                      file: entry,
                      missingColumns: missingCols,
                    });
                  }
                }
              } catch (_e) {
                // skip schema check if read fails
              }
            }
          }

          files.push(fileEntry);
        }

        // Check error folder
        if (monitor.errorFolderPath && fs.existsSync(monitor.errorFolderPath)) {
          let errorFiles = [];
          try {
            errorFiles = fs
              .readdirSync(monitor.errorFolderPath)
              .filter((e) => fs.statSync(path.join(monitor.errorFolderPath, e)).isFile());
          } catch (_e) {
            // ignore
          }
          if (errorFiles.length > 0) {
            findings.push({
              finding: FIM_ERROR_FOLDER_PRESENT,
              severity: 'error',
              message: `Error folder contains ${errorFiles.length} file(s): ${monitor.errorFolderPath}`,
              errorFileCount: errorFiles.length,
            });
          }
        }

        // Determine overall status
        const hasError = findings.some((f) => f.severity === 'error');
        const hasWarning = findings.some((f) => f.severity === 'warning');

        let status;
        if (hasError) {
          status = 'red';
        } else if (hasWarning) {
          status = 'yellow';
        } else {
          status = 'green';
          findings.push({
            finding: FIM_MONITOR_HEALTHY,
            severity: 'info',
            message: 'All monitored files are present, current, and schema-compliant',
          });
        }

        const scanResult = {
          scannedAt,
          status,
          findings,
          files,
        };

        const updated = { ...monitor, lastScan: scanResult };
        await this.db.put(updated);
        return scanResult;
      },
    },

    /**
     * @openapi
     * /api/file-ingest-monitors/{id}/status:
     *   get:
     *     tags: [File Ingest Monitor]
     *     summary: Get latest scan status for a monitor
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Status summary
     */
    getStatus: {
      rest: 'GET /monitors/:id/status',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get latest scan status for a monitor',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        let monitor;
        try {
          monitor = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Monitor not found', 404, 'MONITOR_NOT_FOUND');
          }
          throw err;
        }

        const lastScan = monitor.lastScan || null;
        return {
          monitorId: monitor._id,
          name: monitor.name,
          watchPath: monitor.watchPath,
          status: lastScan ? lastScan.status : 'unknown',
          scannedAt: lastScan ? lastScan.scannedAt : null,
          findingsSummary: lastScan
            ? {
                errors: lastScan.findings.filter((f) => f.severity === 'error').length,
                warnings: lastScan.findings.filter((f) => f.severity === 'warning').length,
                infos: lastScan.findings.filter((f) => f.severity === 'info').length,
              }
            : null,
        };
      },
    },

    /**
     * @openapi
     * /api/file-ingest-monitors/{id}/files:
     *   get:
     *     tags: [File Ingest Monitor]
     *     summary: Get file list from last scan
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: File list
     */
    getFiles: {
      rest: 'GET /monitors/:id/files',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get file list from last scan',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        let monitor;
        try {
          monitor = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Monitor not found', 404, 'MONITOR_NOT_FOUND');
          }
          throw err;
        }
        return {
          monitorId: monitor._id,
          scannedAt: monitor.lastScan ? monitor.lastScan.scannedAt : null,
          files: monitor.lastScan ? monitor.lastScan.files : [],
        };
      },
    },

    /**
     * @openapi
     * /api/file-ingest-monitors/{id}/findings:
     *   get:
     *     tags: [File Ingest Monitor]
     *     summary: Get findings from last scan
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Findings list
     */
    getFindings: {
      rest: 'GET /monitors/:id/findings',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get findings from last scan',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        let monitor;
        try {
          monitor = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Monitor not found', 404, 'MONITOR_NOT_FOUND');
          }
          throw err;
        }
        return {
          monitorId: monitor._id,
          scannedAt: monitor.lastScan ? monitor.lastScan.scannedAt : null,
          findings: monitor.lastScan ? monitor.lastScan.findings : [],
        };
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads only the first line of a file synchronously.
 * Returns null if the file cannot be read.
 */
function readFirstLine(filePath) {
  try {
    const CHUNK_SIZE = 4096;
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(CHUNK_SIZE);
    const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, 0);
    fs.closeSync(fd);
    const content = buffer.slice(0, bytesRead).toString('utf8');
    const newlineIdx = content.indexOf('\n');
    return newlineIdx >= 0 ? content.slice(0, newlineIdx) : content;
  } catch (_e) {
    return null;
  }
}
