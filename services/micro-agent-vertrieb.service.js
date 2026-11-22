'use strict';

// Domain pack „Vertrieb, Marketing und Kunde" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.vertrieb',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/vertrieb'))],
};
