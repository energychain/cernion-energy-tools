'use strict';

// Domain pack „Finanzen und Controlling" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.finanzen',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/finanzen'))],
};
