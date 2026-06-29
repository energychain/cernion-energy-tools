'use strict';

const path = require('path');

/**
 * ZNP — Zielnetzplanung Workspace API (v0.20.4)
 *
 * Stateful, in-memory workspace service for target grid planning.
 * Each "project" is a persistent Knowledge Graph backed by graphology.
 * The graph is loaded iteratively via "Data Layers":
 *
 *   Layer 0 — MaStR assets (theoretical installations from Marktstammdatenregister)
 *   Layer 1 — OSM buildings / spatial data (stub — not yet implemented)
 *   Layer 2 — Measured transformer loads from documents (stub — not yet implemented)
 *
 * Architecture decisions (v0.23):
 * - Graphs are persisted to PouchDB via graph.export() after every layer mutation.
 *   On service start, all graphs are hydrated back from PouchDB (graph.import()).
 *   PouchDB uses two separate document types per project:
 *     znp:meta:<projectId>  — lightweight metadata (bbox, name, layers, stats)
 *     znp:graph:<projectId> — full serialised graphology export (graphData blob)
 *   This split guarantees fast list/dashboard queries (metadata only) while
 *   keeping the large graph blobs isolated.
 * - Layer 0 wires all assets to a single virtual substation node (SUB_1) because
 *   MaStR contains no network topology. Re-wiring to real substations happens in
 *   Layer 1/2 when OSM or VNB structural data becomes available.
 * - Strategic Assumption nodes (layer 2.5) are injected via POST /assumptions.
 *   §14a flex-NAV nodes are throttled to realistic emergency minimum (g=0.45)
 *   in calculateGFactor.
 *
 * Graph schema:
 *   Nodes:
 *     - mastr_asset   { type, mastrNummer, capacity (kW), assetType, lat, lon, layer }
 *     - substation    { type: 'substation', substationId }
 *   Edges:
 *     - CONTRIBUTES_LOAD { relationship, layer }  (asset → substation, directed)
 *
 * @module znp.service
 */

const crypto = require('crypto');
const { MoleculerError } = require('moleculer').Errors;
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const Graph = require('graphology');

const jobStore = require('../src/job-store');
const { appendLog } = require('../src/job-store');
const {
  extractLayer2CalibrationFromBuffer,
  extractLayer2CalibrationFromFile,
} = require('../src/znp-pdf-extractor');
const { fetchBuildingsForBbox, mapAssetsToBuildings } = require('../src/znp-osm-buildings');
const { detectClusters, computeGFactorAdjustment } = require('../src/znp-clustering-heuristics');
const { generateStructured, SchemaType } = require('../src/llm-client');
const { normaliseBoolFlag } = require('../src/redispatch-utils');
const { getTenantId } = require('../src/tenant-context');
const { computePortfolioAssessment } = require('../src/znp-portfolio-logic');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default substation node key for Layer 0 (single virtual aggregation point). */
const SUBSTATION_KEY = 'SUB_1';

/** PouchDB document prefix — metadata documents (bbox, name, layers, stats). */
const DOC_PREFIX_META = 'znp:meta:';

/** PouchDB document prefix — serialised graph data (graphology export blob). */
const DOC_PREFIX_GRAPH = 'znp:graph:';

/** Tile count per axis used by Layer 1 OSM fetching (matches znp-osm-buildings.js). */
const TILE_N = 2;

// ─── LLM schemas (module-level, reused across actions) ───────────────────────

/** Schema for strategicPrompts — 2-3 planning questions array. */
const STRATEGIC_PROMPTS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    questions: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ['questions'],
};

/** Schema for addAssumption — structured asset extraction from free text. */
const ASSUMPTION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    assetType: { type: SchemaType.STRING },
    capacityKW: { type: SchemaType.NUMBER },
    status: { type: SchemaType.STRING },
    hasFlexibleNav: { type: SchemaType.BOOLEAN },
  },
  required: ['assetType', 'capacityKW', 'status', 'hasFlexibleNav'],
};

// ─── Service definition ───────────────────────────────────────────────────────

