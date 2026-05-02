'use strict';

const {
  createMessage,
  personaEvaluated,
  conflictDetected,
  negotiationRound,
  consensusReached,
  consensusFailed,
  validateMessage,
  VALID_EVENT_NAMES,
  A2A_NAMESPACE,
} = require('../src/cya-a2a-protocol');

// ── UUID pattern ─────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe('cya-a2a-protocol — createMessage', () => {
  it('returns an object with messageId in UUID v4 format', () => {
    const msg = createMessage(
      'cya.a2a.persona.evaluated',
      'sess-1',
      'technical',
      'orchestrator',
      {}
    );
    expect(msg.messageId).toMatch(UUID_RE);
  });

  it('timestamp is ISO 8601', () => {
    const msg = createMessage(
      'cya.a2a.persona.evaluated',
      'sess-1',
      'technical',
      'orchestrator',
      {}
    );
    expect(msg.timestamp).toMatch(ISO_RE);
  });

  it('protocolVersion is "1.0"', () => {
    const msg = createMessage(
      'cya.a2a.persona.evaluated',
      'sess-1',
      'technical',
      'orchestrator',
      {}
    );
    expect(msg.protocolVersion).toBe('1.0');
  });

  it('fromPersona and toPersona are set correctly', () => {
    const msg = createMessage('cya.a2a.conflict.detected', 'sess-2', 'orchestrator', null, {});
    expect(msg.fromPersona).toBe('orchestrator');
    expect(msg.toPersona).toBeNull();
  });

  it('eventName is passed through', () => {
    const msg = createMessage('cya.a2a.consensus.reached', 'sess-3', 'orchestrator', null, {});
    expect(msg.eventName).toBe('cya.a2a.consensus.reached');
  });

  it('sessionId is passed through', () => {
    const msg = createMessage('cya.a2a.consensus.failed', 'sess-xyz', 'orchestrator', null, {});
    expect(msg.sessionId).toBe('sess-xyz');
  });

  it('payload is passed through', () => {
    const payload = { verdict: 'blocked', summary: 'test' };
    const msg = createMessage(
      'cya.a2a.persona.evaluated',
      's',
      'technical',
      'orchestrator',
      payload
    );
    expect(msg.payload).toEqual(payload);
  });

  it('each call produces a unique messageId', () => {
    const a = createMessage('cya.a2a.persona.evaluated', 's', 'technical', 'orchestrator', {});
    const b = createMessage('cya.a2a.persona.evaluated', 's', 'technical', 'orchestrator', {});
    expect(a.messageId).not.toBe(b.messageId);
  });
});

describe('cya-a2a-protocol — factory functions', () => {
  it('personaEvaluated: eventName is "cya.a2a.persona.evaluated"', () => {
    const msg = personaEvaluated('s1', 'technical', {
      verdict: 'approved',
      summary: 'ok',
      conflictTriggers: [],
      keyPoints: [],
      riskNotes: [],
    });
    expect(msg.eventName).toBe('cya.a2a.persona.evaluated');
  });

  it('personaEvaluated: fromPersona is personaId, toPersona is "orchestrator"', () => {
    const msg = personaEvaluated('s1', 'compliance', {
      verdict: 'blocked',
      summary: '',
      conflictTriggers: [],
      keyPoints: [],
      riskNotes: [],
    });
    expect(msg.fromPersona).toBe('compliance');
    expect(msg.toPersona).toBe('orchestrator');
  });

  it('personaEvaluated: payload contains verdict and summary', () => {
    const state = {
      verdict: 'conditional',
      summary: 'needs more data',
      conflictTriggers: ['capacity'],
      keyPoints: ['k1'],
      riskNotes: ['r1'],
    };
    const msg = personaEvaluated('s1', 'commercial', state);
    expect(msg.payload.verdict).toBe('conditional');
    expect(msg.payload.summary).toBe('needs more data');
    expect(msg.payload.conflictTriggers).toEqual(['capacity']);
  });

  it('conflictDetected: toPersona is null (broadcast)', () => {
    const msg = conflictDetected('s2', {
      blockers: ['compliance'],
      approvers: ['technical'],
      triggers: ['capacity'],
    });
    expect(msg.toPersona).toBeNull();
    expect(msg.fromPersona).toBe('orchestrator');
  });

  it('conflictDetected: eventName is "cya.a2a.conflict.detected"', () => {
    const msg = conflictDetected('s2', { blockers: [], approvers: [], triggers: [] });
    expect(msg.eventName).toBe('cya.a2a.conflict.detected');
  });

  it('conflictDetected: payload contains blockers and approvers', () => {
    const msg = conflictDetected('s2', {
      blockers: ['compliance'],
      approvers: ['technical', 'commercial'],
      triggers: ['T1'],
    });
    expect(msg.payload.blockers).toEqual(['compliance']);
    expect(msg.payload.approvers).toEqual(['technical', 'commercial']);
  });

  it('negotiationRound: payload.round is correct', () => {
    const msg = negotiationRound('s3', {
      round: 2,
      blockers: ['c'],
      triggers: ['t'],
      consensusReached: false,
      unresolvedConflicts: ['uc'],
    });
    expect(msg.payload.round).toBe(2);
    expect(msg.eventName).toBe('cya.a2a.negotiation.round');
  });

  it('consensusReached: payload.narrative is present', () => {
    const narrative = { headline: 'Test', executiveSummary: 'Summary' };
    const msg = consensusReached('s4', { narrative, round: 1 });
    expect(msg.payload.narrative).toEqual(narrative);
    expect(msg.eventName).toBe('cya.a2a.consensus.reached');
  });

  it('consensusFailed: payload.escalation is "HITL"', () => {
    const msg = consensusFailed('s5', { unresolvedConflicts: ['uc1'], roundsAttempted: 3 });
    expect(msg.payload.escalation).toBe('HITL');
    expect(msg.payload.roundsAttempted).toBe(3);
    expect(msg.eventName).toBe('cya.a2a.consensus.failed');
  });
});

