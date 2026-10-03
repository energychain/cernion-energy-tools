'use strict';

const { ServiceBroker } = require('moleculer');
const coverageSchema = require('../../../services/function-coverage.service');
const { createMemoryDb } = require('./coverage-memory-db');
const { visible } = require('../../../src/domain-router-policy');

async function createAdapter({ functions, jest: timerApi }) {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const db = createMemoryDb();
  const service = broker.createService({
    ...coverageSchema,
    mixins: [
      {
        ...coverageSchema.mixins[0],
        created() {
          this.db = db;
        },
        async started() {},
      },
    ],
    settings: { ...coverageSchema.settings, model: { functions }, clock: Date.now },
  });
  const authorizationChecks = [];
  const emittedEvents = [];
  const emit = broker.emit.bind(broker);
  broker.emit = async (name, payload) => {
    emittedEvents.push({ name, payload: structuredClone(payload) });
    return emit(name, payload);
  };
  await broker.start();
  let sequence = 0;
  return {
    async apply(step) {
      if (step.type === 'advance') {
        if (timerApi) timerApi.advanceTimersByTime(step.milliseconds);
        return;
      }
      if (!['touch', 'signal'].includes(step.type)) return;
      const payload = step.payload || step;
      const fn = functions.find((item) => item.functionId === payload.functionId);
      if (!fn) return;
      const policy = {
        tenantId: payload.tenantId,
        actorId: payload.actorId,
        roles: ['ROLE_USER'],
        clearance: [],
        domainsAllowed: [],
        roleFamilies: [],
        sensitivityClearance: [],
      };
      const target = {
        tenantId: payload.tenantId,
        actorId: payload.actorId,
        accessRoles: ['ROLE_ADMIN'],
        sensitivityFlags: [],
        sharedWithRoles: [],
      };
      const before = visible(policy, target);
      const policyBefore = structuredClone(policy);
      await service.actions.recordTouch(
        {
          tenantId: payload.tenantId,
          actorId: payload.actorId,
          sourceType: 'completed_turn',
          sourceRef: `ref-${sequence++}`,
          conversationId: payload.conversationId || 'conv-a',
          signalClass: step.signalKind === 'question' ? 'knowledge_query' : 'case_followup',
          capabilities: fn.capabilities.slice(0, 64),
          operations: fn.operations.slice(0, 64),
        },
        {
          meta: {
            apiToken: { tenantId: payload.tenantId, id: payload.actorId, roles: policy.roles },
          },
        }
      );
      authorizationChecks.push({
        before,
        after: visible(policy, target),
        policyBefore,
        policyAfter: structuredClone(policy),
      });
    },
    async snapshot() {
      const coverage = await service.actions.matrix(
        {},
        {
          meta: {
            apiToken: {
              tenantId: 'tenant-a',
              id: 'admin-a',
              roles: ['ROLE_TENANT_ADMIN'],
            },
          },
        }
      );
      return {
        fresh: db.docs.size === 0,
        functions,
        now: Date.now(),
        activations: [],
        agents: [],
        operationAttempts: [],
        activityQueries: [],
        emptyWakes: [],
        corrections: [],
        journal: [],
        handoffs: [],
        authorizationChecks: structuredClone(authorizationChecks),
        coverage: coverage.items,
        emittedEvents: structuredClone(emittedEvents),
      };
    },
    async close() {
      const stopped = broker.stop();
      // Broker shutdown schedules its grace period even with no transport.
      if (timerApi) await timerApi.runOnlyPendingTimersAsync();
      await stopped;
    },
  };
}

module.exports = { createAdapter };
