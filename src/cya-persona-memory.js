'use strict';

const { getPersona } = require('./cya-agent-personas');

/**
 * Retrieve persona-specific memory from the Object Store.
 * Queries the persona's dedicated namespace for recent context documents.
 * Returns empty memoryContext on any error (non-blocking — missing memory
 * never blocks the multi-agent orchestration).
 *
 * @param {import('moleculer').Context} ctx
 * @param {string} personaId - Persona ID (technical, commercial, compliance)
 * @param {{ tags?: string[], limit?: number }} [options]
 * @returns {Promise<{ personaId: string, memories: Object[] }>}
 */
async function retrievePersonaContext(ctx, personaId, options = {}) {
  const persona = getPersona(personaId);
  if (!persona) return { personaId, memories: [] };

  const limit = options.limit || 5;

  try {
    const result = await ctx.call('object-store.query', {
      namespace: persona.objectStoreNamespace,
      selector: options.tags?.length
        ? { tags: { $elemMatch: { $in: options.tags } } }
        : {},
      limit,
      sort: [{ createdAt: 'desc' }],
    });
    const memories = Array.isArray(result?.items) ? result.items.slice(0, limit) : [];
    return { personaId, memories };
  } catch {
    // Non-blocking: empty memory is valid; fresh personas have no prior context
    return { personaId, memories: [] };
  }
}

/**
 * Format memory context entries into a compact prompt-friendly string.
 * Returns empty string if no memories are available.
 *
 * @param {{ personaId: string, memories: Object[] }} memoryContext
 * @returns {string}
 */
function formatMemoryForPrompt(memoryContext) {
  const memories = memoryContext?.memories || [];
  if (memories.length === 0) return '';

  const lines = memories.slice(0, 5).map((m, i) => {
    const payload = m.payload || m;
    const summary =
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload).slice(0, 200);
    return `[Erinnerung ${i + 1}] ${summary}`;
  });

  return `Frühere Erfahrungen dieser Perspektive:\n${lines.join('\n')}`;
}

/**
 * Augment a baseline grounding with persona-specific memory context.
 * The memory hint is injected as `personaMemoryHint` for the LLM prompt builder
 * in cya-synthesis.js. If no memories are available the baseline is returned
 * unchanged (except for the `personaId` tag).
 *
 * @param {Object} baseline - Base grounding from buildGrounding()
 * @param {{ personaId: string, memories: Object[] }} memoryContext
 * @param {string} personaId
 * @returns {Object} Augmented grounding
 */
function buildPersonaGrounding(baseline, memoryContext, personaId) {
  const memoryPrompt = formatMemoryForPrompt(memoryContext);

  return {
    ...baseline,
    personaId,
    ...(memoryPrompt ? { personaMemoryHint: memoryPrompt } : {}),
  };
}

module.exports = {
  retrievePersonaContext,
  formatMemoryForPrompt,
  buildPersonaGrounding,
};