describe('cya-a2a-protocol — validateMessage', () => {
  const validMsg = () =>
    personaEvaluated('s1', 'technical', {
      verdict: 'approved',
      summary: '',
      conflictTriggers: [],
      keyPoints: [],
      riskNotes: [],
    });

  it('does not throw for a valid message', () => {
    expect(() => validateMessage(validMsg())).not.toThrow();
  });

  it('returns true for a valid message', () => {
    expect(validateMessage(validMsg())).toBe(true);
  });

  it('throws A2A_INVALID_ENVELOPE when messageId is missing', () => {
    const msg = { ...validMsg(), messageId: undefined };
    expect(() => validateMessage(msg)).toThrow('A2A_INVALID_ENVELOPE');
  });

  it('throws A2A_INVALID_ENVELOPE when sessionId is missing', () => {
    const msg = { ...validMsg(), sessionId: undefined };
    expect(() => validateMessage(msg)).toThrow('A2A_INVALID_ENVELOPE');
  });

  it('throws A2A_INVALID_ENVELOPE when fromPersona is missing', () => {
    const msg = { ...validMsg(), fromPersona: undefined };
    expect(() => validateMessage(msg)).toThrow('A2A_INVALID_ENVELOPE');
  });

  it('throws A2A_INVALID_ENVELOPE for null input', () => {
    expect(() => validateMessage(null)).toThrow('A2A_INVALID_ENVELOPE');
  });

  it('throws A2A_UNKNOWN_EVENT for unknown eventName', () => {
    const msg = { ...validMsg(), eventName: 'cya.a2a.unknown.event' };
    expect(() => validateMessage(msg)).toThrow('A2A_UNKNOWN_EVENT');
  });

  it('VALID_EVENT_NAMES contains all 5 event names', () => {
    expect(VALID_EVENT_NAMES.size).toBe(5);
    expect(VALID_EVENT_NAMES.has('cya.a2a.persona.evaluated')).toBe(true);
    expect(VALID_EVENT_NAMES.has('cya.a2a.conflict.detected')).toBe(true);
    expect(VALID_EVENT_NAMES.has('cya.a2a.negotiation.round')).toBe(true);
    expect(VALID_EVENT_NAMES.has('cya.a2a.consensus.reached')).toBe(true);
    expect(VALID_EVENT_NAMES.has('cya.a2a.consensus.failed')).toBe(true);
  });
});

describe('cya-a2a-protocol — A2A_NAMESPACE', () => {
  it('A2A_NAMESPACE is "cya_a2a_messages"', () => {
    expect(A2A_NAMESPACE).toBe('cya_a2a_messages');
  });
});

