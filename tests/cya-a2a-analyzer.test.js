'use strict';

const { analyzeLog, aggregateLogs, summarizeLog } = require('../src/cya-a2a-analyzer');

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Vollständiger Konsens-Log:
 * 3x persona.evaluated, 1x conflict.detected, 2x negotiation.round, 1x consensus.reached
 */
function buildConsensusLog(sessionId = 'ses_001') {
  const t = (offsetMs) => new Date(1_700_000_000_000 + offsetMs).toISOString();
  return [
    {
      messageId: 'msg-1',
      eventName: 'cya.a2a.persona.evaluated',
      sessionId,
      fromPersona: 'technical',
      toPersona: 'orchestrator',
      payload: { verdict: 'approve', summary: 'Technisch machbar.' },
      timestamp: t(0),
      protocolVersion: '1.0',
    },
    {
      messageId: 'msg-2',
      eventName: 'cya.a2a.persona.evaluated',
      sessionId,
      fromPersona: 'commercial',
      toPersona: 'orchestrator',
      payload: { verdict: 'reject', summary: 'Kosten zu hoch.' },
      timestamp: t(1000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'msg-3',
      eventName: 'cya.a2a.persona.evaluated',
      sessionId,
      fromPersona: 'compliance',
      toPersona: 'orchestrator',
      payload: { verdict: 'approve', summary: 'Konform.' },
      timestamp: t(2000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'msg-4',
      eventName: 'cya.a2a.conflict.detected',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: {
        blockers: ['commercial'],
        approvers: ['technical', 'compliance'],
        conflictTriggers: ['HIGH_CURTAILMENT', 'COST_THRESHOLD'],
      },
      timestamp: t(3000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'msg-5',
      eventName: 'cya.a2a.negotiation.round',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: {
        round: 1,
        blockers: ['commercial'],
        triggers: ['COST_THRESHOLD'],
        consensusReached: false,
        unresolvedConflicts: ['COST_THRESHOLD'],
      },
      timestamp: t(4000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'msg-6',
      eventName: 'cya.a2a.negotiation.round',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: {
        round: 2,
        blockers: [],
        triggers: [],
        consensusReached: true,
        unresolvedConflicts: [],
      },
      timestamp: t(5000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'msg-7',
      eventName: 'cya.a2a.consensus.reached',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: { narrative: { text: 'Einigung erzielt.' }, round: 2 },
      timestamp: t(6000),
      protocolVersion: '1.0',
    },
  ];
}

/**
 * HITL-Eskalations-Log:
 * 3x persona.evaluated, 1x conflict.detected, 3x negotiation.round, 1x consensus.failed
 */
function buildHitlLog(sessionId = 'ses_002') {
  const t = (offsetMs) => new Date(1_700_100_000_000 + offsetMs).toISOString();
  return [
    {
      messageId: 'h-1',
      eventName: 'cya.a2a.persona.evaluated',
      sessionId,
      fromPersona: 'technical',
      toPersona: 'orchestrator',
      payload: { verdict: 'approve', summary: 'OK.' },
      timestamp: t(0),
      protocolVersion: '1.0',
    },
    {
      messageId: 'h-2',
      eventName: 'cya.a2a.persona.evaluated',
      sessionId,
      fromPersona: 'commercial',
      toPersona: 'orchestrator',
      payload: { verdict: 'reject', summary: 'Ablehnung.' },
      timestamp: t(500),
      protocolVersion: '1.0',
    },
    {
      messageId: 'h-3',
      eventName: 'cya.a2a.persona.evaluated',
      sessionId,
      fromPersona: 'compliance',
      toPersona: 'orchestrator',
      payload: { verdict: 'reject', summary: 'Regulatorisch unklar.' },
      timestamp: t(1000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'h-4',
      eventName: 'cya.a2a.conflict.detected',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: {
        blockers: ['commercial', 'compliance'],
        approvers: ['technical'],
        conflictTriggers: ['NOVA_BLOCKED'],
      },
      timestamp: t(2000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'h-5',
      eventName: 'cya.a2a.negotiation.round',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: {
        round: 1,
        blockers: ['commercial', 'compliance'],
        triggers: ['NOVA_BLOCKED'],
        consensusReached: false,
        unresolvedConflicts: ['NOVA_BLOCKED'],
      },
      timestamp: t(3000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'h-6',
      eventName: 'cya.a2a.negotiation.round',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: {
        round: 2,
        blockers: ['commercial'],
        triggers: ['NOVA_BLOCKED'],
        consensusReached: false,
        unresolvedConflicts: ['NOVA_BLOCKED'],
      },
      timestamp: t(4000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'h-7',
      eventName: 'cya.a2a.negotiation.round',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: {
        round: 3,
        blockers: ['commercial'],
        triggers: ['NOVA_BLOCKED'],
        consensusReached: false,
        unresolvedConflicts: ['NOVA_BLOCKED'],
      },
      timestamp: t(5000),
      protocolVersion: '1.0',
    },
    {
      messageId: 'h-8',
      eventName: 'cya.a2a.consensus.failed',
      sessionId,
      fromPersona: 'orchestrator',
      toPersona: null,
      payload: { unresolvedConflicts: ['NOVA_BLOCKED'], roundsAttempted: 3, escalation: 'HITL' },
      timestamp: t(6000),
      protocolVersion: '1.0',
    },
  ];
}

// ── analyzeLog ────────────────────────────────────────────────────────────────

describe('analyzeLog', () => {
  test('totalMessages ist korrekt', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.totalMessages).toBe(7);
  });

  test('personaEvaluations enthält alle 3 Personas', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(Object.keys(result.personaEvaluations)).toEqual(
      expect.arrayContaining(['technical', 'commercial', 'compliance'])
    );
  });

  test('personaEvaluations enthält verdict und summary', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.personaEvaluations.technical.verdict).toBe('approve');
    expect(result.personaEvaluations.commercial.verdict).toBe('reject');
  });

  test('conflictsDetected = 1 bei Konsens-Log', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.conflictsDetected).toBe(1);
  });

  test('negotiationRounds = 2 bei Konsens-Log', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.negotiationRounds).toBe(2);
  });

  test('consensusReached = true bei consensus.reached-Event', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.consensusReached).toBe(true);
  });

  test('consensusRound = 2 aus payload', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.consensusRound).toBe(2);
  });

  test('hitlEscalated = false bei consensus.reached', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.hitlEscalated).toBe(false);
  });

  test('hitlEscalated = true bei consensus.failed', () => {
    const result = analyzeLog(buildHitlLog());
    expect(result.hitlEscalated).toBe(true);
  });

  test('consensusReached = false bei HITL-Log', () => {
    const result = analyzeLog(buildHitlLog());
    expect(result.consensusReached).toBe(false);
  });

  test('durationMs > 0 wenn Timestamps vorhanden', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBe(6000);
  });

  test('blockerPersonas aus conflict.detected extrahiert (dedupliziert)', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.blockerPersonas).toEqual(['commercial']);
  });

  test('signalsSeen aus conflict.detected extrahiert (dedupliziert)', () => {
    const result = analyzeLog(buildConsensusLog());
    expect(result.signalsSeen).toEqual(
      expect.arrayContaining(['HIGH_CURTAILMENT', 'COST_THRESHOLD'])
    );
  });

  test('leerer Log → consensusReached false, 0 Runden', () => {
    const result = analyzeLog([]);
    expect(result.consensusReached).toBe(false);
    expect(result.negotiationRounds).toBe(0);
    expect(result.totalMessages).toBe(0);
    expect(result.durationMs).toBeNull();
  });

  test('null-Log → wie leerer Log', () => {
    const result = analyzeLog(null);
    expect(result.totalMessages).toBe(0);
    expect(result.consensusReached).toBe(false);
  });

  test('HITL-Log hat 3 negotiationRounds', () => {
    const result = analyzeLog(buildHitlLog());
    expect(result.negotiationRounds).toBe(3);
  });
});

