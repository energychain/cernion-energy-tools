'use strict';

const {
  SIGNAL_DISTURBANCE_PATTERN,
  SIGNAL_REPEATING_FAULT,
  buildSignalsFromEvents,
  buildInvestmentProposals,
} = require('../src/disturbance-schema');

describe('disturbance-schema', () => {
  it('builds disturbance and repeating fault signals for recurring grouped events', () => {
    const signals = buildSignalsFromEvents({
      now: '2026-05-01T00:00:00.000Z',
      minEvents: 3,
      windowDays: 90,
      events: [
        {
          sourceType: 'redispatch',
          timestamp: '2026-02-10T10:00:00.000Z',
          groupKey: 'redispatch:SNB:high',
          severity: 'high',
        },
        {
          sourceType: 'redispatch',
          timestamp: '2026-03-02T10:00:00.000Z',
          groupKey: 'redispatch:SNB:high',
          severity: 'high',
        },
        {
          sourceType: 'quality_findings',
          timestamp: '2026-04-04T10:00:00.000Z',
          groupKey: 'redispatch:SNB:high',
          severity: 'warning',
        },
      ],
    });

    expect(signals.some((signal) => signal.signalType === SIGNAL_DISTURBANCE_PATTERN)).toBe(true);
    expect(signals.some((signal) => signal.signalType === SIGNAL_REPEATING_FAULT)).toBe(true);
  });

  it('builds confidence-threshold auto proposals', () => {
    const proposals = buildInvestmentProposals({
      confidenceThreshold: 0.7,
      signals: [
        {
          signalKey: 's1',
          signalType: SIGNAL_DISTURBANCE_PATTERN,
          eventCount: 4,
          confidence: 0.82,
          reason: 'Recurring disturbances',
          sourceTypes: ['redispatch'],
        },
        {
          signalKey: 's2',
          signalType: SIGNAL_REPEATING_FAULT,
          eventCount: 3,
          confidence: 0.63,
          reason: 'Repeating fault',
          sourceTypes: ['mastr_monitor'],
        },
      ],
    });

    expect(proposals).toHaveLength(2);
    expect(proposals[0].autoProposal).toBe(true);
    expect(proposals[0].status).toBe('auto_proposed');
    expect(proposals[1].autoProposal).toBe(false);
    expect(proposals[1].status).toBe('manual_review');
  });
});
