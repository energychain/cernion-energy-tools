'use strict';

const { randomUUID } = require('node:crypto');
const { principal, deny } = require('./domain-router-policy');
const { getFunctionModel } = require('./function-model');

const display = require('./project-skill-display');
async function projectSkills(ctx, projectId) {
  const p = principal(ctx);
  const project = await ctx.call('project-file.get', { projectId });
  if (
    project.tenantId !== p.tenantId ||
    !['ready', 'degraded'].includes(project.lifecycle) ||
    project.deletion
  )
    deny('Project unavailable');
  const store = ctx.broker.getLocalService('workbench')?.store;
  if (!store) return [];
  return store.listPlaybooks({ tenantId: p.tenantId, projectId });
}
async function save(ctx, skill, kind, reason) {
  principal(ctx);
  return ctx.call(
    'project-file.ingestMutation',
    {
      projectId: skill.projectId,
      work: () => persistSkill(ctx, skill, kind, reason),
    },
    {
      meta: {
        ...ctx.meta,
        projectIngest: require('./project-file-ingest-policy').ingestCapability,
      },
      timeout: 0,
    }
  );
}
async function persistSkill(ctx, skill, kind, reason) {
  const p = principal(ctx);
  if (skill.tenantId !== p.tenantId) deny('Skill tenant mismatch');
  await projectSkills(ctx, skill.projectId);
  const store = ctx.broker.getLocalService('workbench').store;
  const saved = await store.saveProjectSkill({
    ...skill,
    reason,
    updatedAt: new Date().toISOString(),
  });
  if (kind && saved.lifecycle === 'active' && !ctx.broker.getLocalService('journal')) {
    await store.saveProjectSkill({ ...saved, lifecycle: 'draft', reason: 'journal_unavailable' });
    throw new Error('Journal required before activation');
  }
  if (kind && ctx.broker.getLocalService('journal')) {
    const functionId = getFunctionModel().functions.find((fn) =>
      fn.capabilities?.includes('project_skill_learning')
    )?.functionId;
    if (!functionId) throw new Error('Project skill function identity missing');
    try {
      await ctx.call('journal.append', {
        entryId: `project-skill-${randomUUID()}`,
        functionId,
        kind,
        summary:
          `Check „${skill.title}“: ${display.lifecycles[skill.lifecycle]}; ${display.reasons[reason] || reason}`.slice(
            0,
            280
          ),
        refs: [{ kind: 'projectSkill', id: skill.skillId, projectId: skill.projectId }],
      });
    } catch (error) {
      if (saved.lifecycle === 'active')
        await store.saveProjectSkill({
          ...saved,
          lifecycle: 'draft',
          reason: 'journal_unavailable',
        });
      throw error;
    }
  }
  await ctx.broker.emit(
    'project.skill.lifecycle.v1',
    {
      tenantId: p.tenantId,
      projectId: skill.projectId,
      skillId: skill.skillId,
      lifecycle: skill.lifecycle,
      reason,
    },
    { meta: ctx.meta }
  );
  return saved;
}
function validateSkillCorrection(c) {
  if (
    !c ||
    Object.keys(c).some(
      (key) => !['projectId', 'skillId', 'kind', 'destinationProjectId'].includes(key)
    ) ||
    !['projectId', 'skillId'].every(
      (key) => typeof c[key] === 'string' && c[key].length > 0 && c[key].length <= 200
    ) ||
    !['incorrect', 'retire', 'transfer'].includes(c.kind)
  )
    deny('Invalid project skill correction');
  if (
    c.kind === 'transfer' &&
    (typeof c.destinationProjectId !== 'string' ||
      !c.destinationProjectId ||
      c.destinationProjectId.length > 200 ||
      c.destinationProjectId === c.projectId)
  )
    deny('Invalid destination project');
  return { ...c };
}
module.exports = { projectSkills, save, validateSkillCorrection };
