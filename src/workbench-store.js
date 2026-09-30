'use strict';

const { randomBytes } = require('node:crypto');
const { Errors } = require('moleculer');

const now = () => new Date().toISOString();
const randomSuffix = () => randomBytes(4).toString('hex');
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
function turnMemoryId(tenantId, caseId) {
  return key('turn-memory', tenantId, caseId);
}
function userContextId(tenantId, actorId) {
  return key('user-context', tenantId, actorId);
}
function workspaceContextId(tenantId, client, workspaceId) {
  return key('workspace-context', tenantId, client, workspaceId);
}
function contextRefId(tenantId, contextRefIdValue) {
  return key('context-ref', tenantId, contextRefIdValue);
}
function playbookId(tenantId, id) {
  return key('playbook', tenantId, id);
}
function inboxTaskId(tenantId, id) {
  return key('inbox-task', tenantId, id);
}
function toolRunId(tenantId, id) {
  return key('tool-run', tenantId, id);
}
function mailAccountId(tenantId, id) {
  return key('mail-account', tenantId, id);
}
function williMappingId(tenantId, mandantId, userKey) {
  return key('willi-mako-mapping', tenantId, mandantId, userKey);
}
function williEmailIndexId(tenantId, mandantId, email) {
  return key('willi-mako-email-index', tenantId, mandantId, email);
}
function williRoleAlignmentId(tenantId, profile) {
  return key('willi-mako-role-alignment', tenantId, profile);
}

class WorkbenchStore {
  constructor({
    conversationsDb,
    identityDb,
    deliveryDb,
    evidenceDb,
    turnMemoryDb,
    contextDb,
    playbookDb,
    inboxDb,
    toolRunDb,
    mailAccountDb,
  }) {
    this.conversationsDb = conversationsDb;
    this.identityDb = identityDb;
    this.deliveryDb = deliveryDb;
    this.evidenceDb = evidenceDb;
    this.turnMemoryDb = turnMemoryDb || conversationsDb;
    this.contextDb = contextDb || conversationsDb;
    this.playbookDb = playbookDb || conversationsDb;
    this.inboxDb = inboxDb || conversationsDb;
    this.toolRunDb = toolRunDb || conversationsDb;
    this.mailAccountDb = mailAccountDb || conversationsDb;
  }

