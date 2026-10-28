'use strict';

// Cold start (#997 step 5): answered knowledge needs prefill operation parameters of the same
// catalog name. A prefill is a known fact about the tenant, never a grant: reads still pass the
// unchanged policy, RBAC and domain checks.
const STATES = ['confirmed', 'answered'];

// Parameters that a tenant answer could fill, from the generated register (static data).
let prefillKeys;
function knowledgeKeys() {
  prefillKeys ||= new Set(
    require('../knowledge-needs.json')
      .needs.filter((need) => need.kind !== 'dataset' && need.kind !== 'contact')
      .map((need) => need.key)
  );
  return prefillKeys;
}

async function tenantKnowledge(ctx, tenantId, candidates = []) {
  // A local read of the caller's own tenant register, not an additional backend call.
  const register = ctx.broker?.getLocalService?.('knowledge-needs');
  if (typeof register?.answeredNeeds !== 'function' || !tenantId) return [];
  const keys = knowledgeKeys();
  // Only consult the register when an offered operation declares such a parameter.
  if (
    !candidates.some((candidate) =>
      Object.keys(candidate.schema?.properties || {}).some((name) => keys.has(name))
    )
  )
    return [];
  try {
    const needs = await register.answeredNeeds(tenantId);
    return needs
      .filter((need) => STATES.includes(need.state) && need.kind !== 'dataset')
      .map((need) => {
        const answer = [...(need.answers || [])]
          .filter((entry) => typeof entry.value === 'string' && entry.value.trim())
          .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
        return answer
          ? {
              key: need.key,
              label: need.label,
              value: answer.value,
              needId: need.needId,
              answerId: answer.answerId,
            }
          : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Fill only parameters the schema declares and the planner left empty.
function prefill(input, schema, knowledge) {
  const properties = schema?.properties || {};
  const filled = [];
  const result = { ...input };
  for (const fact of knowledge) {
    const property = properties[fact.key];
    if (!property || (result[fact.key] !== undefined && result[fact.key] !== '')) continue;
    if (property.type && property.type !== 'string') continue;
    result[fact.key] = fact.value;
    filled.push({ parameter: fact.key, needId: fact.needId, answerId: fact.answerId });
  }
  return { input: result, filled };
}

module.exports = { tenantKnowledge, prefill };
