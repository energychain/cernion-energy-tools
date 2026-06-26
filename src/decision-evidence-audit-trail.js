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

// ── Provenance (Option B, #276) ──────────────────────────────────────────────
// A decision 'source' describes one data origin that was consulted when the
// decision was made (e.g. a MaStR asset record, an EDM time-series, an
// object-store object). Storing these with the entry enables future dependency
// lookup: "which decisions used asset X and may be affected by its change?"
//
// sourceType: known taxonomy values — 'mastr' | 'edm' | 'object-store' |
//   'vdmi' | 'mcp-tool' | 'external-api' | any custom string.
// sourceId: the unique identifier within the source (MaStR Einheitennummer,
//   EDM MeLo-ID, object-store "${ns}:${key}", VDMI matrix ID, etc.).
// sourceVersion: the version/revision at the time of consultation
//   (MaStR lastUpdatedAt, PouchDB _rev, snapshot hash, etc.) — null if
//   the source has no versioning concept.
// sourceTimestamp: ISO timestamp when the data was fetched/observed.
// fieldNames: which fields of the source were actually used (optional;
//   useful for fine-grained re-validation — only re-validate if a
//   RELEVANT field changed).
//
// Note: sources[] is included in calculateHash (schema version 2). Entries
// created before this version will have entryHash computed without sources
// and will show as unverified by verifyTrail — this is honest behavior for
// a schema-breaking provenance upgrade. See CHANGELOG [0.67.2].

const KNOWN_SOURCE_TYPES = Object.freeze([
  'mastr',
  'edm',
  'object-store',
  'vdmi',
  'mcp-tool',
  'external-api',
]);

function normalizeSource(item) {
  if (!isPlainObject(item)) return null;
  const sourceType = normalizeString(item.sourceType);
  const sourceId = normalizeString(item.sourceId);
  if (!sourceType || !sourceId) return null;
  return {
    sourceType,
    sourceId,
    sourceVersion: normalizeString(item.sourceVersion),
    sourceTimestamp: normalizeString(item.sourceTimestamp),
    fieldNames: Array.isArray(item.fieldNames)
      ? item.fieldNames.map((f) => String(f || '').trim()).filter(Boolean)
      : null,
  };
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeSource).filter(Boolean);
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
      // Provenance sources (#276 Option B) — which data origins justified this
      // decision. Empty array means "no provenance recorded" (not an error).
      sources: normalizeSources(input.sources),
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
          // Provenance sources included in hash (schema v2, #276): changing
          // sources post-hoc is detectable. Pre-v2 entries stored without
          // sources default to [] here, so they will fail verification —
          // this is the correct, honest behavior (see CHANGELOG [0.67.2]).
          sources: entry.sources || [],
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
  KNOWN_SOURCE_TYPES,
  normalizeSources,
};
