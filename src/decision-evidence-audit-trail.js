'use strict';

const crypto = require('crypto');

const DOC_PREFIX = 'decision-evidence-audit:';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

function stableCopy(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableCopy(entry));
  }
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableCopy(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableCopy(value));
}

function stripPouchFields(doc) {
  const { _id, _rev, ...rest } = doc;
  return { id: _id, ...rest };
}

class DecisionEvidenceAuditTrail {
  constructor(pouchdb) {
    this.db = pouchdb;
    this.collectionPrefix = DOC_PREFIX;
  }

  buildDocId({ tenantId, entityId, rowId, timestamp, entryId }) {
    const rowSegment = rowId ? `row:${rowId}` : 'entity';
    return `${this.collectionPrefix}${tenantId}:${entityId}:${rowSegment}:${timestamp}:${entryId}`;
  }

  buildTrailStart({ tenantId, entityId, rowId }) {
    if (!rowId) {
      return `${this.collectionPrefix}${tenantId}:${entityId}:`;
    }
    return `${this.collectionPrefix}${tenantId}:${entityId}:row:${rowId}:`;
  }

  async appendEntry(input = {}) {
    const tenantId = normalizeString(input.tenantId, 'public');
    const entityId = normalizeString(input.entityId);
    const decision = normalizeString(input.decision);
    if (!entityId) {
      throw new Error('entityId is required');
    }
    if (!decision) {
      throw new Error('decision is required');
    }

    const rowId = normalizeString(input.rowId);
    const timestamp = normalizeString(input.timestamp, new Date().toISOString());
    const entryId = crypto.randomUUID();
    const previousEntry = await this.getLatestEntry({ tenantId, entityId, rowId });
    const previousHash = previousEntry?.entryHash || null;

    const auditEntry = {
      _id: this.buildDocId({ tenantId, entityId, rowId, timestamp, entryId }),
      tenantId,
      entityId,
      rowId,
      mandate: normalizeString(input.mandate),
      controlCase: normalizeString(input.controlCase),
      actor: normalizeString(input.actor),
      role: normalizeString(input.role),
      evidenceState: stableCopy(normalizeObject(input.evidenceState)),
      decision,
      followUpAction: normalizeString(input.followUpAction),
      policyDecision: stableCopy(normalizeObject(input.policyDecision)),
      metadata: stableCopy(normalizeObject(input.metadata)),
      timestamp,
      previousHash,
      createdAt: new Date().toISOString(),
    };

    auditEntry.entryHash = this.calculateHash(auditEntry);

    const result = await this.db.put(auditEntry);
    return {
      ...stripPouchFields(auditEntry),
      _rev: result.rev,
      chain: {
        previousHash,
        entryHash: auditEntry.entryHash,
      },
    };
  }

  async getTrail({ tenantId = 'public', entityId, rowId } = {}) {
    const normalizedTenantId = normalizeString(tenantId, 'public');
    const normalizedEntityId = normalizeString(entityId);
    if (!normalizedEntityId) {
      throw new Error('entityId is required');
    }

    const start = this.buildTrailStart({
      tenantId: normalizedTenantId,
      entityId: normalizedEntityId,
      rowId: normalizeString(rowId),
    });
    const result = await this.db.allDocs({
      include_docs: true,
      startkey: start,
      endkey: `${start}\uffff`,
    });

    return result.rows
      .map((row) => stripPouchFields(row.doc))
      .sort((a, b) => {
        const byTimestamp = String(a.timestamp).localeCompare(String(b.timestamp));
        return byTimestamp || String(a.id).localeCompare(String(b.id));
      });
  }

  async getLatestEntry(scope) {
    const trail = await this.getTrail(scope);
    return trail[trail.length - 1] || null;
  }

  async verifyTrail(scope) {
    const entries = await this.getTrail(scope);
    const failures = [];
    let previousHash = null;

    entries.forEach((entry, index) => {
      const expectedHash = this.calculateHash(entry);
      if (entry.entryHash !== expectedHash) {
        failures.push({
          index,
          id: entry.id,
          reason: 'entry_hash_mismatch',
          expectedHash,
          actualHash: entry.entryHash,
        });
      }
      if (entry.previousHash !== previousHash) {
        failures.push({
          index,
          id: entry.id,
          reason: 'previous_hash_mismatch',
          expectedPreviousHash: previousHash,
          actualPreviousHash: entry.previousHash,
        });
      }
      previousHash = entry.entryHash || null;
    });

    return {
      verified: failures.length === 0,
      entryCount: entries.length,
      failures,
      latestHash: entries.length > 0 ? entries[entries.length - 1].entryHash : null,
    };
  }

  calculateHash(entry) {
    return crypto
      .createHash('sha256')
      .update(
        stableStringify({
          tenantId: entry.tenantId,
          entityId: entry.entityId,
          rowId: entry.rowId || null,
          mandate: entry.mandate || null,
          controlCase: entry.controlCase || null,
          actor: entry.actor || null,
          role: entry.role || null,
          evidenceState: entry.evidenceState || {},
          decision: entry.decision,
          followUpAction: entry.followUpAction || null,
          policyDecision: entry.policyDecision || {},
          metadata: entry.metadata || {},
          timestamp: entry.timestamp,
          previousHash: entry.previousHash || null,
        })
      )
      .digest('hex');
  }
}

module.exports = {
  DecisionEvidenceAuditTrail,
  stableStringify,
};
