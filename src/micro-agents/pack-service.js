'use strict';

/**
 * Service factory of a domain pack (micro-agent tier). A pack is data plus behaviour:
 * - `packs/<area>.json`: label, description, link to the function model, object kinds; a kind
 *   names its format detector from `packs/detectors.js` by key;
 * - `packs/<area>.expanders.js` (optional): `{ expanders, playbooks }`.
 * A service file is one line: `module.exports = packService('<area>');`.
 */

const path = require('node:path');
const fs = require('node:fs');
const { createDomainPackMixin } = require('./pack-mixin');

const PACK_DIR = path.join(__dirname, 'packs');

function packDefinition(area, { dir = PACK_DIR } = {}) {
  const definition = JSON.parse(fs.readFileSync(path.join(dir, `${area}.json`), 'utf8'));
  const detectors = require(path.join(dir, 'detectors.js'));
  const behaviourFile = path.join(dir, `${area}.expanders.js`);
  const behaviour = fs.existsSync(behaviourFile) ? require(behaviourFile) : {};
  return {
    ...definition,
    objectKinds: (definition.objectKinds || []).map(({ detector, ...kind }) => {
      if (detector && typeof detectors[detector] !== 'function')
        throw new Error(`Unknown detector ${detector} in pack ${definition.pack}`);
      return detector ? { ...kind, detect: detectors[detector] } : kind;
    }),
    expanders: behaviour.expanders || {},
    playbooks: behaviour.playbooks || [],
    ...(behaviour.timeoutMs ? { timeoutMs: behaviour.timeoutMs } : {}),
  };
}

function packService(area, options) {
  const definition = packDefinition(area, options);
  // An explicit (empty) actions map: tooling that rebuilds schemas ({ ...schema, actions })
  // keeps the mixin's actions instead of passing undefined to Moleculer.
  return {
    name: `micro-agent.${definition.pack}`,
    mixins: [createDomainPackMixin(definition)],
    actions: {},
  };
}

module.exports = { packService, packDefinition, PACK_DIR };
