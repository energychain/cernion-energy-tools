'use strict';

// Domain pack „Assetmanagement und Investition" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.asset',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/assetmanagement'))],
};
