'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, tenantNamespace } = require('../src/tenant-context');

const SANDBOX_TENANT_ID = 'stadtwerk-mauer';
const SANDBOX_CASE_ID = 'smm-budibase-workbench';
const BASE_NAMESPACE = 'stadtwerk_mauer_sandbox_runtime';
const LAST_RESET_KEY = '_last_reset';
const NOTE_MAX_LENGTH = 280;

const CASE_ANNOTATION_COMMANDS = [
  'mark_reviewed_sandbox',
  'add_operator_note_sandbox',
  'set_demo_status_sandbox',
];

const CASE_ANNOTATION_STATUSES = [
  'reviewed',
  'needs_evidence',
  'ready_for_verify',
  'blocked_by_missing_evidence',
];

const ARTIFACT_KINDS = [
  'event_instance',
  'dossier_addition',
  'follow_up_proposal',
  'stub_transcript_placeholder',
  'outbox_queue_placeholder',
  'audit_artifact',
  'case_annotation',
];

function nowIso() {
  return new Date().toISOString();
}

function runtimeId(prefix) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function stableRuntimeId(prefix, value) {
  return `${prefix}:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
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

function shortText(value, max = NOTE_MAX_LENGTH) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

function looksSecretLike(value) {
  return /(password|passwort|secret|token|api[_ -]?key|private[_ -]?key|bearer\s+[a-z0-9._-]+)/i.test(
    String(value || '')
  );
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

    recordCaseAnnotation: {
      rest: 'POST /case-annotations',
      params: {
        tenantId: { type: 'string', optional: true },
        caseId: { type: 'string', optional: true },
        commandType: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        note: { type: 'string', optional: true },
        reason: { type: 'string', optional: true },
        actorLabel: { type: 'string', optional: true },
        sourceLabel: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId);
        const namespace = tenantNamespace(BASE_NAMESPACE, SANDBOX_TENANT_ID);
        const params = { ...ctx.params, tenantId };
        const rejection = this.validateCaseAnnotationInput(params);
        if (rejection) {
          return this.buildCaseAnnotationRejection(params, rejection);
        }

        const idempotencyKey = shortText(params.idempotencyKey, 120);
        const commandId = stableRuntimeId('smm-case-annotation', idempotencyKey);
        const existing = await this.getRuntimeDoc(ctx, namespace, commandId);
        if (existing?.payload) {
          return {
            ...this.formatCaseAnnotationResult(existing.payload, true),
            sourceActions: this.sourceActionGuards(),
          };
        }

        const prior = await this.getLatestCaseAnnotation(ctx, namespace, SANDBOX_CASE_ID);
        const priorStatus = prior?.nextStatus || 'needs_evidence';
        const nextStatus = this.resolveCaseAnnotationNextStatus(params, priorStatus);
        const createdAt = nowIso();
        const payload = {
          kind: 'runtime_artifact',
          artifactKind: 'case_annotation',
          dataClass: 'sandbox_runtime_artifact',
          tenantId,
          caseId: SANDBOX_CASE_ID,
          commandId,
          idempotencyKey,
          commandType: params.commandType,
          priorStatus,
          nextStatus,
          note: shortText(params.note),
          reason: shortText(params.reason || params.note || params.commandType, 160),
          actorLabel: shortText(params.actorLabel, 80),
          sourceLabel: shortText(params.sourceLabel || 'budibase-workbench', 80),
          createdAt,
        };

        await ctx.call('object-store.put', {
          namespace,
          key: commandId,
          payload,
        });

        return {
          ...this.formatCaseAnnotationResult(payload, false),
          sourceActions: this.sourceActionGuards(),
        };
      },
    },

    listCaseAnnotations: {
      rest: 'GET /case-annotations',
      params: {
        tenantId: { type: 'string', optional: true },
        caseId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId || SANDBOX_TENANT_ID);
        const caseId = ctx.params.caseId || SANDBOX_CASE_ID;
        const sandboxBoundaryAllowed = tenantId === SANDBOX_TENANT_ID;
        const selectedCaseAllowed = caseId === SANDBOX_CASE_ID;
        const namespace = tenantNamespace(BASE_NAMESPACE, SANDBOX_TENANT_ID);
        const limit = Math.max(1, Math.min(Number(ctx.params.limit || 25), 50));
        const annotations =
          sandboxBoundaryAllowed && selectedCaseAllowed
            ? (await this.listCaseAnnotationPayloads(ctx, namespace, caseId)).slice(0, limit)
            : [];
        const latest = annotations[0] || null;

        return {
          capabilityKey: 'stadtwerk_mauer_case_annotations',
          safety: 'read_only_sandbox_annotation_readback',
          tenantId,
          requiredTenantId: SANDBOX_TENANT_ID,
          caseId,
          requiredCaseId: SANDBOX_CASE_ID,
          sandboxBoundaryAllowed,
          selectedCaseAllowed,
          found: sandboxBoundaryAllowed && selectedCaseAllowed,
          status: !sandboxBoundaryAllowed
            ? 'case_annotations_blocked_outside_sandbox_tenant'
            : !selectedCaseAllowed
              ? 'case_annotations_case_not_found'
              : latest
                ? 'case_annotations_ready'
                : 'case_annotations_empty',
          currentDemoStatus: latest?.nextStatus || 'needs_evidence',
          annotationCount: annotations.length,
          annotationRows: this.buildCaseAnnotationRows(annotations),
          auditRows: this.buildCaseAnnotationAuditRows(annotations),
          sourceActions: this.sourceActionGuards(),
        };
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
        const runtimeDocs = sandboxBoundaryAllowed
          ? await this.listRuntimeDocs(ctx, namespace)
          : [];
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

    async getRuntimeDoc(ctx, namespace, key) {
      try {
        return await ctx.call('object-store.get', { namespace, key });
      } catch (err) {
        if (err?.type === 'OBJECT_NOT_FOUND' || err?.code === 'OBJECT_NOT_FOUND') return null;
        throw err;
      }
    },

    async listCaseAnnotationPayloads(ctx, namespace, caseId = SANDBOX_CASE_ID) {
      const docs = await this.listRuntimeDocs(ctx, namespace);
      return docs
        .map((doc) => doc.payload)
        .filter(
          (payload) => payload?.artifactKind === 'case_annotation' && payload.caseId === caseId
        )
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    async getLatestCaseAnnotation(ctx, namespace, caseId = SANDBOX_CASE_ID) {
      const annotations = await this.listCaseAnnotationPayloads(ctx, namespace, caseId);
      return annotations[0] || null;
    },

    validateCaseAnnotationInput(params = {}) {
      if (params.tenantId !== SANDBOX_TENANT_ID) {
        return {
          code: 'SANDBOX_TENANT_REQUIRED',
          message: 'Case annotations are allowed only for tenant stadtwerk-mauer',
        };
      }
      if ((params.caseId || SANDBOX_CASE_ID) !== SANDBOX_CASE_ID) {
        return {
          code: 'SANDBOX_CASE_REQUIRED',
          message: 'Case annotations are allowed only for the synthetic Stadtwerk Mauer demo case',
        };
      }
      if (!CASE_ANNOTATION_COMMANDS.includes(params.commandType)) {
        return {
          code: 'UNSUPPORTED_COMMAND_TYPE',
          message: 'Unsupported sandbox case annotation command type',
        };
      }
      if (!shortText(params.actorLabel)) {
        return {
          code: 'MISSING_AUDIT_METADATA',
          message: 'actorLabel is required for audited sandbox annotations',
        };
      }
      if (!shortText(params.idempotencyKey)) {
        return {
          code: 'MISSING_IDEMPOTENCY_KEY',
          message: 'idempotencyKey is required for duplicate-safe sandbox annotations',
        };
      }
      if (
        params.commandType === 'set_demo_status_sandbox' &&
        !CASE_ANNOTATION_STATUSES.includes(params.status)
      ) {
        return {
          code: 'UNSUPPORTED_STATUS',
          message: 'Unsupported sandbox demo status',
        };
      }
      if (params.status && !CASE_ANNOTATION_STATUSES.includes(params.status)) {
        return {
          code: 'UNSUPPORTED_STATUS',
          message: 'Unsupported sandbox demo status',
        };
      }
      const note = String(params.note || '');
      if (note.length > NOTE_MAX_LENGTH) {
        return {
          code: 'NOTE_TOO_LONG',
          message: `Sandbox notes are limited to ${NOTE_MAX_LENGTH} characters`,
        };
      }
      if (looksSecretLike(`${params.note || ''} ${params.reason || ''}`)) {
        return {
          code: 'UNSAFE_NOTE',
          message: 'Sandbox notes must not contain secrets, tokens or private key material',
        };
      }
      return null;
    },

    resolveCaseAnnotationNextStatus(params = {}, priorStatus = 'needs_evidence') {
      if (params.commandType === 'mark_reviewed_sandbox') return 'reviewed';
      if (params.commandType === 'set_demo_status_sandbox') return params.status;
      return params.status || priorStatus || 'needs_evidence';
    },

    buildCaseAnnotationRejection(params = {}, rejection = {}) {
      return {
        accepted: false,
        rejected: true,
        duplicate: false,
        rejectionCode: rejection.code || 'CASE_ANNOTATION_REJECTED',
        message: rejection.message || 'Sandbox annotation command rejected',
        tenantId: params.tenantId || null,
        requiredTenantId: SANDBOX_TENANT_ID,
        caseId: params.caseId || null,
        requiredCaseId: SANDBOX_CASE_ID,
        commandType: params.commandType || null,
        currentDemoStatus: null,
        annotationRows: [],
        auditRows: [],
        sourceActions: this.sourceActionGuards(),
      };
    },

    formatCaseAnnotationResult(payload = {}, duplicate = false) {
      const row = this.buildCaseAnnotationRows([payload])[0];
      const auditRow = this.buildCaseAnnotationAuditRows([payload])[0];
      return {
        accepted: true,
        rejected: false,
        duplicate,
        tenantId: payload.tenantId,
        caseId: payload.caseId,
        commandId: payload.commandId,
        commandType: payload.commandType,
        priorStatus: payload.priorStatus,
        nextStatus: payload.nextStatus,
        currentDemoStatus: payload.nextStatus,
        actorLabel: payload.actorLabel,
        sourceLabel: payload.sourceLabel,
        timestamp: payload.createdAt,
        dataClass: payload.dataClass,
        noteSummary: payload.note || null,
        reasonSummary: payload.reason || null,
        annotationRows: row ? [row] : [],
        auditRows: auditRow ? [auditRow] : [],
      };
    },

    buildCaseAnnotationRows(annotations = []) {
      return annotations.map((item) => ({
        annotationId: item.commandId || null,
        caseId: item.caseId || null,
        commandType: item.commandType || null,
        currentStatus: item.nextStatus || null,
        priorStatus: item.priorStatus || null,
        actorLabel: item.actorLabel || null,
        sourceLabel: item.sourceLabel || null,
        noteLabel: item.note || null,
        reasonLabel: item.reason || null,
        dataClass: item.dataClass || 'sandbox_runtime_artifact',
        createdAt: item.createdAt || null,
      }));
    },

    buildCaseAnnotationAuditRows(annotations = []) {
      return annotations.map((item) => ({
        auditId: item.commandId || null,
        caseId: item.caseId || null,
        actorLabel: item.actorLabel || null,
        sourceLabel: item.sourceLabel || null,
        transitionLabel: `${item.priorStatus || 'unknown'} -> ${item.nextStatus || 'unknown'}`,
        commandType: item.commandType || null,
        idempotencyKey: item.idempotencyKey || null,
        createdAt: item.createdAt || null,
      }));
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
