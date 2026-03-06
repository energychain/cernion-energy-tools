/**
 * Utility Report Service
 *
 * Generates comprehensive 360° Management Reports for German energy utility
 * decision-makers (Stadtwerke, Energieversorger).
 *
 * Features:
 *  - Sequential 4-phase pipeline covering 8 KPI sections
 *  - 7-day disk cache with UUID filenames (.reports/UUID.html)
 *  - Per-phase progress tracking for resumability (.reports/UUID.progress.json)
 *  - Graceful degradation: unavailable/unknown MCP tools return { available: false }
 *  - cernion_discover preflight to verify live tool availability
 *  - Gemini narrative for management summary (optional – falls back to static template)
 *  - Pure-HTML output designed for browser print-to-PDF
 *
 * Endpoints:
 *  POST   /api/utility-report/generate          – start or resume report generation
 *  GET    /api/utility-report/status/:reportId  – poll generation progress
 *  GET    /api/utility-report/download/:reportId – download completed HTML report
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { GoogleGenerativeAI } = require('@google/generative-ai');

const CernionMCPClient = require('../src/mcp-client');
const { buildHtmlReport, summarizeForReport } = require('../src/report-builder');

// ─── Constants ─────────────────────────────────────────────────────────────────

const REPORTS_DIR = path.join(__dirname, '..', '.reports');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Directory helpers ─────────────────────────────────────────────────────────

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function reportPath(reportId) {
  return path.join(REPORTS_DIR, `${reportId}.html`);
}

function progressPath(reportId) {
  return path.join(REPORTS_DIR, `${reportId}.progress.json`);
}

function loadProgress(reportId) {
  const file = progressPath(reportId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function saveProgress(progress) {
  ensureReportsDir();
  fs.writeFileSync(progressPath(progress.reportId), JSON.stringify(progress, null, 2));
}

function reportExists(reportId) {
  const file = reportPath(reportId);
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
}

// ─── Cache key ─────────────────────────────────────────────────────────────────

function buildCacheKey(utilityName, date) {
  const normalized = utilityName.toLowerCase().trim();
  return crypto.createHash('sha256').update(JSON.stringify({ utilityName: normalized, date })).digest('hex');
}

function findCachedReport(utilityName, date) {
  ensureReportsDir();
  const key = buildCacheKey(utilityName, date);
  const indexFile = path.join(REPORTS_DIR, 'index.json');
  if (!fs.existsSync(indexFile)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    const entry = index[key];
    if (!entry) return null;
    if (reportExists(entry.reportId)) return entry.reportId;
    // Expired – remove index entry
    delete index[key];
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    return null;
  } catch {
    return null;
  }
}

function indexReport(utilityName, date, reportId) {
  ensureReportsDir();
  const key = buildCacheKey(utilityName, date);
  const indexFile = path.join(REPORTS_DIR, 'index.json');
  let index = {};
  if (fs.existsSync(indexFile)) {
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf-8')); } catch { /* ignore */ }
  }
  index[key] = { reportId, createdAt: new Date().toISOString() };
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
}

// ─── Graceful MCP call ─────────────────────────────────────────────────────────

/**
 * Call a Cernion MCP tool directly (not via a wrapped Moleculer service).
 * Used for tools that are not yet wrapped as services, or for the discover preflight.
 * Never throws – returns { available: false, error } on any failure.
 */
async function callMcpDirect(toolName, params, token) {
  const TIMEOUT_MS = 30_000;
  try {
    const callPromise = CernionMCPClient.callWithNewSession(toolName, params, token || null);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
    );
    const result = await Promise.race([callPromise, timeoutPromise]);
    if (!result || result.success === false) {
      return { available: false, error: result?.error?.message || 'Tool returned error' };
    }
    return { available: true, data: result.data ?? result };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/**
 * Safely call a Moleculer broker service action.
 * Never throws – returns { available: false } on any failure.
 */
async function callBroker(ctx, action, params) {
  try {
    const result = await ctx.broker.call(action, params, {
      meta: ctx.meta,
      timeout: 30_000, // 30 s – never block the report pipeline longer than this
    });
    return { available: true, data: result };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

// ─── Discover preflight ────────────────────────────────────────────────────────

/**
 * Call cernion_discover to get live tool list.
 * Returns a Set of tool names.
 */
async function discoverAvailableTools(token) {
  try {
    const result = await CernionMCPClient.callWithNewSession('cernion_discover', {}, token || null);
    if (!result || result.success === false) return new Set();

    // Try to extract tool names from response
    const toolNames = [];
    const data = result.data ?? result;

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item?.name) toolNames.push(item.name);
        if (typeof item === 'string') toolNames.push(item);
      }
    } else if (data?.tools && Array.isArray(data.tools)) {
      for (const t of data.tools) {
        if (t?.name) toolNames.push(t.name);
        else if (typeof t === 'string') toolNames.push(t);
      }
    } else if (data?.content && Array.isArray(data.content)) {
      // Content may contain a JSON string
      const text = data.content[0]?.text ?? '';
      try {
        const parsed = JSON.parse(text);
        const tools = parsed.tools ?? parsed;
        if (Array.isArray(tools)) {
          tools.forEach((t) => t?.name && toolNames.push(t.name));
        }
      } catch { /* ignore */ }
    }

    return new Set(toolNames);
  } catch {
    return new Set();
  }
}

