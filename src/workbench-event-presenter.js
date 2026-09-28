'use strict';

const TITLES = {
  'clarification.required': 'Rückfrage erforderlich',
  'evidence.required': 'Evidenz erforderlich',
  'domain.changed': 'Domain geändert',
  'branch.created': 'Verwandter Fallzweig erstellt',
  'handoff.completed': 'Handoff abgeschlossen',
  'evidence.available': 'Evidenz verfügbar',
  'related.session.reply': 'Antwort aus verwandter Session',
  'case.escalation.required': 'Eskalation erforderlich',
};

function safeText(event) {
  const title = TITLES[event.eventType] || event.eventType || 'CET Case Event';
  const caseText = event.cetCaseId ? ` für Case ${event.cetCaseId}` : '';
  const summary =
    event.payloadSummary && event.payloadSummary !== event.eventType ? event.payloadSummary : title;
  return `${summary}${caseText}. Bitte CET Case öffnen und Evidence/Guardrails prüfen.`;
}

function presentEvent(event, conversation = null) {
  return {
    eventId: event.eventId || event._id,
    caseId: event.cetCaseId || event.caseId,
    cetCaseId: event.cetCaseId || event.caseId,
    eventType: event.eventType,
    severity: event.severity || 'info',
    requiresUserAttention: !!event.requiresUserAttention,
    title: TITLES[event.eventType] || event.eventType || 'CET Case Event',
    safeDisplayText: safeText(event),
    sensitivityLevel: event.sensitivityLevel || 'tenant_internal',
    conversationRef: conversation
      ? {
          client: conversation.client,
          conversationId: conversation.externalConversationId,
          openWebuiConversationId: conversation.openWebuiConversationId,
        }
      : event.conversationId
        ? { conversationId: event.conversationId }
        : null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    deliveryState: event.deliveryState,
  };
}

module.exports = { presentEvent };
