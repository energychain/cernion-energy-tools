'use strict';

// Public action names from #693/#697; execution remains protected on
// shared-service-agent. Forward the caller's authenticated context unchanged.
module.exports = {
  name: 'agents',
  actions: {
    list: {
      handler(ctx) {
        return ctx.call('shared-service-agent.list', ctx.params);
      },
    },
    get: {
      handler(ctx) {
        return ctx.call('shared-service-agent.get', ctx.params);
      },
    },
    retire: {
      handler(ctx) {
        return ctx.call('shared-service-agent.retire', ctx.params);
      },
    },
  },
};
