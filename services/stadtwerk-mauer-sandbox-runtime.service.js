'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, tenantNamespace } = require('../src/tenant-context');

const SANDBOX_TENANT_ID = 'stadtwerk-mauer';
const BASE_NAMESPACE = 'stadtwerk_mauer_sandbox_runtime';
const LAST_RESET_KEY = '_last_reset';

const ARTIFACT_KINDS = [
  'event_instance',
  'dossier_addition',
  'follow_up_proposal',
  'stub_transcript_placeholder',
  'outbox_queue_placeholder',
  'audit_artifact',
];

function nowIso() {
  return new Date().toISOString();
}

function runtimeId(prefix) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function resolveTenant(ctx, explicitTenantId) {
  return String(explicitTenantId || getTenantId(ctx) || '').toLowerCase();
}

function ensureSandboxTenant(tenantId) {
  if (tenantId !== SANDBOX_TENANT_ID) {
    throw new MoleculerClientError(
      'Stadtwerk Mauer sandbox mutations are allowed only for tenant stadtwerk-mauer',
      403,
      'SANDBOX_TENANT_REQUIRED',
      { tenantId, requiredTenantId: SANDBOX_TENANT_ID }
    );
  }
}

module.exports = {
  name: 'stadtwerk-mauer-sandbox-runtime',

  actions: {
    ingestEvent: {
      rest: 'POST /events',
      params: {
        tenantId: { type: 'string', optional: true },
        eventType: { type: 'string', min: 2 },
        caseId: { type: 'string', optional: true },
        sourceRef: { type: 'string', optional: true },
        payload: { type: 'object', optional: true, default: {} },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId);
        ensureSandboxTenant(tenantId);

        const namespace = tenantNamespace(BASE_NAMESPACE, tenantId);
        const eventId = runtimeId('smm-event');
        const createdAt = nowIso();
        const eventPayload = {
          kind: 'runtime_artifact',
          artifactKind: 'event_instance',
          tenantId,
          eventId,
          eventType: ctx.params.eventType,
          caseId: ctx.params.caseId || null,
          sourceRef: ctx.params.sourceRef || null,
          payload: ctx.params.payload || {},
          createdAt,
        };

        const derivedArtifacts = [
          {
            kind: 'dossier_addition',
            label: `Dossier addition for ${ctx.params.eventType}`,
            sourceEventId: eventId,
          },
          {
            kind: 'follow_up_proposal',
            label: 'Sandbox follow-up proposal',
            sourceEventId: eventId,
          },
          {
            kind: 'stub_transcript_placeholder',
            label: 'External-interface transcript placeholder',
            sourceEventId: eventId,
          },
          {
            kind: 'outbox_queue_placeholder',
            label: 'Sandbox outbox placeholder',
            sourceEventId: eventId,
          },
          {
            kind: 'audit_artifact',
            label: 'Sandbox audit artifact',
            sourceEventId: eventId,
          },
        ];

        await ctx.call('object-store.put', {
          namespace,
          key: eventId,
          payload: eventPayload,
        });

        for (const artifact of derivedArtifacts) {
          await ctx.call('object-store.put', {
            namespace,
            key: runtimeId(`smm-${artifact.kind}`),
            payload: {
              kind: 'runtime_artifact',
              artifactKind: artifact.kind,
              tenantId,
              eventId,
              label: artifact.label,
              sourceEventId: artifact.sourceEventId,
              createdAt,
            },
          });
        }

        return {
          success: true,
          tenantId,
          eventId,
          eventType: ctx.params.eventType,
          derivedArtifactsCreated: derivedArtifacts.length,
          sourceActions: this.sourceActionGuards(),
        };
      },
    },

    reset: {
      rest: 'POST /reset',
      params: {
        tenantId: { type: 'string', optional: true },
        reason: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId);
        ensureSandboxTenant(tenantId);
        const namespace = tenantNamespace(BASE_NAMESPACE, tenantId);
        const before = await this.listRuntimeDocs(ctx, namespace);
        const deletedKeys = [];

        for (const doc of before) {
          await ctx.call('object-store.delete', { namespace, key: doc.key });
          deletedKeys.push(doc.key);
        }

        const result = {
          resetId: runtimeId('smm-reset'),
          tenantId,
          reason: ctx.params.reason || null,
          deletedArtifactCount: deletedKeys.length,
          deletedKeys,
          resetAt: nowIso(),
          idempotent: true,
          sourceActions: this.sourceActionGuards(),
        };

        await ctx.call('object-store.put', {
          namespace,
          key: LAST_RESET_KEY,
          payload: {
            kind: 'reset_marker',
            tenantId,
            ...result,
          },
        });

        return result;
      },
    },

    status: {
      rest: 'GET /status',
      params: {
        tenantId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId || SANDBOX_TENANT_ID);
        const sandboxBoundaryAllowed = tenantId === SANDBOX_TENANT_ID;
        const namespace = tenantNamespace(BASE_NAMESPACE, SANDBOX_TENANT_ID);
        const runtimeDocs = sandboxBoundaryAllowed ? await this.listRuntimeDocs(ctx, namespace) : [];
        const lastReset = sandboxBoundaryAllowed ? await this.getLastReset(ctx, namespace) : null;
        return this.buildStatus({ tenantId, runtimeDocs, lastReset, sandboxBoundaryAllowed });
      },
    },
  },

  methods: {
    async listRuntimeDocs(ctx, namespace) {
      const result = await ctx.call('object-store.query', {
        namespace,
        selector: { 'payload.kind': 'runtime_artifact' },
        limit: 1000,
      });
      return result.docs || [];
    },

    async getLastReset(ctx, namespace) {
      try {
        const doc = await ctx.call('object-store.get', { namespace, key: LAST_RESET_KEY });
        return doc.payload || null;
      } catch (err) {
        if (err?.type === 'OBJECT_NOT_FOUND' || err?.code === 'OBJECT_NOT_FOUND') return null;
        throw err;
      }
    },

    buildStatus({ tenantId, runtimeDocs, lastReset, sandboxBoundaryAllowed }) {
      const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0]));
      for (const doc of runtimeDocs) {
        const artifactKind = doc.payload?.artifactKind;
        if (artifactKind && Object.prototype.hasOwnProperty.call(counts, artifactKind)) {
          counts[artifactKind] += 1;
        }
      }

      const eventCount = counts.event_instance;
      const artifactCount = runtimeDocs.length;
      const missingLifecycleEvidence = [];
      if (eventCount === 0) {
        missingLifecycleEvidence.push({
          missingDataPoint: 'seeded_demo_event',
          enablesDossierAddition: 'add deterministic Stadtwerk Mauer event trace',
        });
      }
      if (!lastReset) {
        missingLifecycleEvidence.push({
          missingDataPoint: 'reset_delete_proof',
          enablesDossierAddition: 'add cleanup readiness and residue-free reset evidence',
        });
      }
      if (!sandboxBoundaryAllowed) {
        missingLifecycleEvidence.push({
          missingDataPoint: 'tenant_isolation_proof',
          enablesDossierAddition: 'add tenant boundary and cross-tenant deletion guard evidence',
        });
      }

      const status = !sandboxBoundaryAllowed
        ? 'blocked_outside_sandbox_tenant'
        : eventCount === 0
          ? 'empty_sandbox_ready_for_seed'
          : lastReset
            ? 'sandbox_state_mutated_with_reset_proof'
            : 'sandbox_state_mutated_needs_reset_proof';

      const positiveFollowUps = missingLifecycleEvidence.map((item) => ({
        ...item,
        category: BASE_NAMESPACE,
      }));

      const dossierFacts = [
        `Status: ${status}`,
        `Sandbox events: ${eventCount}`,
        `Sandbox artifacts: ${artifactCount}`,
      ];
      if (lastReset) dossierFacts.push(`Last reset deleted: ${lastReset.deletedArtifactCount}`);

      return {
        capabilityKey: BASE_NAMESPACE,
        safety: 'read_only_status_for_non_consequential_sandbox_runtime',
        tenantId,
        requiredTenantId: SANDBOX_TENANT_ID,
        sandboxBoundaryAllowed,
        status,
        eventCount,
        artifactCount,
        derivedStateInventory: counts,
        resetDeleteReadiness: {
          canReset: sandboxBoundaryAllowed,
          canDelete: sandboxBoundaryAllowed,
          idempotent: true,
          scopedToTenant: SANDBOX_TENANT_ID,
          wouldDeleteArtifactCount: artifactCount,
        },
        lastResetResult: lastReset,
        missingLifecycleEvidence,
        positiveFollowUps,
        sourceActions: this.sourceActionGuards(),
        dossierEvidence: {
          status,
          tenantId,
          eventCount,
          artifactCount,
          derivedStateInventory: counts,
          resetDeleteReadiness: {
            canReset: sandboxBoundaryAllowed,
            idempotent: true,
            wouldDeleteArtifactCount: artifactCount,
          },
          lastResetResult: lastReset,
          missingLifecycleEvidence,
          positiveFollowUps,
          dossierFacts,
        },
      };
    },

    sourceActionGuards() {
      return {
        inspected: ['stadtwerk-mauer-sandbox-runtime.status'],
        referenced: ['object-store.query', 'object-store.put', 'object-store.delete'],
        notCalled: [
          'mako.dispatch',
          'msb.connector.call',
          'edm.connector.call',
          'customer-service.send',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'switching.execute',
          'webhook.emit',
          'device-control.execute',
          'smgw.connector.call',
          'cls.control.execute',
          'external.connector.call',
          'hitl.create',
          'personal-agent.execute',
          'tenant.delete.production',
        ],
      };
    },
  },
};
