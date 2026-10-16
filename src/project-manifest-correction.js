'use strict';

const { deny } = require('./domain-router-policy');

function validateManifestCorrection(c) {
  if (
    !c ||
    Object.keys(c).some(
      (key) => !['projectId', 'questionTypeId', 'kind', 'nodeId', 'name'].includes(key)
    ) ||
    typeof c.projectId !== 'string' ||
    !c.projectId.length ||
    c.projectId.length > 200 ||
    !['reject', 'confirm', 'entity'].includes(c.kind)
  )
    deny('Invalid project manifest correction');
  for (const key of ['questionTypeId', 'nodeId', 'name'])
    if (
      c[key] !== undefined &&
      (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 200)
    )
      deny('Invalid project manifest correction field');
  if (c.kind === 'entity' && (!c.nodeId || !c.name))
    deny('Manifest entity correction needs node and name');
  return { ...c };
}

module.exports = { validateManifestCorrection };