  async linkConversation(input) {
    const _id = conversationId(input.tenantId, input.client, input.conversationId);
    let existing = null;
    try {
      existing = await this.conversationsDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (existing?.cetCaseId && existing.cetCaseId !== input.cetCaseId && !input.overwrite) {
      conflict('Conversation already linked to a different CET case');
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_conversation',
      tenantId: input.tenantId,
      client: input.client,
      externalConversationId: input.conversationId,
      openWebuiConversationId: input.openWebuiConversationId || input.conversationId,
      openWebuiUserId: input.openWebuiUserId || existing?.openWebuiUserId || null,
      openWebuiOrgId: input.openWebuiOrgId || existing?.openWebuiOrgId || null,
      cetCaseId: input.cetCaseId || existing?.cetCaseId || null,
      caseStateVersion: input.caseStateVersion || existing?.caseStateVersion || 1,
      clientId: input.clientId || existing?.clientId || null,
      lastEventCursor: input.lastEventCursor || existing?.lastEventCursor || null,
      mappingState:
        input.cetCaseId || existing?.cetCaseId ? 'linked' : existing?.mappingState || 'pending',
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    try {
      const saved = await this.conversationsDb.put(doc);
      return { ...doc, _rev: saved.rev };
    } catch (e) {
      if (e.status !== 409) throw e;
      const latest = await this.conversationsDb.get(_id);
      if (latest?.cetCaseId && latest.cetCaseId !== input.cetCaseId && !input.overwrite) {
        conflict('Conversation already linked to a different CET case');
      }
      return this.linkConversation({ ...input, overwrite: input.overwrite || !latest?.cetCaseId });
    }
  }

  async reserveConversation(input) {
    const _id = conversationId(input.tenantId, input.client, input.conversationId);
    const timestamp = now();
    const doc = {
      _id,
      type: 'workbench_conversation',
      tenantId: input.tenantId,
      client: input.client,
      externalConversationId: input.conversationId,
      openWebuiConversationId: input.openWebuiConversationId || input.conversationId,
      openWebuiUserId: input.openWebuiUserId || null,
      openWebuiOrgId: input.openWebuiOrgId || null,
      cetCaseId: null,
      caseStateVersion: 0,
      clientId: input.clientId || null,
      lastEventCursor: null,
      mappingState: 'classifying',
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      const saved = await this.conversationsDb.put(doc);
      return { reserved: true, mapping: { ...doc, _rev: saved.rev } };
    } catch (e) {
      if (e.status !== 409) throw e;
      const existing = await this.conversationsDb.get(_id);
      if (existing.enabled === false) disabled('Conversation mapping disabled');
      return { reserved: false, mapping: existing };
    }
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
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_tenant_mapping',
      client: input.client,
      externalOrgId: input.externalOrgId,
      cetTenantId: input.cetTenantId,
      defaultClientId: input.defaultClientId || existing?.defaultClientId || null,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.identityDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getTenantMapping(input, { optional = false } = {}) {
    const _id = tenantMappingId(input.client, input.externalOrgId);
    try {
      const doc = await this.identityDb.get(_id);
      if (doc.enabled === false) disabled('Tenant mapping disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Tenant mapping not found');
      throw e;
    }
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
    const doc = Object.assign(existing ? { ...existing } : {}, {
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
    });
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

  async saveWilliRoleAlignment(input) {
    const _id = williRoleAlignmentId(input.cetTenantId, input.williRoleProfile);
    let existing = null;
    try {
      existing = await this.identityDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_willi_role_alignment',
      provider: input.provider || 'willi-mako',
      cetTenantId: input.cetTenantId,
      williRoleProfile: input.williRoleProfile,
      roles: input.roles || [],
      sensitivityClearance: input.sensitivityClearance || [],
      description: input.description || existing?.description || null,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: input.updatedBy || existing?.updatedBy || null,
    });
    const saved = await this.identityDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getWilliRoleAlignment(input, { optional = true } = {}) {
    try {
      const doc = await this.identityDb.get(
        williRoleAlignmentId(input.cetTenantId, input.williRoleProfile)
      );
      if (doc.enabled === false) disabled('Willi-MaKo role alignment disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Willi-MaKo role alignment not found');
      throw e;
    }
  }

  async listWilliRoleAlignments(input) {
    const rows = await this.identityDb.allDocs({ include_docs: true });
    return rows.rows
      .map((row) => row.doc)
      .filter(
        (doc) =>
          doc.type === 'workbench_willi_role_alignment' && doc.cetTenantId === input.cetTenantId
      )
      .sort((a, b) => String(a.williRoleProfile).localeCompare(String(b.williRoleProfile)));
  }

  async saveWilliMapping(input) {
    const userKey = input.williUserId || `email:${input.externalEmailNorm}`;
    const _id = williMappingId(input.cetTenantId, input.williMandantId, userKey);
    let existing = null;
    try {
      existing = await this.identityDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_willi_mapping',
      provider: input.provider || 'willi-mako',
      williMandantId: input.williMandantId,
      externalOrgId: input.externalOrgId || input.williMandantId,
      williUserId: input.williUserId || null,
      externalUserId: input.externalUserId || input.williUserId || null,
      externalEmailNorm: input.externalEmailNorm || null,
      cetTenantId: input.cetTenantId,
      cetActorId: input.cetActorId,
      roles: input.roles || [],
      sensitivityClearance: input.sensitivityClearance || [],
      williRoleProfile: input.williRoleProfile || 'normal_user',
      isWilliStaff: !!input.isWilliStaff,
      williSessionId: input.williSessionId || null,
      cetCaseId: input.cetCaseId || null,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      createdBy: existing?.createdBy || input.createdBy || null,
      updatedBy: input.updatedBy || null,
    });
    const saved = await this.identityDb.put(doc);
    const withRev = { ...doc, _rev: saved.rev };
    if (doc.externalEmailNorm) {
      await this.saveWilliEmailIndex(withRev);
    }
    return withRev;
  }

  async saveWilliEmailIndex(mapping) {
    const _id = williEmailIndexId(
      mapping.cetTenantId,
      mapping.williMandantId,
      mapping.externalEmailNorm
    );
    let existing = null;
    try {
      existing = await this.identityDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_willi_email_index',
      cetTenantId: mapping.cetTenantId,
      williMandantId: mapping.williMandantId,
      externalEmailNorm: mapping.externalEmailNorm,
      mappingId: mapping._id,
      enabled: mapping.enabled !== false,
      updatedAt: now(),
      createdAt: existing?.createdAt || mapping.createdAt || now(),
    });
    await this.identityDb.put(doc);
  }

  async getWilliMapping(input, { optional = false } = {}) {
    let mappingId = null;
    if (input.williUserId) {
      mappingId = williMappingId(input.cetTenantId, input.williMandantId, input.williUserId);
    } else if (input.externalEmailNorm) {
      try {
        const index = await this.identityDb.get(
          williEmailIndexId(input.cetTenantId, input.williMandantId, input.externalEmailNorm)
        );
        if (index.enabled === false) disabled('Willi-MaKo mapping disabled');
        mappingId = index.mappingId;
      } catch (e) {
        if (e.status === 404 && optional) return null;
        if (e.status === 404) notFound('Willi-MaKo mapping not found');
        throw e;
      }
    }
    if (!mappingId) notFound('Willi-MaKo mapping not found');
    try {
      const doc = await this.identityDb.get(mappingId);
      if (doc.enabled === false) disabled('Willi-MaKo mapping disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Willi-MaKo mapping not found');
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
    const doc = Object.assign(existing ? { ...existing } : {}, {
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
    });
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

  async saveUserContext(input) {
    const _id = userContextId(input.tenantId, input.actorId);
    let existing = null;
    try {
      existing = await this.contextDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_user_context',
      tenantId: input.tenantId,
      actorId: input.actorId,
      externalClientRefs: input.externalClientRefs || existing?.externalClientRefs || [],
      roleFamilies: input.roleFamilies || existing?.roleFamilies || [],
      domainsAllowed: input.domainsAllowed || existing?.domainsAllowed || [],
      sensitivityClearance: input.sensitivityClearance || existing?.sensitivityClearance || [],
      language: input.language || existing?.language || null,
      tone: input.tone || existing?.tone || null,
      defaultNoCallGuards: input.defaultNoCallGuards || existing?.defaultNoCallGuards || [],
      defaultEscalationRules:
        input.defaultEscalationRules || existing?.defaultEscalationRules || [],
      preferredEvidenceHandling:
        input.preferredEvidenceHandling || existing?.preferredEvidenceHandling || [],
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.contextDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getUserContext(input, { optional = true } = {}) {
    try {
      const doc = await this.contextDb.get(userContextId(input.tenantId, input.actorId));
      if (doc.enabled === false) disabled('User context disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Workbench user context not found');
      throw e;
    }
  }

  async saveWorkspaceContext(input) {
    const _id = workspaceContextId(input.tenantId, input.client, input.workspaceId);
    let existing = null;
    try {
      existing = await this.contextDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_workspace_context',
      tenantId: input.tenantId,
      client: input.client,
      workspaceId: input.workspaceId,
      externalWorkspaceRef: input.externalWorkspaceRef || existing?.externalWorkspaceRef || null,
      allowedDomains: input.allowedDomains || existing?.allowedDomains || [],
      defaultDeliveryClientId:
        input.defaultDeliveryClientId || existing?.defaultDeliveryClientId || null,
      defaultPlaybooks: input.defaultPlaybooks || existing?.defaultPlaybooks || [],
      workspaceNoCallGuards: input.workspaceNoCallGuards || existing?.workspaceNoCallGuards || [],
      sensitivityBoundary:
        input.sensitivityBoundary || existing?.sensitivityBoundary || 'tenant_internal',
      caseVisibilityPolicy:
        input.caseVisibilityPolicy || existing?.caseVisibilityPolicy || 'tenant',
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.contextDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getWorkspaceContext(input, { optional = true } = {}) {
    try {
      const doc = await this.contextDb.get(
        workspaceContextId(input.tenantId, input.client, input.workspaceId)
      );
      if (doc.enabled === false) disabled('Workspace context disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Workbench workspace context not found');
      throw e;
    }
  }

  async saveContextRef(input) {
    const id = input.contextRefId || `ctx_${Date.now()}_${randomSuffix()}`;
    const _id = contextRefId(input.tenantId, id);
    const timestamp = now();
    const doc = {
      _id,
      type: 'workbench_context_ref',
      tenantId: input.tenantId,
      actorId: input.actorId,
      contextRefId: id,
      contextType: input.contextType,
      purpose: input.purpose || 'routing_context',
      label: input.label,
      sourceRef: input.sourceRef || {},
      sensitivityLevel: input.sensitivityLevel || 'tenant_internal',
      safeSummary: input.safeSummary || null,
      provenance: input.provenance || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const saved = await this.contextDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async savePlaybook(input) {
    const _id = playbookId(input.tenantId, input.playbookId);
    let existing = null;
    try {
      existing = await this.playbookDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_playbook',
      tenantId: input.tenantId,
      playbookId: input.playbookId,
      title: input.title,
      scope: input.scope || 'tenant',
      domain: input.domain || 'governance',
      workspaceId: input.workspaceId || null,
      roleFamilies: input.roleFamilies || [],
      version: input.version || (existing?.version || 0) + 1,
      status: input.status || existing?.status || 'draft',
      routingSignals: input.routingSignals || [],
      requiredEvidence: input.requiredEvidence || [],
      allowedActions: input.allowedActions || [],
      blockedActions: input.blockedActions || [],
      noCallGuards: input.noCallGuards || [],
      handoffRules: input.handoffRules || [],
      eventRules: input.eventRules || [],
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.playbookDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async listPlaybooks(input) {
    const rows = await this.playbookDb.allDocs({ include_docs: true });
    return rows.rows
      .map((r) => r.doc)
      .filter((doc) => doc.tenantId === input.tenantId && doc.type === 'workbench_playbook')
      .filter((doc) => !input.domain || doc.domain === input.domain || doc.domain === 'governance')
      .sort((a, b) => String(a.playbookId).localeCompare(String(b.playbookId)));
  }

  async saveInboxTask(input) {
    const _id = inboxTaskId(input.tenantId, input.taskId);
    let existing = null;
    try {
      existing = await this.inboxDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, input, {
      _id,
      type: 'workbench_inbox_task',
      createdAt: existing?.createdAt || input.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.inboxDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getInboxTask(input, { optional = false } = {}) {
    try {
      return await this.inboxDb.get(inboxTaskId(input.tenantId, input.taskId));
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Workbench inbox task not found');
      throw e;
    }
  }

  async listInboxTasks(input) {
    const rows = await this.inboxDb.allDocs({ include_docs: true });
    return rows.rows
      .map((r) => r.doc)
      .filter((doc) => doc.tenantId === input.tenantId && doc.type === 'workbench_inbox_task')
      .filter(
        (doc) => !input.caseId || doc.caseId === input.caseId || doc.cetCaseId === input.caseId
      )
      .filter((doc) => !input.status || doc.status === input.status)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async saveTurnMemory(input) {
    const _id = turnMemoryId(input.tenantId, input.caseId);
    let existing = null;
    try {
      existing = await this.turnMemoryDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_turn_memory',
      tenantId: input.tenantId,
      caseId: input.caseId,
      actorId: input.actorId,
      caseStateVersion: input.caseStateVersion,
      memory: input.memory || {},
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.turnMemoryDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getTurnMemory(input, { optional = true } = {}) {
    try {
      const doc = await this.turnMemoryDb.get(turnMemoryId(input.tenantId, input.caseId));
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Workbench turn memory not found');
      throw e;
    }
  }

  async saveToolRun(input) {
    const id = input.toolRunId || `toolrun_${Date.now()}_${randomSuffix()}`;
    const _id = toolRunId(input.tenantId, id);
    const timestamp = now();
    const doc = Object.assign(input.existing ? { ...input.existing } : {}, {
      _id,
      type: 'workbench_tool_run',
      toolRunId: id,
      tenantId: input.tenantId,
      actorId: input.actorId,
      caseId: input.caseId,
      toolId: input.toolId,
      toolClass: input.toolClass,
      sideEffectClass: input.sideEffectClass,
      status: input.status || 'completed',
      inputSummary: input.inputSummary || null,
      outputSummary: input.outputSummary || null,
      evidenceRefs: input.evidenceRefs || [],
      receiptRefs: input.receiptRefs || [],
      blockedReason: input.blockedReason || null,
      auditRef: input.auditRef || null,
      startedAt: input.startedAt || timestamp,
      finishedAt: input.finishedAt || timestamp,
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.toolRunDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getToolRun(input, { optional = false } = {}) {
    try {
      return await this.toolRunDb.get(toolRunId(input.tenantId, input.toolRunId));
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Workbench tool run not found');
      throw e;
    }
  }

  async listToolRuns(input) {
    const rows = await this.toolRunDb.allDocs({ include_docs: true });
    return rows.rows
      .map((row) => row.doc)
      .filter((doc) => doc.tenantId === input.tenantId && doc.type === 'workbench_tool_run')
      .filter((doc) => !input.caseId || doc.caseId === input.caseId)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }

  async saveMailAccount(input) {
    const _id = mailAccountId(input.tenantId, input.mailAccountRef);
    let existing = null;
    try {
      existing = await this.mailAccountDb.get(_id);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const timestamp = now();
    const doc = Object.assign(existing ? { ...existing } : {}, {
      _id,
      type: 'workbench_mail_account',
      tenantId: input.tenantId,
      actorId: input.actorId,
      mailAccountRef: input.mailAccountRef,
      label: input.label,
      provider: input.provider || 'imap',
      driver: input.driver || 'himalaya',
      mode: input.mode || 'reference',
      folders: input.folders || ['INBOX'],
      allowedQueryPrefixes: input.allowedQueryPrefixes || [],
      encryptedSecret: input.encryptedSecret,
      secretFingerprint: input.secretFingerprint || null,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.mailAccountDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }

  async getMailAccount(input, { optional = false } = {}) {
    try {
      const doc = await this.mailAccountDb.get(mailAccountId(input.tenantId, input.mailAccountRef));
      if (doc.enabled === false) disabled('Mail account disabled');
      return doc;
    } catch (e) {
      if (e.status === 404 && optional) return null;
      if (e.status === 404) notFound('Workbench mail account not found');
      throw e;
    }
  }

  async listMailAccounts(input) {
    const rows = await this.mailAccountDb.allDocs({ include_docs: true });
    return rows.rows
      .map((row) => row.doc)
      .filter((doc) => doc.tenantId === input.tenantId && doc.type === 'workbench_mail_account')
      .filter((doc) => !input.enabledOnly || doc.enabled !== false)
      .sort((a, b) => String(a.mailAccountRef).localeCompare(String(b.mailAccountRef)));
  }

  async deleteMailAccount(input) {
    const existing = await this.getMailAccount(input);
    const timestamp = now();
    const doc = { ...existing, enabled: false, deletedAt: timestamp, updatedAt: timestamp };
    const saved = await this.mailAccountDb.put(doc);
    return { ...doc, _rev: saved.rev };
  }
}

module.exports = { WorkbenchStore };
