'use strict';

const {
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  validateWorkOutLoudPayload,
} = require('../src/personal-agent-work-out-loud');

module.exports = {
  name: 'personal-agent-work-out-loud-listener',

  events: {
    [PERSONAL_AGENT_WORK_OUT_LOUD_EVENT]: {
      async handler(ctx) {
        await this.handleWorkOutLoudEvent(ctx.params);
      },
    },
  },

  methods: {
    async handleWorkOutLoudEvent(payload = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        this.logger?.warn('Rejected personal-agent.work-out-loud event: invalid payload shape');
        return null;
      }

      if (!payload.tenantId || typeof payload.tenantId !== 'string' || !payload.tenantId.trim()) {
        this.logger?.warn('Rejected personal-agent.work-out-loud event: missing or invalid tenantId');
        return null;
      }

      try {
        return validateWorkOutLoudPayload(payload);
      } catch (error) {
        this.logger?.warn(
          `Rejected personal-agent.work-out-loud event for tenantId=${payload.tenantId}: ${error.message}`
        );
        return null;
      }
    },
  },
};
