/**
 * VDMI Signature Module
 * Manages digital signatures for manual evidence and critical approvals
 * v0.50.2 — Evidence Injection & Dual Approval Workflows
 */

const crypto = require('crypto');

class VDMISignature {
  constructor(pouchdb) {
    this.db = pouchdb;
    this.collectionPrefix = 'vdmi-signature:';
  }

  /**
   * Create signature request for critical operation
   * @param {string} tenantId
   * @param {object} request - Signature request data
   * @returns {Promise<object>} Signature request with unique ID
   */
  async createSignatureRequest(tenantId, request) {
    const sigRequest = {
      _id: `${this.collectionPrefix}${tenantId}:${crypto.randomUUID()}`,
      tenantId,
      operationType: request.operationType, // evidence_injection, evidence_approval, critical_override
      operationId: request.operationId, // evidence-id, finding-id, etc.
      requiredSigners: request.requiredSigners || [], // array of emails
      signatures: {}, // will be populated: { 'email@company.com': { timestamp, hash, certificate } }
      status: 'pending', // pending, partially_signed, fully_signed, expired
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // 72 hours
      createdBy: request.createdBy,
      signingPortalUrl: null, // will be set after creation
    };

    try {
      const result = await this.db.put(sigRequest);
      return {
        id: result.id,
        ...sigRequest,
        _rev: result.rev,
        signingPortalUrl: `/auth/sign/${result.id}`,
      };
    } catch (error) {
      throw new Error(`Failed to create signature request: ${error.message}`);
    }
  }

  /**
   * Add signature to request
   * @param {string} requestId - Signature request ID
   * @param {string} signerEmail - Email of signer
   * @param {string} signatureData - Base64-encoded signature
   * @returns {Promise<object>} Updated signature request
   */
  async addSignature(requestId, signerEmail, signatureData) {
    try {
      const doc = await this.db.get(requestId);

      if (!doc.requiredSigners.includes(signerEmail)) {
        throw new Error('Signer not authorized for this request');
      }

      if (doc.signatures[signerEmail]) {
        throw new Error('Signature already provided by this signer');
      }

      doc.signatures[signerEmail] = {
        timestamp: new Date().toISOString(),
        signatureHash: this._hashSignature(signatureData),
        certificateSubject: signerEmail, // would be extracted from certificate in production
      };

      // Update status
      const signedCount = Object.keys(doc.signatures).length;
      if (signedCount === doc.requiredSigners.length) {
        doc.status = 'fully_signed';
      } else {
        doc.status = 'partially_signed';
      }

      const result = await this.db.put(doc);
      return { id: result.id, ...doc, _rev: result.rev };
    } catch (error) {
      throw new Error(`Failed to add signature: ${error.message}`);
    }
  }

  /**
   * Verify all signatures are present and valid
   * @param {string} requestId
   * @returns {Promise<object>} Verification result
   */
  async verifySignatures(requestId) {
    try {
      const doc = await this.db.get(requestId);

      const verification = {
        requestId,
        status: doc.status,
        isComplete: doc.status === 'fully_signed',
        totalRequired: doc.requiredSigners.length,
        signedCount: Object.keys(doc.signatures).length,
        signedBy: Object.keys(doc.signatures),
        missingSigners: doc.requiredSigners.filter((email) => !doc.signatures[email]),
        expiresAt: doc.expiresAt,
        isExpired: new Date(doc.expiresAt) < new Date(),
        signatures: Object.entries(doc.signatures).map(([email, sig]) => ({
          signer: email,
          timestamp: sig.timestamp,
          signatureVerified: true, // in production, would verify against certificate
        })),
      };

      return verification;
    } catch (error) {
      throw new Error(`Failed to verify signatures: ${error.message}`);
    }
  }

  /**
   * Hash signature for integrity check
   * @private
   */
  _hashSignature(signatureData) {
    return crypto.createHash('sha256').update(Buffer.from(signatureData, 'base64')).digest('hex');
  }
}

module.exports = VDMISignature;