// ─── Gemini narrative ──────────────────────────────────────────────────────────

async function generateNarrative(utilityName, kpiSummary) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildStaticNarrative(utilityName, kpiSummary);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const summaryJson = JSON.stringify(kpiSummary, null, 2).slice(0, 4000);
    const prompt = `Du bist ein Energieberater und erstellst eine Management Summary für den Jahresbericht von "${utilityName}".

Basierend auf diesen KPI-Daten:
${summaryJson}

Erstelle 5–7 prägnante, handlungsorientierte Erkenntnisse auf Deutsch (jeweils 1–2 Sätze).
Format: Eine Erkenntnis pro Zeile, beginnend mit einem Emoji und kurzem Stichwort.
Fokus: Was bedeuten diese Zahlen für den Geschäftsführer? Was sind die wichtigsten Handlungsfelder?
Keine Überschriften, keine Nummerierung, nur die Erkenntnisse.`;

    const result = await model.generateContent(prompt);
    const text = result.response?.text?.() ?? '';
    return text.trim().length > 50 ? text.trim() : buildStaticNarrative(utilityName, kpiSummary);
  } catch {
    return buildStaticNarrative(utilityName, kpiSummary);
  }
}

function buildStaticNarrative(utilityName, kpiSummary) {
  const lines = [
    `⚡ Netzbetrieb: Die Netzkapazitätsanalyse für ${utilityName} liegt vor – prüfen Sie kritische Stränge auf §14a-Handlungsbedarf.`,
    '🌱 EE-Portfolio: MaStR-Einspeiserportfolio und Redispatch-Anlagen wurden vollständig inventarisiert.',
    '📈 Energiemarkt: Strom- und Gasmarktdaten wurden für den Berichtszeitraum erfasst.',
    '🏛️ Regulierung: BNetzA EWK-Benchmarkdaten zu Anschlussdauer, Digitalisierung und Umsetzungsquote sind ausgewertet.',
    '👥 Kunden & Vertrieb: Churn-Risiken und Neukundenpotenziale aus dem Netzgebiet wurden identifiziert.',
    '💡 Digitalisierung: Systemstatus und EIC-Datenbankübersicht wurden dokumentiert.',
  ];

  // Add a data-driven line if we have some KPIs
  if (kpiSummary && Object.keys(kpiSummary).length > 0) {
    lines.push('📋 Hinweis: Für eine KI-gestützte Analyse aktivieren Sie GEMINI_API_KEY in der .env-Konfiguration.');
  }

  return lines.join('\n');
}

// ─── Pipeline phase helper ─────────────────────────────────────────────────────

/**
 * Run a collection step only if its tool is in the available tools set
 * (or if availableTools is empty, meaning discover failed).
 *
 * @param {Set}      availableTools  - from discover preflight (empty = unknown)
 * @param {string[]} toolNames       - MCP tool names required by this step
 * @param {Function} fn              - async () => callBroker / callMcpDirect
 * @returns {Promise<object>} { available, data?, error? }
 */
async function gated(availableTools, toolNames, fn) {
  // If discover returned data, check gating; if empty set (preflight failed), allow all
  const allKnown =
    availableTools.size === 0 ||
    toolNames.every((t) => availableTools.has(t));

  if (!allKnown) {
    return { available: false, error: 'Tool not available at live backend' };
  }
  return fn();
}

// ─── Service definition ────────────────────────────────────────────────────────

