'use strict';

// Domain pack „Energiebeschaffung und Portfolio" of the micro-agent tier; the subject matter is in the pack module.
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');

module.exports = {
  name: 'micro-agent.beschaffung',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/beschaffung'))],
};
