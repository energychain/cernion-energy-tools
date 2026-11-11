'use strict';

// Conversation core (AP2): the understanding of the turn decides what happens, not wording in
// code. In core mode the regex intent routing and the direct evidence path stop deciding before
// the understanding; stored material becomes a tool of the content turn, whose answer uses it as
// evidence (gated for other conversations) instead of being replaced by it. Off by default;
// WORKBENCH_CONVERSATION_CORE enables it for all tenants ("all") or a comma-separated list.

function conversationCoreEnabled(tenantId, env = process.env) {
  const value = String(env.WORKBENCH_CONVERSATION_CORE || '').trim();
  if (!value) return false;
  if (['all', '1', 'true', 'on'].includes(value.toLowerCase())) return true;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .includes(String(tenantId || ''));
}

// Whether the understanding asks for stored material beyond this conversation.
function wantsStoredMaterial(situation = {}) {
  return Boolean(
    situation.selfKnowledge?.requested ||
    situation.caseSearch?.requested ||
    situation.contextScope === 'tenant'
  );
}

/**
 * Stored tenant material as evidence for the content turn. Material of another conversation is
 * labelled with its origin, so the cross-case gate judges it like every other foreign item.
 */
async function storedEvidence(service, ctx, { p, envelope, pending, meta, situation }) {
  if (!wantsStoredMaterial(situation)) return [];
  const safe = Object.assign(Object.create(ctx), {
    meta,
    call: (name, params, options) =>
      ctx.call(name, params, { ...options, meta: { ...meta, ...options?.meta } }),
  });
  let result = null;
  try {
    result = await require('./project-manifest-evidence').projectManifestAnswer(
      safe,
      envelope.userRequest,
      {
        routing: service.settings?.tenantEvidenceRouting,
        currentConversationId: envelope.conversationId,
        previousEvidence: {
          selection: pending?.tenantEvidenceSelection,
          question: pending?.tenantEvidenceQuestion || pending?.lastUserRequest,
        },
      }
    );
  } catch (error) {
    service.logger?.warn?.(`Conversation core stored evidence failed: ${error.message}`);
    return [];
  }
  return (result?.evidence || []).map((entry) => ({
    ...entry,
    metadata: {
      ...entry.metadata,
      ...(entry.metadata?.otherConversation ? { scopeOrigin: 'aus anderem Gespräch' } : {}),
    },
  }));
}

module.exports = { conversationCoreEnabled, storedEvidence, wantsStoredMaterial };
