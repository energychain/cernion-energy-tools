'use strict';

// Domain pack „Netzbetrieb, Redispatch und Flexibilität" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.netzbetrieb',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/netzbetrieb'))],
};