module.exports = {
  name: 'utility-report',

  settings: {
    defaultTimeout: 10 * 60 * 1000, // 10 minutes
  },

  actions: {
    /**
     * Generate (or resume) a 360° utility management report.
     * Responds immediately with reportId; use /status/:reportId to poll.
     *
     * Tool: internal pipeline (no direct MCP call)
     */
    generate: {
      rest: 'POST /generate',
      params: {
        utilityName: { type: 'string', min: 1 },
        region: { type: 'string', optional: true },
        bdew: { type: 'string', optional: true },
        forceRefresh: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Generate a 360° Management Report for an energy utility (Stadtwerk)',
        tags: ['Utility Report'],
        description: `Starts (or resumes) the generation of a comprehensive ~50-section HTML management report for German energy utilities.

**Report sections:**
1. Netzbetrieb & Netzplanung (capacity utilization, redispatch, residual load, CO₂)
2. Erneuerbare Energien & Einspeiser (PV, Wind, Storage from MaStR)
3. Energiemarkt & Preise (EPEX, ENTSO-E, SMARD)
4. Gasinfrastruktur & Versorgungssicherheit (AGSI/GIE)
5. Regulierung, Compliance & Marktprozesse (BNetzA EWK)
6. Kundenmanagement, Vertrieb & Prosumer (churn, leads)
7. Investitionsplanung & Business Cases
8. Digitalisierung & Systemübersicht

**Caching:** Reports are cached for 7 days (UUID filename). Identical requests return the cached report.
**Resumability:** Generation progress is saved after each phase. If generation is interrupted, retry the same request to resume.
**PDF:** Open the downloaded HTML in a browser and use Print → Save as PDF.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['utilityName'],
                properties: {
                  utilityName: {
                    type: 'string',
                    description: 'Name of the energy utility',
                    example: 'Stadtwerke Heidelberg GmbH',
                  },
                  region: {
                    type: 'string',
                    description: 'Region, city or postal code for context',
                    example: 'Heidelberg',
                  },
                  bdew: {
                    type: 'string',
                    description: 'BDEW code of the grid operator (optional, improves data quality)',
                    example: '9907462000006',
                  },
                  forceRefresh: {
                    type: 'boolean',
                    description: 'Force regeneration even if a cached report exists',
                    default: false,
                  },
                },
              },
              examples: {
                stadtwerkeHeidelberg: {
                  summary: 'Stadtwerke Heidelberg',
                  value: { utilityName: 'Stadtwerke Heidelberg GmbH', region: 'Heidelberg', bdew: '9907462000006' },
                },
                twlNetze: {
                  summary: 'TWL Netze GmbH',
                  value: { utilityName: 'TWL Netze GmbH', region: 'Ludwigshafen', bdew: '9907462000013' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Report generation started or resumed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    reportId: { type: 'string' },
                    status: { type: 'string', enum: ['generating', 'completed', 'cached'] },
                    message: { type: 'string' },
                    downloadUrl: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },

      async handler(ctx) {
        const { utilityName, region = '', bdew = '', forceRefresh = false } = ctx.params;
        const cernionToken = ctx.meta?.cernionToken || process.env.CERNION_TOKEN;
        const today = new Date().toISOString().slice(0, 10);

        // ── Check cache ──────────────────────────────────────────────────────
        if (!forceRefresh) {
          const cachedId = findCachedReport(utilityName, today);
          if (cachedId && reportExists(cachedId)) {
            return {
              success: true,
              reportId: cachedId,
              status: 'cached',
              message: 'Cached report returned (7-day TTL). Use forceRefresh:true to regenerate.',
              downloadUrl: `/api/utility-report/download/${cachedId}`,
            };
          }
        }

        // ── Generate new report ID ────────────────────────────────────────────
        const reportId = crypto.randomUUID();
        const progress = {
          reportId,
          utilityName,
          region,
          bdew,
          status: 'generating',
          phase: 0,
          startedAt: new Date().toISOString(),
          completedAt: null,
          error: null,
          results: {},
          meta: {},
        };
        saveProgress(progress);

        // ── Run pipeline asynchronously (do not await) ───────────────────────
        this._runPipeline(ctx, progress, cernionToken, today).catch((err) => {
          this.logger.error(`[UtilityReport] Pipeline error for ${reportId}: ${err.message}`);
          const p = loadProgress(reportId) || progress;
          p.status = 'error';
          p.error = err.message;
          saveProgress(p);
        });

        return {
          success: true,
          reportId,
          status: 'generating',
          message: 'Report generation started. Poll /status/:reportId for progress.',
          downloadUrl: `/api/utility-report/download/${reportId}`,
        };
      },
    },

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Poll generation status
     */
    status: {
      rest: 'GET /status/:reportId',
      params: {
        reportId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Poll generation status of a utility report',
        tags: ['Utility Report'],
        description: 'Returns current phase, completion percentage and any errors.',
        responses: {
          200: {
            description: 'Report status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    reportId: { type: 'string' },
                    status: { type: 'string', enum: ['generating', 'completed', 'error'] },
                    phase: { type: 'number' },
                    phaseName: { type: 'string' },
                    progress: { type: 'number', description: '0–100 completion percentage' },
                    error: { type: 'string', nullable: true },
                    downloadUrl: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { reportId } = ctx.params;
        const prog = loadProgress(reportId);

        if (!prog) {
          return { success: false, error: 'Report not found', reportId };
        }

        const phaseNames = [
          'Initialisierung',
          'Identifikation (VNB/BDEW-Lookup)',
          'Metadaten & Stammdaten',
          'Datenabruf (8 Abschnitte)',
          'Kontext & Rendering',
        ];

        const progressPct = Math.min(100, Math.round((prog.phase / 4) * 100));

        return {
          success: true,
          reportId,
          status: prog.status,
          phase: prog.phase,
          phaseName: phaseNames[prog.phase] ?? 'Unbekannt',
          progress: progressPct,
          error: prog.error ?? null,
          downloadUrl: prog.status === 'completed' ? `/api/utility-report/download/${reportId}` : null,
        };
      },
    },

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Re-render HTML from stored progress data (no MCP calls, instant).
     * Use this to refresh the HTML of an existing completed report after a
     * report-builder code update without re-running the expensive 4-phase pipeline.
     */
    rebuild: {
      rest: 'POST /rebuild/:reportId',
      params: {
        reportId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Re-render an existing report from cached data',
        tags: ['Utility Report'],
        description:
          'Reads the stored `.progress.json` for the given reportId and re-runs ' +
          '`buildHtmlReport()` to overwrite the `.html` file. Instant – no MCP calls needed. ' +
          'Useful after a report-builder bug fix to refresh already-generated reports.',
        responses: {
          200: { description: 'Report re-rendered successfully' },
          404: { description: 'No progress data found for reportId' },
          409: { description: 'Report pipeline has not completed yet' },
        },
      },
      async handler(ctx) {
        const { reportId } = ctx.params;
        const prog = loadProgress(reportId);

        if (!prog) {
          ctx.$statusCode = 404;
          return { success: false, error: 'No progress data found for this reportId', reportId };
        }
        if (prog.status !== 'completed' || !prog.results) {
          ctx.$statusCode = 409;
          return { success: false, error: 'Report is not yet completed; re-run generate instead', reportId, status: prog.status };
        }

        const utilityName = prog.utilityName ?? '';
        const region = prog.region ?? '';
        const resolvedVnbName = prog.meta?.resolvedVnbName ?? null;
        const resolvedBdew = prog.meta?.resolvedBdew ?? prog.bdew ?? null;
        // Reuse stored narrative if available (saved by pipeline since v0.8.2)
        const managementSummary = prog.managementSummary ?? '';
        const webSearchResults = prog.webSearchResults ?? [];

        const html = buildHtmlReport({
          meta: {
            utilityName,
            vnbName: resolvedVnbName,
            region,
            bdew: resolvedBdew,
            reportId,
          },
          section1: prog.results.section1,
          section2: prog.results.section2,
          section3: prog.results.section3,
          section4: prog.results.section4,
          section5: prog.results.section5,
          section6: prog.results.section6,
          section7: prog.results.section7,
          section8: prog.results.section8,
          managementSummary,
          webSearchResults,
          generatedAt: new Date().toISOString(),
        });

        ensureReportsDir();
        fs.writeFileSync(reportPath(reportId), html, 'utf-8');

        return {
          success: true,
          reportId,
          message: 'Report HTML re-rendered from cached data',
          downloadUrl: `/api/utility-report/download/${reportId}`,
        };
      },
    },

    /**
     * Re-render ALL completed reports from stored progress data (batch rebuild).
     */
    rebuildAll: {
      rest: 'POST /rebuild-all',
      openapi: {
        summary: 'Re-render all completed reports from cached data',
        tags: ['Utility Report'],
        description:
          'Iterates every `.progress.json` in the reports directory and re-renders the HTML ' +
          'for every completed report. Returns a summary with counts of rebuilt/skipped/failed entries.',
        responses: {
          200: { description: 'Batch rebuild summary' },
        },
      },
      async handler(ctx) {
        ensureReportsDir();
        const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.progress.json'));
        const results = { rebuilt: [], skipped: [], failed: [] };

        for (const file of files) {
          const reportId = file.replace('.progress.json', '');
          try {
            const result = await ctx.call('utility-report.rebuild', { reportId });
            if (result.success) {
              results.rebuilt.push(reportId);
            } else {
              results.skipped.push({ reportId, reason: result.error });
            }
          } catch (err) {
            results.failed.push({ reportId, error: err.message });
          }
        }

        return {
          success: true,
          total: files.length,
          rebuilt: results.rebuilt.length,
          skipped: results.skipped.length,
          failed: results.failed.length,
          details: results,
        };
      },
    },

    /**
     * Download completed HTML report
     */
    download: {
      rest: 'GET /download/:reportId',
      params: {
        reportId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Download a completed HTML report',
        tags: ['Utility Report'],
        description: 'Returns the raw HTML document. Open in a browser and use Print → Save as PDF.',
        responses: {
          200: { description: 'HTML report document' },
          404: { description: 'Report not found or not yet complete' },
        },
      },
      handler(ctx) {
        const { reportId } = ctx.params;
        const file = reportPath(reportId);

        if (!fs.existsSync(file)) {
          const prog = loadProgress(reportId);
          if (prog && prog.status === 'generating') {
            ctx.$statusCode = 202;
            return { success: false, message: 'Report still generating', status: 'generating', reportId };
          }
          ctx.$statusCode = 404;
          return { success: false, error: 'Report not found', reportId };
        }

        const html = fs.readFileSync(file, 'utf-8');
        ctx.$responseType = 'text/html; charset=utf-8';
        ctx.$responseHeaders = {
          'Content-Disposition': `inline; filename="360-report-${reportId}.html"`,
        };
        return Buffer.from(html, 'utf-8');
      },
    },
  },

  // ─── Methods ─────────────────────────────────────────────────────────────────

  methods: {

  // ─── Pipeline ───────────────────────────────────────────────────────────────

  /**
   * Sequential 4-phase pipeline. Saves progress after each phase for resumability.
   */
  async _runPipeline(ctx, progress, cernionToken, today) {
    const { utilityName, region, bdew } = progress;
    const p = progress;

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 0: Discover available tools
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 0) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 0: Discover tools`);
      const availableTools = await discoverAvailableTools(cernionToken);
      p.meta.availableTools = Array.from(availableTools);
      p.phase = 1;
      saveProgress(p);
    }

    const availableTools = new Set(p.meta.availableTools || []);

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 1: Identification – resolve VNB from name/BDEW
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 1) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 1: Identification`);

      const marketPartners = await callBroker(ctx, 'grid-operations.marketPartners', {
        query: bdew || utilityName,
        limit: 3,
      });

      const firstPartner =
        marketPartners.data?.results?.[0] ||
        marketPartners.data?.data?.results?.[0] ||
        marketPartners.data?.partners?.[0] ||
        null;

      const resolvedBdew = firstPartner?.bdewCode || firstPartner?.bdew || bdew || null;
      const resolvedMastrId = firstPartner?.mastrId || firstPartner?.gridOperatorMastrId || null;
      const resolvedVnbName = firstPartner?.name || firstPartner?.displayName || utilityName;

      p.meta.resolvedBdew = resolvedBdew;
      p.meta.resolvedMastrId = resolvedMastrId;
      p.meta.resolvedVnbName = resolvedVnbName;

      if (resolvedBdew) {
        const vnbLookup = await callBroker(ctx, 'grid-operations.vnbLookup', {
          bdew: resolvedBdew,
          limit: 1,
        });
        p.meta.vnbLookup = vnbLookup.data ?? null;
        // Extract mastrId from vnbLookup response if not already resolved from marketPartners
        if (!p.meta.resolvedMastrId) {
          const vnbData = vnbLookup.data?.data ?? vnbLookup.data;
          const mastrFromLookup =
            vnbData?.mastrId ||
            vnbData?.data?.mastrId ||
            vnbData?.mastrIds?.[0] ||
            vnbData?.data?.mastrIds?.[0] ||
            null;
          if (mastrFromLookup) {
            p.meta.resolvedMastrId = mastrFromLookup;
            this.logger.info(`[UtilityReport] resolvedMastrId via vnbLookup: ${mastrFromLookup}`);
          }
        }
      }

      p.phase = 2;
      saveProgress(p);
    }

    const { resolvedBdew, resolvedMastrId, resolvedVnbName } = p.meta;

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 2: Metadata & Stammdaten
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 2) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 2: Metadata`);

      const [eicSearch, ewkBenchmark] = await Promise.all([
        callBroker(ctx, 'eic-codes.search', { query: resolvedVnbName, limit: 3 }),
        callBroker(ctx, 'ewk-monitoring.benchmarkVnb', {
          vnbName: resolvedVnbName,
          ...(resolvedBdew ? { bnr: resolvedBdew } : {}),
        }),
      ]);

      p.results.phase2 = { eicSearch, ewkBenchmark };
      p.phase = 3;
      saveProgress(p);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 3: Data collection – 8 sections, fully sequential
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 3) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 3: Data collection`);

      const gridOpParams = resolvedMastrId
        ? { gridOperatorId: resolvedMastrId }
        : resolvedBdew
        ? { bdewCode: resolvedBdew }
        : {};
      const gridOpIdParams = resolvedBdew
        ? { gridOperatorBdewCode: resolvedBdew }
        : resolvedMastrId
        ? { gridOperatorId: resolvedMastrId }
        : {};

      // ── Section 1: Netzbetrieb ────────────────────────────────────────────
      const capacityUtilization = await callBroker(
        ctx, 'grid-operations.capacityUtilization', { ...gridOpIdParams }
      );

      const redispatchExport = await gated(
        availableTools, ['cernion_redispatch_export'],
        () => callBroker(ctx, 'grid-operations.redispatchExport', {
          ...(resolvedMastrId
            ? { gridOperatorId: resolvedMastrId }
            : resolvedBdew
            ? { gridOperatorBdewCode: resolvedBdew }
            : {}),
        })
      );

      const residualLoad = await callBroker(ctx, 'residual-load.netResidualLoad', {
        ...gridOpParams,
        region: region || resolvedVnbName,
      });

      const co2Intensity = await callBroker(ctx, 'energy-market.co2Intensity', {
        region: region || 'DE',
      });

      const operatorAnalysis = await callBroker(ctx, 'grid-operations.operatorAnalysis', {
        ...gridOpIdParams,
      });

      const emobilityImpact = await gated(
        availableTools, ['cernion_emobility_impact_analysis'],
        () => callMcpDirect('cernion_emobility_impact_analysis', {
          gridOperator: resolvedVnbName,
          location: region || resolvedVnbName,
        }, cernionToken)
      );

      const gridLossAnalysis = await gated(
        availableTools, ['cernion_grid_loss_analysis'],
        () => callMcpDirect('cernion_grid_loss_analysis', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      // ── MaStR data quality checks (parallel, fast local MongoDB) ──────────
      // cernion_installations_local requires gridOperatorMastrId – BDEW code is NOT supported.
      // Skip all three queries when only a BDEW code is available (no MaStR ID resolved).
      const dataQualityBaseParams = resolvedMastrId
        ? { gridOperatorMastrId: resolvedMastrId }
        : null;

      // Run 3 queries in parallel: sample-for-PLZ, in-Prüfung count, ≥100kW ohne MeLo
      const [sampleForPlz, anlagenInPruefung, installationenOhneMelo] = await Promise.all([
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              status: 'InBetrieb',
              format: 'detailed',
              includeStats: true,
              limit: 100,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No grid operator identifier' }),
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              netzbetreiberPruefungStatus: 'NetzbetreiberPruefung',
              status: 'InBetrieb',
              format: 'detailed',
              includeStats: true,
              limit: 1,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No grid operator identifier' }),
        dataQualityBaseParams
          ? callMcpDirect('cernion_installations_local', {
              ...dataQualityBaseParams,
              minCapacity: 100,
              status: 'InBetrieb',
              format: 'detailed',
              includeStats: true,
              includeNapData: true,
              limit: 2000,
            }, cernionToken)
          : Promise.resolve({ available: false, error: 'No grid operator identifier' }),
      ]);

      // Derive dominant PLZ prefix from sample and query ortsfremde Anlagen
      let ortsfremdeAnlagen = { available: false, error: 'PLZ prefix could not be determined' };
      if (sampleForPlz.available) {
        const sampleInsts =
          sampleForPlz.data?.installations ||
          sampleForPlz.data?.data?.installations ||
          [];
        const plzCounts = {};
        for (const inst of sampleInsts) {
          const pfx = String(inst.postleitzahl || '').slice(0, 3);
          if (pfx.length === 3) plzCounts[pfx] = (plzCounts[pfx] || 0) + 1;
        }
        const dominantPrefix = Object.entries(plzCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (dominantPrefix) {
          ortsfremdeAnlagen = await callMcpDirect('cernion_installations_local', {
            ...dataQualityBaseParams,
            postleitzahlNot: dominantPrefix,
            status: 'InBetrieb',
            format: 'detailed',
            includeStats: true,
            limit: 1,
          }, cernionToken);
          if (ortsfremdeAnlagen.available) {
            ortsfremdeAnlagen.dominantPlzPrefix = dominantPrefix;
          }
        }
      }

      p.results.section1 = {
        capacityUtilization,
        redispatchExport,
        residualLoad,
        co2Intensity,
        operatorAnalysis,
        emobilityImpact,
        gridLossAnalysis,
        anlagenInPruefung,
        installationenOhneMelo,
        ortsfremdeAnlagen,
      };
      saveProgress(p);

      // ── Section 2: EE-Portfolio ────────────────────────────────────────────
      const solar = await callBroker(ctx, 'assets.solar', { ...gridOpParams });
      const wind = await callBroker(ctx, 'assets.wind', { ...gridOpParams });
      const storage = await callBroker(ctx, 'assets.storage', { ...gridOpParams });

      const generationForecast = await callBroker(ctx, 'forecast.generationForecast', {
        ...gridOpParams,
        installationType: 'solar',
        forecastDays: 1,
      });

      const windSolarActual = await callBroker(ctx, 'entsoe.windSolarActual', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const regionalEnergyMix = await gated(
        availableTools, ['cernion_regional_energy_mix'],
        () => callMcpDirect('cernion_regional_energy_mix', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      p.results.section2 = {
        solar,
        wind,
        storage,
        generationForecast,
        windSolarActual,
        regionalEnergyMix,
      };
      saveProgress(p);

      // ── Section 3: Energiemarkt ────────────────────────────────────────────
      const prices = await callBroker(ctx, 'energy-market.prices', {
        market: 'day-ahead',
        region: 'DE',
        date: today,
      });

      const spotprices = await callBroker(ctx, 'german-grid.spotprices', { date: today });

      const negativePrices = await callBroker(ctx, 'german-grid.negativePrices', {
        dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        dateTo: today,
      });

      const actualGeneration = await callBroker(ctx, 'entsoe.actualGeneration', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const loadForecast = await callBroker(ctx, 'entsoe.loadForecast', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const unavailability = await callBroker(ctx, 'entsoe.unavailability', {
        region: 'DE',
        dateFrom: today,
        dateTo: today,
      });

      const priceProductionAnalysis = await gated(
        availableTools, ['cernion_price_production_analysis'],
        () => callMcpDirect('cernion_price_production_analysis', {
          region: 'DE',
          dateFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          dateTo: today,
        }, cernionToken)
      );

      p.results.section3 = {
        prices,
        spotprices,
        negativePrices,
        actualGeneration,
        loadForecast,
        unavailability,
        priceProductionAnalysis,
      };
      saveProgress(p);

      // ── Section 4: Gas ────────────────────────────────────────────────────
      const countryStorage = await callBroker(ctx, 'gas-storage.countryStorage', { country: 'DE' });
      const euStatistics = await callBroker(ctx, 'gas-storage.euStatistics', {});
      const storageTrend = await callBroker(ctx, 'gas-storage.storageTrend', {
        country: 'DE',
        period: 'monthly',
      });
      const supplySecurityCheck = await callBroker(ctx, 'gas-storage.supplySecurityCheck', {
        country: 'DE',
      });
      const compareCountries = await callBroker(ctx, 'gas-storage.compareCountries', {
        countries: ['DE', 'AT', 'NL', 'FR'],
      });

      p.results.section4 = {
        countryStorage,
        euStatistics,
        storageTrend,
        supplySecurityCheck,
        compareCountries,
      };
      saveProgress(p);

      // ── Section 5: Regulierung ────────────────────────────────────────────
      const ewkAnschlussdauer = await callBroker(ctx, 'ewk-monitoring.anschlussdauer', {
        vnbName: resolvedVnbName,
        voltageLevel: 'NS',
        installationType: 'EE',
        limit: 1,
        includeRanking: true,
      });

      const ewkDigitalisierungsindex = await callBroker(ctx, 'ewk-monitoring.digitalisierungsindex', {
        vnbName: resolvedVnbName,
        limit: 1,
        includeRanking: true,
      });

      const ewkUmsetzungsquote = await callBroker(ctx, 'ewk-monitoring.umsetzungsquote', {
        vnbName: resolvedVnbName,
        voltageLevel: 'NS',
        installationType: 'EE',
        limit: 1,
      });

      const nestCompliance = await gated(
        availableTools, ['cernion_nest_compliance_report'],
        () => callMcpDirect('cernion_nest_compliance_report', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      p.results.section5 = {
        benchmarkVnb: p.results.phase2?.ewkBenchmark ?? { available: false },
        anschlussdauer: ewkAnschlussdauer,
        digitalisierungsindex: ewkDigitalisierungsindex,
        umsetzungsquote: ewkUmsetzungsquote,
        nestCompliance,
      };
      saveProgress(p);

      // ── Section 6: Kunden & Vertrieb ──────────────────────────────────────
      const churnPrediction = await callBroker(ctx, 'business-intelligence.churnPrediction', {
        customerSegment: 'all',
        region: region || resolvedVnbName,
        riskThreshold: 'medium',
      });

      const salesLeads = await callBroker(ctx, 'business-intelligence.salesLeads', {
        region: region || resolvedVnbName,
        installationType: 'solar',
        daysBack: 90,
        limit: 20,
      });

      const marketPenetration = await gated(
        availableTools, ['cernion_market_penetration_analysis'],
        () => callBroker(ctx, 'business-intelligence.marketPenetration', {
          region: region || resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        })
      );

      const prosumerTariff = await gated(
        availableTools, ['cernion_prosumer_tariff_designer'],
        () => callMcpDirect('cernion_prosumer_tariff_designer', {
          customerSegment: 'all',
          region: region || resolvedVnbName,
          designGoal: 'customer-acquisition',
        }, cernionToken)
      );

      const directMarketing = await gated(
        availableTools, ['cernion_direct_marketing_opportunity_scanner'],
        () => callMcpDirect('cernion_direct_marketing_opportunity_scanner', {
          gridOperator: resolvedVnbName,
          minCapacity: 100,
          region: region || resolvedVnbName,
        }, cernionToken)
      );

      p.results.section6 = {
        churnPrediction,
        salesLeads,
        marketPenetration,
        prosumerTariff,
        directMarketing,
      };
      saveProgress(p);

      // ── Section 7: Investition ────────────────────────────────────────────
      const investmentBusinessCase = await gated(
        availableTools, ['cernion_investment_business_case'],
        () => callMcpDirect('cernion_investment_business_case', {
          gridOperator: resolvedVnbName,
          scenario: 'grid-expansion',
          region: region || resolvedVnbName,
        }, cernionToken)
      );

      const operatorPortfolio = await gated(
        availableTools, ['cernion_operator_portfolio'],
        () => callMcpDirect('cernion_operator_portfolio', {
          gridOperator: resolvedVnbName,
          ...(resolvedBdew ? { bdewCode: resolvedBdew } : {}),
        }, cernionToken)
      );

      const storageOptimization = await gated(
        availableTools, ['cernion_storage_optimization'],
        () => callMcpDirect('cernion_storage_optimization', {
          gridOperator: resolvedVnbName,
          region: region || resolvedVnbName,
        }, cernionToken)
      );

      p.results.section7 = {
        investmentBusinessCase,
        operatorPortfolio,
        storageOptimization,
        operatorAnalysis,
      };
      saveProgress(p);

      // ── Section 8: Digitalisierung & System ──────────────────────────────
      const systemStatus = await callBroker(ctx, 'system.status', {});

      const eicStatistics = await callBroker(ctx, 'eic-codes.statistics', {});

      p.results.section8 = {
        systemStatus,
        eicStatistics,
        digitalisierungsindex: ewkDigitalisierungsindex,
      };
      saveProgress(p);

      p.phase = 4;
      saveProgress(p);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 4: Context enrichment + HTML rendering
    // ──────────────────────────────────────────────────────────────────────────
    if (p.phase <= 4) {
      this.logger.info(`[UtilityReport] ${p.reportId} – Phase 4: Context & Rendering`);

      // Web search context (3 queries)
      const searchQueries = [
        `${resolvedVnbName} Netzausbau ${new Date().getFullYear()}`,
        `${utilityName} Digitalisierung Energiewende aktuell`,
        `BNetzA EWK Anschlussdauer ${resolvedVnbName} Benchmark`,
      ];

      const webSearchResults = [];
      for (const q of searchQueries) {
        const res = await callBroker(ctx, 'web-search.query', { query: q, numResults: 3 });
        if (res.available) webSearchResults.push(res.data);
      }

      // Build compact KPI summary for Gemini
      const kpiSummary = {};
      const allSections = { ...p.results.section1, ...p.results.section2, ...p.results.section3 };
      for (const [key, val] of Object.entries(allSections)) {
        Object.assign(kpiSummary, summarizeForReport(val, key));
      }

      const managementSummary = await generateNarrative(utilityName, kpiSummary);

      // Build HTML
      const html = buildHtmlReport({
        meta: {
          utilityName,
          vnbName: resolvedVnbName,
          region,
          bdew: resolvedBdew,
          reportId: p.reportId,
        },
        section1: p.results.section1,
        section2: p.results.section2,
        section3: p.results.section3,
        section4: p.results.section4,
        section5: p.results.section5,
        section6: p.results.section6,
        section7: p.results.section7,
        section8: p.results.section8,
        managementSummary,
        webSearchResults,
        generatedAt: new Date().toISOString(),
      });

      // Save HTML and index
      ensureReportsDir();
      fs.writeFileSync(reportPath(p.reportId), html, 'utf-8');
      indexReport(utilityName, today, p.reportId);

      p.status = 'completed';
      p.phase = 4;
      p.completedAt = new Date().toISOString();
      p.managementSummary = managementSummary;
      p.webSearchResults = webSearchResults;
      saveProgress(p);

      this.logger.info(`[UtilityReport] ${p.reportId} – Completed!`);
    }
  },

  }, // end methods
};
