'use strict';

// Domain pack „Unternehmenswissen" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.wissen',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/unternehmenswissen'))],
};
