'use strict';

const metrics = require('../src/metrics');

describe('metrics export', () => {
  beforeEach(() => {
    metrics.resetForTests();
  });

  it('renders custom metrics without tenantId labels', async () => {
    metrics.recordActionMetric({
      service: 'demo-service',
      action: 'demo.action',
      status: 'success',
      requestOrigin: 'internal',
      durationMs: 42,
    });
    metrics.recordRagQuery('tenant:abc:knowledge', 7);
    metrics.recordMastrDelta({ added: 1, changed: 0, removed: 0 });
    metrics.recordUtilityReportPhase('phase_3', 'success', 1200);
    metrics.recordRateLimitHit({ tenantId: 'tenant-alpha', endpointClass: 'compute' });
    metrics.recordQuotaUsage({
      tenantId: 'tenant-alpha',
      resource: 'llm_tokens_per_day',
      window: '2026-05-08',
      used: 321,
    });

    const output = await metrics.renderMetrics();

    expect(output).toContain('cernion_action_calls_total');
    expect(output).toContain('cernion_rag_query_hit_count');
    expect(output).toContain('cernion_mastr_delta_count');
    expect(output).toContain('cernion_utility_report_phase_duration_seconds');
    expect(output).toContain('cernion_rate_limit_hits');
    expect(output).toContain('cernion_quota_usage');
    expect(output).not.toContain('tenantId');
    expect(output).not.toContain('tenant:abc:knowledge');
    expect(output).not.toContain('tenant-alpha');
    expect(output).toContain('collection="tenant_scoped"');
    expect(output).not.toContain('{tenant=');
  });
});