module.exports = {
  name: 'znp',

  settings: {
    /** PouchDB path for project metadata. Override with ZNP_DB_PATH env var. */
    dbPath: process.env.ZNP_DB_PATH || './data/znp',
  },

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  created() {
    /**
     * In-memory registry of active ZNP projects.
     * Map<projectId: string, { graph: Graph, bbox, createdAt, layers: string[] }>
     */
    this.activeGraphs = new Map();
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`[znp] Project metadata DB initialised at ${this.settings.dbPath}`);
    await this._hydrateGraphs();
  },

  async stopped() {
    this.activeGraphs.clear();
    if (this.db) {
      await this.db.close();
    }
  },

  // ─── Actions ────────────────────────────────────────────────────────────────

  actions: {
    /**
     * createProject — Create a new empty ZNP workspace graph.
     *
     * Allocates a new graphology Graph instance and stores it in activeGraphs.
     * Persists lightweight project metadata (bbox, timestamps) to PouchDB.
     * The virtual aggregation substation (SUB_1) is pre-seeded at creation time
     * so it is always available as a target for CONTRIBUTES_LOAD edges.
     *
     * POST /api/znp/projects
     */
    createProject: {
      rest: 'POST /projects',
      params: {
        bbox: {
          type: 'object',
          props: {
            south: { type: 'number', convert: true },
            west: { type: 'number', convert: true },
            north: { type: 'number', convert: true },
            east: { type: 'number', convert: true },
          },
        },
        name: { type: 'string', optional: true, max: 120 },
      },
      openapi: {
        summary: 'Create a new ZNP project workspace',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Allocates a new in-memory graphology graph for the given geographic bounding box. ' +
          'Returns a projectId (UUID) that must be passed to all subsequent layer-loading ' +
          'and analysis calls. ' +
          'The virtual aggregation substation SUB_1 is pre-seeded into the graph. ' +
          'Graph state is persisted to PouchDB (znp:meta: + znp:graph: documents) and ' +
          'hydrated on service start. Sessions survive server restarts as of v0.23.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bbox'],
                properties: {
                  bbox: {
                    type: 'object',
                    required: ['south', 'west', 'north', 'east'],
                    example: { south: 49.47, west: 8.43, north: 49.52, east: 8.52 },
                    properties: {
                      south: { type: 'number', example: 49.47 },
                      west: { type: 'number', example: 8.43 },
                      north: { type: 'number', example: 49.52 },
                      east: { type: 'number', example: 8.52 },
                    },
                  },
                  name: { type: 'string', example: 'Ludwigshafen Nord Q3-2026' },
                },
              },
              examples: {
                default: {
                  value: {
                    bbox: { south: 49.47, west: 8.43, north: 49.52, east: 8.52 },
                    name: 'Ludwigshafen Nord Q3-2026',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Project created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string', example: 'a1b2c3d4-...' },
                    name: { type: 'string' },
                    bbox: { type: 'object' },
                    createdAt: { type: 'string', format: 'date-time' },
                    tenantId: { type: 'string', nullable: true },
                    graphStats: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { bbox, name } = ctx.params;
        const tenantId = getTenantId(ctx);
        const projectId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const projectName = name || `ZNP Project ${projectId.slice(0, 8)}`;

        // ── Initialise directed graph for this project ──
        const graph = new Graph({ type: 'directed', multi: false });

        // Pre-seed the virtual aggregation substation (Layer 0 anchor).
        // All MaStR assets loaded via addLayer0 connect to this node.
        graph.addNode(SUBSTATION_KEY, {
          type: 'substation',
          substationId: SUBSTATION_KEY,
          label: 'Virtual Aggregation Substation (Layer 0)',
        });

        // Register in active-graphs Map
        this.activeGraphs.set(projectId, {
          graph,
          bbox,
          name: projectName,
          createdAt,
          tenantId,
          layers: [],
          layer1GFactorAdjustment: 1.0, // updated by addLayer1 when clustering is computed
          layer2CalibrationFactor: 0,
          layer2MeasuredPeakLoadKw: 0,
          layer2TransformerId: null,
          layer2NominalCapacityKw: 0,
        });

        // Persist project metadata to PouchDB (znp:meta: — lightweight, no graph data)
        const metaDoc = {
          _id: `${DOC_PREFIX_META}${projectId}`,
          projectId,
          tenantId,
          name: projectName,
          bbox,
          createdAt,
          layers: [],
          layer1GFactorAdjustment: 1.0,
          layer2CalibrationFactor: 0,
          layer2MeasuredPeakLoadKw: 0,
          layer2TransformerId: null,
          layer2NominalCapacityKw: 0,
          nodeCount: graph.order,
          edgeCount: graph.size,
        };
        await this.db.put(metaDoc);

        // Persist initial graph state (SUB_1 only) to znp:graph: document
        await this.persistGraph(projectId, graph);

        this.logger.info(
          `[znp] Created project ${projectId} ("${projectName}") for tenant ${tenantId}`
        );

        return {
          projectId,
          name: projectName,
          bbox,
          createdAt,
          tenantId,
          graphStats: { nodes: graph.order, edges: graph.size },
        };
      },
    },

    /**
     * addLayer0 — Load MaStR assets (Layer 0) into an existing project graph.
     *
     * Each asset is added as a directed node with type 'mastr_asset'. A directed
     * CONTRIBUTES_LOAD edge (layer: 0) is created from each asset to the virtual
     * aggregation substation SUB_1. Duplicate mastrNummer values are silently
     * skipped to make the operation idempotent.
     *
     * POST /api/znp/projects/:projectId/layer0
     */
    addLayer0: {
      rest: 'POST /projects/:projectId/layer0',
      params: {
        projectId: { type: 'string' },
        assets: {
          type: 'array',
          items: {
            type: 'object',
            props: {
              mastrNummer: { type: 'string' },
              capacity: { type: 'number', convert: true }, // kW — accepts string from form-data
              assetType: { type: 'string', optional: true },
              lat: { type: 'number', optional: true, convert: true },
              lon: { type: 'number', optional: true, convert: true },
              status: { type: 'string', optional: true },
              commissioningDate: { type: 'string', optional: true },
              fernsteuerbarkeitDv: { type: 'boolean', optional: true, convert: true },
              fernsteuerbarkeitSonstige: { type: 'boolean', optional: true, convert: true },
            },
          },
          min: 1,
        },
      },
      openapi: {
        summary: 'Load Layer 0 — MaStR assets into a ZNP project graph',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Adds MaStR installation nodes and CONTRIBUTES_LOAD edges to the in-memory graph. ' +
          'All assets are wired to the virtual substation SUB_1 in Layer 0 because MaStR ' +
          'contains no network topology (physical wiring is resolved in Layer 1 / Layer 2). ' +
          'Duplicate mastrNummer entries are skipped (idempotent). ' +
          'Returns counts of added nodes and edges.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['assets'],
                properties: {
                  assets: {
                    type: 'array',
                    example: [
                      {
                        mastrNummer: 'SEE900123456789',
                        capacity: 10.5,
                        assetType: 'solar',
                        lat: 49.491,
                        lon: 8.471,
                      },
                      {
                        mastrNummer: 'SEE900987654321',
                        capacity: 7.0,
                        assetType: 'solar',
                        lat: 49.492,
                        lon: 8.472,
                      },
                    ],
                    items: {
                      type: 'object',
                      required: ['mastrNummer', 'capacity'],
                      properties: {
                        mastrNummer: { type: 'string', example: 'SEE900123456789' },
                        capacity: { type: 'number', example: 10.5, description: 'kW' },
                        assetType: { type: 'string', example: 'solar' },
                        lat: { type: 'number', example: 49.491 },
                        lon: { type: 'number', example: 8.471 },
                        status: {
                          type: 'string',
                          example: 'InBetrieb',
                          nullable: true,
                          description:
                            'MaStR Betriebsstatus (optional, unvalidated string — MaStR date formats vary).',
                        },
                        commissioningDate: {
                          type: 'string',
                          example: '2024-06-15',
                          nullable: true,
                          description:
                            'Commissioning date string (unvalidated — MaStR date formats vary).',
                        },
                        fernsteuerbarkeitDv: {
                          type: 'boolean',
                          example: true,
                          nullable: true,
                          description:
                            'Optional controlability marker from MaStR exports (stored as normalized boolean).',
                        },
                        fernsteuerbarkeitSonstige: {
                          type: 'boolean',
                          example: false,
                          nullable: true,
                          description:
                            'Optional fallback controlability marker from MaStR exports.',
                        },
                      },
                    },
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    assets: [
                      {
                        mastrNummer: 'SEE900123456789',
                        capacity: 10.5,
                        assetType: 'solar',
                        lat: 49.491,
                        lon: 8.471,
                      },
                      {
                        mastrNummer: 'SEE900987654321',
                        capacity: 7.0,
                        assetType: 'solar',
                        lat: 49.492,
                        lon: 8.472,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId, assets } = ctx.params;
        await this.ensureProjectHydrated(projectId);
        const { graph } = this.getProject(projectId);
        let nodesAdded = 0;
        let edgesAdded = 0;
        const skipped = [];

        for (const asset of assets) {
          // ── Per-item semantic validation ─────────────────────────────────
          // Return 400 INVALID_ASSET for items that pass type checks but are
          // semantically unacceptable (empty id, non-positive capacity, etc.).
          if (!asset.mastrNummer || asset.mastrNummer.trim() === '') {
            throw new MoleculerError(
              'Invalid asset: mastrNummer is required.',
              400,
              'INVALID_ASSET',
              { field: 'mastrNummer', value: asset.mastrNummer }
            );
          }
          if (!Number.isFinite(asset.capacity) || asset.capacity <= 0) {
            throw new MoleculerError(
              `Invalid asset "${asset.mastrNummer}": capacity must be a positive number (got ${asset.capacity}).`,
              400,
              'INVALID_ASSET',
              { field: 'capacity', mastrNummer: asset.mastrNummer, value: asset.capacity }
            );
          }

          const nodeKey = `mastr:${asset.mastrNummer}`;

          // Idempotency: skip if this MaStR number was already loaded
          if (graph.hasNode(nodeKey)) {
            skipped.push(asset.mastrNummer);
            continue;
          }

          // Add asset node with full attributes
          graph.addNode(nodeKey, {
            type: 'mastr_asset',
            mastrNummer: asset.mastrNummer,
            capacity: asset.capacity, // kW
            capacity_kw: asset.capacity, // kW alias for NOVA/Redispatch logic
            assetType: asset.assetType || 'unknown',
            lat: asset.lat ?? null,
            lon: asset.lon ?? null,
            layer: 0,
            status: asset.status || null,
            commissioningDate: asset.commissioningDate || null,
            fernsteuerbarkeitDv: normaliseBoolFlag(asset.fernsteuerbarkeitDv),
            fernsteuerbarkeitSonstige: normaliseBoolFlag(asset.fernsteuerbarkeitSonstige),
          });
          nodesAdded++;

          // Add directed edge: asset → SUB_1 (CONTRIBUTES_LOAD, layer 0)
          graph.addEdge(nodeKey, SUBSTATION_KEY, {
            relationship: 'CONTRIBUTES_LOAD',
            layer: 0,
          });
          edgesAdded++;
        }

        // Update PouchDB metadata doc and persist full graph state
        await this.updateProjectMeta(projectId, graph, 'layer0');
        await this.persistGraph(projectId, graph);

        this.logger.info(
          `[znp] addLayer0 project=${projectId}: +${nodesAdded} nodes, +${edgesAdded} edges` +
            (skipped.length ? `, skipped=${skipped.length}` : '')
        );

        return {
          projectId,
          nodesAdded,
          edgesAdded,
          skipped: skipped.length,
          totalNodes: graph.order,
          totalEdges: graph.size,
        };
      },
    },

    /**
     * addLayer1 — Load OSM building footprints and compute spatial clustering (Layer 1).
     *
     * Fetches buildings from the Overpass API using 2×2 tiling over the project bbox.
     * Maps Layer 0 MaStR assets into building polygons (oeo_located_in edges).
     * Detects asset clusters and computes a g-factor adjustment stored on the project.
     * Runs as an async job (202) for REST callers; synchronous for internal callers.
     *
     * POST /api/znp/projects/:projectId/layer1
     */
    addLayer1: {
      rest: 'POST /projects/:projectId/layer1',
      params: {
        projectId: { type: 'string' },
      },
      openapi: {
        summary: 'Load Layer 1 — OSM spatial buildings and clustering (async job)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Fetches building footprints for the project bounding box from the Overpass API ' +
          '(2×2 tiling, rate-limited). Maps Layer 0 MaStR assets to building polygons ' +
          '(oeo_located_in edges) and detects spatial clusters. Computes a clustering-based ' +
          'g-factor multiplier (solar shading / EV simultaneity). ' +
          'REST callers receive HTTP 202 + jobId; poll GET /api/jobs/:jobId/status. ' +
          'Requires addLayer0 to have been called first.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: {}, example: {} },
              examples: { default: { value: {} } },
            },
          },
        },
        responses: {
          202: {
            description: 'Job accepted — poll statusUrl for progress logs and result.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobId: { type: 'string' },
                    statusUrl: { type: 'string' },
                    resultUrl: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId); // throws 404 if unknown
        const { graph, bbox } = project;
        const activeGraphs = this.activeGraphs;
        const updateMeta = this.updateProjectMeta.bind(this);
        const persistGraph = this.persistGraph.bind(this);
        const logger = this.logger;

        return jobStore.startJob(ctx, { service: 'znp', action: 'addLayer1' }, async (jobId) => {
          appendLog(
            jobId,
            'osm_fetch',
            10,
            `Lade OSM-Gebäude für BBox (${TILE_N}×${TILE_N} Kacheln)...`
          );

          const buildings = await fetchBuildingsForBbox(bbox, (tileNum, total) => {
            const pct = 10 + Math.round((tileNum / total) * 30);
            appendLog(jobId, 'osm_fetch', pct, `Lade Kachel ${tileNum}/${total}...`);
          });

          appendLog(
            jobId,
            'spatial_mapping',
            45,
            `Mappe Assets auf ${buildings.length} Gebäude...`
          );

          const assetNodes = [];
          graph.forEachNode((nodeKey, attrs) => {
            if (attrs.type === 'mastr_asset' && attrs.lat != null && attrs.lon != null) {
              assetNodes.push({ nodeKey, ...attrs });
            }
          });

          const mappings = mapAssetsToBuildings(assetNodes, buildings);
          let buildingNodesAdded = 0;
          let locatedInEdgesAdded = 0;

          for (const { assetNodeKey, buildingOsmId, building } of mappings) {
            const bKey = `osm:${buildingOsmId}`;
            if (!graph.hasNode(bKey)) {
              graph.addNode(bKey, {
                type: 'OSM_Building',
                osmId: buildingOsmId,
                centroidLat: building.centroid.lat,
                centroidLon: building.centroid.lon,
                layer: 1,
              });
              buildingNodesAdded++;
            }
            if (!graph.hasEdge(assetNodeKey, bKey)) {
              graph.addEdge(assetNodeKey, bKey, { relationship: 'oeo_located_in', layer: 1 });
              locatedInEdgesAdded++;
            }
          }

          appendLog(jobId, 'clustering', 70, 'Berechne Cluster-Dichte und g-Faktor-Anpassung...');

          const clusters = detectClusters(assetNodes);
          const gFactorAdjustment = computeGFactorAdjustment(clusters);

          const updatedProject = activeGraphs.get(projectId);
          if (updatedProject) updatedProject.layer1GFactorAdjustment = gFactorAdjustment;

          await updateMeta(projectId, graph, 'layer1');
          await persistGraph(projectId, graph);

          appendLog(
            jobId,
            'done',
            100,
            `Layer 1 geladen: ${buildingNodesAdded} Gebäude, ${clusters.length} Cluster. ` +
              `g-Faktor Anpassung: ×${gFactorAdjustment.toFixed(2)}`
          );
          logger.info(
            `[znp] addLayer1 project=${projectId}: +${buildingNodesAdded} buildings, ` +
              `${clusters.length} clusters, g×${gFactorAdjustment.toFixed(2)}`
          );

          return {
            projectId,
            buildingNodesAdded,
            locatedInEdgesAdded,
            clusterCount: clusters.length,
            gFactorAdjustment,
            totalNodes: graph.order,
            totalEdges: graph.size,
          };
        });
      },
    },

    /**
     * addLayer2 — Extract measured transformer calibration data from a VNB PDF (Layer 2).
     *
     * Accepts either the path of a PDF already uploaded via POST /api/datasources/uploads
     * or an inline Base64-encoded PDF payload from a SPA.
     * Parses the PDF text, calls Gemini with a strict JSON schema to extract the
     * Jahreshöchstlast, transformer ID, and nominal transformer capacity, and attaches
     * a Measurement node plus a calibration node to SUB_1 in the graph.
     * Enables the Layer 2 short-circuit in calculateGFactor (measured load overrides
     * the theoretical Layer 1 estimate).
     *
     * POST /api/znp/projects/:projectId/layer2
     */
    addLayer2: {
      rest: 'POST /projects/:projectId/layer2',
      params: {
        projectId: { type: 'string' },
        filePath: { type: 'string', min: 3, optional: true },
        fileContentBase64: { type: 'string', min: 16, optional: true },
        fileName: { type: 'string', min: 1, optional: true },
      },
      openapi: {
        summary: 'Load Layer 2 — AI-extracted transformer peak load from PDF (async job)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Accepts either the path of a PDF uploaded via `POST /api/datasources/uploads` ' +
          'or an inline Base64-encoded PDF (`fileContentBase64`). ' +
          'Parses the document with pdf-parse, then calls Gemini (structured JSON output) ' +
          'to extract the maximum simultaneous annual peak transformer load (Jahreshöchstlast), ' +
          'transformer ID, and nominal transformer capacity. The nominal capacity is ' +
          'converted to kW in the extractor using cos(phi)=0.95. Adds a Measurement node ' +
          'plus a calibration node and enables the Layer 2 short-circuit in calculateGFactor: ' +
          'the measured value replaces the theoretical Layer 1 estimate. ' +
          'REST callers receive HTTP 202 + jobId; poll GET /api/jobs/:jobId/status for ' +
          'Chain-of-Thought log messages.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  filePath: {
                    type: 'string',
                    example: '/opt/cernion-energy-tools/uploads/lastprofil_trafo.pdf',
                  },
                  fileContentBase64: { type: 'string', example: 'JVBERi0xLjQKJcfs...' },
                  fileName: { type: 'string', example: 'lastprofil_trafo.pdf' },
                },
                oneOf: [{ required: ['filePath'] }, { required: ['fileContentBase64'] }],
              },
              examples: {
                byPath: {
                  value: { filePath: '/opt/cernion-energy-tools/uploads/lastprofil_trafo.pdf' },
                },
                byBase64: {
                  value: {
                    fileName: 'lastprofil_trafo_2025.pdf',
                    fileContentBase64:
                      'data:application/pdf;base64,JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoK',
                  },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Job accepted — poll statusUrl for AI extraction logs and result.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    jobId: { type: 'string' },
                    status: { type: 'string' },
                    message: { type: 'string' },
                    statusUrl: { type: 'string' },
                    resultUrl: { type: 'string' },
                  },
                },
                examples: {
                  accepted: {
                    value: {
                      success: true,
                      jobId: '6fd6a40e-4f18-4d78-aad0-0a7d4fdfec8d',
                      status: 'queued',
                      message: 'Job started. Poll /api/jobs/:jobId/status for progress.',
                      statusUrl: '/api/jobs/6fd6a40e-4f18-4d78-aad0-0a7d4fdfec8d/status',
                      resultUrl: '/api/jobs/6fd6a40e-4f18-4d78-aad0-0a7d4fdfec8d/result',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId, filePath, fileContentBase64, fileName } = ctx.params;
        if (!filePath && !fileContentBase64) {
          throw new MoleculerError(
            'Layer 2 requires either filePath or fileContentBase64.',
            400,
            'ZNP_LAYER2_FILE_REQUIRED'
          );
        }

        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId); // throws 404 if unknown
        const { graph } = project;
        const updateMeta = this.updateProjectMeta.bind(this);
        const persistGraph = this.persistGraph.bind(this);
        const logger = this.logger;

        return jobStore.startJob(ctx, { service: 'znp', action: 'addLayer2' }, async (jobId) => {
          if (jobId) jobStore.updateJob(jobId, { status: 'running' });
          appendLog(jobId, 'pdf_parse', 10, 'Lese PDF...');
          const extraction = await (async () => {
            appendLog(jobId, 'llm_extract', 40, 'Übergebe PDF an LLM-Extraktion...');
            if (fileContentBase64) {
              const pdfBuffer = this.decodePdfBase64(fileContentBase64);
              const value = await extractLayer2CalibrationFromBuffer(pdfBuffer);
              appendLog(
                jobId,
                'llm_extract',
                70,
                `Peak ${value.peakLoadKw} kW und Trafo ${value.transformerId} extrahiert.`
              );
              return value;
            }

            const value = await extractLayer2CalibrationFromFile(filePath);
            appendLog(
              jobId,
              'llm_extract',
              70,
              `Peak ${value.peakLoadKw} kW und Trafo ${value.transformerId} extrahiert.`
            );
            return value;
          })();

          const { peakLoadKw, transformerId, nominalCapacityKw } = extraction;
          const layer1Result = await this.broker.call('znp.calculateGFactor', {
            projectId,
            substationId: SUBSTATION_KEY,
            target_layer: 1,
          });
          const layer1NominalCapacityKw =
            Math.round((layer1Result.totalCapacityKW || 0) * 1000) / 1000;
          const calibrationGFactor =
            layer1NominalCapacityKw > 0
              ? Math.round((peakLoadKw / layer1NominalCapacityKw) * 1000) / 1000
              : 0;
          const sourceFileName =
            fileName || (filePath ? path.basename(filePath) : 'inline-upload.pdf');

          appendLog(
            jobId,
            'graph_update',
            80,
            `Schreibe Measurement- und Calibration-Node (${peakLoadKw} kW) an ${SUBSTATION_KEY}...`
          );
          const measurementKey = `measurement:peak_load:${SUBSTATION_KEY}`;
          if (!graph.hasNode(measurementKey)) {
            graph.addNode(measurementKey, {
              type: 'measurement',
              metricType: 'peak_load',
              value: peakLoadKw,
              unit: 'kW',
              layer: 2,
              transformerId,
              nominalCapacityKw,
              sourceFileName,
            });
            graph.addEdge(measurementKey, SUBSTATION_KEY, {
              relationship: 'oeo_measures',
              metric: 'peak_load_measured',
              layer: 2,
            });
          } else {
            graph.setNodeAttribute(measurementKey, 'value', peakLoadKw);
            graph.setNodeAttribute(measurementKey, 'transformerId', transformerId);
            graph.setNodeAttribute(measurementKey, 'nominalCapacityKw', nominalCapacityKw);
            graph.setNodeAttribute(measurementKey, 'sourceFileName', sourceFileName);
          }

          const calibrationKey = `calibration:substation:${SUBSTATION_KEY}`;
          const calibrationPayload = {
            type: 'calibration_node',
            metricType: 'layer2_calibration',
            peakLoadKw,
            transformerId,
            nominalCapacityKw,
            layer1NominalCapacityKw,
            calibrationGFactor,
            sourceFileName,
            layer: 2,
            updatedAt: new Date().toISOString(),
          };

          if (!graph.hasNode(calibrationKey)) {
            graph.addNode(calibrationKey, calibrationPayload);
            graph.addEdge(calibrationKey, SUBSTATION_KEY, {
              relationship: 'calibrates',
              metric: 'layer2_g_factor',
              layer: 2,
            });
          } else {
            for (const [key, value] of Object.entries(calibrationPayload)) {
              graph.setNodeAttribute(calibrationKey, key, value);
            }
          }

          graph.setNodeAttribute(SUBSTATION_KEY, 'layer2Active', true);
          graph.setNodeAttribute(SUBSTATION_KEY, 'layer2MeasuredPeakLoadKw', peakLoadKw);
          graph.setNodeAttribute(SUBSTATION_KEY, 'layer2TransformerId', transformerId);
          graph.setNodeAttribute(SUBSTATION_KEY, 'layer2NominalCapacityKw', nominalCapacityKw);
          graph.setNodeAttribute(SUBSTATION_KEY, 'layer2SourceFileName', sourceFileName);
          graph.setNodeAttribute(SUBSTATION_KEY, 'layer2CalibrationGFactor', calibrationGFactor);
          graph.setNodeAttribute(SUBSTATION_KEY, 'layer2UpdatedAt', new Date().toISOString());

          project.layer2CalibrationFactor = calibrationGFactor;
          project.layer2MeasuredPeakLoadKw = peakLoadKw;
          project.layer2TransformerId = transformerId;
          project.layer2NominalCapacityKw = nominalCapacityKw;

          await updateMeta(projectId, graph, 'layer2');
          await persistGraph(projectId, graph);

          this.emitLayer2ActivatedEvent(projectId, {
            measurementKey,
            calibrationKey,
            peakLoadKw,
            transformerId,
            nominalCapacityKw,
            layer1NominalCapacityKw,
            calibrationGFactor,
            sourceFileName,
          });

          appendLog(jobId, 'done', 100, 'Layer 2 erfolgreich geladen.');
          logger.info(
            `[znp] addLayer2 project=${projectId}: peak_load=${peakLoadKw} kW, ` +
              `trafo=${transformerId}, nominal_kw=${nominalCapacityKw}, calibration_g=${calibrationGFactor}`
          );

          return {
            projectId,
            measurementKey,
            calibrationKey,
            peakLoadKw,
            transformerId,
            nominalCapacityKw,
            layer1NominalCapacityKw,
            calibrationGFactor,
            totalNodes: graph.order,
            totalEdges: graph.size,
          };
        });
      },
    },

    /**
     * calculateGFactor — Compute simultaneity-adjusted capacity from substation.
     *
     * Implements "Immutable Stacking with Query-Time Short-Circuiting":
     * the graph is never mutated — layers are traversed at query time by
     * filtering edges whose `layer` attribute is ≤ targetLayer.
     *
     * For targetLayer=0:
     *   Sum all `capacity` values on nodes reachable from SUB_1 via inbound
     *   CONTRIBUTES_LOAD edges with layer == 0.
     *   Apply the appropriate simultaneity factor from SIMULTANEITY_FACTORS.
     *
     * GET /api/znp/projects/:projectId/g-factor?target_layer=0
     */
    calculateGFactor: {
      rest: 'GET /projects/:projectId/g-factor',
      params: {
        projectId: { type: 'string' },
        target_layer: {
          type: 'number',
          integer: true,
          optional: true,
          default: 0,
          min: 0,
          max: 2,
          convert: true,
        },
        substationId: { type: 'string', optional: true, default: SUBSTATION_KEY },
      },
      openapi: {
        summary: 'Calculate simultaneity factor (G-Factor) for a ZNP project',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Traverses all CONTRIBUTES_LOAD edges with `layer ≤ targetLayer` inbound to the ' +
          'specified substation node, sums asset capacities, and applies the simultaneity ' +
          'factor (Gleichzeitigkeitsfaktor) from VDE-AR-N 4100.\n\n' +
          '**Immutable Stacking:** The graph is never mutated — layer filtering happens at ' +
          'query time (Short-Circuiting). This means you can call calculateGFactor with ' +
          '`targetLayer=0` even after addLayer1 has been called, and the result will only ' +
          'reflect Layer 0 assets.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
          {
            name: 'target_layer',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 0, minimum: 0, maximum: 2 },
            description: 'Include all layers ≤ target_layer in the capacity sum.',
          },
          {
            name: 'substationId',
            in: 'query',
            required: false,
            schema: { type: 'string', default: 'SUB_1' },
            description: 'Target substation node key. Defaults to SUB_1.',
          },
        ],
        responses: {
          200: {
            description: 'G-Factor calculation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string' },
                    substationId: { type: 'string' },
                    targetLayer: { type: 'integer' },
                    assetCount: { type: 'integer' },
                    totalCapacityKW: { type: 'number' },
                    simultaneityFactor: { type: 'number' },
                    adjustedCapacityKW: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId, substationId } = ctx.params;
        const targetLayer = ctx.params.target_layer;
        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId);
        const { graph } = project;

        // Validate the target substation node exists in the graph
        if (!graph.hasNode(substationId)) {
          throw new MoleculerError(
            `Substation node "${substationId}" not found in project graph.`,
            404,
            'ZNP_SUBSTATION_NOT_FOUND',
            { projectId, substationId }
          );
        }

        // ── Graph traversal: collect inbound CONTRIBUTES_LOAD edges ──────────────
        // Handles two node types:
        //   mastr_asset    — standard MaStR installation (layer 0/1)
        //   assumption     — strategic planning node (layer 2.5, Issues 3)
        //                    §14a EnWG: hasFlexibleNav=true → emergency throttle (g=0.45)
        let totalCapacityKW = 0;
        let assetCount = 0;
        let flexNavExcluded = 0;

        graph.forEachInEdge(substationId, (edgeKey, edgeAttrs, sourceKey) => {
          if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
          const nodeAttrs = graph.getNodeAttributes(sourceKey);
          const edgeGFactor = this.normaliseEdgeGFactor(edgeAttrs.gFactor);

          if (nodeAttrs.type === 'assumption') {
            // Assumption nodes are visible at target_layer >= 2 (planning horizon)
            if (targetLayer < 2) return;
            let assumptionGFactor = 1.0;
            if (nodeAttrs.hasFlexibleNav) {
              // §14a flex-NAV: legally curtailable → realistic emergency floor
              assumptionGFactor = 0.45;
              flexNavExcluded++;
            }

            const effectiveCapacity = (nodeAttrs.capacity || 0) * edgeGFactor * assumptionGFactor;
            if (effectiveCapacity > 0) {
              totalCapacityKW += effectiveCapacity;
              assetCount++;
            }
            return;
          }

          // Standard layer-filtered traversal for mastr_asset nodes
          if (edgeAttrs.layer > targetLayer) return;
          if (nodeAttrs.type === 'mastr_asset') {
            const effectiveCapacity = (nodeAttrs.capacity || 0) * edgeGFactor;
            if (effectiveCapacity > 0) {
              totalCapacityKW += effectiveCapacity;
              assetCount++;
            }
          }
        });

        // ── Layer 2 short-circuit (Architecture Deep Dive §3) ──────────────────
        // If a Measurement node exists AND targetLayer ≥ 2, use the measured peak
        // load directly. The g-factor is back-computed as measured / theoretical.
        if (targetLayer >= 2) {
          const measurementKey = `measurement:peak_load:${substationId}`;
          if (graph.hasNode(measurementKey)) {
            const measuredLoad = graph.getNodeAttributes(measurementKey).value;
            const gFactor =
              totalCapacityKW > 0 ? Math.round((measuredLoad / totalCapacityKW) * 1000) / 1000 : 0;
            return {
              projectId,
              substationId,
              targetLayer,
              assetCount,
              totalCapacityKW: Math.round(totalCapacityKW * 1000) / 1000,
              simultaneityFactor: gFactor,
              adjustedCapacityKW: Math.round(measuredLoad * 1000) / 1000,
              layer2ShortCircuit: true,
              measuredPeakLoadKW: measuredLoad,
              flexNavExcluded,
            };
          }
        }

        // ── Apply VDE-AR-N 4100 simultaneity factor ────────────────────────────
        const simultaneityFactor = this.getSimultaneityFactor(assetCount);

        // ── Layer 1 clustering adjustment (multiplied on top of VDE factor) ───
        const clusterMultiplier =
          targetLayer >= 1 && project.layer1GFactorAdjustment
            ? project.layer1GFactorAdjustment
            : 1.0;
        const adjustedCapacityKW = totalCapacityKW * simultaneityFactor * clusterMultiplier;

        this.logger.debug(
          `[znp] G-Factor project=${projectId} layer≤${targetLayer}: ` +
            `n=${assetCount}, Σ=${totalCapacityKW} kW, g=${simultaneityFactor}, ` +
            `cluster×${clusterMultiplier}, adj=${adjustedCapacityKW.toFixed(2)} kW`
        );

        return {
          projectId,
          substationId,
          targetLayer,
          assetCount,
          totalCapacityKW: Math.round(totalCapacityKW * 1000) / 1000,
          simultaneityFactor: Math.round(simultaneityFactor * clusterMultiplier * 1000) / 1000,
          adjustedCapacityKW: Math.round(adjustedCapacityKW * 1000) / 1000,
          flexNavExcluded,
        };
      },
    },

    assessPortfolio: {
      rest: 'GET /projects/:projectId/portfolio',
      params: {
        projectId: { type: 'string' },
        kaufmaennischeFreigabeFnav: {
          type: 'boolean',
          optional: true,
          default: false,
          convert: true,
        },
      },
      openapi: {
        summary: 'Assess ZNP portfolio with hybrid provenance and transparent dimensions',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Computes a deterministic portfolio assessment across ZNP Layer 0 (MaStR), Layer 2 ' +
          '(inhouse transformer PDF calibration), and Layer 2.5 (strategic assumptions). ' +
          'The result includes explicit `portfolio.weg` metadata and provenance flags ' +
          'to make confidence and source reliability transparent. ' +
          'If kaufmännische fNAV approval is missing, the response is a manual-only hard blocker.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
          {
            name: 'kaufmaennischeFreigabeFnav',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
            description:
              'Explicit governance confirmation for fNAV (kaufmännische Freigabe). ' +
              'If false, assessment stays blocked until manual UI resolution.',
          },
        ],
        responses: {
          200: {
            description: 'Portfolio assessment result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string' },
                    tenantId: { type: 'string', nullable: true },
                    decisionStatus: {
                      type: 'string',
                      enum: ['blocked', 'ready'],
                    },
                    portfolio: {
                      type: 'object',
                      properties: {
                        weg: { type: 'string', example: 'hybrid_layered_v1' },
                        provenance: {
                          type: 'array',
                          items: { type: 'string' },
                          example: ['mastr_layer_0', 'inhouse_layer_2', 'strategic_assumption'],
                        },
                        provenanceFlags: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              provenance: { type: 'string' },
                              source: { type: 'string' },
                              reliability: { type: 'number' },
                            },
                          },
                        },
                        reliabilityScore: { type: 'number' },
                      },
                    },
                    dimensionScores: {
                      type: 'object',
                      properties: {
                        economic: { type: 'number' },
                        regulatory: { type: 'number' },
                        technical: { type: 'number' },
                        temporal: { type: 'number' },
                      },
                    },
                    overallScore: { type: 'number' },
                    governance: {
                      type: 'object',
                      properties: {
                        resolutionMode: { type: 'string', example: 'manual_only' },
                        hardBlockers: { type: 'array', items: { type: 'object' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        const tenantId = getTenantId(ctx);

        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId);
        this.requireProjectTenant(project, tenantId, projectId);

        const metrics = this.collectPortfolioMetrics(project);
        metrics.missingFnavApproval = ctx.params.kaufmaennischeFreigabeFnav !== true;

        const governance = await this.evaluatePortfolioGovernance(ctx, {
          projectId,
          tenantId,
          missingFnavApproval: metrics.missingFnavApproval,
        });

        const assessment = computePortfolioAssessment(metrics);

        return {
          projectId,
          tenantId: project.tenantId,
          decisionStatus: governance.decisionStatus,
          portfolio: {
            ...assessment.portfolio,
            provenance: assessment.portfolio.provenanceFlags.map((flag) => flag.provenance),
          },
          dimensionScores: assessment.dimensionScores,
          overallScore: assessment.overallScore,
          governance,
          metrics: {
            mastrAssetCount: metrics.mastrAssetCount,
            mastrCapacityKW: Math.round(metrics.mastrCapacityKW * 100) / 100,
            assumptionCount: metrics.assumptionCount,
            assumptionCapacityKW: Math.round(metrics.assumptionCapacityKW * 100) / 100,
            measuredPeakLoadKW: Math.round(metrics.measuredPeakLoadKW * 100) / 100,
          },
        };
      },
    },

    morningBriefing: {
      rest: 'GET /projects/:projectId/morning-briefing',
      params: {
        projectId: { type: 'string' },
        thresholdMW: {
          type: 'number',
          optional: true,
          default: 81,
          min: 0,
          convert: true,
        },
        since: { type: 'string', optional: true, max: 80 },
      },
      openapi: {
        summary: 'Build a read-only ZNP morning briefing for grid planners',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Returns an action-oriented morning summary for the Cernion ZNP Workspace. ' +
          'The briefing consolidates overnight planning changes, bottleneck signals ' +
          'against the supplied MW threshold, and recommended advisory next actions. ' +
          'It is read-only and does not mutate the ZNP graph or apply NOVA decisions.',
        parameters: [
          { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'thresholdMW',
            in: 'query',
            required: false,
            schema: { type: 'number', default: 81 },
          },
          { name: 'since', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Morning briefing dashboard model',
          },
        },
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        const tenantId = getTenantId(ctx);
        const thresholdKW = ctx.params.thresholdMW * 1000;
        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId);
        this.requireProjectTenant(project, tenantId, projectId);

        const { graph } = project;
        const assumptions = [];
        const plannedAssets = [];
        let mastrCapacityKW = 0;

        graph.forEachNode((nodeKey, attrs) => {
          if (attrs.type === 'assumption') {
            assumptions.push({
              id: nodeKey.replace(/^assumption:/, ''),
              assetType: attrs.assetType || 'planning-assumption',
              capacityKW: attrs.capacity || 0,
              status: attrs.status || 'planned',
              hasFlexibleNav: attrs.hasFlexibleNav === true,
              createdAt: attrs.createdAt || null,
              source: 'strategic_assumption',
            });
            return;
          }

          if (attrs.type === 'mastr_asset') {
            const capacity = attrs.capacity || 0;
            mastrCapacityKW += capacity;
            if (/planung|planned/i.test(String(attrs.status || ''))) {
              plannedAssets.push({
                id: attrs.mastrNummer || nodeKey,
                assetType: attrs.assetType || 'asset',
                capacityKW: capacity,
                status: attrs.status || 'planned',
                commissioningDate: attrs.commissioningDate || null,
                source: 'mastr_layer_0',
              });
            }
          }
        });

        const measuredPeakKW = project.layer2MeasuredPeakLoadKw || 0;
        const layer2BasisKW = measuredPeakKW || mastrCapacityKW;
        const visibleDemandKW =
          layer2BasisKW +
          assumptions.reduce((sum, item) => {
            const flexFactor = item.hasFlexibleNav ? 0.45 : 1.0;
            return sum + item.capacityKW * flexFactor;
          }, 0);
        const utilization = thresholdKW > 0 ? visibleDemandKW / thresholdKW : 0;

        const overnightChanges = [...plannedAssets, ...assumptions]
          .sort((a, b) => (b.capacityKW || 0) - (a.capacityKW || 0))
          .slice(0, 5)
          .map((item) => ({
            title: `${item.assetType} ${Math.round(item.capacityKW)} kW`,
            detail: item.hasFlexibleNav
              ? 'Planungsannahme mit flexiblem NAV erkannt'
              : item.status === 'planned' || item.status === 'In Planung'
                ? 'Neue oder geplante Anschlusslast im Planungsraum'
                : 'Aktualisierte Planungsannahme im Workspace',
            severity: item.hasFlexibleNav ? 'info' : item.capacityKW >= 1000 ? 'watch' : 'info',
            source: item.source,
          }));

        if (overnightChanges.length === 0) {
          overnightChanges.push({
            title: 'Keine neuen Anschlussereignisse im Workspace',
            detail: 'Layer 0/2.5 enthalten aktuell keine neuen Planungsdelta-Signale.',
            severity: 'info',
            source: 'znp_graph',
          });
        }

        const bottlenecks = [
          {
            title: `Pfalzwerke-Schwelle ${ctx.params.thresholdMW} MW`,
            detail: `${Math.round(visibleDemandKW / 10) / 100} MW sichtbar gegen ${ctx.params.thresholdMW} MW Schwelle`,
            severity: utilization >= 0.95 ? 'critical' : utilization >= 0.8 ? 'watch' : 'clear',
            utilization: Math.round(utilization * 1000) / 1000,
            thresholdMW: ctx.params.thresholdMW,
          },
        ];

        if (assumptions.some((item) => !item.hasFlexibleNav && item.capacityKW >= 1000)) {
          bottlenecks.push({
            title: 'Starre Grossanschlussannahme',
            detail: 'Mindestens eine neue MW-Annahme bindet Kapazitaet ohne Flexibilitaetshebel.',
            severity: 'watch',
          });
        }

        const recommendedActions = [];
        if (assumptions.some((item) => item.hasFlexibleNav)) {
          recommendedActions.push({
            title: 'Flexible NAV als Angebotslinie vorbereiten',
            detail: 'Planungsannahme im NOVA-/Portfolio-Kontext pruefen und kaufmaennische Freigabe separat einholen.',
            actionType: 'advisory',
            priority: 'high',
          });
        }
        if (utilization >= 0.8) {
          recommendedActions.push({
            title: '81-MW Engpassbezug pruefen',
            detail: 'Anschlussdelta gegen N-1-Grenze, Gleichzeitigkeit und Layer-2-Messbasis plausibilisieren.',
            actionType: 'review',
            priority: utilization >= 0.95 ? 'critical' : 'high',
          });
        }
        if (recommendedActions.length === 0) {
          recommendedActions.push({
            title: 'Morgenlage beobachten',
            detail: 'Keine akute Schwellenverletzung; naechsten Layer-2-/Anschlussdelta-Lauf abwarten.',
            actionType: 'monitor',
            priority: 'normal',
          });
        }

        return {
          projectId,
          tenantId: project.tenantId,
          generatedAt: new Date().toISOString(),
          since: ctx.params.since || null,
          headline:
            utilization >= 0.95
              ? 'Kapazitaetslage kritisch'
              : utilization >= 0.8
                ? 'Engpassschwelle im Blick behalten'
                : 'Morgenlage stabil',
          metrics: {
            visibleDemandMW: Math.round(visibleDemandKW / 10) / 100,
            thresholdMW: ctx.params.thresholdMW,
            utilizationPct: Math.round(utilization * 1000) / 10,
            overnightChangeCount: overnightChanges.length,
            recommendationCount: recommendedActions.length,
          },
          overnightChanges,
          bottlenecks,
          recommendedActions,
          sourceActions: {
            inspected: ['znp.project.graph', 'znp.layer0', 'znp.layer2', 'znp.assumptions'],
            notCalled: ['nova.apply', 'nova.approveDecision', 'external.connector.call'],
          },
        };
      },
    },

    productionReadinessStatus: {
      rest: 'GET /projects/:projectId/production-readiness/status',
      params: {
        projectId: { type: 'string' },
        layer1Evidence: { type: 'string', optional: true, max: 120 },
        layer2Evidence: { type: 'string', optional: true, max: 120 },
        gfactorValidation: { type: 'string', optional: true, max: 120 },
        acceptanceReference: { type: 'string', optional: true, max: 160 },
        novaHandoff: { type: 'string', optional: true, max: 120 },
        referenceDataset: { type: 'string', optional: true, max: 160 },
        measuredGfactor: { type: 'number', optional: true, convert: true },
        modelGfactor: { type: 'number', optional: true, convert: true },
        owner: { type: 'string', optional: true, max: 120 },
        nextReview: { type: 'string', optional: true, max: 120 },
        source: { type: 'string', optional: true, max: 160 },
      },
      openapi: {
        summary: 'Read-only ZNP production-readiness evidence gate',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Classifies supplied ZNP Layer 1, Layer 2, G-Factor, NOVA handoff and acceptance evidence ' +
          'for a dossier-safe production-readiness review. This endpoint does not fetch external data, ' +
          'parse PDFs, create jobs, mutate projects, or apply NOVA decisions.',
        parameters: [
          { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'layer1Evidence', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'layer2Evidence', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'gfactorValidation', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'acceptanceReference', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'novaHandoff', in: 'query', required: false, schema: { type: 'string' } },
                  { in: 'query', name: 'referenceDataset', schema: { type: 'string' } },
          { in: 'query', name: 'measuredGfactor', schema: { type: 'number' } },
          { in: 'query', name: 'modelGfactor', schema: { type: 'number' } },
          { in: 'query', name: 'owner', schema: { type: 'string' } },
          { in: 'query', name: 'nextReview', schema: { type: 'string' } },
          { in: 'query', name: 'source', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Read-only production-readiness status',
          },
        },
      },
      async handler(ctx) {
        const params = ctx.params || {};
        const projectId = params.projectId;
        const tenantId = getTenantId(ctx);
        const isPresent = (value) => /^(present|ready|valid|validated|provided|complete|ok|true|yes|ja|advisory-ready|reviewed)$/i.test(String(value || '').trim());
        const makeSignal = (code, label, value, statusWhenMissing, enablesDossierAddition) => {
          const supplied = isPresent(value);
          return {
            code,
            label,
            status: supplied ? 'present' : 'missing',
            value: value || null,
            statusWhenMissing,
            enablesDossierAddition,
          };
        };
        const readinessSignals = [
          makeSignal(
            'layer1_evidence',
            'Layer 1 OSM/building clustering evidence',
            params.layer1Evidence,
            'needs_layer1_evidence',
            'add Layer 1 building / OSM clustering evidence reference'
          ),
          makeSignal(
            'layer2_evidence',
            'Layer 2 transformer/load profile evidence',
            params.layer2Evidence,
            'needs_layer2_evidence',
            'add Layer 2 transformer or measured load profile evidence'
          ),
          makeSignal(
            'gfactor_validation',
            'G-Factor validation evidence',
            params.gfactorValidation,
            'needs_gfactor_validation',
            'add measured/reference G-Factor comparison basis'
          ),
          makeSignal(
            'acceptance_reference',
            'Acceptance/reference evidence',
            params.acceptanceReference || params.referenceDataset,
            'needs_acceptance_reference',
            'add acceptance fixture, reference dataset, or review record'
          ),
          makeSignal(
            'nova_handoff',
            'NOVA advisory handoff readiness',
            params.novaHandoff,
            'needs_nova_handoff_readiness',
            'add advisory NOVA handoff status without applying a decision'
          ),
        ];
        const missingSignals = readinessSignals.filter((signal) => signal.status !== 'present');
        let status = 'ready_for_znp_readiness_review';
        if (!projectId || String(projectId).trim() === '') {
          status = 'needs_project_context';
        } else if (missingSignals.length > 0) {
          status = missingSignals[0].statusWhenMissing;
        }
        const gateStatus = status === 'ready_for_znp_readiness_review' ? 'ready' : 'evidence_gap';
        const evidenceGaps = !projectId
          ? [
              {
                missingDataPoint: 'project_context',
                status: 'missing',
                enablesDossierAddition: 'provide project id, municipality/territory, and planning scope',
                category: 'znp_production_readiness_evidence_gate',
              },
            ]
          : missingSignals.map((signal) => ({
              missingDataPoint: signal.code,
              status: signal.status,
              enablesDossierAddition: signal.enablesDossierAddition,
              category: 'znp_production_readiness_evidence_gate',
            }));
        const positiveFollowUps = evidenceGaps.map((gap) => ({
          missingDataPoint: gap.missingDataPoint,
          status: gap.status,
          enablesDossierAddition: gap.enablesDossierAddition,
          category: gap.category,
        }));
        const sourceActions = {
          inspected: ['znp.productionReadinessStatus'],
          referenced: ['znp.project.metadata', 'znp.layer1', 'znp.layer2', 'znp.gfactor', 'nova.handoff'],
          notCalled: [
            'overpass.fetch',
            'znp.addLayer1',
            'znp.addLayer2',
            'znp.createProject',
            'znp.updateProject',
            'pdf.import',
            'job.create',
            'nova.apply',
            'hitl.create',
            'workflow.execute',
            'notification.send',
            'graph.mutate',
            'external.connector.call',
            'personal-agent.execute',
          ],
        };
        const dossierFacts = [
          `Status: ${status}`,
          `Project: ${projectId || 'unknown'}`,
          `Gate: ${gateStatus}`,
          `Layer 1: ${readinessSignals[0].status}`,
          `Layer 2: ${readinessSignals[1].status}`,
          `G-Factor: ${readinessSignals[2].status}`,
          `Acceptance: ${readinessSignals[3].status}`,
          `NOVA handoff: ${readinessSignals[4].status}`,
          `Open gaps: ${evidenceGaps.length}`,
        ];

        return {
          productionReadinessStatusId: `znp-pr:${Buffer.from(`${tenantId || 'public'}:${projectId || 'missing'}`).toString('base64url').slice(0, 28)}`,
          capabilityKey: 'znp_production_readiness_evidence_gate',
          safety: 'read_only',
          status,
          gateStatus,
          projectContext: {
            projectId: projectId || null,
            tenantId,
            owner: params.owner || null,
            nextReview: params.nextReview || null,
            source: params.source || null,
          },
          readinessSignals,
          evidenceGaps,
          missingEvidence: evidenceGaps,
          positiveFollowUps,
          sourceActions,
          validationFindings: evidenceGaps.map((gap, index) => ({
            code: `ZNP_PR_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
            severity: status === 'ready_for_znp_readiness_review' ? 'info' : 'medium',
            message: gap.enablesDossierAddition,
          })),
          dossierEvidence: {
            status,
            gateStatus,
            projectContext: {
              projectId: projectId || null,
              tenantId,
              owner: params.owner || null,
              nextReview: params.nextReview || null,
              source: params.source || null,
            },
            readinessSignals,
            evidenceGaps,
            positiveFollowUps,
            sourceActions: {
              notCalled: sourceActions.notCalled,
            },
            dossierFacts,
          },
        };
      },
    },

    /**
     * strategicPrompts — LLM-generated strategic planning questions for a project.
     *
     * Analyses the current graph topology and asks Gemini to generate 2-3 targeted
     * questions about future developments not visible in MaStR/OSM data (e.g. data
     * centres, §14a flexible connections, new housing estates).
     *
     * GET /api/znp/projects/:projectId/strategic-prompts
     */
    strategicPrompts: {
      rest: 'GET /projects/:projectId/strategic-prompts',
      params: {
        projectId: { type: 'string' },
        questionSeed: { type: 'string', optional: true, max: 500 },
      },
      openapi: {
        summary: 'Generate strategic planning questions for a ZNP project (AI)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Analyses the current graph topology (asset types, capacity, layers) and uses ' +
          'Google Gemini to generate 2-3 strategic questions a grid planner should answer ' +
          'about developments not visible in MaStR/OSM (e.g. data centres, §14a NAV, ' +
          'heat-pump obligations). Returns the questions array + the graph summary used ' +
          'as LLM context. Requires GEMINI_API_KEY \u2014 returns HTTP 503 if not configured.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
          {
            name: 'questionSeed',
            in: 'query',
            required: false,
            description: 'SCQA Kernfrage as seed to orient generated planning questions',
            schema: { type: 'string', maxLength: 500 },
          },
        ],
        responses: {
          200: {
            description: 'Strategic questions generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string' },
                    questions: { type: 'array', items: { type: 'string' } },
                    graphSummary: { type: 'object' },
                  },
                },
              },
            },
          },
          503: { description: 'HTTP 503 LLM_NOT_CONFIGURED \u2014 GEMINI_API_KEY not set' },
        },
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId);
        const { graph } = project;

        // ── Build graph summary for LLM context ──────────────────────────────
        const assetTypes = {};
        let totalCapacityKW = 0;
        let hasMeasurements = false;
        let assumptionCount = 0;

        graph.forEachNode((key, attrs) => {
          if (attrs.type === 'mastr_asset') {
            assetTypes[attrs.assetType] = (assetTypes[attrs.assetType] || 0) + 1;
            totalCapacityKW += attrs.capacity || 0;
          } else if (attrs.type === 'measurement') {
            hasMeasurements = true;
          } else if (attrs.type === 'assumption') {
            assumptionCount++;
          }
        });

        const graphSummary = {
          nodeCount: graph.order,
          edgeCount: graph.size,
          layers: project.layers,
          assetTypes,
          totalCapacityKW: Math.round(totalCapacityKW),
          hasMeasurements,
          assumptionCount,
          bbox: project.bbox,
        };

        const planningAssist = await this.getPlanningAssist(ctx, {
          task: `ZNP strategische Fragengenerierung für Projekt ${projectId} mit Fokus auf Netzplanung und fehlende Datenpfade.`,
          mode: 'initial',
        });
        const planningHint =
          planningAssist.available && planningAssist.summary
            ? `\n\nPlanungsassistenz-Hinweis: ${planningAssist.summary}`
            : '';

        const questionSeedHint = ctx.params.questionSeed
          ? `\n\nSCQA-Kernfrage des Entscheidungsrahmens (als Orientierung f\u00fcr die Fragengenerierung): ${ctx.params.questionSeed}`
          : '';

        const prompt =
          'Du bist ein Zielnetzplanungs-Experte f\u00fcr deutsche Verteilnetzbetreiber.\n' +
          'Analysiere folgendes Verteilnetz-Areal und formuliere 2-3 strategische Fragen, ' +
          'die ein Netzplaner unbedingt beantworten sollte \u2014 \u00fcber Aspekte, die NICHT in den ' +
          '\u00f6ffentlichen Daten (MaStR, OSM) sichtbar sind.\n\n' +
          `Netz-Kontext:\n${JSON.stringify(graphSummary, null, 2)}\n\n` +
          'Beziehe dich auf \u00a714a EnWG (steuerbare Verbrauchseinrichtungen), m\u00f6gliche ' +
          'Rechenzentren/Gewerbegebiete, Neubaupotenzial, W\u00e4rmepumpenpflicht (GEG), ' +
          'und EV-Ladeinfrastruktur. Stelle konkrete, handlungsrelevante Fragen.' +
          planningHint +
          questionSeedHint;

        const result = await generateStructured(STRATEGIC_PROMPTS_SCHEMA, prompt);

        return {
          projectId,
          questions: Array.isArray(result.questions) ? result.questions : [],
          graphSummary,
          planningAssist,
        };
      },
    },

    /**
     * createAssumption — Create a StrategicAssumption node from free text.
     *
     * Inserts a lightweight StrategicAssumption node (layer 2.5), applies
     * deterministic peak-shaving edge overrides, and persists the updated graph.
     */

    correlateDisturbance: {
      rest: 'POST /projects/:projectId/correlate-disturbance',
      params: {
        projectId: { type: 'string' },
        disturbanceId: { type: 'string' },
        pattern: { type: 'string', optional: true },
        severity: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Correlate a disturbance signal with ZNP',
        description:
          'Maps a Phase 4 blindflug-radar disturbance signal into a NOVA option shape for investment decisioning.',
        tags: ['ZNP'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId', 'disturbanceId'],
                properties: {
                  projectId: { type: 'string', example: 'znp_prj_123' },
                  disturbanceId: { type: 'string', example: 'SIG-123' },
                  pattern: { type: 'string', example: 'CAPACITY_BOTTLENECK' },
                  severity: { type: 'string', example: 'high' },
                },
              },
              examples: {
                default: {
                  value: {
                    projectId: 'znp_prj_123',
                    disturbanceId: 'SIG-123',
                    pattern: 'CAPACITY_BOTTLENECK',
                    severity: 'high',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successfully correlated disturbance to NOVA option',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    projectId: { type: 'string' },
                    disturbanceId: { type: 'string' },
                    novaOption: { type: 'object' },
                    governanceAction: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId, disturbanceId, pattern, severity } = ctx.params;
        const project = this.activeGraphs.get(projectId);
        if (!project) {
          throw new MoleculerClientError('Project graph not loaded', 404, 'NOT_FOUND', {
            projectId,
          });
        }

        const novaOption = {
          id: `NOVA-OPT-${Date.now()}`,
          projectId,
          sourceSignal: disturbanceId,
          reason: `Disturbance correlation: ${pattern || 'UNKNOWN'}`,
          type: 'znp_capex_alternative',
          status: 'proposed',
          severity: severity || 'medium',
          createdAt: new Date().toISOString(),
        };

        let governanceAction = 'none';

        if (severity === 'high' || severity === 'critical') {
          // High-impact => HITL
          await ctx
            .call('hitl.create', {
              kind: 'blindflug-radar-high-impact',
              originService: this.name,
              originAction: 'correlateDisturbance',
              severity: 'warning',
              payload: { novaOption },
            })
            .catch((err) => this.logger.warn('Failed to create HITL item', err));
          governanceAction = 'hitl.create';
        } else if (severity === 'medium') {
          // Unresolved evidence => interface-placeholder
          await ctx
            .call('interface-placeholder.markGap', {
              role: 'portfolio_planner',
              reason: 'NEEDS_EVIDENCE',
              blockingLevel: 'soft',
              placeholderGapKey: `disturbance_${disturbanceId}`,
              replacementCriteria: {
                kind: 'process',
                capabilityHint: 'znp.correlateDisturbance',
                deadline: null,
              },
            })
            .catch((err) => this.logger.warn('Failed to mark interface gap', err));
          governanceAction = 'interface-placeholder.markGap';
        }

        return {
          success: true,
          projectId,
          disturbanceId,
          novaOption,
          governanceAction,
        };
      },
    },

    createAssumption: {
      params: {
        projectId: { type: 'string' },
        text: { type: 'string', min: 1, max: 5000 },
      },
      openapi: {
        summary: 'Create in-memory StrategicAssumption node (stub)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Creates a Layer 2.5 StrategicAssumption node in the project graph, applies deterministic ' +
          'peak-shaving edge updates, and persists the resulting graph state to PouchDB.',
      },
      async handler(ctx) {
        const { projectId, text } = ctx.params;
        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId);
        const { graph } = project;

        const id = crypto.randomUUID();
        const nodeKey = `strategic_assumption:${id}`;

        graph.addNode(nodeKey, {
          type: 'StrategicAssumption',
          id,
          text,
          layer: 2.5,
          createdAt: new Date().toISOString(),
        });

        this.applyAssumptionPeakShaving(graph, text, id);
        await this.persistGraph(projectId, graph);
        await this.updateProjectMeta(projectId, graph, 'layer2.5');
        this.emitAssumptionConfirmedEventAsync(projectId, id, text);

        return { id, text };
      },
    },

    /**
     * addAssumption — Ingest a natural-language planning assumption into the graph.
     *
     * Calls Gemini with a strict JSON schema to extract asset type, capacity,
     * status, and §14a flex-NAV flag from free text. Inserts a StrategicAssumption
     * node (layer 2.5) and a CONTRIBUTES_LOAD edge to SUB_1. The flex-NAV flag
     * controls §14a throttling in calculateGFactor (hasFlexibleNav=true → g=0.45).
     * Persists the updated graph to PouchDB.
     *
     * POST /api/znp/projects/:projectId/assumptions
     */
    addAssumption: {
      params: {
        projectId: { type: 'string' },
        text: { type: 'string', min: 10, max: 2000 },
      },
      openapi: {
        summary: 'Ingest a natural-language planning assumption into the graph (AI)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Uses Gemini (structured JSON schema) to extract asset type, capacity (kW), ' +
          'status, and \u00a714a flex-NAV flag from free-text German input. Inserts a ' +
          'StrategicAssumption node at layer=2.5 and a CONTRIBUTES_LOAD edge to SUB_1. ' +
          'In calculateGFactor, nodes with hasFlexibleNav=true are throttled to a realistic ' +
          'emergency minimum (legally curtailable under \u00a714a EnWG \u2014 g=0.45). ' +
          'On success, backend emits `znp.project.updated` with payload ' +
          '{ type: "assumption-confirmed", data: { id: "<assumptionId>", text: "<originalText>" } } ' +
          'for NovaFeedStore/SSE consumers. ' +
          'Requires GEMINI_API_KEY \u2014 returns HTTP 503 if not configured.',
        parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: {
                    type: 'string',
                    example: 'Wir planen einen 5 MW Speicher mit flexiblem NAV am Br\u00fcckweg.',
                  },
                },
              },
              examples: {
                flexNav: {
                  value: {
                    text: 'Wir planen einen 5 MW Speicher mit flexiblem NAV am Br\u00fcckweg.',
                  },
                },
                datacenter: {
                  value: {
                    text: 'Ein neues Rechenzentrum mit 3000 kW Anschlussleistung ist im Gewerbegebiet Nord geplant.',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Assumption node inserted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string' },
                    assumptionId: { type: 'string' },
                    nodeKey: { type: 'string' },
                    extracted: { type: 'object' },
                    hasFlexibleNav: { type: 'boolean' },
                    graphStats: { type: 'object' },
                  },
                },
              },
            },
          },
          422: {
            description:
              'HTTP 422 ASSUMPTION_EXTRACTION_FAILED \u2014 LLM could not extract valid capacity',
          },
          503: { description: 'HTTP 503 LLM_NOT_CONFIGURED \u2014 GEMINI_API_KEY not set' },
        },
      },
      async handler(ctx) {
        const { projectId, text } = ctx.params;
        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId);
        const { graph } = project;

        const planningAssist = await this.getAgentAnalyzeAssist(ctx, {
          text,
          projectId,
        });
        const assistHint = planningAssist?.hint || '';

        // ── LLM extraction ────────────────────────────────────────────────────
        const prompt =
          'Extrahiere die geplante Energieanlage aus dieser deutschen Beschreibung als JSON.\n' +
          `Beschreibung: "${text}"\n\n` +
          'Extrahiere:\n' +
          '- assetType: Typ der Anlage (z.B. "storage", "datacenter", "heatpump", "wallbox", "solar", "wind")\n' +
          '- capacityKW: Nennleistung in kW (als Zahl, ohne Einheit)\n' +
          '- status: Planungsstatus (z.B. "planned", "approved", "under_construction")\n' +
          '- hasFlexibleNav: true wenn ein flexibler Netzanschlussvertrag (\u00a714a EnWG) erw\u00e4hnt wird, sonst false\n\n' +
          'Antworte NUR als striktes JSON.' +
          assistHint;

        const extracted = await generateStructured(ASSUMPTION_SCHEMA, prompt);

        if (!Number.isFinite(extracted.capacityKW) || extracted.capacityKW <= 0) {
          throw new MoleculerError(
            'LLM konnte keine g\u00fcltige Leistungsangabe aus dem Text extrahieren.',
            422,
            'ASSUMPTION_EXTRACTION_FAILED',
            { text: text.slice(0, 120), extracted }
          );
        }

        // ── Graph mutation ────────────────────────────────────────────────────
        const assumptionId = crypto.randomUUID();
        const nodeKey = `assumption:${assumptionId}`;

        graph.addNode(nodeKey, {
          type: 'assumption',
          assumptionId,
          assetType: extracted.assetType,
          capacity: extracted.capacityKW,
          status: extracted.status,
          hasFlexibleNav: extracted.hasFlexibleNav === true,
          layer: 2.5,
          sourceText: text.slice(0, 200),
          createdAt: new Date().toISOString(),
        });

        graph.addEdge(nodeKey, SUBSTATION_KEY, {
          relationship: 'CONTRIBUTES_LOAD',
          layer: 2.5,
        });

        // Persist updated graph state
        await this.persistGraph(projectId, graph);
        await this.updateProjectMeta(projectId, graph, 'layer2.5');

        this.logger.info(
          `[znp] addAssumption project=${projectId}: ` +
            `${extracted.assetType} ${extracted.capacityKW}kW flexNav=${extracted.hasFlexibleNav}`
        );

        // Emit frontend-consumable update event for NovaFeedStore.
        // Contract: { type: 'assumption-confirmed', data: { id, text } }
        this.emitAssumptionConfirmedEvent(projectId, assumptionId, text);

        return {
          projectId,
          assumptionId,
          nodeKey,
          extracted,
          hasFlexibleNav: extracted.hasFlexibleNav === true,
          graphStats: { nodes: graph.order, edges: graph.size },
          planningAssist: {
            available: !!planningAssist,
            warning: planningAssist?.warning || null,
          },
        };
      },
    },

    /**
     * getProjectAssets — Return a paginated, filtered list of Layer 0 MaStR assets.
     *
     * GET /api/znp/projects/:projectId/assets
     */
    getProjectAssets: {
      rest: 'GET /projects/:projectId/assets',
      params: {
        projectId: { type: 'string' },
        status: { type: 'string', optional: true },
        assetType: { type: 'string', optional: true },
        limit: { type: 'number', integer: true, default: 100, max: 1000, convert: true },
        offset: { type: 'number', integer: true, default: 0, min: 0, convert: true },
        sortByCapacity: { type: 'enum', values: ['asc', 'desc'], default: 'desc', optional: true },
      },
      openapi: {
        summary: 'List MaStR assets in a ZNP project (paginated)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Returns the Layer 0 MaStR asset nodes from the project graph. ' +
          'Supports filtering by status and assetType, sorting by capacity, and ' +
          'offset/limit pagination. Strategic assumption nodes (Layer 2.5) are excluded — ' +
          'use a dedicated assumptions endpoint for those.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'InBetrieb' },
            description: 'Filter by asset status (exact string match).',
          },
          {
            name: 'assetType',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'solar' },
            description: 'Filter by asset type (exact string match).',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, maximum: 1000, example: 100 },
            description: 'Maximum number of results to return (1–1000).',
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 0, example: 0 },
            description: 'Zero-based offset for pagination.',
          },
          {
            name: 'sortByCapacity',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc', example: 'desc' },
            description: 'Sort direction by capacity (kW). Default: desc (highest capacity first).',
          },
        ],
        responses: {
          200: {
            description: 'Paginated asset list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalCount: { type: 'integer', example: 42 },
                    offset: { type: 'integer', example: 0 },
                    limit: { type: 'integer', example: 100 },
                    assets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          mastrNummer: { type: 'string', example: 'SEE900123456789' },
                          capacity: { type: 'number', example: 10.5 },
                          assetType: { type: 'string', example: 'solar' },
                          status: { type: 'string', example: 'InBetrieb', nullable: true },
                          commissioningDate: {
                            type: 'string',
                            example: '2024-06-15',
                            nullable: true,
                          },
                          lat: { type: 'number', example: 49.491, nullable: true },
                          lon: { type: 'number', example: 8.471, nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          projectId,
          status,
          assetType,
          limit = 100,
          offset = 0,
          sortByCapacity = 'desc',
        } = ctx.params;
        const tenantId = getTenantId(ctx);

        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId); // throws 404 if not found
        this.requireProjectTenant(project, tenantId, projectId);
        const { graph } = project;

        // Collect all mastr_asset nodes (Layer 0 only — excludes assumptions, buildings, etc.)
        const allAssets = [];
        graph.forEachNode((_nodeKey, attrs) => {
          if (attrs.type !== 'mastr_asset') return;
          allAssets.push(attrs);
        });

        // Apply optional filters
        let filtered = allAssets;
        if (status !== undefined && status !== null) {
          filtered = filtered.filter((a) => a.status === status);
        }
        if (assetType !== undefined && assetType !== null) {
          filtered = filtered.filter((a) => a.assetType === assetType);
        }

        // Sort by capacity (ascending or descending)
        const dir = sortByCapacity === 'asc' ? 1 : -1;
        filtered.sort((a, b) => dir * (a.capacity - b.capacity));

        const totalCount = filtered.length;
        const page = filtered.slice(offset, offset + limit);

        return {
          totalCount,
          offset,
          limit,
          assets: page.map((a) => ({
            mastrNummer: a.mastrNummer,
            capacity: a.capacity,
            assetType: a.assetType,
            status: a.status ?? null,
            commissioningDate: a.commissioningDate ?? null,
            lat: a.lat ?? null,
            lon: a.lon ?? null,
          })),
        };
      },
    },

    /**
     * getProject (metadata) — Return project metadata and current graph stats.
     *
     * GET /api/znp/projects/:projectId
     */
    getProjectMeta: {
      rest: 'GET /projects/:projectId',
      params: {
        projectId: { type: 'string' },
      },
      openapi: {
        summary: 'Get ZNP project metadata and graph statistics',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Returns the project metadata (bbox, name, createdAt, loaded layers) and ' +
          'live graph statistics (node count, edge count) from the in-memory graph. ' +
          'As of v0.23, graphs are persisted and hydrated on restart — 404 should not occur ' +
          'unless the project was explicitly deleted from PouchDB.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        const tenantId = getTenantId(ctx);
        await this.ensureProjectHydrated(projectId);
        const project = this.getProject(projectId); // throws 404 if not found
        this.requireProjectTenant(project, tenantId, projectId);

        return {
          projectId,
          name: project.name,
          bbox: project.bbox,
          createdAt: project.createdAt,
          tenantId: project.tenantId,
          layers: project.layers,
          graphStats: {
            nodes: project.graph.order,
            edges: project.graph.size,
          },
        };
      },
    },

    /**
     * listProjects — List all active in-memory ZNP projects.
     *
     * GET /api/znp/projects
     */
    listProjects: {
      rest: 'GET /projects',
      params: {},
      openapi: {
        summary: 'List all active ZNP projects (in-memory)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Returns all projects currently held in the in-memory activeGraphs Map. ' +
          'As of v0.23, graphs are hydrated from PouchDB on service start, so this list ' +
          'is populated even after a server restart.',
      },
      handler(ctx) {
        const tenantId = getTenantId(ctx);
        const projects = [];
        for (const [projectId, project] of this.activeGraphs.entries()) {
          if (project.tenantId && project.tenantId !== tenantId) continue;
          projects.push({
            projectId,
            name: project.name,
            bbox: project.bbox,
            createdAt: project.createdAt,
            tenantId: project.tenantId,
            layers: project.layers,
            graphStats: {
              nodes: project.graph.order,
              edges: project.graph.size,
            },
          });
        }
        return { projects, total: projects.length };
      },
    },

    /**
     * deleteProject — Remove a ZNP project and all its persisted data.
     *
     * Deletes both the metadata document (znp:meta:*) and graph document (znp:graph:*)
     * from PouchDB, then removes the project from the in-memory activeGraphs registry.
     * This operation is irreversible and intended primarily for test cleanup and workspace
     * management. Returns success confirmation.
     *
     * DELETE /api/znp/projects/:projectId
     */
    deleteProject: {
      rest: 'DELETE /projects/:projectId',
      params: {
        projectId: { type: 'string' },
      },
      openapi: {
        summary: 'Delete a ZNP project permanently',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Removes the project from in-memory activeGraphs and deletes all persisted data ' +
          '(znp:meta and znp:graph documents) from PouchDB. This is irreversible and intended ' +
          'for test cleanup and workspace management. Returns success confirmation.',
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        const tenantId = getTenantId(ctx);

        // Check that project exists (in-memory)
        if (!this.activeGraphs.has(projectId)) {
          throw new MoleculerError(
            `Project "${projectId}" not found in active workspace.`,
            404,
            'ZNP_PROJECT_NOT_FOUND',
            { projectId }
          );
        }

        const project = this.activeGraphs.get(projectId);
        this.requireProjectTenant(project, tenantId, projectId);

        const metaDocId = `${DOC_PREFIX_META}${projectId}`;
        const graphDocId = `${DOC_PREFIX_GRAPH}${projectId}`;

        // Fetch current revisions before deletion (PouchDB requires _rev for delete)
        let metaRev;
        let graphRev;
        try {
          const metaDoc = await this.db.get(metaDocId);
          metaRev = metaDoc._rev;
        } catch (err) {
          if (err.status !== 404) throw err;
          // meta doc missing — continue
        }
        try {
          const graphDoc = await this.db.get(graphDocId);
          graphRev = graphDoc._rev;
        } catch (err) {
          if (err.status !== 404) throw err;
          // graph doc missing — continue
        }

        // Delete PouchDB documents if they exist
        const deletePromises = [];
        if (metaRev) {
          deletePromises.push(
            this.db.remove(metaDocId, metaRev).catch((err) => {
              if (err.status !== 404) {
                this.logger.warn(
                  `[znp] Failed to delete meta doc for "${projectId}": ${err.message}`
                );
              }
            })
          );
        }
        if (graphRev) {
          deletePromises.push(
            this.db.remove(graphDocId, graphRev).catch((err) => {
              if (err.status !== 404) {
                this.logger.warn(
                  `[znp] Failed to delete graph doc for "${projectId}": ${err.message}`
                );
              }
            })
          );
        }

        await Promise.all(deletePromises);

        // Remove from in-memory registry
        this.activeGraphs.delete(projectId);

        this.logger.info(`[znp] Deleted project ${projectId}`);

        return {
          success: true,
          projectId,
          message: `Project "${projectId}" has been permanently deleted.`,
        };
      },
    },
  },

  // ─── Methods ────────────────────────────────────────────────────────────────

  methods: {
    async getPlanningAssist(ctx, { task, mode = 'initial' }) {
      try {
        const result = await this.broker.call(
          'capability-broker.recommend',
          {
            task,
            mode,
            alreadyExecutedSteps: [],
            doNotUse: ['query.ask', 'query.askLearned'],
          },
          { meta: ctx?.meta || {}, timeout: 5000 }
        );
        return {
          available: true,
          summary: result?.summary || null,
          intent: result?.intent || null,
          confidence: Number.isFinite(result?.confidence) ? result.confidence : null,
          warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        };
      } catch (error) {
        this.logger.debug(`[znp] planning assist unavailable: ${error.message}`);
        return {
          available: false,
          warning: error.message,
        };
      }
    },

    async getAgentAnalyzeAssist(ctx, { text, projectId }) {
      try {
        const result = await this.broker.call(
          'agent.analyze',
          {
            problem:
              `Extrahiere aus folgender ZNP-Annahme strukturierte Parameter (assetType, capacityKW, status, hasFlexibleNav) und ` +
              `bevorzuge deterministische Interpretation. Projekt: ${projectId}. Text: ${text}`,
          },
          { meta: ctx?.meta || {}, timeout: 8000 }
        );

        const topAction =
          Array.isArray(result?.steps) && result.steps.length > 0 ? result.steps[0].action : null;

        return {
          warning: null,
          hint: topAction
            ? `\n\nAssist-Hinweis: geplanter Analysepfad startet mit ${topAction}.`
            : '',
        };
      } catch (error) {
        this.logger.debug(`[znp] agent.analyze assist unavailable: ${error.message}`);
        return {
          warning: error.message,
          hint: '',
        };
      }
    },

    /**
     * hydrateGraph — Load one project from PouchDB and import the graphology state.
     *
     * @param {string} projectId
     * @returns {Promise<object>} hydrated project descriptor
     */
    async hydrateGraph(projectId) {
      const metaDocId = `${DOC_PREFIX_META}${projectId}`;
      const graphDocId = `${DOC_PREFIX_GRAPH}${projectId}`;

      const [meta, graphDoc] = await Promise.all([this.db.get(metaDocId), this.db.get(graphDocId)]);

      if (!graphDoc.graphData) {
        throw new Error(`Missing graphData for project "${projectId}".`);
      }

      const graph = new Graph({ type: 'directed', multi: false });
      graph.import(graphDoc.graphData);

      const project = {
        graph,
        bbox: meta.bbox,
        name: meta.name,
        createdAt: meta.createdAt,
        tenantId: meta.tenantId || null,
        layers: meta.layers || [],
        layer1GFactorAdjustment: meta.layer1GFactorAdjustment || 1.0,
        layer2CalibrationFactor: meta.layer2CalibrationFactor || 0,
        layer2MeasuredPeakLoadKw: meta.layer2MeasuredPeakLoadKw || 0,
        layer2TransformerId: meta.layer2TransformerId || null,
        layer2NominalCapacityKw: meta.layer2NominalCapacityKw || 0,
      };

      this.activeGraphs.set(projectId, project);
      return project;
    },

    /**
     * ensureProjectHydrated — Ensure project is available in-memory; load from PouchDB if needed.
     *
     * @param {string} projectId
     * @returns {Promise<void>}
     */
    async ensureProjectHydrated(projectId) {
      if (this.activeGraphs.has(projectId)) return;

      try {
        await this.hydrateGraph(projectId);
      } catch (err) {
        throw new MoleculerError(
          `ZNP project "${projectId}" not found.`,
          404,
          'ZNP_PROJECT_NOT_FOUND',
          { projectId, reason: err.message }
        );
      }
    },

    /**
     * getProject — Retrieve an active project or throw 404.
     * @param {string} projectId
     * @returns {{ graph: Graph, bbox, name, createdAt, layers: string[] }}
     */
    getProject(projectId) {
      const project = this.activeGraphs.get(projectId);
      if (!project) {
        throw new MoleculerError(
          `ZNP project "${projectId}" not found.`,
          404,
          'ZNP_PROJECT_NOT_FOUND',
          { projectId }
        );
      }
      return project;
    },

    requireProjectTenant(project, tenantId, projectId) {
      if (!project.tenantId || project.tenantId === tenantId) {
        return;
      }

      throw new MoleculerError(
        `ZNP project "${projectId}" not found.`,
        404,
        'ZNP_PROJECT_NOT_FOUND',
        { projectId }
      );
    },

    collectPortfolioMetrics(project) {
      const metrics = {
        mastrAssetCount: 0,
        mastrCapacityKW: 0,
        controllableAssetCount: 0,
        hasLayer2Measurement: false,
        measuredPeakLoadKW: 0,
        assumptionCount: 0,
        assumptionCapacityKW: 0,
        dataAgeHours: 24 * 30,
        missingFnavApproval: false,
      };

      const timestamps = [
        project.createdAt,
        project.graph.getNodeAttribute(SUBSTATION_KEY, 'layer2UpdatedAt'),
      ]
        .map((value) => Date.parse(value))
        .filter((value) => Number.isFinite(value) && value > 0);

      project.graph.forEachNode((_nodeKey, attrs) => {
        if (attrs.type === 'mastr_asset') {
          metrics.mastrAssetCount += 1;
          metrics.mastrCapacityKW += Number(attrs.capacity) || 0;
          if (
            attrs.fernsteuerbarkeitDv ||
            attrs.fernsteuerbarkeitSonstige ||
            attrs.hasFlexibleNav
          ) {
            metrics.controllableAssetCount += 1;
          }
          return;
        }

        if (attrs.type === 'measurement' && attrs.metricType === 'peak_load') {
          metrics.hasLayer2Measurement = true;
          metrics.measuredPeakLoadKW = Number(attrs.value) || 0;
          return;
        }

        if (attrs.type === 'assumption' || attrs.type === 'StrategicAssumption') {
          metrics.assumptionCount += 1;
          metrics.assumptionCapacityKW += Number(attrs.capacity) || Number(attrs.capacityKW) || 0;
        }
      });

      if (timestamps.length > 0) {
        const latestTimestamp = Math.max(...timestamps);
        metrics.dataAgeHours = Math.max(0, (Date.now() - latestTimestamp) / (1000 * 60 * 60));
      }

      return metrics;
    },

    async evaluatePortfolioGovernance(ctx, { projectId, tenantId, missingFnavApproval }) {
      const governance = {
        resolutionMode: 'manual_only',
        autoResolutionEligible: false,
        missingFnavApproval,
        hardBlockers: [],
        warnings: [],
      };

      let placeholderState = null;
      try {
        placeholderState = await ctx.call('interface-placeholder.canExecuteAction', {
          action: 'znp.assessPortfolio',
        });
      } catch (err) {
        governance.warnings.push(
          `interface-placeholder.canExecuteAction unavailable: ${err.message}`
        );
      }

      if (missingFnavApproval) {
        try {
          const existing = await ctx.call('interface-placeholder.listGaps', {
            includeResolved: false,
            blockingLevel: 'hard',
            limit: 250,
          });

          const fnavBlocker = (existing.placeholders || []).find(
            (item) => item.placeholderGapKey === 'kaufmaennische_freigabe_fnav'
          );

          if (!fnavBlocker) {
            const created = await ctx.call('interface-placeholder.markGap', {
              role: 'portfolio_planner',
              reason: 'NEEDS_DECISION',
              blockingLevel: 'hard',
              placeholderGapKey: 'kaufmaennische_freigabe_fnav',
              replacementCriteria: {
                kind: 'process',
                capabilityHint: 'znp.assessPortfolio',
                deadline: null,
              },
            });

            if (created?.placeholder) {
              governance.hardBlockers.push(created.placeholder);
            }
          } else {
            governance.hardBlockers.push(fnavBlocker);
          }
        } catch (err) {
          governance.warnings.push(`interface-placeholder.markGap unavailable: ${err.message}`);
          governance.hardBlockers.push({
            placeholderGapKey: 'kaufmaennische_freigabe_fnav',
            reason: 'NEEDS_DECISION',
            blockingLevel: 'hard',
            tenantId,
            projectId,
            status: 'placeholder_gap',
          });
        }
      }

      if (placeholderState && Array.isArray(placeholderState.blockingPlaceholders)) {
        const dedup = new Map();
        for (const blocker of [
          ...governance.hardBlockers,
          ...placeholderState.blockingPlaceholders,
        ]) {
          const key = blocker.placeholderId || blocker.placeholderGapKey || JSON.stringify(blocker);
          if (!dedup.has(key)) dedup.set(key, blocker);
        }
        governance.hardBlockers = Array.from(dedup.values());
      }

      governance.decisionStatus = governance.hardBlockers.length > 0 ? 'blocked' : 'ready';
      return governance;
    },

    /**
     * updateProjectMeta — Update PouchDB metadata doc with current graph stats.
     * Only lightweight counters are persisted — no raw graph data (KRITIS).
     * @param {string} projectId
     * @param {Graph} graph
     * @param {string} layerName  e.g. 'layer0'
     */
    async updateProjectMeta(projectId, graph, layerName) {
      const docId = `${DOC_PREFIX_META}${projectId}`;
      try {
        const doc = await this.db.get(docId);
        const project = this.activeGraphs.get(projectId);

        // Track which layers have been loaded (idempotent push)
        if (project && !project.layers.includes(layerName)) {
          project.layers.push(layerName);
        }

        await this.db.put({
          ...doc,
          layers: project ? project.layers : doc.layers,
          layer1GFactorAdjustment: project
            ? project.layer1GFactorAdjustment
            : doc.layer1GFactorAdjustment || 1.0,
          layer2CalibrationFactor: project
            ? project.layer2CalibrationFactor || 0
            : doc.layer2CalibrationFactor || 0,
          layer2MeasuredPeakLoadKw: project
            ? project.layer2MeasuredPeakLoadKw || 0
            : doc.layer2MeasuredPeakLoadKw || 0,
          layer2TransformerId: project
            ? project.layer2TransformerId || null
            : doc.layer2TransformerId || null,
          layer2NominalCapacityKw: project
            ? project.layer2NominalCapacityKw || 0
            : doc.layer2NominalCapacityKw || 0,
          nodeCount: graph.order,
          edgeCount: graph.size,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        // Non-fatal: metadata update failure must not break the graph operation
        this.logger.warn(
          `[znp] Failed to update metadata for project ${projectId}: ${err.message}`
        );
      }
    },

    /**
     * persistGraph — Serialise the current graphology instance to PouchDB.
     *
     * Writes (or updates) the znp:graph:<projectId> document with the full
     * graph.export() payload. Non-fatal: a failure logs a warning but never
     * breaks the in-progress graph operation.
     *
     * @param {string} projectId
     * @param {Graph}  graph
     */
    async persistGraph(projectId, graph) {
      const docId = `${DOC_PREFIX_GRAPH}${projectId}`;
      const maxAttempts = 3;
      const graphData = graph.export();

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          let rev;
          try {
            const existing = await this.db.get(docId);
            rev = existing._rev;
          } catch (_) {
            /* new document — no _rev needed */
          }

          await this.db.put({
            _id: docId,
            ...(rev ? { _rev: rev } : {}),
            projectId,
            graphData,
            savedAt: new Date().toISOString(),
          });
          return;
        } catch (err) {
          const isConflict = err && (err.status === 409 || err.name === 'conflict');
          if (isConflict && attempt < maxAttempts) {
            this.logger.debug(
              `[znp] Graph persist conflict for project ${projectId} (attempt ${attempt}/${maxAttempts}), retrying...`
            );
            continue;
          }

          this.logger.warn(
            `[znp] Failed to persist graph for project ${projectId}: ${err.message}`
          );
          return;
        }
      }
    },

    /**
     * emitAssumptionConfirmedEvent — Publish NovaFeed-compatible payload.
     *
     * Event name: znp.project.updated
     * Payload shape (required by NovaFeedStore):
     *   {
     *     type: 'assumption-confirmed',
     *     data: {
     *       id: '<assumptionId>',
     *       text: '<originalText>'
     *     }
     *   }
     *
     * @param {string} projectId
     * @param {string} assumptionId
     * @param {string} text
     */
    emitAssumptionConfirmedEvent(projectId, assumptionId, text) {
      try {
        this.broker.emit('znp.project.updated', {
          type: 'assumption-confirmed',
          data: {
            id: assumptionId,
            text,
          },
        });
      } catch (err) {
        this.logger.warn(
          `[znp] Failed to emit assumption-confirmed event for project ${projectId}: ${err.message}`
        );
      }
    },

    /**
     * emitAssumptionConfirmedEventAsync — Async wrapper for frontend push updates.
     * @param {string} projectId
     * @param {string} assumptionId
     * @param {string} text
     */
    emitAssumptionConfirmedEventAsync(projectId, assumptionId, text) {
      setImmediate(() => {
        this.emitAssumptionConfirmedEvent(projectId, assumptionId, text);
      });
    },

    emitLayer2ActivatedEvent(projectId, payload) {
      try {
        this.broker.emit('znp.project.updated', {
          type: 'layer2-activated',
          data: {
            projectId,
            ...payload,
          },
        });
      } catch (err) {
        this.logger.warn(
          `[znp] Failed to emit layer2-activated event for project ${projectId}: ${err.message}`
        );
      }
    },

    decodePdfBase64(fileContentBase64) {
      const normalized = String(fileContentBase64 || '')
        .replace(/^data:application\/pdf;base64,/, '')
        .trim();

      if (!normalized) {
        throw new MoleculerError(
          'Layer 2 received empty fileContentBase64 payload.',
          400,
          'ZNP_LAYER2_EMPTY_FILE'
        );
      }

      try {
        return Buffer.from(normalized, 'base64');
      } catch (err) {
        throw new MoleculerError(
          `Layer 2 could not decode Base64 PDF payload: ${err.message}`,
          400,
          'ZNP_LAYER2_INVALID_BASE64'
        );
      }
    },

    /**
     * normaliseEdgeGFactor — Return valid edge gFactor (default 1.0).
     * @param {number|undefined|null} gFactor
     * @returns {number}
     */
    normaliseEdgeGFactor(gFactor) {
      if (!Number.isFinite(gFactor)) return 1.0;
      if (gFactor < 0) return 0;
      if (gFactor > 1) return 1;
      return gFactor;
    },

    /**
     * applyAssumptionPeakShaving — Apply edge-level gFactor overrides from assumption text.
     *
     * For matching asset types (e.g. BESS / §14a controllable), all
     * CONTRIBUTES_LOAD edges to substations are forced to gFactor=0.45.
     * Afterwards, cumulative capacities are recalculated upwards.
     *
     * @param {Graph} graph
     * @param {string} assumptionText
     * @param {string} assumptionId
     */
    applyAssumptionPeakShaving(graph, assumptionText, assumptionId) {
      const matchedAssetKeys = [];
      const affectedSubstations = new Set();

      graph.forEachNode((nodeKey, attrs) => {
        if (attrs.type !== 'mastr_asset') return;
        if (this.matchesAssetToAssumption(attrs, assumptionText)) {
          matchedAssetKeys.push(nodeKey);
        }
      });

      for (const assetKey of matchedAssetKeys) {
        graph.forEachOutboundEdge(assetKey, (edgeKey, edgeAttrs, _sourceKey, targetKey) => {
          if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
          if (!graph.hasNode(targetKey)) return;
          if (graph.getNodeAttribute(targetKey, 'type') !== 'substation') return;

          graph.setEdgeAttribute(edgeKey, 'gFactor', 0.45);
          graph.setEdgeAttribute(edgeKey, 'peakShavingSource', 'createAssumption');
          graph.setEdgeAttribute(edgeKey, 'peakShavingAssumptionId', assumptionId);
          affectedSubstations.add(targetKey);
        });
      }

      this.recalculateCumulativeCapacitiesUpstream(graph, Array.from(affectedSubstations));
    },

    /**
     * matchesAssetToAssumption — deterministic keyword matching for simulation.
     * @param {object} assetAttrs
     * @param {string} assumptionText
     * @returns {boolean}
     */
    matchesAssetToAssumption(assetAttrs, assumptionText) {
      if (!assumptionText) return false;

      const text = String(assumptionText).toLowerCase();
      const assetType = String(assetAttrs.assetType || '').toLowerCase();

      const assumptionMentionsStorage = /(bess|batter(y|ie)|speicher|storage)/.test(text);
      const assumptionMentionsSection14a =
        /(§\s*14a|14a|steuerbar|steuerbare|controll?able|flex\s*nav|flexibler\s*nav)/.test(text);

      const isStorageAsset = /(storage|speicher|bess|battery|batterie)/.test(assetType);
      const isSection14aAsset =
        /(wallbox|heatpump|wärmepumpe|waermepumpe|storage|speicher)/.test(assetType) ||
        assetAttrs.hasFlexibleNav === true ||
        assetAttrs.controllable === true ||
        assetAttrs.section14a === true;

      return (
        (assumptionMentionsStorage && isStorageAsset) ||
        (assumptionMentionsSection14a && isSection14aAsset)
      );
    },

    /**
     * recalculateCumulativeCapacitiesUpstream — Recompute cumulative capacities
     * from affected substations upwards through CONTRIBUTES_LOAD parent edges.
     *
     * @param {Graph} graph
     * @param {string[]} startSubstationKeys
     */
    recalculateCumulativeCapacitiesUpstream(graph, startSubstationKeys = []) {
      const queue = [...new Set(startSubstationKeys.filter((k) => graph.hasNode(k)))];
      const enqueued = new Set(queue);

      while (queue.length > 0) {
        const nodeKey = queue.shift();
        const cumulative = this.calculateNodeCumulativePeakCapacity(graph, nodeKey);
        graph.setNodeAttribute(nodeKey, 'cumulativePeakCapacityKW', cumulative);
        graph.setNodeAttribute(nodeKey, 'peakCapacityGraphUpdatedAt', new Date().toISOString());

        graph.forEachOutboundEdge(nodeKey, (edgeKey, edgeAttrs, _sourceKey, targetKey) => {
          if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
          if (!graph.hasNode(targetKey)) return;
          if (graph.getNodeAttribute(targetKey, 'type') !== 'substation') return;
          if (!enqueued.has(targetKey)) {
            queue.push(targetKey);
            enqueued.add(targetKey);
          }
        });
      }
    },

    /**
     * calculateNodeCumulativePeakCapacity — Sum effective inbound capacity for node.
     * @param {Graph} graph
     * @param {string} nodeKey
     * @returns {number}
     */
    calculateNodeCumulativePeakCapacity(graph, nodeKey) {
      let cumulative = 0;

      graph.forEachInEdge(nodeKey, (edgeKey, edgeAttrs, sourceKey) => {
        if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
        const gFactor = this.normaliseEdgeGFactor(edgeAttrs.gFactor);
        const sourceAttrs = graph.getNodeAttributes(sourceKey);
        const sourceBase = Number.isFinite(sourceAttrs.cumulativePeakCapacityKW)
          ? sourceAttrs.cumulativePeakCapacityKW
          : sourceAttrs.capacity || 0;
        const effective = sourceBase * gFactor;
        cumulative += effective;
        graph.setEdgeAttribute(edgeKey, 'effectiveCapacityKW', Math.round(effective * 1000) / 1000);
      });

      return Math.round(cumulative * 1000) / 1000;
    },

    /**
     * _hydrateGraphs — Restore all persisted projects into this.activeGraphs on start.
     *
     * Scans all znp:meta: documents, fetches the corresponding znp:graph: document,
     * and imports the serialised graph via graph.import(). Projects with missing or
     * corrupt graph data are skipped with a warning (non-fatal).
     */
    async _hydrateGraphs() {
      try {
        const result = await this.db.allDocs({
          startkey: DOC_PREFIX_META,
          endkey: `${DOC_PREFIX_META}\uffff`,
          include_docs: true,
        });

        let restored = 0;
        for (const row of result.rows) {
          const meta = row.doc;
          const projectId = meta.projectId;
          if (!projectId) continue;

          try {
            await this.hydrateGraph(projectId);
            restored++;
          } catch (err) {
            this.logger.warn(
              `[znp] Skipping project ${projectId} during hydration — ` +
                `graph data missing or corrupt: ${err.message}`
            );
          }
        }

        this.logger.info(`[znp] Hydrated ${restored} project(s) from PouchDB.`);
      } catch (err) {
        this.logger.warn(`[znp] Graph hydration failed: ${err.message}`);
      }
    },

    /**
     * getSimultaneityFactor — Return the Gleichzeitigkeitsfaktor g for n installations.
     *
     * Derived from VDE-AR-N 4100 (Niederspannungsanschluss) simultaneity tables.
     * The factor accounts for the statistical improbability that all n installations
     * operate at peak capacity simultaneously.
     *
     * Lookup table (stepped):
     *   n=1       → g=1.00  (single unit, 100% coincidence)
     *   n=2–5     → g=0.80
     *   n=6–10    → g=0.65
     *   n=11–25   → g=0.55
     *   n=26–50   → g=0.45
     *   n=51–100  → g=0.38
     *   n>100     → g=0.30  (large aggregates)
     *
     * @param {number} n  Number of connected installations
     * @returns {number}  Simultaneity factor (0–1)
     */
    getSimultaneityFactor(n) {
      if (n <= 0) return 0;
      if (n === 1) return 1.0;
      if (n <= 5) return 0.8;
      if (n <= 10) return 0.65;
      if (n <= 25) return 0.55;
      if (n <= 50) return 0.45;
      if (n <= 100) return 0.38;
      return 0.3;
    },
  },
};
