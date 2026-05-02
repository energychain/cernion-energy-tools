'use strict';

/**
 * A2A Log Analyzer — Cernion Energy Tools v0.38.2
 *
 * Wertet persistierte Agent-to-Agent Kommunikations-Logs aus.
 * Liefert strukturierte Insights über Negotiation-Verläufe,
 * Konflikt-Häufigkeiten und Consensus-Erfolgsraten.
 *
 * @module cya-a2a-analyzer
 */

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

/**
 * Zählt Häufigkeiten von Elementen in einem Array und gibt das häufigste zurück.
 * @param {string[]} items
 * @returns {string|null}
 */
function mostFrequent(items) {
  if (!items || items.length === 0) return null;
  const counts = {};
  for (const item of items) {
    counts[item] = (counts[item] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Berechnet arithmetisches Mittel, ignoriert null-Werte.
 * @param {(number|null)[]} values
 * @returns {number|null}
 */
function avg(values) {
  const valid = values.filter((v) => v !== null && v !== undefined);
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// ── Kern-Analyse ─────────────────────────────────────────────────────────────

/**
 * Berechnet Statistiken über einen A2A-Message-Log einer Session.
 *
 * @param {object[]} messages - Array von A2AMessage-Envelopes
 * @returns {{
 *   sessionId: string|null,
 *   totalMessages: number,
 *   personaEvaluations: object,
 *   conflictsDetected: number,
 *   negotiationRounds: number,
 *   consensusReached: boolean,
 *   consensusRound: number|null,
 *   hitlEscalated: boolean,
 *   durationMs: number|null,
 *   blockerPersonas: string[],
 *   signalsSeen: string[],
 * }}
 */
function analyzeLog(messages) {
  if (!messages || messages.length === 0) {
    return {
      sessionId: null,
      totalMessages: 0,
      personaEvaluations: {},
      conflictsDetected: 0,
      negotiationRounds: 0,
      consensusReached: false,
      consensusRound: null,
      hitlEscalated: false,
      durationMs: null,
      blockerPersonas: [],
      signalsSeen: [],
    };
  }

  const sessionId = messages[0].sessionId || null;
  const personaEvaluations = {};
  let conflictsDetected = 0;
  let negotiationRounds = 0;
  let consensusReached = false;
  let consensusRound = null;
  let hitlEscalated = false;
  const blockerPersonas = [];
  const signalsSeen = [];

  for (const msg of messages) {
    const event = msg.eventName;
    const payload = msg.payload || {};

    if (event === 'cya.a2a.persona.evaluated') {
      personaEvaluations[msg.fromPersona] = {
        verdict: payload.verdict,
        summary: payload.summary,
      };
    } else if (event === 'cya.a2a.conflict.detected') {
      conflictsDetected += 1;
      if (Array.isArray(payload.blockers)) {
        blockerPersonas.push(...payload.blockers);
      }
      if (Array.isArray(payload.conflictTriggers)) {
        signalsSeen.push(...payload.conflictTriggers);
      }
    } else if (event === 'cya.a2a.negotiation.round') {
      negotiationRounds += 1;
    } else if (event === 'cya.a2a.consensus.reached') {
      consensusReached = true;
      consensusRound = payload.round != null ? payload.round : null;
    } else if (event === 'cya.a2a.consensus.failed') {
      hitlEscalated = true;
    }
  }

  // Dauer: erste bis letzte Message
  let durationMs = null;
  const timestamps = messages
    .map((m) => m.timestamp)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !isNaN(t));
  if (timestamps.length >= 2) {
    durationMs = Math.max(...timestamps) - Math.min(...timestamps);
  }

  return {
    sessionId,
    totalMessages: messages.length,
    personaEvaluations,
    conflictsDetected,
    negotiationRounds,
    consensusReached,
    consensusRound,
    hitlEscalated,
    durationMs,
    blockerPersonas: [...new Set(blockerPersonas)],
    signalsSeen: [...new Set(signalsSeen)],
  };
}

// ── Aggregation über mehrere Sessions ────────────────────────────────────────

/**
 * Aggregiert Analyse-Ergebnisse über mehrere Sessions.
 *
 * @param {ReturnType<typeof analyzeLog>[]} sessionAnalyses
 * @returns {{
 *   totalSessions: number,
 *   consensusRate: number,
 *   avgNegotiationRounds: number,
 *   hitlEscalationRate: number,
 *   mostFrequentBlocker: string|null,
 *   mostFrequentSignal: string|null,
 *   avgDurationMs: number|null,
 * }}
 */
function aggregateLogs(sessionAnalyses) {
  if (!sessionAnalyses || sessionAnalyses.length === 0) {
    return {
      totalSessions: 0,
      consensusRate: 0,
      avgNegotiationRounds: 0,
      hitlEscalationRate: 0,
      mostFrequentBlocker: null,
      mostFrequentSignal: null,
      avgDurationMs: null,
    };
  }

  const total = sessionAnalyses.length;
  const consensusCount = sessionAnalyses.filter((a) => a.consensusReached).length;
  const hitlCount = sessionAnalyses.filter((a) => a.hitlEscalated).length;

  const allBlockers = sessionAnalyses.flatMap((a) => a.blockerPersonas || []);
  const allSignals = sessionAnalyses.flatMap((a) => a.signalsSeen || []);

  return {
    totalSessions: total,
    consensusRate: total > 0 ? consensusCount / total : 0,
    avgNegotiationRounds: avg(sessionAnalyses.map((a) => a.negotiationRounds)) ?? 0,
    hitlEscalationRate: total > 0 ? hitlCount / total : 0,
    mostFrequentBlocker: mostFrequent(allBlockers),
    mostFrequentSignal: mostFrequent(allSignals),
    avgDurationMs: avg(sessionAnalyses.map((a) => a.durationMs)),
  };
}

// ── Menschenlesbare Zusammenfassung ─────────────────────────────────────────

/**
 * Gibt eine menschenlesbare deutschsprachige Zusammenfassung zurück.
 *
 * @param {ReturnType<typeof analyzeLog>} analysis
 * @returns {string}
 */
function summarizeLog(analysis) {
  if (!analysis || analysis.totalMessages === 0) {
    return 'Kein A2A-Log vorhanden — keine Agenten-Kommunikation aufgezeichnet.';
  }

  const parts = [];

  const personas = Object.keys(analysis.personaEvaluations);
  if (personas.length > 0) {
    parts.push(`${personas.length} Persona(s) bewertet: ${personas.join(', ')}.`);
  }

  if (analysis.conflictsDetected > 0) {
    parts.push(`${analysis.conflictsDetected} Konflikt(e) erkannt.`);
  } else {
    parts.push('Keine Konflikte erkannt.');
  }

  if (analysis.negotiationRounds > 0) {
    parts.push(`Verhandlung: ${analysis.negotiationRounds} Runde(n).`);
  }

  if (analysis.consensusReached) {
    const roundInfo = analysis.consensusRound != null ? ` (Runde ${analysis.consensusRound})` : '';
    parts.push(`Konsens erreicht${roundInfo}.`);
  } else if (analysis.hitlEscalated) {
    parts.push('Konsens nicht erreicht — HITL-Eskalation ausgelöst.');
  } else {
    parts.push('Kein Konsens-Ergebnis in diesem Log.');
  }

  if (analysis.durationMs != null) {
    const secs = (analysis.durationMs / 1000).toFixed(1);
    parts.push(`Gesamtdauer: ${secs}s.`);
  }

  return parts.join(' ');
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { analyzeLog, aggregateLogs, summarizeLog };
