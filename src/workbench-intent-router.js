'use strict';

// Intent is a presentation/routing hint, never authorization to execute a tool.
function classifyWorkbenchIntent(message, { cetCaseId } = {}) {
  const text = String(message || '').toLowerCase();
  if (
    /\b(run|execute|fetch|search|lookup|attach|ausführen|ausfuehren|führe|fuehre|abrufen|suche|anhängen)\b/.test(
      text
    ) &&
    /\b(tool|web|mail|e-?mail|evidence|willi|beleg)\b/.test(text)
  )
    return 'tool_run_request';
  if (
    /\b(start|create|open|starte|erstelle|eröffne)\b/.test(text) &&
    /\b(case|fall|klärfall|klaerfall|evaluation|bewertung)\b/.test(text)
  )
    return 'case_start';
  if (
    /\b(status|readiness|stand|bearbeitungsstand)\b|missing evidence|fehlende belege|next safe action/.test(
      text
    )
  )
    return 'status_query';
  if (
    /\b(show|list|which|zeige|liste|auflisten|welche)\b/.test(text) &&
    /\b(cases|fälle|faelle|events|ereignisse|tools|starters|fallstarter)\b/.test(text)
  )
    return 'data_lookup';
  if (
    /compare|recommend|assess|bewerte|vergleiche|empfehl|abwäg|abwaeg|nächste.*schritt|naechste.*schritt|next.*step/.test(
      text
    )
  )
    return 'decision_support';
  if (
    /what (does|is|are)|explain|meaning|was (ist|sind|bedeutet)|erkläre|erkl[aä]rung|definition/.test(
      text
    )
  )
    return 'knowledge_query';
  if (
    cetCaseId ||
    /\b(continue|follow.?up|fortsetzen|weiter|nachreich|cetcaseid)\b|\bcase[_-][\w-]+\b|hier (ist|sind).*beleg|provide.*evidence/.test(
      text
    )
  )
    return 'case_followup';
  return 'decision_support';
}

function isReadOnlyIntent(intent) {
  return ['status_query', 'knowledge_query', 'data_lookup'].includes(intent);
}

const INTERNAL_POLICY =
  /routing advice only|knowledge hits are unverified routing hints|never claim approval, booking or binding regulatory decisions/i;
function readable(value) {
  if (typeof value === 'string') return INTERNAL_POLICY.test(value) ? '' : value.trim();
  if (value && typeof value === 'object')
    return readable(value.label || value.question || value.description || value.type);
  return '';
}

function renderWorkbenchResponse(result = {}, intent) {
  const reply = readable(result.responseText);
  if (reply && intent !== 'status_query') return reply;
  if (intent === 'knowledge_query')
    return 'CET could not provide a verified explanation. Please specify the process and document version.';
  const entries = result.items || result.tools;
  if (Array.isArray(entries)) {
    const lines = entries
      .slice(0, 20)
      .map((item) => {
        const label = readable(
          [
            item.title,
            item.name,
            item.label,
            item.caseId,
            item.id,
            item.toolId,
            item.starterId,
            item.taskId,
          ]
            .map(readable)
            .find(Boolean)
        );
        const state = readable(item.status || item.readinessState);
        return label ? `- ${label}${state ? ` (${state})` : ''}` : '';
      })
      .filter(Boolean);
    return lines.length ? lines.join('\n') : 'No matching CET entries are available.';
  }
  const lines = [];
  const caseId = readable(result.cetCaseId || result.caseId);
  if (caseId) lines.push(`Case: ${caseId}`);
  if (readable(result.status)) lines.push(`Status: ${readable(result.status)}`);
  if (readable(result.readinessState)) lines.push(`Readiness: ${readable(result.readinessState)}`);
  const pending =
    result.pendingEvents ?? result.eventSummary?.unacknowledged ?? result.eventSummary?.pending;
  if (pending != null) lines.push(`Pending events: ${Number(pending) || 0}`);
  for (const [key, label] of [
    ['missingEvidence', 'Missing evidence'],
    ['requiredClarifications', 'Clarifications'],
    ['workingAssumptions', 'Assumptions'],
    ['allowedActions', 'Next safe actions'],
  ]) {
    const values = (Array.isArray(result[key]) ? result[key] : []).map(readable).filter(Boolean);
    if (values.length) lines.push(`${label}: ${values.join('; ')}`);
  }
  if (intent === 'tool_run_request')
    lines.push(
      'Tool requests require CET governance checks and an authorized case. No tool execution is confirmed.'
    );
  else if (intent !== 'status_query')
    lines.push(
      'Non-binding assessment. Provide the missing inputs and evidence before human review.'
    );
  if (!lines.length)
    return reply || 'Please provide a CET case ID or select an existing case to view its status.';
  return lines.join('\n');
}

module.exports = { classifyWorkbenchIntent, isReadOnlyIntent, renderWorkbenchResponse };
