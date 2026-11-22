'use strict';

// Domain pack „Zielnetzplanung und Netzanschluss" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.netzplanung',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/netzplanung'))],
};
