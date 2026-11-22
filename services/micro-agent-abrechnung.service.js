'use strict';

// Domain pack „Abrechnung und Netzentgelte" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.abrechnung',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/abrechnung'))],
};
