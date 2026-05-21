/**
 * VDMI Evidence Injection Service
 * Enables manual evidence injection for offline processes and dual-evidence requirement
 * v0.50.2 — Offline-Realität & Signature-Based Evidence Binding
 */

const Service = require('moleculer').Service;
const PouchDB = require('pouchdb');
const VDMIAuditTrail = require('../src/vdmi-audit-trail');
const VDMISignature = require('../src/vdmi-signature');

module.exports = class VDMIEvidenceService extends Service {
  constructor(broker) {
    super(broker);

    this.name = 'vdmi-evidence';
    this.settings = {
      fields: {
        id: { type: 'string', primaryKey: true },
        tenantId: { type: 'string', required: true },
        taskId: { type: 'string', required: true },
        status: {
          type: 'enum',
          values: ['pending_signature', 'fully_signed', 'approved', 'injected'],
        },
      },
    };

    this.db = null;
    this.auditTrail = null;
    this.signature = null;
  }

  created() {
    this.db = new PouchDB('data/vdmi-evidence', {
      auto_compaction: true,
    });
    this.auditTrail = new VDMIAuditTrail(
      new PouchDB('data/vdmi-audit-trail', { auto_compaction: true })
    );
    this.signature = new VDMISignature(
      new PouchDB('data/vdmi-signatures', { auto_compaction: true })
    );
  }

  async started() {
    await this.db.createIndex({
      index: { fields: ['tenantId', 'taskId'] },
    });
    await this.db.createIndex({
      index: { fields: ['tenantId', 'status'] },
    });
  }

  actions = {
    /**
     * POST — Inject manual evidence
     */
    inject: {
      rest: 'POST /tenants/:tenantId/tasks/:taskId/evidence',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'Inject manual evidence for dual-evidence requirement',
        parameters: [
          { name: 'tenantId', path: true, required: true },
          { name: 'taskId', path: true, required: true },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  evidenceType: {
                    type: 'string',
                    enum: ['manual_confirmation', 'attestation', 'document'],
                  },
                  category: {
                    type: 'string',
                    enum: [
                      'hr_confirmation',
                      'manager_attestation',
                      'legal_exception',
                      'legacy_system_mapping',
                    ],
                  },
                  data: { type: 'object' },
                  affectedMatrix: { type: 'object' },
                  sourceQuality: { type: 'string', enum: ['low', 'medium', 'high'] },
                  signatureRequired: { type: 'boolean' },
                  rationale: { type: 'string' },
                },
                required: ['evidenceType', 'category', 'data', 'rationale'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Evidence injected successfully' },
          409: { description: 'Task already approved' },
          422: { description: 'Invalid evidence category' },
        },
      },
      async handler(ctx) {
        const { tenantId, taskId } = ctx.params;
        const {
          evidenceType,
          category,
          data,
          affectedMatrix,
          sourceQuality,
          signatureRequired,
          rationale,
        } = ctx.request.body;

        try {
          // Validate evidence category
          const validCategories = [
            'hr_confirmation',
            'manager_attestation',
            'legal_exception',
            'legacy_system_mapping',
          ];
          if (!validCategories.includes(category)) {
            throw new Error(`Invalid evidence category: ${category}`);
          }

          // Fetch task
          const task = await ctx.call('vdmi.getTask', { id: taskId });
          if (!task || task.tenantId !== tenantId) {
            throw new Error('Task not found');
          }

          if (task.status === 'approved' || task.status === 'applied') {
            throw new Error('Cannot inject evidence for already-approved tasks');
          }

          // Create evidence document
          const evidenceDoc = {
            _id: `vdmi-evidence:${tenantId}:${taskId}:${Date.now()}`,
            tenantId,
            taskId,
            type: evidenceType,
            category,
            status: signatureRequired ? 'pending_signature' : 'approved',
            data: {
              ...data,
              injectedAt: new Date().toISOString(),
              injectedBy: ctx.meta.userId,
            },
            affectedMatrix,
            sourceQuality,
            rationale,
            createdAt: new Date().toISOString(),
          };

          await this.db.put(evidenceDoc);

          // Assess dual-evidence status
          const dualEvidenceStatus = await this._assessDualEvidenceStatus(task, evidenceDoc);

          // Create signature request if required
          let signatureRequest = null;
          if (signatureRequired) {
            signatureRequest = await this.signature.createSignatureRequest(tenantId, {
              operationType: 'evidence_injection',
              operationId: evidenceDoc._id,
              requiredSigners: [
                'compliance-officer@company.com',
                data.confirmingPerson || 'unknown@company.com',
              ],
              createdBy: ctx.meta.userId,
            });
          }

          // Create audit entry
          await this.auditTrail.createEntry(tenantId, {
            action: 'EVIDENCE_INJECTED',
            actor: ctx.meta.userId,
            rationale,
            delta: {
              evidenceType,
              category,
              dualEvidenceStatus,
            },
            relatedEntities: {
              type: 'evidence',
              id: evidenceDoc._id,
            },
          });

          // Update task's evidence reference
          task.injectedEvidence = task.injectedEvidence || [];
          task.injectedEvidence.push(evidenceDoc._id);
          if (dualEvidenceStatus.satisfied) {
            task.status = 'pending_approval';
          }
          await ctx.call('vdmi.updateTask', task);

          return {
            evidence: {
              id: evidenceDoc._id,
              tenantId,
              taskId,
              type: evidenceType,
              category,
              status: evidenceDoc.status,
              createdAt: evidenceDoc.createdAt,
              createdBy: ctx.meta.userId,
              dualEvidenceStatus,
            },
            signatureRequest: signatureRequest
              ? {
                  id: signatureRequest.id,
                  status: signatureRequest.status,
                  requiredSigners: signatureRequest.requiredSigners,
                  expiresAt: signatureRequest.expiresAt,
                  signingPortalUrl: signatureRequest.signingPortalUrl,
                }
              : null,
            matrixImpact: {
              matrixId: affectedMatrix?.matrixId,
              willUnblockMatrix: dualEvidenceStatus.satisfied,
              triggeredApprovalAfterSignature: signatureRequired && dualEvidenceStatus.satisfied,
            },
          };
        } catch (error) {
          this.logger.error('Error injecting evidence:', error);
          throw error;
        }
      },
    },

    /**
     * POST — Sign evidence (used by signature portal)
     */
    sign: {
      rest: 'POST /tenants/:tenantId/evidence/:evidenceId/sign',
      async handler(ctx) {
        const { tenantId, evidenceId } = ctx.params;
        const { signatureRequestId, signatureData } = ctx.request.body;

        try {
          // Verify signature
          const verified = await this.signature.verifySignatures(signatureRequestId);
          if (!verified.isComplete) {
            throw new Error('Not all signatures provided');
          }

          // Update evidence status
          const evidence = await this.db.get(evidenceId);
          evidence.status = 'approved';
          evidence.signatureRequestId = signatureRequestId;
          evidence.signatures = verified.signatures;
          await this.db.put(evidence);

          // Create audit entry
          await this.auditTrail.createEntry(tenantId, {
            action: 'EVIDENCE_SIGNED',
            actor: ctx.meta.userId,
            rationale: `Evidence signed by ${verified.signedBy.length} signatories`,
            relatedEntities: {
              type: 'evidence',
              id: evidenceId,
            },
          });

          return { status: 'approved', signatures: verified.signatures };
        } catch (error) {
          this.logger.error('Error signing evidence:', error);
          throw error;
        }
      },
    },
  };

  /**
   * Assess if dual-evidence requirement is satisfied
   * @private
   */
  async _assessDualEvidenceStatus(task, newEvidence) {
    const existingSources = task.evidenceSources || [];
    const newSource = newEvidence.category;

    // Check if we now have dual evidence
    const hasFirstSource = existingSources.some((s) => s !== newSource);
    const hasSecondSource = newSource;

    return {
      firstSource: {
        type: existingSources[0] || 'unknown',
        status: existingSources.length > 0 ? 'present' : 'missing',
      },
      secondSource: {
        type: newSource,
        status: 'pending_injection',
        evidenceId: newEvidence._id,
      },
      dualEvidenceSatisfied: hasFirstSource && hasSecondSource,
      satisfiedAfterSignature: newEvidence.signatureRequired,
    };
  }
};