// ── aggregateLogs ─────────────────────────────────────────────────────────────

describe('aggregateLogs', () => {
  test('consensusRate = 0.5 bei 1 von 2 Sessions mit Konsens', () => {
    const analyses = [analyzeLog(buildConsensusLog()), analyzeLog(buildHitlLog())];
    const stats = aggregateLogs(analyses);
    expect(stats.consensusRate).toBe(0.5);
  });

  test('avgNegotiationRounds korrekt (2+3)/2 = 2.5', () => {
    const analyses = [analyzeLog(buildConsensusLog()), analyzeLog(buildHitlLog())];
    const stats = aggregateLogs(analyses);
    expect(stats.avgNegotiationRounds).toBe(2.5);
  });

  test('hitlEscalationRate = 0.5 bei 1 von 2 HITL', () => {
    const analyses = [analyzeLog(buildConsensusLog()), analyzeLog(buildHitlLog())];
    const stats = aggregateLogs(analyses);
    expect(stats.hitlEscalationRate).toBe(0.5);
  });

  test('mostFrequentBlocker korrekt', () => {
    const analyses = [analyzeLog(buildConsensusLog()), analyzeLog(buildHitlLog())];
    const stats = aggregateLogs(analyses);
    // commercial erscheint in beiden Logs als Blocker
    expect(stats.mostFrequentBlocker).toBe('commercial');
  });

  test('mostFrequentSignal korrekt', () => {
    const analyses = [analyzeLog(buildConsensusLog()), analyzeLog(buildHitlLog())];
    const stats = aggregateLogs(analyses);
    // NOVA_BLOCKED nur im HITL-Log, HIGH_CURTAILMENT+COST_THRESHOLD im Konsens-Log
    expect(typeof stats.mostFrequentSignal).toBe('string');
  });

  test('leeres Array → graceful Rückgabe ohne Crash', () => {
    const stats = aggregateLogs([]);
    expect(stats.totalSessions).toBe(0);
    expect(stats.consensusRate).toBe(0);
    expect(stats.avgNegotiationRounds).toBe(0);
    expect(stats.hitlEscalationRate).toBe(0);
    expect(stats.mostFrequentBlocker).toBeNull();
    expect(stats.mostFrequentSignal).toBeNull();
    expect(stats.avgDurationMs).toBeNull();
  });

  test('null → graceful Rückgabe ohne Crash', () => {
    const stats = aggregateLogs(null);
    expect(stats.totalSessions).toBe(0);
  });

  test('totalSessions korrekt', () => {
    const analyses = [analyzeLog(buildConsensusLog()), analyzeLog(buildHitlLog())];
    expect(aggregateLogs(analyses).totalSessions).toBe(2);
  });
});

// ── summarizeLog ──────────────────────────────────────────────────────────────

describe('summarizeLog', () => {
  test('gibt deutschen String zurück', () => {
    const result = summarizeLog(analyzeLog(buildConsensusLog()));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('enthält consensusReached-Information (Konsens-Log)', () => {
    const result = summarizeLog(analyzeLog(buildConsensusLog()));
    expect(result).toMatch(/Konsens erreicht/i);
  });

  test('enthält Rundenanzahl', () => {
    const result = summarizeLog(analyzeLog(buildConsensusLog()));
    expect(result).toMatch(/2 Runde/);
  });

  test('HITL-Eskalation wird erwähnt', () => {
    const result = summarizeLog(analyzeLog(buildHitlLog()));
    expect(result).toMatch(/HITL/);
  });

  test('leerer Log → Hinweis-String', () => {
    const result = summarizeLog(analyzeLog([]));
    expect(result).toMatch(/Kein A2A-Log/);
  });
});
