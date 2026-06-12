'use strict';

const {
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  validateWorkOutLoudPayload,
} = require('../src/personal-agent-work-out-loud');

// Signal types that represent a newly-learned structured fact (as opposed to,
// e.g., bootstrap_context_updated, which only reflects an organization-level
// classification). Only these can resolve an open evidence requirement.
const FACT_LEARNING_SIGNAL_TYPES = new Set([
  WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
  WORK_OUT_LOUD_SIGNAL_TYPES.ONBOARDING_FACT_LEARNED,
]);

function isEvidenceRevalidationUnavailable(error) {
  return (
    error?.code === 404 ||
    error?.type === 'SERVICE_NOT_FOUND' ||
    error?.type === 'SERVICE_NOT_AVAILABLE' ||
    error?.name === 'ServiceNotFoundError'
  );
}

module.exports = {
  name: 'personal-agent-work-out-loud-listener',

  events: {
    [PERSONAL_AGENT_WORK_OUT_LOUD_EVENT]: {
      async handler(ctx) {
        const validated = await this.handleWorkOutLoudEvent(ctx.params);
        if (validated) {
          await this.triggerEvidenceRevalidationIfLearned(ctx, validated);
        }
        return validated;
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
        this.logger?.warn(
          'Rejected personal-agent.work-out-loud event: missing or invalid tenantId'
        );
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

    /**
     * For fact-learning signals (scoped_fact_learned / onboarding_fact_learned)
     * with a safe `evidence.contextField`, ask evidence-revalidation whether
     * this newly-learned fact resolves an open requirement from another
     * (origin) session — so the origin session gets notified automatically.
     *
     * Only the validated tenantId and the safe field *name* are forwarded —
     * never the learned value, never signal.value, never prompt/answer text.
     * Failures (including the service being unavailable) are fail-open: they
     * are logged and otherwise ignored so the originating chat turn is never
     * affected by this side channel.
     */
    async triggerEvidenceRevalidationIfLearned(ctx, payload) {
      if (!FACT_LEARNING_SIGNAL_TYPES.has(payload?.signal?.type)) {
        return;
      }

      const requestedFact = payload?.evidence?.contextField;
      if (typeof requestedFact !== 'string' || !requestedFact.trim()) {
        return;
      }

      const tenantId = payload.tenantId;

      try {
        await ctx.call(
          'evidence-revalidation.correlateFact',
          { tenantId, requestedFact },
          { meta: { tenantId, $gateway: false } }
        );
      } catch (error) {
        if (isEvidenceRevalidationUnavailable(error)) {
          this.logger?.warn(
            `evidence-revalidation unavailable while handling personal-agent.work-out-loud for tenantId=${tenantId}, requestedFact=${requestedFact}: ${error.message}`
          );
          return;
        }

        this.logger?.warn(
          `evidence-revalidation.correlateFact failed while handling personal-agent.work-out-loud for tenantId=${tenantId}, requestedFact=${requestedFact}: ${error.message}`
        );
      }
    },
  },
};
