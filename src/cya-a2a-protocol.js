'use strict';

/**
 * Agent-to-Agent (A2A) Protocol — Cernion Energy Tools v0.35.0
 *
 * Struktur: Jede Agenten-Interaktion wird als A2AMessage-Envelope
 * via broker.emit() publiziert und in cya_a2a_messages persistiert.
 *
 * Moleculer Event-Namen (Konvention: cya.a2a.*):
 *   cya.a2a.persona.evaluated   — Persona hat Verdict abgegeben
 *   cya.a2a.conflict.detected   — Konflikt zwischen Personas erkannt
 *   cya.a2a.negotiation.round   — Verhandlungsrunde abgeschlossen
 *   cya.a2a.consensus.reached   — Konsens erreicht
 *   cya.a2a.consensus.failed    — Konsens gescheitert → HITL
 *
 * @module cya-a2a-protocol
 */

const { v4: uuidv4 } = require('uuid');

// ── Envelope-Schema ──────────────────────────────────────────────────────────

/**
 * Erstellt ein strukturiertes A2A-Message-Envelope.
 *
 * @param {string} eventName      - cya.a2a.*-Event-Name
 * @param {string} sessionId      - CYA-Session-ID (Correlation-ID)
 * @param {string} fromPersona    - Sender-Persona ('technical'|'commercial'|'compliance'|'orchestrator')
 * @param {string|null} toPersona - Empfänger-Persona (null = broadcast)
 * @param {object} payload        - Event-spezifische Nutzdaten
 * @returns {A2AMessage}
 */
function createMessage(eventName, sessionId, fromPersona, toPersona, payload) {
  return {
    messageId: uuidv4(),
    eventName,
    sessionId,
    fromPersona,
    toPersona,       // null = broadcast an alle Personas
    payload,
    timestamp: new Date().toISOString(),
    protocolVersion: '1.0',
  };
}

// ── Factory-Funktionen pro Event-Typ ────────────────────────────────────────

/**
 * @param {string} sessionId
 * @param {string} personaId
 * @param {{ verdict: string, summary: string, conflictTriggers: string[], keyPoints: string[], riskNotes: string[] }} state
 */
function personaEvaluated(sessionId, personaId, state) {
  const { verdict, summary, conflictTriggers, keyPoints, riskNotes } = state;
  return createMessage(
    'cya.a2a.persona.evaluated',
    sessionId,
    personaId,
    'orchestrator',
    { verdict, summary, conflictTriggers, keyPoints, riskNotes }
  );
}

/**
 * @param {string} sessionId
 * @param {{ blockers: string[], approvers: string[], triggers: string[] }} conflict
 */
function conflictDetected(sessionId, conflict) {
  const { blockers, approvers, triggers } = conflict;
  return createMessage(
    'cya.a2a.conflict.detected',
    sessionId,
    'orchestrator',
    null,  // broadcast
    { blockers, approvers, conflictTriggers: triggers }
  );
}

/**
 * @param {string} sessionId
 * @param {{ round: number, blockers: string[], triggers: string[], consensusReached: boolean, unresolvedConflicts: string[] }} roundData
 */
function negotiationRound(sessionId, roundData) {
  const { round, blockers, triggers, consensusReached, unresolvedConflicts } = roundData;
  return createMessage(
    'cya.a2a.negotiation.round',
    sessionId,
    'orchestrator',
    null,
    { round, blockers, triggers, consensusReached, unresolvedConflicts }
  );
}

/**
 * @param {string} sessionId
 * @param {{ narrative: object, round: number }} data
 */
function consensusReached(sessionId, data) {
  const { narrative, round } = data;
  return createMessage(
    'cya.a2a.consensus.reached',
    sessionId,
    'orchestrator',
    null,
    { narrative, round }
  );
}

/**
 * @param {string} sessionId
 * @param {{ unresolvedConflicts: string[], roundsAttempted: number }} data
 */
function consensusFailed(sessionId, data) {
  const { unresolvedConflicts, roundsAttempted } = data;
  return createMessage(
    'cya.a2a.consensus.failed',
    sessionId,
    'orchestrator',
    null,
    { unresolvedConflicts, roundsAttempted, escalation: 'HITL' }
  );
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_EVENT_NAMES = new Set([
  'cya.a2a.persona.evaluated',
  'cya.a2a.conflict.detected',
  'cya.a2a.negotiation.round',
  'cya.a2a.consensus.reached',
  'cya.a2a.consensus.failed',
]);

/**
 * Validiert ein A2AMessage-Envelope.
 * Wirft Error wenn Pflichtfelder fehlen oder eventName unbekannt.
 *
 * @param {object} msg
 * @returns {true}
 */
function validateMessage(msg) {
  if (!msg || !msg.messageId || !msg.sessionId || !msg.eventName || !msg.fromPersona) {
    throw new Error('A2A_INVALID_ENVELOPE: missing required fields');
  }
  if (!VALID_EVENT_NAMES.has(msg.eventName)) {
    throw new Error(`A2A_UNKNOWN_EVENT: ${msg.eventName}`);
  }
  return true;
}

module.exports = {
  createMessage,
  personaEvaluated,
  conflictDetected,
  negotiationRound,
  consensusReached,
  consensusFailed,
  validateMessage,
  VALID_EVENT_NAMES,
  A2A_NAMESPACE: 'cya_a2a_messages',
};
