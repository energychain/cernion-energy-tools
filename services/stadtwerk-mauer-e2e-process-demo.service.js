'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, tenantNamespace } = require('../src/tenant-context');

const SANDBOX_TENANT_ID = 'stadtwerk-mauer';
const BASE_NAMESPACE = 'stadtwerk_mauer_sandbox_runtime';
const CAPABILITY_KEY = 'stadtwerk_mauer_e2e_process_demo';
const DEFAULT_DEMO_PATH = 'pv_registration_electrician_missing_nap';

const NO_CALL_GUARDS = [
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
];

function nowIso() {
  return new Date().toISOString();
}

function demoId(prefix) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function hashPayload(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload || {}))
    .digest('hex')
    .slice(0, 16);
}

function resolveTenant(ctx, explicitTenantId) {
  return String(explicitTenantId || getTenantId(ctx) || '').toLowerCase();
}

function ensureSandboxTenant(tenantId) {
  if (tenantId !== SANDBOX_TENANT_ID) {
    throw new MoleculerClientError(
      'Stadtwerk Mauer E2E process demos can mutate only tenant stadtwerk-mauer',
      403,
      'SANDBOX_TENANT_REQUIRED',
      { tenantId, requiredTenantId: SANDBOX_TENANT_ID }
    );
  }
}

function missingField(input, key) {
  const value = input?.[key];
  return value == null || value === '';
}

