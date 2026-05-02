'use strict';

const { PassThrough } = require('stream');
const { MoleculerError } = require('moleculer').Errors;
const { isRedispatchEligibleCapacityOnly } = require('../src/redispatch-utils');

const QU_GAIN_FACTOR = 0.15;
const RONT_PV_GAIN_FACTOR = 0.5;
const RONT_WPEV_GAIN_FACTOR = 0.25;
const RONT_CAPEX_EUR = 5500;
const RD_CURTAILMENT_FACTOR = 0.3;

module.exports = {
  name: 'nova',

  created() {
    this.sseClients = new Set();
    this.pendingDecisionIndex = new Map();
  },

  stopped() {
    for (const client of this.sseClients) {
      try {
        clearInterval(client.keepAliveTimer);
        client.stream.end();
      } catch (_) {
        // Ignore cleanup errors on shutdown.
      }
    }
    this.sseClients.clear();
  },

  events: {
    /**
     * Forward existing ZNP updates to all NOVA decision-feed SSE clients.
     */
    'znp.project.updated'(payload) {
      this.broadcastSSE('znp.project.updated', payload);
    },
  },

  actions: {
    /**
     * GET /api/nova/pending-decisions
     */
    pendingDecisions: {
      rest: {
        method: 'GET',
        path: '/pending-decisions',
      },
      params: {
        projectId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'List pending NOVA decisions (dynamic)',
        tags: ['NOVA'],
        description:
          'Analyses the project graph and returns dynamic NOVA decisions using O/V heuristics ' +
          '(Q(U) optimization and rONT reinforcement).',
        parameters: [
          {
            in: 'query',
            name: 'projectId',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        const decisions = await this.analyseProjectForPendingDecisions(projectId);

        for (const decision of decisions) {
          this.pendingDecisionIndex.set(`${projectId}:${decision.id}`, decision);
        }

        return decisions.map((decision) => ({
          id: decision.id,
          type: decision.type,
          gridNode: decision.gridNode,
          description: decision.description,
          capex: decision.capex,
          capacity_gain_kw: decision.capacity_gain_kw,
        }));
      },
    },

    /**
     * POST /api/nova/apply/:id
     */
    apply: {
      rest: {
        method: 'POST',
        path: '/apply/:id',
      },
      params: {
        projectId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Apply NOVA decision',
        tags: ['NOVA'],
        description:
          'Applies a dynamic NOVA decision to the in-memory ZNP graph, persists the update, ' +
          'and emits znp.project.updated for SSE consumers.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId', 'id'],
                properties: {
                  projectId: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
                  id: { type: 'string', example: 'dec_a1b2c3d4_SUB_1_QU' },
                },
              },
              examples: {
                default: {
                  value: {
                    projectId: 'a1b2c3d4-0000-0000-0000-000000000001',
                    id: 'dec_a1b2c3d4_SUB_1_QU',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId, id } = ctx.params;
        const { znpService } = await this.getProjectGraph(projectId);
        let decision = this.pendingDecisionIndex.get(`${projectId}:${id}`);

        if (!decision) {
          const recomputed = await this.analyseProjectForPendingDecisions(projectId);
          for (const item of recomputed) {
            this.pendingDecisionIndex.set(`${projectId}:${item.id}`, item);
          }
          decision = this.pendingDecisionIndex.get(`${projectId}:${id}`);
        }

        if (!decision) {
          throw new MoleculerError(
            `NOVA decision "${id}" not found for project "${projectId}".`,
            404,
            'NOVA_DECISION_NOT_FOUND',
            { projectId, id }
          );
        }

        const projectGraph = znpService.getProject(projectId);
        const graph = projectGraph.graph;

        if (decision.type === 'QU') {
          this.applyQuRegulationDecision(graph, decision.substationKey);
        } else if (decision.type === 'rONT') {
          this.applyRontDecision(graph, decision.substationKey, decision.capacity_gain_kw);
        } else if (decision.type === 'RD_CURTAILMENT') {
          this.applyRdCurtailmentDecision(
            graph,
            decision.substationKey,
            Array.isArray(decision.redispatchAssetKeys) ? decision.redispatchAssetKeys : []
          );
        } else {
          throw new MoleculerError(
            `Unsupported NOVA decision type "${decision.type}".`,
            400,
            'NOVA_DECISION_TYPE_UNSUPPORTED',
            { projectId, id, type: decision.type }
          );
        }

        if (typeof znpService.recalculateCumulativeCapacitiesUpstream === 'function') {
          znpService.recalculateCumulativeCapacitiesUpstream(graph, [decision.substationKey]);
        }
        if (typeof znpService.persistGraph === 'function') {
          await znpService.persistGraph(projectId, graph);
        }
        if (typeof znpService.updateProjectMeta === 'function') {
          await znpService.updateProjectMeta(projectId, graph, 'nova');
        }

        this.broker.emit('znp.project.updated', {
          type: 'nova-decision-applied',
          data: {
            projectId,
            id: decision.id,
            decisionType: decision.type,
            gridNode: decision.gridNode,
            capacity_gain_kw: decision.capacity_gain_kw,
            capex: decision.capex,
          },
        });

        return {
          success: true,
          id,
        };
      },
    },

    /**
     * GET /api/nova/stream
     */
    stream: {
      rest: {
        method: 'GET',
        path: '/stream',
      },
      params: {},
      openapi: {
        summary: 'NOVA realtime stream (SSE)',
        tags: ['NOVA'],
        description:
          'Server-Sent Events endpoint. Streams updates from existing broker event `znp.project.updated` to connected clients.',
      },
      handler(ctx) {
        const stream = new PassThrough();

        ctx.meta.$responseType = 'text/event-stream';
        ctx.meta.$responseHeaders = {
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        };

        const client = {
          stream,
          keepAliveTimer: null,
        };

        const cleanup = () => {
          if (client.keepAliveTimer) clearInterval(client.keepAliveTimer);
          this.sseClients.delete(client);
          if (!stream.destroyed) stream.end();
        };

        client.keepAliveTimer = setInterval(() => {
          if (!stream.destroyed) stream.write(': keep-alive\n\n');
        }, 15000);

        this.sseClients.add(client);

        // Initial handshake event
        stream.write(`event: connected\ndata: ${JSON.stringify({ success: true })}\n\n`);

        const req = ctx.meta.$req;
        if (req && typeof req.on === 'function') {
          req.on('close', cleanup);
          req.on('aborted', cleanup);
        }
        stream.on('close', cleanup);
        stream.on('error', cleanup);

        return stream;
      },
    },
  },

  methods: {
    getZnpService() {
      const znpService = this.broker.services.find((service) => service.name === 'znp');
      if (!znpService) {
        throw new MoleculerError(
          'Service "znp" is required for NOVA graph analysis but is not available.',
          503,
          'NOVA_ZNP_SERVICE_UNAVAILABLE'
        );
      }
      return znpService;
    },

    async getProjectGraph(projectId) {
      const znpService = this.getZnpService();
      if (typeof znpService.getProject !== 'function') {
        throw new MoleculerError(
          'znp.getProject method is unavailable for NOVA analysis.',
          500,
          'NOVA_ZNP_PROJECT_ACCESS_UNAVAILABLE'
        );
      }

      if (typeof znpService.ensureProjectHydrated === 'function') {
        await znpService.ensureProjectHydrated(projectId);
      }

      const project = znpService.getProject(projectId);
      return {
        graph: project.graph,
        znpService,
      };
    },

    listSubstationKeys(graph) {
      const keys = [];
      graph.forEachNode((nodeKey, attrs) => {
        const type = String(attrs.type || '').toLowerCase();
        if (type === 'substation') keys.push(nodeKey);
      });
      return keys;
    },

    async analyseProjectForPendingDecisions(projectId) {
      const { graph } = await this.getProjectGraph(projectId);
      const decisions = [];
      const substationKeys = this.listSubstationKeys(graph);

      for (const substationKey of substationKeys) {
        const profile = await this.buildSubstationProfile(projectId, graph, substationKey);
        if (!profile.isOverloaded) continue;

        const quGain = Math.round(profile.pvEffectiveKW * QU_GAIN_FACTOR * 1000) / 1000;
        if (quGain > 0 && quGain >= profile.overloadKW) {
          decisions.push({
            id: `dec_${projectId}_${substationKey}_QU`,
            type: 'QU',
            gridNode: substationKey,
            substationKey,
            description: 'Aktivierung Q(U)-Regelung für PV-Wechselrichter.',
            capex: 0,
            capacity_gain_kw: quGain,
          });
        }

        const rontGainRaw =
          profile.pvEffectiveKW * RONT_PV_GAIN_FACTOR +
          profile.wpEvEffectiveKW * RONT_WPEV_GAIN_FACTOR;
        const rontGain = Math.round(rontGainRaw * 1000) / 1000;
        if (rontGain > 0 && rontGain >= profile.overloadKW) {
          decisions.push({
            id: `dec_${projectId}_${substationKey}_rONT`,
            type: 'rONT',
            gridNode: substationKey,
            substationKey,
            description: 'Austausch SONT gegen rONT. Hebt PV-Kapazität um ca. 50%.',
            capex: RONT_CAPEX_EUR,
            capacity_gain_kw: rontGain,
          });
        }

        const rdGainRaw = profile.redispatchEligibleEffectiveKW * RD_CURTAILMENT_FACTOR;
        const rdGain = Math.round(rdGainRaw * 1000) / 1000;
        if (rdGain > 0 && rdGain >= profile.overloadKW) {
          decisions.push({
            id: `dec_${projectId}_${substationKey}_RD_CURTAILMENT`,
            type: 'RD_CURTAILMENT',
            gridNode: substationKey,
            substationKey,
            description:
              `${profile.redispatchAssetCount} Redispatch-fähige Großanlagen (>100 kW) ` +
              `am Trafo identifiziert. Abregelung um 30% entspannt den Netzknoten ` +
              `um ${rdGain} kW.`,
            capex: 0,
            capacity_gain_kw: rdGain,
            redispatchAssetKeys: profile.redispatchAssetKeys,
          });
        }
      }

      return decisions;
    },

    async buildSubstationProfile(projectId, graph, substationKey) {
      const znpResult = await this.broker.call('znp.calculateGFactor', {
        projectId,
        substationId: substationKey,
        target_layer: 1,
      });

      const assets = this.collectAssetsBySubstationTraversal(graph, substationKey);
      let pvEffectiveKW = 0;
      let wpEvEffectiveKW = 0;
      let redispatchEligibleEffectiveKW = 0;
      let redispatchAssetCount = 0;
      const redispatchAssetKeys = [];

      for (const asset of assets) {
        const gFactor = this.resolveContributionGFactor(
          graph,
          asset.nodeKey,
          substationKey,
          asset.attrs
        );
        const effectiveKW = (asset.capacityKW || 0) * gFactor;

        if (this.isPvAsset(asset.attrs)) pvEffectiveKW += effectiveKW;
        if (this.isWpEvAsset(asset.attrs)) wpEvEffectiveKW += effectiveKW;
        if (this.isRedispatchEligibleAsset(asset.attrs)) {
          redispatchEligibleEffectiveKW += effectiveKW;
          redispatchAssetCount += 1;
          redispatchAssetKeys.push(asset.nodeKey);
        }
      }

      const thermalLimitKW = this.resolveSubstationThermalLimit(graph, substationKey);
      if (!Number.isFinite(thermalLimitKW) || thermalLimitKW <= 0) {
        return {
          isOverloaded: false,
          overloadKW: 0,
          pvEffectiveKW,
          wpEvEffectiveKW,
          redispatchEligibleEffectiveKW,
          redispatchAssetCount,
          redispatchAssetKeys,
        };
      }

      const overloadKW = Math.max(0, znpResult.adjustedCapacityKW - thermalLimitKW);

      return {
        isOverloaded: overloadKW > 0,
        overloadKW,
        pvEffectiveKW,
        wpEvEffectiveKW,
        redispatchEligibleEffectiveKW,
        redispatchAssetCount,
        redispatchAssetKeys,
      };
    },

    collectAssetsBySubstationTraversal(graph, startSubstationKey) {
      const queue = [startSubstationKey];
      const visitedSubstations = new Set([startSubstationKey]);
      const assets = [];
      const seenAssets = new Set();

      while (queue.length > 0) {
        const nodeKey = queue.shift();

        graph.forEachInEdge(nodeKey, (_edgeKey, edgeAttrs, sourceKey) => {
          if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
          if (!graph.hasNode(sourceKey)) return;

          const sourceAttrs = graph.getNodeAttributes(sourceKey);
          const sourceType = String(sourceAttrs.type || '').toLowerCase();

          if (sourceType === 'substation') {
            if (!visitedSubstations.has(sourceKey)) {
              visitedSubstations.add(sourceKey);
              queue.push(sourceKey);
            }
            return;
          }

          if (sourceType !== 'mastr_asset') return;
          if (seenAssets.has(sourceKey)) return;
          seenAssets.add(sourceKey);

          assets.push({
            nodeKey: sourceKey,
            attrs: sourceAttrs,
            capacityKW: this.resolveAssetCapacityKW(sourceAttrs),
          });
        });
      }

      return assets;
    },

    resolveContributionGFactor(graph, assetKey, substationKey, assetAttrs) {
      const edgeKey = graph.edge(assetKey, substationKey);
      if (!edgeKey) return 1.0;
      const edgeAttrs = graph.getEdgeAttributes(edgeKey);
      const edgeGFactor = Number.isFinite(edgeAttrs.gFactor) ? edgeAttrs.gFactor : 1.0;
      const normalizedEdgeGFactor = Math.max(0, Math.min(1, edgeGFactor));

      if (assetAttrs && assetAttrs.section14a === true && normalizedEdgeGFactor > 0.45) {
        return 0.45;
      }

      return normalizedEdgeGFactor;
    },

    resolveSubstationThermalLimit(graph, substationKey) {
      if (!graph.hasNode(substationKey)) return null;
      const attrs = graph.getNodeAttributes(substationKey);
      const keys = ['thermalLimitKW', 'capacity_kw', 'capacityKW', 'maxCapacityKW'];
      for (const key of keys) {
        if (Number.isFinite(attrs[key])) {
          return attrs[key];
        }
      }
      return null;
    },

    isPvAsset(assetAttrs) {
      const assetType = String(assetAttrs.assetType || '').toLowerCase();
      return /(solar|pv|photovoltaik)/.test(assetType);
    },

    isWpEvAsset(assetAttrs) {
      const assetType = String(assetAttrs.assetType || '').toLowerCase();
      return /(wallbox|ev|e-?mob|heatpump|wärmepumpe|waermepumpe)/.test(assetType);
    },

    resolveAssetCapacityKW(assetAttrs) {
      if (Number.isFinite(assetAttrs.capacity_kw)) return assetAttrs.capacity_kw;
      return Number(assetAttrs.capacity || 0);
    },

    isRedispatchEligibleAsset(assetAttrs) {
      return isRedispatchEligibleCapacityOnly(assetAttrs);
    },

    applyQuRegulationDecision(graph, substationKey) {
      if (!graph.hasNode(substationKey)) return;

      graph.setNodeAttribute(substationKey, 'is_qu_regulated', true);
      graph.setNodeAttribute(substationKey, 'quRegulationAppliedAt', new Date().toISOString());

      graph.forEachInEdge(substationKey, (edgeKey, edgeAttrs, sourceKey) => {
        if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
        const sourceAttrs = graph.getNodeAttributes(sourceKey);
        if (!this.isPvAsset(sourceAttrs)) return;

        const sourceCapacity = Number(sourceAttrs.capacity || 0);
        const boost = Math.round(sourceCapacity * QU_GAIN_FACTOR * 1000) / 1000;
        const currentBoost = Number(graph.getEdgeAttribute(edgeKey, 'capacity_boost_kw') || 0);
        graph.setEdgeAttribute(
          edgeKey,
          'capacity_boost_kw',
          Math.round((currentBoost + boost) * 1000) / 1000
        );
      });
    },

    applyRontDecision(graph, substationKey, capacityGainKW) {
      if (!graph.hasNode(substationKey)) return;

      graph.setNodeAttribute(substationKey, 'is_rONT', true);
      graph.setNodeAttribute(substationKey, 'rONTAppliedAt', new Date().toISOString());

      const attrs = graph.getNodeAttributes(substationKey);
      const limitKey = Number.isFinite(attrs.thermalLimitKW)
        ? 'thermalLimitKW'
        : Number.isFinite(attrs.capacity_kw)
          ? 'capacity_kw'
          : Number.isFinite(attrs.capacityKW)
            ? 'capacityKW'
            : Number.isFinite(attrs.maxCapacityKW)
              ? 'maxCapacityKW'
              : 'thermalLimitKW';
      const currentLimit = Number(attrs[limitKey] || 0);
      graph.setNodeAttribute(
        substationKey,
        limitKey,
        Math.round((currentLimit + capacityGainKW) * 1000) / 1000
      );

      graph.forEachInEdge(substationKey, (edgeKey, edgeAttrs, sourceKey) => {
        if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
        const sourceAttrs = graph.getNodeAttributes(sourceKey);
        const sourceCapacity = Number(sourceAttrs.capacity || 0);

        let multiplier = 0;
        if (this.isPvAsset(sourceAttrs)) {
          multiplier = RONT_PV_GAIN_FACTOR;
        } else if (this.isWpEvAsset(sourceAttrs)) {
          multiplier = RONT_WPEV_GAIN_FACTOR;
        }
        if (multiplier <= 0) return;

        const additionalCapacity = Math.round(sourceCapacity * multiplier * 1000) / 1000;
        const currentCapacity = Number(
          graph.getEdgeAttribute(edgeKey, 'capacity_kw') || sourceCapacity
        );
        graph.setEdgeAttribute(
          edgeKey,
          'capacity_kw',
          Math.round((currentCapacity + additionalCapacity) * 1000) / 1000
        );
        graph.setEdgeAttribute(edgeKey, 'is_rONT_applied', true);
      });
    },

    applyRdCurtailmentDecision(graph, substationKey, redispatchAssetKeys) {
      if (!graph.hasNode(substationKey)) return;

      const eligibleKeys = Array.isArray(redispatchAssetKeys) ? redispatchAssetKeys : [];

      for (const assetKey of eligibleKeys) {
        if (!graph.hasNode(assetKey)) continue;
        const attrs = graph.getNodeAttributes(assetKey);
        if (!this.isRedispatchEligibleAsset(attrs)) continue;

        const edgeKey = graph.edge(assetKey, substationKey);
        if (!edgeKey) continue;
        const edgeAttrs = graph.getEdgeAttributes(edgeKey);
        if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') continue;

        graph.setEdgeAttribute(edgeKey, 'gFactor', 0.7);
        graph.setEdgeAttribute(edgeKey, 'is_rd_curtailed', true);
        graph.setNodeAttribute(assetKey, 'is_rd_curtailed', true);
      }
    },

    broadcastSSE(eventName, payload) {
      if (!this.sseClients.size) return;
      const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

      for (const client of this.sseClients) {
        if (!client.stream.destroyed) {
          try {
            client.stream.write(frame);
          } catch (_) {
            if (client.keepAliveTimer) clearInterval(client.keepAliveTimer);
            this.sseClients.delete(client);
          }
        }
      }
    },
  },
};
