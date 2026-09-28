'use strict';

const { Errors } = require('moleculer');

const now = () => new Date().toISOString();
const key = (...parts) => parts.map((p) => encodeURIComponent(String(p))).join(':');

function notFound(message = 'Workbench resource not found') {
  throw new Errors.MoleculerClientError(message, 404, 'WORKBENCH_NOT_FOUND');
}
function conflict(message = 'Workbench mapping conflict') {
  throw new Errors.MoleculerClientError(message, 409, 'WORKBENCH_CONFLICT');
}
function disabled(message = 'Workbench mapping disabled') {
  throw new Errors.MoleculerClientError(message, 403, 'WORKBENCH_DISABLED');
}

function conversationId(tenantId, client, conversationIdValue) {
  return key('conversation', tenantId, client, conversationIdValue);
}
function identityId(client, externalOrgId, externalUserId) {
  return key('identity', client, externalOrgId, externalUserId);
}
function tenantMappingId(client, externalOrgId) {
  return key('tenant', client, externalOrgId);
}
function deliveryId(tenantId, clientId) {
  return key('delivery', tenantId, clientId);
}
function evidenceId(tenantId, caseId, id) {
  return key('evidence', tenantId, caseId, id);
}

class WorkbenchStore {
  constructor({ conversationsDb, identityDb, deliveryDb, evidenceDb }) {
    this.conversationsDb = conversationsDb;
    this.identityDb = identityDb;
    this.deliveryDb = deliveryDb;
    this.evidenceDb = evidenceDb;
  }

  async linkConversation(input) {
    const _id = conversationId(input.tenantId, input.client, input.conversationId);
    let existing = null;
    try {
      existing = await this.conversationsDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (existing && existing.cetCaseId !== input.cetCaseId && !input.overwrite) {
      conflict('Conversation already linked to a different CET case');
    }
    const timestamp = now();
    const doc = {
      ...(existing || {}),
      _id,
      type: 'workbench_conversation',
      tenantId: input.tenantId,
      client: input.client,
      externalConversationId: input.conversationId,
      openWebuiConversationId: input.openWebuiConversationId || input.conversationId,
      openWebuiUserId: input.openWebuiUserId || existing?.openWebuiUserId || null,
      openWebuiOrgId: input.openWebuiOrgId || existing?.openWebuiOrgId || null,
      cetCaseId: input.cetCaseId,
      caseStateVersion: input.caseStateVersion || existing?.caseStateVersion || 1,
      clientId: input.clientId || existing?.clientId || null,
      lastEventCursor: input.lastEventCursor || existing?.lastEventCursor || null,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const saved = await this.conversationsDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async resolveConversation(input, { optional = false } = {}) {
    try {
      const doc = await this.conversationsDb.get(
        conversationId(input.tenantId, input.client, input.conversationId)
      );
      if (doc.enabled === false) disabled('Conversation mapping disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Conversation mapping not found');
      throw e;
    }
  }

  async saveTenantMapping(input) {
    const _id = tenantMappingId(input.client, input.externalOrgId);
    let existing = null;
    try {
      existing = await this.identityDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = {
      ...(existing || {}),
      _id,
      type: 'workbench_tenant_mapping',
      client: input.client,
      externalOrgId: input.externalOrgId,
      cetTenantId: input.cetTenantId,
      defaultClientId: input.defaultClientId || existing?.defaultClientId || null,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const saved = await this.identityDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async saveUserMapping(input) {
    const _id = identityId(input.client, input.externalOrgId, input.externalUserId);
    let existing = null;
    try {
      existing = await this.identityDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = {
      ...(existing || {}),
      _id,
      type: 'workbench_user_mapping',
      client: input.client,
      externalOrgId: input.externalOrgId,
      externalUserId: input.externalUserId,
      cetTenantId: input.cetTenantId,
      cetActorId: input.cetActorId,
      roles: [...new Set(input.roles || [])],
      sensitivityClearance: [...new Set(input.sensitivityClearance || [])],
      defaultClientId: input.defaultClientId || existing?.defaultClientId || null,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const saved = await this.identityDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getUserMapping(input, { optional = false } = {}) {
    const _id = identityId(input.client, input.externalOrgId, input.externalUserId);
    try {
      const doc = await this.identityDb.get(_id);
      if (doc.enabled === false) disabled('User mapping disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('User mapping not found');
      throw e;
    }
  }

  async registerDeliveryClient(input) {
    const _id = deliveryId(input.tenantId, input.clientId);
    let existing = null;
    try {
      existing = await this.deliveryDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = {
      ...(existing || {}),
      _id,
      type: 'workbench_delivery_client',
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientType: input.clientType || 'open-webui',
      deliveryMode: input.deliveryMode || 'poll',
      ackMode: input.ackMode || 'explicit',
      eventTypes: input.eventTypes || [],
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const saved = await this.deliveryDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getDeliveryClient(input, { optional = true } = {}) {
    try {
      const doc = await this.deliveryDb.get(deliveryId(input.tenantId, input.clientId));
      if (doc.enabled === false) disabled('Delivery client disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Delivery client not found');
      throw e;
    }
  }

  async findEvidenceByFingerprint(input) {
    const rows = await this.evidenceDb.allDocs({ include_docs: true });
    return rows.rows
      .map((r) => r.doc)
      .find(
        (doc) =>
          doc.tenantId === input.tenantId &&
          doc.caseId === input.caseId &&
          doc.sourceFingerprint &&
          doc.sourceFingerprint === input.sourceFingerprint
      );
  }

  async saveEvidence(input) {
    const existing = input.sourceFingerprint ? await this.findEvidenceByFingerprint(input) : null;
    if (existing && !input.forceNewVersion) {
      return { ...existing, duplicate: true, duplicateOf: existing.evidenceId };
    }
    const _id = evidenceId(input.tenantId, input.caseId, input.evidenceId);
    const timestamp = now();
    const doc = {
      _id,
      type: 'workbench_evidence_ref',
      tenantId: input.tenantId,
      actorId: input.actorId,
      caseId: input.caseId,
      evidenceId: input.evidenceId,
      evidenceType: input.evidenceType,
      label: input.label,
      description: input.description || null,
      safeSummary: input.safeSummary || null,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef || {},
      extracts: input.extracts || {},
      sensitivityLevel: input.sensitivityLevel || 'tenant_internal',
      status: input.status || 'attached',
      hash: input.hash || null,
      fileHash: input.fileHash || null,
      hashStatus: input.hashStatus || (input.fileHash ? 'provided' : 'unavailable'),
      sourceFingerprint: input.sourceFingerprint || null,
      provenance: input.provenance || null,
      evidenceRole: input.evidenceRole || 'supporting_evidence',
      claimStrength: input.claimStrength || 'reference',
      readinessReviewRequired: !!input.readinessReviewRequired,
      routingSignals: input.routingSignals || [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const saved = await this.evidenceDb.put(doc);
    return { ...doc, _rev: saved.rev, duplicate: false };
  }

  async listEvidence(input) {
    const rows = await this.evidenceDb.allDocs({ include_docs: true });
    return rows.rows
      .map((r) => r.doc)
      .filter((doc) => doc.tenantId === input.tenantId && doc.caseId === input.caseId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

module.exports = { WorkbenchStore };
