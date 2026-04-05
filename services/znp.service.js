'use strict';

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
 *   §14a flex-NAV nodes are excluded from peak load in calculateGFactor (g=0.0).
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
const { extractPeakLoadFromFile } = require('../src/znp-pdf-extractor');
const { fetchBuildingsForBbox, mapAssetsToBuildings } = require('../src/znp-osm-buildings');
const { detectClusters, computeGFactorAdjustment } = require('../src/znp-clustering-heuristics');
const { generateStructured, SchemaType } = require('../src/llm-client');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default substation node key for Layer 0 (single virtual aggregation point). */
const SUBSTATION_KEY = 'SUB_1';

/** PouchDB document prefix — metadata documents (bbox, name, layers, stats). */
const DOC_PREFIX_META  = 'znp:meta:';

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
    assetType:      { type: SchemaType.STRING },
    capacityKW:     { type: SchemaType.NUMBER },
    status:         { type: SchemaType.STRING },
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
            west:  { type: 'number', convert: true },
            north: { type: 'number', convert: true },
            east:  { type: 'number', convert: true },
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
                      west:  { type: 'number', example: 8.43 },
                      north: { type: 'number', example: 49.52 },
                      east:  { type: 'number', example: 8.52 },
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
                    projectId:  { type: 'string', example: 'a1b2c3d4-...' },
                    name:       { type: 'string' },
                    bbox:       { type: 'object' },
                    createdAt:  { type: 'string', format: 'date-time' },
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
          layers: [],
          layer1GFactorAdjustment: 1.0,  // updated by addLayer1 when clustering is computed
        });

        // Persist project metadata to PouchDB (znp:meta: — lightweight, no graph data)
        const metaDoc = {
          _id: `${DOC_PREFIX_META}${projectId}`,
          projectId,
          name: projectName,
          bbox,
          createdAt,
          layers: [],
          layer1GFactorAdjustment: 1.0,
          nodeCount: graph.order,
          edgeCount: graph.size,
        };
        await this.db.put(metaDoc);

        // Persist initial graph state (SUB_1 only) to znp:graph: document
        await this.persistGraph(projectId, graph);

        this.logger.info(`[znp] Created project ${projectId} ("${projectName}")`);

        return {
          projectId,
          name: projectName,
          bbox,
          createdAt,
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
              capacity:    { type: 'number', convert: true },  // kW — accepts string from form-data
              assetType:   { type: 'string', optional: true },
              lat:         { type: 'number', optional: true, convert: true },
              lon:         { type: 'number', optional: true, convert: true },
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
                      { mastrNummer: 'SEE900123456789', capacity: 10.5, assetType: 'solar', lat: 49.491, lon: 8.471 },
                      { mastrNummer: 'SEE900987654321', capacity: 7.0, assetType: 'solar', lat: 49.492, lon: 8.472 },
                    ],
                    items: {
                      type: 'object',
                      required: ['mastrNummer', 'capacity'],
                      properties: {
                        mastrNummer: { type: 'string', example: 'SEE900123456789' },
                        capacity:    { type: 'number', example: 10.5, description: 'kW' },
                        assetType:   { type: 'string', example: 'solar' },
                        lat:         { type: 'number', example: 49.491 },
                        lon:         { type: 'number', example: 8.471 },
                      },
                    },
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    assets: [
                      { mastrNummer: 'SEE900123456789', capacity: 10.5, assetType: 'solar', lat: 49.491, lon: 8.471 },
                      { mastrNummer: 'SEE900987654321', capacity: 7.0, assetType: 'solar', lat: 49.492, lon: 8.472 },
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
              'Invalid asset: mastrNummer must be a non-empty string.',
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
            capacity: asset.capacity,        // kW
            assetType: asset.assetType || 'unknown',
            lat: asset.lat ?? null,
            lon: asset.lon ?? null,
            layer: 0,
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
            content: { 'application/json': { schema: { type: 'object', properties: {
              jobId:     { type: 'string' },
              statusUrl: { type: 'string' },
              resultUrl: { type: 'string' },
            } } } },
          },
        },
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        const project = this.getProject(projectId);  // throws 404 if unknown
        const { graph, bbox } = project;
        const activeGraphs = this.activeGraphs;
        const updateMeta   = this.updateProjectMeta.bind(this);
        const persistGraph = this.persistGraph.bind(this);
        const logger       = this.logger;

        return jobStore.startJob(
          ctx,
          { service: 'znp', action: 'addLayer1' },
          async (jobId) => {
            appendLog(jobId, 'osm_fetch', 10, `Lade OSM-Gebäude für BBox (${TILE_N}×${TILE_N} Kacheln)...`);

            const buildings = await fetchBuildingsForBbox(bbox, (tileNum, total) => {
              const pct = 10 + Math.round((tileNum / total) * 30);
              appendLog(jobId, 'osm_fetch', pct, `Lade Kachel ${tileNum}/${total}...`);
            });

            appendLog(jobId, 'spatial_mapping', 45, `Mappe Assets auf ${buildings.length} Gebäude...`);

            const assetNodes = [];
            graph.forEachNode((nodeKey, attrs) => {
              if (attrs.type === 'mastr_asset' && attrs.lat != null && attrs.lon != null) {
                assetNodes.push({ nodeKey, ...attrs });
              }
            });

            const mappings = mapAssetsToBuildings(assetNodes, buildings);
            let buildingNodesAdded    = 0;
            let locatedInEdgesAdded   = 0;

            for (const { assetNodeKey, buildingOsmId, building } of mappings) {
              const bKey = `osm:${buildingOsmId}`;
              if (!graph.hasNode(bKey)) {
                graph.addNode(bKey, {
                  type: 'OSM_Building', osmId: buildingOsmId,
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

            const clusters          = detectClusters(assetNodes);
            const gFactorAdjustment = computeGFactorAdjustment(clusters);

            const updatedProject = activeGraphs.get(projectId);
            if (updatedProject) updatedProject.layer1GFactorAdjustment = gFactorAdjustment;

            await updateMeta(projectId, graph, 'layer1');
            await persistGraph(projectId, graph);

            appendLog(
              jobId, 'done', 100,
              `Layer 1 geladen: ${buildingNodesAdded} Gebäude, ${clusters.length} Cluster. ` +
              `g-Faktor Anpassung: ×${gFactorAdjustment.toFixed(2)}`
            );
            logger.info(`[znp] addLayer1 project=${projectId}: +${buildingNodesAdded} buildings, ` +
              `${clusters.length} clusters, g×${gFactorAdjustment.toFixed(2)}`);

            return { projectId, buildingNodesAdded, locatedInEdgesAdded,
              clusterCount: clusters.length, gFactorAdjustment,
              totalNodes: graph.order, totalEdges: graph.size };
          }
        );
      },
    },

    /**
     * addLayer2 — Extract measured transformer peak load from a VNB document (Layer 2).
     *
     * Accepts the path of a PDF already uploaded via POST /api/datasources/uploads.
     * Parses the PDF text, calls Gemini with a strict JSON schema to extract the
     * Jahreshöchstlast, and attaches a Measurement node to SUB_1 in the graph.
     * Enables the Layer 2 short-circuit in calculateGFactor (measured load overrides
     * the VDE-AR-N 4100 theoretical value).
     *
     * POST /api/znp/projects/:projectId/layer2
     */
    addLayer2: {
      rest: 'POST /projects/:projectId/layer2',
      params: {
        projectId: { type: 'string' },
        filePath:  { type: 'string', min: 3 },
      },
      openapi: {
        summary: 'Load Layer 2 — AI-extracted transformer peak load from PDF (async job)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Accepts the path of a PDF uploaded via `POST /api/datasources/uploads`. ' +
          'Parses the document with pdf-parse, then calls Gemini (structured JSON output) ' +
          'to extract the maximum simultaneous annual peak transformer load (Jahreshöchstlast). ' +
          'Adds a Measurement node to the graph and enables the Layer 2 short-circuit in ' +
          'calculateGFactor: the measured value replaces the theoretical Layer 0 estimate. ' +
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
                required: ['filePath'],
                properties: {
                  filePath: { type: 'string', example: '/opt/cernion-energy-tools/uploads/lastprofil_trafo.pdf' },
                },
              },
              examples: { default: { value: { filePath: '/opt/cernion-energy-tools/uploads/lastprofil_trafo.pdf' } } },
            },
          },
        },
        responses: {
          202: {
            description: 'Job accepted — poll statusUrl for AI extraction logs and result.',
            content: { 'application/json': { schema: { type: 'object', properties: {
              jobId:     { type: 'string' },
              statusUrl: { type: 'string' },
              resultUrl: { type: 'string' },
            } } } },
          },
        },
      },
      async handler(ctx) {
        const { projectId, filePath } = ctx.params;
        const project      = this.getProject(projectId);  // throws 404 if unknown
        const { graph }    = project;
        const updateMeta   = this.updateProjectMeta.bind(this);
        const persistGraph = this.persistGraph.bind(this);
        const logger       = this.logger;

        return jobStore.startJob(
          ctx,
          { service: 'znp', action: 'addLayer2' },
          async (jobId) => {
            appendLog(jobId, 'pdf_parse', 10, 'Lese PDF...');
            const peakLoadKw = await (async () => {
              appendLog(jobId, 'llm_extract', 40, 'Übergebe an LLM...');
              const value = await extractPeakLoadFromFile(filePath);
              appendLog(jobId, 'llm_extract', 70, `Wert ${value} kW gefunden, aktualisiere Graph...`);
              return value;
            })();

            appendLog(jobId, 'graph_update', 80, `Schreibe Measurement-Node (${peakLoadKw} kW) an ${SUBSTATION_KEY}...`);
            const measurementKey = `measurement:peak_load:${SUBSTATION_KEY}`;
            if (!graph.hasNode(measurementKey)) {
              graph.addNode(measurementKey, {
                type: 'measurement', metricType: 'peak_load',
                value: peakLoadKw, unit: 'kW', layer: 2,
              });
              graph.addEdge(measurementKey, SUBSTATION_KEY, {
                relationship: 'oeo_measures', metric: 'peak_load_measured', layer: 2,
              });
            } else {
              graph.setNodeAttribute(measurementKey, 'value', peakLoadKw);
            }

            await updateMeta(projectId, graph, 'layer2');
            await persistGraph(projectId, graph);

            appendLog(jobId, 'done', 100, 'Layer 2 erfolgreich geladen.');
            logger.info(`[znp] addLayer2 project=${projectId}: peak_load=${peakLoadKw} kW`);

            return { projectId, measurementKey, peakLoadKw,
              totalNodes: graph.order, totalEdges: graph.size };
          }
        );
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
        projectId:    { type: 'string' },
        target_layer: { type: 'number', integer: true, optional: true, default: 0, min: 0, max: 2, convert: true },
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
                    projectId:            { type: 'string' },
                    substationId:         { type: 'string' },
                    targetLayer:          { type: 'integer' },
                    assetCount:           { type: 'integer' },
                    totalCapacityKW:      { type: 'number' },
                    simultaneityFactor:   { type: 'number' },
                    adjustedCapacityKW:   { type: 'number' },
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
        //                    §14a EnWG: hasFlexibleNav=true → excluded (g=0.0)
        let totalCapacityKW = 0;
        let assetCount      = 0;
        let flexNavExcluded = 0;

        graph.forEachInEdge(substationId, (edgeKey, edgeAttrs, sourceKey) => {
          if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
          const nodeAttrs = graph.getNodeAttributes(sourceKey);

          if (nodeAttrs.type === 'assumption') {
            // Assumption nodes are visible at target_layer >= 2 (planning horizon)
            if (targetLayer < 2) return;
            if (nodeAttrs.hasFlexibleNav) {
              // §14a flex-NAV: legally curtailable → does not add to peak load
              flexNavExcluded++;
            } else {
              totalCapacityKW += nodeAttrs.capacity || 0;
              assetCount++;
            }
            return;
          }

          // Standard layer-filtered traversal for mastr_asset nodes
          if (edgeAttrs.layer > targetLayer) return;
          if (nodeAttrs.type === 'mastr_asset') {
            totalCapacityKW += nodeAttrs.capacity || 0;
            assetCount++;
          }
        });

        // ── Layer 2 short-circuit (Architecture Deep Dive §3) ──────────────────
        // If a Measurement node exists AND targetLayer ≥ 2, use the measured peak
        // load directly. The g-factor is back-computed as measured / theoretical.
        if (targetLayer >= 2) {
          const measurementKey = `measurement:peak_load:${substationId}`;
          if (graph.hasNode(measurementKey)) {
            const measuredLoad = graph.getNodeAttributes(measurementKey).value;
            const gFactor = totalCapacityKW > 0
              ? Math.round((measuredLoad / totalCapacityKW) * 1000) / 1000
              : 0;
            return {
              projectId, substationId, targetLayer, assetCount,
              totalCapacityKW:    Math.round(totalCapacityKW * 1000) / 1000,
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
          (targetLayer >= 1 && project.layer1GFactorAdjustment)
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
          totalCapacityKW:    Math.round(totalCapacityKW * 1000) / 1000,
          simultaneityFactor: Math.round(simultaneityFactor * clusterMultiplier * 1000) / 1000,
          adjustedCapacityKW: Math.round(adjustedCapacityKW * 1000) / 1000,
          flexNavExcluded,
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
            name: 'projectId', in: 'path', required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
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
                    projectId:    { type: 'string' },
                    questions:    { type: 'array', items: { type: 'string' } },
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
        const project       = this.getProject(projectId);
        const { graph }     = project;

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
          nodeCount:          graph.order,
          edgeCount:          graph.size,
          layers:             project.layers,
          assetTypes,
          totalCapacityKW:    Math.round(totalCapacityKW),
          hasMeasurements,
          assumptionCount,
          bbox:               project.bbox,
        };

        const prompt =
          'Du bist ein Zielnetzplanungs-Experte f\u00fcr deutsche Verteilnetzbetreiber.\n' +
          'Analysiere folgendes Verteilnetz-Areal und formuliere 2-3 strategische Fragen, ' +
          'die ein Netzplaner unbedingt beantworten sollte \u2014 \u00fcber Aspekte, die NICHT in den ' +
          '\u00f6ffentlichen Daten (MaStR, OSM) sichtbar sind.\n\n' +
          `Netz-Kontext:\n${JSON.stringify(graphSummary, null, 2)}\n\n` +
          'Beziehe dich auf \u00a714a EnWG (steuerbare Verbrauchseinrichtungen), m\u00f6gliche ' +
          'Rechenzentren/Gewerbegebiete, Neubaupotenzial, W\u00e4rmepumpenpflicht (GEG), ' +
          'und EV-Ladeinfrastruktur. Stelle konkrete, handlungsrelevante Fragen.';

        const result = await generateStructured(STRATEGIC_PROMPTS_SCHEMA, prompt);

        return {
          projectId,
          questions:    Array.isArray(result.questions) ? result.questions : [],
          graphSummary,
        };
      },
    },

    /**
     * addAssumption — Ingest a natural-language planning assumption into the graph.
     *
     * Calls Gemini with a strict JSON schema to extract asset type, capacity,
     * status, and §14a flex-NAV flag from free text. Inserts a StrategicAssumption
     * node (layer 2.5) and a CONTRIBUTES_LOAD edge to SUB_1. The flex-NAV flag
     * controls §14a exclusion in calculateGFactor (hasFlexibleNav=true → g=0.0).
     * Persists the updated graph to PouchDB.
     *
     * POST /api/znp/projects/:projectId/assumptions
     */
    addAssumption: {
      rest: 'POST /projects/:projectId/assumptions',
      params: {
        projectId: { type: 'string' },
        text:      { type: 'string', min: 10, max: 2000 },
      },
      openapi: {
        summary: 'Ingest a natural-language planning assumption into the graph (AI)',
        tags: ['Zielnetzplanung (ZNP)'],
        description:
          'Uses Gemini (structured JSON schema) to extract asset type, capacity (kW), ' +
          'status, and \u00a714a flex-NAV flag from free-text German input. Inserts a ' +
          'StrategicAssumption node at layer=2.5 and a CONTRIBUTES_LOAD edge to SUB_1. ' +
          'In calculateGFactor, nodes with hasFlexibleNav=true are excluded from peak load ' +
          '(legally curtailable under \u00a714a EnWG \u2014 g=0.0). ' +
          'Requires GEMINI_API_KEY \u2014 returns HTTP 503 if not configured.',
        parameters: [
          { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
        ],
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
                  value: { text: 'Wir planen einen 5 MW Speicher mit flexiblem NAV am Br\u00fcckweg.' },
                },
                datacenter: {
                  value: { text: 'Ein neues Rechenzentrum mit 3000 kW Anschlussleistung ist im Gewerbegebiet Nord geplant.' },
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
                    projectId:      { type: 'string' },
                    assumptionId:   { type: 'string' },
                    nodeKey:        { type: 'string' },
                    extracted:      { type: 'object' },
                    hasFlexibleNav: { type: 'boolean' },
                    graphStats:     { type: 'object' },
                  },
                },
              },
            },
          },
          422: { description: 'HTTP 422 ASSUMPTION_EXTRACTION_FAILED \u2014 LLM could not extract valid capacity' },
          503: { description: 'HTTP 503 LLM_NOT_CONFIGURED \u2014 GEMINI_API_KEY not set' },
        },
      },
      async handler(ctx) {
        const { projectId, text } = ctx.params;
        const project             = this.getProject(projectId);
        const { graph }           = project;

        // ── LLM extraction ────────────────────────────────────────────────────
        const prompt =
          'Extrahiere die geplante Energieanlage aus dieser deutschen Beschreibung als JSON.\n' +
          `Beschreibung: "${text}"\n\n` +
          'Extrahiere:\n' +
          '- assetType: Typ der Anlage (z.B. "storage", "datacenter", "heatpump", "wallbox", "solar", "wind")\n' +
          '- capacityKW: Nennleistung in kW (als Zahl, ohne Einheit)\n' +
          '- status: Planungsstatus (z.B. "planned", "approved", "under_construction")\n' +
          '- hasFlexibleNav: true wenn ein flexibler Netzanschlussvertrag (\u00a714a EnWG) erw\u00e4hnt wird, sonst false\n\n' +
          'Antworte NUR als striktes JSON.';

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
        const nodeKey      = `assumption:${assumptionId}`;

        graph.addNode(nodeKey, {
          type:           'assumption',
          assumptionId,
          assetType:      extracted.assetType,
          capacity:       extracted.capacityKW,
          status:         extracted.status,
          hasFlexibleNav: extracted.hasFlexibleNav === true,
          layer:          2.5,
          sourceText:     text.slice(0, 200),
          createdAt:      new Date().toISOString(),
        });

        graph.addEdge(nodeKey, SUBSTATION_KEY, {
          relationship: 'CONTRIBUTES_LOAD',
          layer:        2.5,
        });

        // Persist updated graph state
        await this.persistGraph(projectId, graph);
        await this.updateProjectMeta(projectId, graph, 'layer2.5');

        this.logger.info(
          `[znp] addAssumption project=${projectId}: ` +
          `${extracted.assetType} ${extracted.capacityKW}kW flexNav=${extracted.hasFlexibleNav}`
        );

        return {
          projectId,
          assumptionId,
          nodeKey,
          extracted,
          hasFlexibleNav: extracted.hasFlexibleNav === true,
          graphStats:     { nodes: graph.order, edges: graph.size },
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
        const project = this.getProject(projectId); // throws 404 if not found

        return {
          projectId,
          name: project.name,
          bbox: project.bbox,
          createdAt: project.createdAt,
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
      handler() {
        const projects = [];
        for (const [projectId, project] of this.activeGraphs.entries()) {
          projects.push({
            projectId,
            name: project.name,
            bbox: project.bbox,
            createdAt: project.createdAt,
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

  },

  // ─── Methods ────────────────────────────────────────────────────────────────

  methods: {

    /**
     * getProject — Retrieve an active project or throw 404.
     * @param {string} projectId
     * @returns {{ graph: Graph, bbox, name, createdAt, layers: string[] }}
     */
    getProject(projectId) {
      const project = this.activeGraphs.get(projectId);
      if (!project) {
        throw new MoleculerError(
          `ZNP project "${projectId}" not found. The graph may have been lost due to a service restart (ephemeral v1).`,
          404,
          'ZNP_PROJECT_NOT_FOUND',
          { projectId }
        );
      }
      return project;
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
        const doc     = await this.db.get(docId);
        const project = this.activeGraphs.get(projectId);

        // Track which layers have been loaded (idempotent push)
        if (project && !project.layers.includes(layerName)) {
          project.layers.push(layerName);
        }

        await this.db.put({
          ...doc,
          layers:                  project ? project.layers : doc.layers,
          layer1GFactorAdjustment: project ? project.layer1GFactorAdjustment : (doc.layer1GFactorAdjustment || 1.0),
          nodeCount:               graph.order,
          edgeCount:               graph.size,
          updatedAt:               new Date().toISOString(),
        });
      } catch (err) {
        // Non-fatal: metadata update failure must not break the graph operation
        this.logger.warn(`[znp] Failed to update metadata for project ${projectId}: ${err.message}`);
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
      try {
        let rev;
        try {
          const existing = await this.db.get(docId);
          rev = existing._rev;
        } catch (_) { /* new document — no _rev needed */ }

        await this.db.put({
          _id: docId,
          ...(rev ? { _rev: rev } : {}),
          projectId,
          graphData: graph.export(),
          savedAt:   new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn(`[znp] Failed to persist graph for project ${projectId}: ${err.message}`);
      }
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
          startkey:     DOC_PREFIX_META,
          endkey:       `${DOC_PREFIX_META}\uffff`,
          include_docs: true,
        });

        let restored = 0;
        for (const row of result.rows) {
          const meta      = row.doc;
          const projectId = meta.projectId;
          if (!projectId) continue;

          try {
            const graphDoc = await this.db.get(`${DOC_PREFIX_GRAPH}${projectId}`);
            if (!graphDoc.graphData) throw new Error('graphData field is null or missing');

            const graph = new Graph({ type: 'directed', multi: false });
            graph.import(graphDoc.graphData);

            this.activeGraphs.set(projectId, {
              graph,
              bbox:                   meta.bbox,
              name:                   meta.name,
              createdAt:              meta.createdAt,
              layers:                 meta.layers || [],
              layer1GFactorAdjustment: meta.layer1GFactorAdjustment || 1.0,
            });
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
      if (n <= 0)   return 0;
      if (n === 1)  return 1.00;
      if (n <= 5)   return 0.80;
      if (n <= 10)  return 0.65;
      if (n <= 25)  return 0.55;
      if (n <= 50)  return 0.45;
      if (n <= 100) return 0.38;
      return 0.30;
    },

  },
};
