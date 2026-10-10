'use strict';

const { principal, deny } = require('./domain-router-policy');
const { resolveFunctionId, getFunction } = require('./function-model');

const kinds = new Set(['retain', 'unretain', 'pin', 'unpin']);
function correctionPrincipal(event, meta) {
  const p = principal({ meta }, event);
  if (event.actorId !== p.actorId) deny('Actor mismatch');
  if (
    ['pin', 'unpin'].includes(event.correction?.kind) &&
    !p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(r))
  )
    deny('Admin role required');
  return p;
}
function validateCorrection(input, model) {
  const allowed = {
    coverage: ['functionId', 'score'],
    activation: ['functionId', 'cet'],
    agent: ['functionId', 'kind', 'factor'],
    neighbor: ['functionId', 'neighborId', 'weight'],
    gap: ['functionId', 'gapRef', 'contentHash', 'kind'],
  };
  const fields = allowed[input.target];
  const c = input.correction;
  if (!fields || !c || Object.keys(c).some((key) => !fields.includes(key)))
    deny('Unsupported correction fields');
  const resolve = (id) => {
    const resolutions = resolveFunctionId(id, { model });
    const rows = getFunction(id, { model })
      ? resolutions.filter((row) => row.functionId === id)
      : resolutions;
    if (rows.length !== 1) deny('Unresolved or ambiguous function');
    return rows[0].functionId;
  };
  const result = { ...c, functionId: resolve(c.functionId || input.ref) };
  if (input.target === 'coverage' && (!Number.isFinite(c.score) || c.score < 0 || c.score > 1))
    deny('Invalid coverage score');
  if (input.target === 'activation' && typeof c.cet !== 'boolean') deny('Invalid responsibility');
  if (
    input.target === 'agent' &&
    (!kinds.has(c.kind) || (c.factor !== undefined && (!Number.isFinite(c.factor) || c.factor < 1)))
  )
    deny('Invalid agent correction');
  if (
    input.target === 'gap' &&
    (!['gap_done', 'gap_ignore'].includes(c.kind) ||
      typeof c.gapRef !== 'string' ||
      !c.gapRef ||
      c.gapRef.length > 256 ||
      typeof c.contentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(c.contentHash))
  )
    deny('Invalid gap correction');
  if (input.target === 'neighbor') {
    result.neighborId = resolve(c.neighborId);
    if (
      result.neighborId === result.functionId ||
      !Number.isFinite(c.weight) ||
      c.weight < 0 ||
      c.weight > 1
    )
      deny('Invalid neighbor correction');
  }
  return result;
}
module.exports = { correctionPrincipal, validateCorrection };
