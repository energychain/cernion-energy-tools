/**
 * VDMI Audit Trail Module
 * Manages immutable audit logging for all VDMI governance operations
 * v0.50.2 — Human Override, Findings, Evidence Injection
 */

const crypto = require('crypto');

class VDMIAuditTrail {
  constructor(pouchdb) {
    this.db = pouchdb;
    this.collectionPrefix = 'vdmi-audit:';
  }

  /**
   * Create immutable audit entry
   * @param {string} tenantId - Tenant identifier
   * @param {object} entry - Audit entry data
   * @returns {Promise<object>} Audit entry with ID and hash
   */
  async createEntry(tenantId, entry) {
    const auditEntry = {
      _id: `${this.collectionPrefix}${tenantId}:${crypto.randomUUID()}`,
      tenantId,
      action: entry.action, // MATRIX_OVERRIDE, MATRIX_REVERT, FINDING_CREATED, etc.
      actor: entry.actor, // email of user performing action
      actorRole: entry.actorRole, // hitl-approver, data-steward, etc.
      timestamp: entry.timestamp || new Date().toISOString(),
      rationale: entry.rationale || null,
      changeCategory: entry.changeCategory || null,
      delta: entry.delta || null,
      relatedEntities: entry.relatedEntities || {}, // matrix-id, finding-id, etc.
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      createdAt: new Date().toISOString(),
    };

    // Calculate immutable hash for integrity verification
    auditEntry.integrityHash = this._calculateHash(auditEntry);

    try {
      const result = await this.db.put(auditEntry);
      return {
        id: result.id,
        ...auditEntry,
        _rev: result.rev,
      };
    } catch (error) {
      throw new Error(`Failed to create audit entry: ${error.message}`);
    }
  }

  /**
   * Get audit trail for entity (matrix, finding, task)
   * @param {string} tenantId
   * @param {string} entityType - matrix, finding, task, evidence
   * @param {string} entityId
   * @returns {Promise<Array>} Sorted audit entries
   */
  async getEntityTrail(tenantId, entityType, entityId) {
    try {
      const result = await this.db.find({
        selector: {
          _id: { $gt: `${this.collectionPrefix}${tenantId}:` },
          _id: { $lt: `${this.collectionPrefix}${tenantId}:\uffff` },
          'relatedEntities.type': entityType,
          'relatedEntities.id': entityId,
        },
      });

      return result.docs
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map(doc => {
          const { _rev, _id, ...rest } = doc;
          return { id: _id, ...rest };
        });
    } catch (error) {
      throw new Error(`Failed to retrieve audit trail: ${error.message}`);
    }
  }

  /**
   * Calculate SHA-256 hash for audit entry
   * @private
   */
  _calculateHash(entry) {
    const canonicalized = JSON.stringify(
      {
        action: entry.action,
        actor: entry.actor,
        timestamp: entry.timestamp,
        delta: entry.delta,
        relatedEntities: entry.relatedEntities,
      },
      Object.keys({
        action: null,
        actor: null,
        timestamp: null,
        delta: null,
        relatedEntities: null,
      }).sort()
    );
    return crypto.createHash('sha256').update(canonicalized).digest('hex');
  }

  /**
   * Verify audit entry integrity
   * @param {object} entry
   * @returns {boolean} True if hash matches
   */
  verifyIntegrity(entry) {
    const expectedHash = this._calculateHash(entry);
    return entry.integrityHash === expectedHash;
  }
}

module.exports = VDMIAuditTrail;