describe('cya-a2a-protocol — _emitA2AMessage integration (broker mock)', () => {
  function makeBroker() {
    return {
      emittedEvents: [],
      calledActions: [],
      emit(eventName, payload) {
        this.emittedEvents.push({ eventName, payload });
      },
      call(action, params) {
        this.calledActions.push({ action, params });
        return Promise.resolve({ ok: true });
      },
    };
  }

  function makeService(broker) {
    return {
      broker,
      logger: { warn: jest.fn(), info: jest.fn() },
      async _emitA2AMessage(msg) {
        const { validateMessage: vld, A2A_NAMESPACE: ns } = require('../src/cya-a2a-protocol');
        vld(msg);
        this.broker.emit(msg.eventName, msg);
        this.broker
          .call('object-store.put', {
            namespace: ns,
            key: msg.messageId,
            payload: msg,
          })
          .catch((err) => this.logger.warn('[A2A] persist failed:', err.message));
      },
    };
  }

  it('broker.emit is called with correct eventName', async () => {
    const broker = makeBroker();
    const svc = makeService(broker);
    const msg = personaEvaluated('s1', 'technical', {
      verdict: 'approved',
      summary: '',
      conflictTriggers: [],
      keyPoints: [],
      riskNotes: [],
    });
    await svc._emitA2AMessage(msg);
    expect(broker.emittedEvents).toHaveLength(1);
    expect(broker.emittedEvents[0].eventName).toBe('cya.a2a.persona.evaluated');
  });

  it('object-store.put is called with correct namespace and key', async () => {
    const broker = makeBroker();
    const svc = makeService(broker);
    const msg = conflictDetected('s2', {
      blockers: ['compliance'],
      approvers: ['technical'],
      triggers: ['cap'],
    });
    await svc._emitA2AMessage(msg);
    expect(broker.calledActions).toHaveLength(1);
    expect(broker.calledActions[0].action).toBe('object-store.put');
    expect(broker.calledActions[0].params.namespace).toBe('cya_a2a_messages');
    expect(broker.calledActions[0].params.key).toBe(msg.messageId);
  });

  it('invalid envelope throws before broker.emit is called', async () => {
    const broker = makeBroker();
    const svc = makeService(broker);
    const badMsg = {
      messageId: null,
      sessionId: 's1',
      eventName: 'cya.a2a.persona.evaluated',
      fromPersona: 'technical',
      payload: {},
    };
    await expect(svc._emitA2AMessage(badMsg)).rejects.toThrow('A2A_INVALID_ENVELOPE');
    expect(broker.emittedEvents).toHaveLength(0);
  });
});

describe('cya-a2a-protocol — session.a2aLog handler logic', () => {
  function buildEntry(sessionId, eventName, ts) {
    return {
      payload: {
        messageId: `mid-${Math.random()}`,
        eventName,
        sessionId,
        fromPersona: 'orchestrator',
        toPersona: null,
        payload: {},
        timestamp: ts,
        protocolVersion: '1.0',
      },
    };
  }

  function filterAndSort(all, id) {
    return all
      .filter((e) => e && e.payload && e.payload.sessionId === id)
      .sort((x, y) => new Date(x.payload.timestamp) - new Date(y.payload.timestamp))
      .map((e) => e.payload);
  }

  it('empty list yields messageCount 0', () => {
    const messages = filterAndSort([], 'sess-abc');
    expect(messages).toHaveLength(0);
  });

  it('session with 3 messages returns messageCount 3', () => {
    const all = [
      buildEntry('sess-abc', 'cya.a2a.persona.evaluated', '2026-04-28T10:00:00.000Z'),
      buildEntry('sess-abc', 'cya.a2a.conflict.detected', '2026-04-28T10:00:01.000Z'),
      buildEntry('sess-abc', 'cya.a2a.consensus.reached', '2026-04-28T10:00:02.000Z'),
    ];
    const messages = filterAndSort(all, 'sess-abc');
    expect(messages).toHaveLength(3);
  });

  it('messages are sorted ascending by timestamp', () => {
    const all = [
      buildEntry('sess-t', 'cya.a2a.consensus.reached', '2026-04-28T10:00:02.000Z'),
      buildEntry('sess-t', 'cya.a2a.persona.evaluated', '2026-04-28T10:00:00.000Z'),
      buildEntry('sess-t', 'cya.a2a.conflict.detected', '2026-04-28T10:00:01.000Z'),
    ];
    const messages = filterAndSort(all, 'sess-t');
    expect(messages[0].eventName).toBe('cya.a2a.persona.evaluated');
    expect(messages[1].eventName).toBe('cya.a2a.conflict.detected');
    expect(messages[2].eventName).toBe('cya.a2a.consensus.reached');
  });

  it('foreign sessionId entries are excluded', () => {
    const all = [
      buildEntry('sess-A', 'cya.a2a.persona.evaluated', '2026-04-28T10:00:00.000Z'),
      buildEntry('sess-B', 'cya.a2a.conflict.detected', '2026-04-28T10:00:01.000Z'),
    ];
    const messages = filterAndSort(all, 'sess-A');
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe('sess-A');
  });
});
