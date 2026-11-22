'use strict';

// Domain pack „Marktkommunikation und EDM" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.mako',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/marktkommunikation'))],
};
