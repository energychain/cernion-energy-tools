'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, tenantNamespace } = require('../src/tenant-context');

const SANDBOX_TENANT_ID = 'stadtwerk-mauer';
const BASE_NAMESPACE = 'stadtwerk_mauer_sandbox_runtime';
const CAPABILITY_KEY = 'stadtwerk_mauer_external_interface_stubs';

const STUB_FAMILIES = {
  mako_lieferantenwechsel: {
    label: 'MaKo / Lieferantenwechsel Stub',
    requiredEvidence: ['maloId', 'meloId', 'supplierRef'],
    missingFollowUp: 'add MaLo/MeLo and supplier reference for simulated MaKo exchange evidence',
  },
  msb_edm_plausibility: {
    label: 'MSB / EDM Plausibilitaets-Stub',
    requiredEvidence: ['meterId', 'meterReading', 'plausibilityStatus'],
    missingFollowUp: 'add meter reading and plausibility status for EDM simulation evidence',
  },
  customer_communication: {
    label: 'Kundenkommunikations-Stub',
    requiredEvidence: ['contactRef', 'messageTemplate', 'consentStatus'],
    missingFollowUp:
      'add contact, consent and template context for customer communication simulation evidence',
  },
  control_device_boundary: {
    label: 'Steuerungs-/Geraetegrenzen-Stub',
    requiredEvidence: ['assetId', 'controlScope', 'technicalBoundary'],
    missingFollowUp:
      'add controllable asset and control-scope context for control-boundary evidence',
  },
  billing_settlement_tariff_placeholder: {
    label: 'Billing / Settlement / Tarif Placeholder',
    requiredEvidence: ['billingContext', 'tariffRef', 'settlementPeriod'],
    missingFollowUp: 'add billing, tariff and settlement period context for placeholder evidence',
  },
  webhook_connector_placeholder: {
    label: 'Webhook / Connector Guard Placeholder',
    requiredEvidence: ['endpointRef', 'payloadContract'],
    missingFollowUp: 'add endpoint and payload-contract context for connector guard evidence',
  },
};

const RESPONSE_VARIANTS = new Set(['success', 'rejected', 'missing_data', 'deadline_risk']);

function nowIso() {
  return new Date().toISOString();
}

function stubId(prefix) {
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
      'Stadtwerk Mauer external-interface stubs can mutate only tenant stadtwerk-mauer',
      403,
      'SANDBOX_TENANT_REQUIRED',
      { tenantId, requiredTenantId: SANDBOX_TENANT_ID }
    );
  }
}

function normalizeStubFamily(stubFamily) {
  const normalized = String(stubFamily || '')
    .trim()
    .toLowerCase();
  if (!STUB_FAMILIES[normalized]) {
    throw new MoleculerClientError(
      `Unsupported Stadtwerk Mauer stub family: ${stubFamily}`,
      422,
      'UNSUPPORTED_STUB_FAMILY',
      { stubFamily, supportedStubFamilies: Object.keys(STUB_FAMILIES) }
    );
  }
  return normalized;
}

function normalizeVariant(variant, missingEvidence) {
  const normalized = String(variant || '')
    .trim()
    .toLowerCase();
  if (RESPONSE_VARIANTS.has(normalized)) return normalized;
  return missingEvidence.length > 0 ? 'missing_data' : 'success';
}