module.exports = {
  name: 'stadtwerk-mauer-e2e-process-demo',

  actions: {
    runDemo: {
      rest: 'POST /run',
      params: {
        tenantId: { type: 'string', optional: true },
        caseId: { type: 'string', optional: true },
        demoPath: { type: 'string', optional: true },
        electricianRegistrationRef: { type: 'string', optional: true },
        customerConsentStatus: { type: 'string', optional: true },
        contactRef: { type: 'string', optional: true },
        messageTemplate: { type: 'string', optional: true },
        pvPlantKw: { type: 'number', optional: true, convert: true, min: 0 },
        napReference: { type: 'string', optional: true },
        maloId: { type: 'string', optional: true },
        meloId: { type: 'string', optional: true },
        meterId: { type: 'string', optional: true },
        resetBeforeRun: { type: 'boolean', optional: true, convert: true },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId);
        ensureSandboxTenant(tenantId);

        const demoPath = ctx.params.demoPath || DEFAULT_DEMO_PATH;
        if (demoPath !== DEFAULT_DEMO_PATH) {
          throw new MoleculerClientError(
            `Unsupported Stadtwerk Mauer demo path: ${demoPath}`,
            422,
            'UNSUPPORTED_DEMO_PATH',
            { demoPath, supportedDemoPaths: [DEFAULT_DEMO_PATH] }
          );
        }

        if (ctx.params.resetBeforeRun) {
          await ctx.call('stadtwerk-mauer-sandbox-runtime.reset', {
            tenantId,
            reason: 'e2e-demo-reset-before-run',
          });
        }

        const caseId =
          ctx.params.caseId || `smm-e2e:${hashPayload({ demoPath, tenantId, t: Date.now() })}`;
        const createdAt = nowIso();
        const namespace = tenantNamespace(BASE_NAMESPACE, tenantId);
        const missingEvidence = this.buildMissingEvidence(ctx.params);

        const event = await ctx.call('stadtwerk-mauer-sandbox-runtime.ingestEvent', {
          tenantId,
          eventType: DEFAULT_DEMO_PATH,
          caseId,
          sourceRef: 'stadtwerk-mauer-e2e-process-demo.runDemo',
          payload: {
            capabilityKey: CAPABILITY_KEY,
            demoPath,
            electricianRegistrationRef: ctx.params.electricianRegistrationRef || null,
            pvPlantKw: ctx.params.pvPlantKw || null,
            napReference: ctx.params.napReference || null,
          },
        });

        const stub = await ctx.call('stadtwerk-mauer-external-interface-stubs.callStub', {
          tenantId,
          stubFamily: 'customer_communication',
          caseId,
          request: {
            contactRef: ctx.params.contactRef || null,
            messageTemplate: ctx.params.messageTemplate || 'pv_registration_missing_nap_request',
            consentStatus: ctx.params.customerConsentStatus || null,
          },
        });

        const traceId = demoId('smm-e2e-trace');
        const positiveFollowUps = missingEvidence.map((item) => ({
          ...item,
          category: CAPABILITY_KEY,
        }));
        const sourceActions = this.sourceActionGuards();
        const rolesAndCapabilities = this.rolesAndCapabilities();

        const trace = {
          kind: 'runtime_artifact',
          artifactKind: 'process_trace',
          capabilityKey: CAPABILITY_KEY,
          tenantId,
          traceId,
          caseId,
          demoPath,
          status: missingEvidence.length > 0 ? 'demo_trace_needs_evidence' : 'demo_trace_ready',
          eventId: event.eventId,
          transcriptId: stub.transcript?.transcriptId || null,
          rolesAndCapabilities,
          evidenceQuality:
            missingEvidence.length > 0 ? 'incomplete_demo_evidence' : 'complete_demo_evidence',
          missingEvidence,
          positiveFollowUps,
          sourceActions,
          createdAt,
        };

        await ctx.call('object-store.put', { namespace, key: traceId, payload: trace });
        await this.putDerivedArtifacts(ctx, namespace, {
          tenantId,
          traceId,
          caseId,
          demoPath,
          eventId: event.eventId,
          transcriptId: trace.transcriptId,
          missingEvidence,
          positiveFollowUps,
          createdAt,
        });

        return {
          success: true,
          capabilityKey: CAPABILITY_KEY,
          tenantId,
          requiredTenantId: SANDBOX_TENANT_ID,
          caseId,
          demoPath,
          trace,
          eventId: event.eventId,
          transcriptId: trace.transcriptId,
          derivedArtifactsCreated: 4,
          sourceActions,
        };
      },
    },

    getStatus: {
      rest: 'GET /status',
      params: {
        tenantId: { type: 'string', optional: true },
        caseId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 50 },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId || SANDBOX_TENANT_ID);
        const sandboxBoundaryAllowed = tenantId === SANDBOX_TENANT_ID;
        const namespace = tenantNamespace(BASE_NAMESPACE, SANDBOX_TENANT_ID);
        const docs = sandboxBoundaryAllowed ? await this.listDemoDocs(ctx, namespace) : [];
        return this.buildStatus({
          tenantId,
          sandboxBoundaryAllowed,
          docs,
          caseId: ctx.params.caseId || null,
          limit: ctx.params.limit || 10,
        });
      },
    },
  },

  methods: {
    buildMissingEvidence(params = {}) {
      const candidates = [
        [
          'napReference',
          'add NAP / Netzanschlusspunkt reference evidence to complete PV registration trace',
        ],
        ['maloId', 'add MaLo context for the simulated downstream boundary'],
        ['meloId', 'add MeLo context for the simulated downstream boundary'],
        ['electricianRegistrationRef', 'add electrician registration / installer context'],
        [
          'customerConsentStatus',
          'add communication consent context for customer-communication stub evidence',
        ],
        ['meterId', 'add meter identity for MSB/EDM plausibility evidence'],
      ];
      return candidates
        .filter(([key]) => missingField(params, key))
        .map(([missingDataPoint, enablesDossierAddition]) => ({
          missingDataPoint,
          enablesDossierAddition,
          demoPath: DEFAULT_DEMO_PATH,
        }));
    },

    rolesAndCapabilities() {
      return [
        {
          role: 'Elektriker',
          capability: 'PV Anmeldung erfassen',
          responsibility: 'seeded sandbox event and installer reference evidence',
        },
        {
          role: 'Netzanschluss',
          capability: 'NAP/reference evidence check',
          responsibility: 'missing NAP and connection-reference follow-up',
        },
        {
          role: 'Kundenkommunikation',
          capability: 'deterministic customer communication stub',
          responsibility: 'no-send transcript and consent evidence boundary',
        },
        {
          role: 'MSB/EDM',
          capability: 'plausibility follow-up boundary',
          responsibility: 'meter and measurement evidence gap tracking only',
        },
        {
          role: 'VDMI Dossier',
          capability: 'dossier growth and reset proof',
          responsibility: 'read-only trace consumption via hydration',
        },
      ];
    },

    async putDerivedArtifacts(ctx, namespace, base) {
      const artifacts = [
        {
          artifactKind: 'dossier_addition',
          label: 'PV Anmeldung dossier growth summary',
        },
        {
          artifactKind: 'follow_up_proposal',
          label: 'PV/NAP/reference evidence follow-up proposal',
        },
        {
          artifactKind: 'outbox_queue_placeholder',
          label: 'No-send customer communication outbox placeholder',
        },
        {
          artifactKind: 'audit_artifact',
          label: 'E2E no-real-action audit artifact',
        },
      ];

      for (const artifact of artifacts) {
        await ctx.call('object-store.put', {
          namespace,
          key: demoId(`smm-e2e-${artifact.artifactKind}`),
          payload: {
            kind: 'runtime_artifact',
            capabilityKey: CAPABILITY_KEY,
            tenantId: base.tenantId,
            traceId: base.traceId,
            caseId: base.caseId,
            demoPath: base.demoPath,
            eventId: base.eventId,
            transcriptId: base.transcriptId,
            missingEvidence: base.missingEvidence,
            positiveFollowUps: base.positiveFollowUps,
            artifactKind: artifact.artifactKind,
            label: artifact.label,
            createdAt: base.createdAt,
          },
        });
      }
    },

    async listDemoDocs(ctx, namespace) {
      const result = await ctx.call('object-store.query', {
        namespace,
        selector: { 'payload.capabilityKey': CAPABILITY_KEY },
        limit: 1000,
      });
      return result.docs || [];
    },

    buildStatus({ tenantId, sandboxBoundaryAllowed, docs, caseId, limit }) {
      const payloads = docs.map((doc) => doc.payload).filter(Boolean);
      const filtered = caseId ? payloads.filter((payload) => payload.caseId === caseId) : payloads;
      const traces = filtered
        .filter((payload) => payload.artifactKind === 'process_trace')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const selectedTrace = traces[0] || null;
      const artifactCount = filtered.length;
      const sourceActions = this.sourceActionGuards();
      const missingEvidence = [];
      if (!sandboxBoundaryAllowed) {
        missingEvidence.push({
          missingDataPoint: 'stadtwerk_mauer_tenant_scope',
          enablesDossierAddition:
            'add proof that E2E demo mutation is limited to tenant stadtwerk-mauer',
        });
      }
      if (!selectedTrace) {
        missingEvidence.push({
          missingDataPoint: 'e2e_demo_trace',
          enablesDossierAddition: 'run the deterministic PV Anmeldung demo trace',
        });
      }
      if (selectedTrace?.missingEvidence) missingEvidence.push(...selectedTrace.missingEvidence);

      const positiveFollowUps = missingEvidence.map((item) => ({
        ...item,
        category: CAPABILITY_KEY,
      }));
      const status = !sandboxBoundaryAllowed
        ? 'blocked_outside_sandbox_tenant'
        : traces.length === 0
          ? 'e2e_demo_ready_for_run'
          : missingEvidence.length > 0
            ? 'e2e_demo_trace_needs_evidence'
            : 'e2e_demo_trace_ready_for_dossier';
      const recentTraces = traces.slice(0, limit).map((trace) => ({
        traceId: trace.traceId,
        caseId: trace.caseId,
        demoPath: trace.demoPath,
        status: trace.status,
        eventId: trace.eventId,
        transcriptId: trace.transcriptId,
        evidenceQuality: trace.evidenceQuality,
        missingEvidence: trace.missingEvidence || [],
        createdAt: trace.createdAt,
      }));
      const dossierFacts = [
        `E2E Demo Status: ${status}`,
        `Tenant: ${tenantId}`,
        `Traces: ${traces.length}`,
        `Artifacts: ${artifactCount}`,
      ];
      if (selectedTrace) {
        dossierFacts.push(`Demo Path: ${selectedTrace.demoPath}`);
        dossierFacts.push(`Case: ${selectedTrace.caseId}`);
        dossierFacts.push(`Stub Transcript: ${selectedTrace.transcriptId}`);
      }

      return {
        capabilityKey: CAPABILITY_KEY,
        safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
        tenantId,
        requiredTenantId: SANDBOX_TENANT_ID,
        sandboxBoundaryAllowed,
        status,
        demoPath: selectedTrace?.demoPath || DEFAULT_DEMO_PATH,
        caseId: selectedTrace?.caseId || caseId || null,
        traceCount: traces.length,
        artifactCount,
        recentTraces,
        rolesAndCapabilities: selectedTrace?.rolesAndCapabilities || this.rolesAndCapabilities(),
        evidenceQuality: selectedTrace?.evidenceQuality || 'no_demo_trace_yet',
        missingEvidence,
        positiveFollowUps,
        resetBoundary: {
          service: 'stadtwerk-mauer-sandbox-runtime.reset',
          namespace: BASE_NAMESPACE,
          removesCapabilityKey: CAPABILITY_KEY,
          scopedToTenant: SANDBOX_TENANT_ID,
        },
        sourceActions,
        dossierEvidence: {
          status,
          tenantId,
          demoPath: selectedTrace?.demoPath || DEFAULT_DEMO_PATH,
          caseId: selectedTrace?.caseId || caseId || null,
          traceCount: traces.length,
          artifactCount,
          recentTraces,
          rolesAndCapabilities: selectedTrace?.rolesAndCapabilities || this.rolesAndCapabilities(),
          evidenceQuality: selectedTrace?.evidenceQuality || 'no_demo_trace_yet',
          missingEvidence,
          positiveFollowUps,
          resetBoundary: {
            service: 'stadtwerk-mauer-sandbox-runtime.reset',
            scopedToTenant: SANDBOX_TENANT_ID,
          },
          sourceActions,
          dossierFacts,
        },
      };
    },

    sourceActionGuards() {
      return {
        inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
        referenced: [
          'stadtwerk-mauer-sandbox-runtime.ingestEvent',
          'stadtwerk-mauer-external-interface-stubs.callStub',
          'stadtwerk-mauer-sandbox-runtime.reset',
          'object-store.query',
          'object-store.put',
        ],
        notCalled: NO_CALL_GUARDS,
      };
    },
  },
};