module.exports = {
  name: 'stadtwerk-mauer-external-interface-stubs',

  actions: {
    callStub: {
      rest: 'POST /call',
      params: {
        tenantId: { type: 'string', optional: true },
        stubFamily: { type: 'string', min: 2 },
        caseId: { type: 'string', optional: true },
        responseVariant: { type: 'string', optional: true },
        request: { type: 'object', optional: true, default: {} },
        deadlineAt: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId);
        ensureSandboxTenant(tenantId);

        const stubFamily = normalizeStubFamily(ctx.params.stubFamily);
        const family = STUB_FAMILIES[stubFamily];
        const request = ctx.params.request || {};
        const missingEvidence = family.requiredEvidence
          .filter((key) => request[key] == null || request[key] === '')
          .map((missingDataPoint) => ({
            missingDataPoint,
            enablesDossierAddition: family.missingFollowUp,
            stubFamily,
          }));
        const responseVariant = normalizeVariant(ctx.params.responseVariant, missingEvidence);
        const createdAt = nowIso();
        const transcriptId = stubId('smm-stub');
        const requestHash = hashPayload({ stubFamily, caseId: ctx.params.caseId || null, request });
        const namespace = tenantNamespace(BASE_NAMESPACE, tenantId);

        const transcript = {
          kind: 'runtime_artifact',
          artifactKind: 'stub_transcript_placeholder',
          capabilityKey: CAPABILITY_KEY,
          tenantId,
          transcriptId,
          stubFamily,
          label: family.label,
          caseId: ctx.params.caseId || null,
          responseVariant,
          requestHash,
          deadlineAt: ctx.params.deadlineAt || null,
          requestMetadata: {
            providedKeys: Object.keys(request).sort(),
            requestHash,
          },
          missingEvidence,
          positiveFollowUps: missingEvidence.map((item) => ({
            ...item,
            category: CAPABILITY_KEY,
          })),
          sourceActions: this.sourceActionGuards(),
          createdAt,
        };

        await ctx.call('object-store.put', {
          namespace,
          key: transcriptId,
          payload: transcript,
        });

        const derived = [
          {
            artifactKind: 'outbox_queue_placeholder',
            label: `Sandbox outbox placeholder for ${stubFamily}`,
          },
          {
            artifactKind: 'follow_up_proposal',
            label: `Follow-up proposal for ${stubFamily}`,
          },
          {
            artifactKind: 'audit_artifact',
            label: `No-call audit artifact for ${stubFamily}`,
          },
        ];

        for (const artifact of derived) {
          await ctx.call('object-store.put', {
            namespace,
            key: stubId(`smm-${artifact.artifactKind}`),
            payload: {
              kind: 'runtime_artifact',
              artifactKind: artifact.artifactKind,
              capabilityKey: CAPABILITY_KEY,
              tenantId,
              transcriptId,
              stubFamily,
              label: artifact.label,
              createdAt,
            },
          });
        }

        return {
          success: true,
          capabilityKey: CAPABILITY_KEY,
          tenantId,
          transcript,
          derivedArtifactsCreated: derived.length,
          sourceActions: this.sourceActionGuards(),
        };
      },
    },

    getStatus: {
      rest: 'GET /status',
      params: {
        tenantId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 50 },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId || SANDBOX_TENANT_ID);
        const sandboxBoundaryAllowed = tenantId === SANDBOX_TENANT_ID;
        const namespace = tenantNamespace(BASE_NAMESPACE, SANDBOX_TENANT_ID);
        const docs = sandboxBoundaryAllowed ? await this.listStubDocs(ctx, namespace) : [];
        return this.buildStatus({
          tenantId,
          sandboxBoundaryAllowed,
          docs,
          limit: ctx.params.limit || 10,
        });
      },
    },
  },

  methods: {
    async listStubDocs(ctx, namespace) {
      const result = await ctx.call('object-store.query', {
        namespace,
        selector: { 'payload.capabilityKey': CAPABILITY_KEY },
        limit: 1000,
      });
      return result.docs || [];
    },

    buildStatus({ tenantId, sandboxBoundaryAllowed, docs, limit }) {
      const transcripts = docs
        .map((doc) => doc.payload)
        .filter((payload) => payload?.artifactKind === 'stub_transcript_placeholder')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const artifactCount = docs.length;
      const familyCounts = Object.fromEntries(
        Object.keys(STUB_FAMILIES).map((family) => [family, 0])
      );
      const variantCounts = Object.fromEntries(
        Array.from(RESPONSE_VARIANTS).map((variant) => [variant, 0])
      );
      for (const transcript of transcripts) {
        if (familyCounts[transcript.stubFamily] != null) familyCounts[transcript.stubFamily] += 1;
        if (variantCounts[transcript.responseVariant] != null)
          variantCounts[transcript.responseVariant] += 1;
      }

      const missingEvidence = [];
      if (!sandboxBoundaryAllowed) {
        missingEvidence.push({
          missingDataPoint: 'stadtwerk_mauer_tenant_scope',
          enablesDossierAddition:
            'add proof that stub mutation is limited to tenant stadtwerk-mauer',
        });
      }
      if (transcripts.length === 0) {
        missingEvidence.push({
          missingDataPoint: 'stub_transcript',
          enablesDossierAddition: 'add first deterministic external-interface transcript',
        });
      }
      for (const family of Object.keys(STUB_FAMILIES)) {
        if (familyCounts[family] === 0) {
          missingEvidence.push({
            missingDataPoint: family,
            enablesDossierAddition: STUB_FAMILIES[family].missingFollowUp,
          });
        }
      }
      for (const transcript of transcripts) {
        missingEvidence.push(...(transcript.missingEvidence || []));
      }

      const status = !sandboxBoundaryAllowed
        ? 'blocked_outside_sandbox_tenant'
        : transcripts.length === 0
          ? 'stub_layer_ready_for_transcripts'
          : missingEvidence.length > 0
            ? 'stub_transcripts_need_evidence'
            : 'stub_transcripts_ready_for_demo';

      const recentTranscripts = transcripts.slice(0, limit).map((transcript) => ({
        transcriptId: transcript.transcriptId,
        stubFamily: transcript.stubFamily,
        label: transcript.label,
        responseVariant: transcript.responseVariant,
        caseId: transcript.caseId,
        requestHash: transcript.requestHash,
        deadlineAt: transcript.deadlineAt,
        missingEvidence: transcript.missingEvidence || [],
        createdAt: transcript.createdAt,
      }));

      const positiveFollowUps = missingEvidence.map((item) => ({
        ...item,
        category: CAPABILITY_KEY,
      }));
      const sourceActions = this.sourceActionGuards();
      const dossierFacts = [
        `Stub Status: ${status}`,
        `Tenant: ${tenantId}`,
        `Transcripts: ${transcripts.length}`,
        `Artifacts: ${artifactCount}`,
      ];
      if (recentTranscripts[0]) {
        dossierFacts.push(`Latest Stub: ${recentTranscripts[0].stubFamily}`);
        dossierFacts.push(`Latest Variant: ${recentTranscripts[0].responseVariant}`);
      }

      return {
        capabilityKey: CAPABILITY_KEY,
        safety: 'sandbox_only_non_consequential_stubs_with_read_only_status',
        tenantId,
        requiredTenantId: SANDBOX_TENANT_ID,
        sandboxBoundaryAllowed,
        status,
        transcriptCount: transcripts.length,
        artifactCount,
        familyCounts,
        variantCounts,
        recentTranscripts,
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
          transcriptCount: transcripts.length,
          artifactCount,
          familyCounts,
          variantCounts,
          recentTranscripts,
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
        inspected: ['stadtwerk-mauer-external-interface-stubs.getStatus'],
        referenced: [
          'stadtwerk-mauer-sandbox-runtime.reset',
          'object-store.query',
          'object-store.put',
        ],
        notCalled: [
          'mako.dispatch',
          'msb.connector.call',
          'edm.connector.call',
          'customer-service.send',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'contract.execute',
          'webhook.emit',
          'device-control.execute',
          'smgw.connector.call',
          'eebus.connector.call',
          'nes2.connector.call',
          'cls.control.execute',
          'external.connector.call',
          'hitl.create',
          'personal-agent.execute',
        ],
      };
    },
  },
};
