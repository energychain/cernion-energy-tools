'use strict';

const { isCorrectionTurn } = require('./workbench-corrections');
const {
  isSystemActivityQuery,
  isFunctionKnowledgeQuery,
  renderSystemActivity,
} = require('./workbench-system-activity');

// Intent is a presentation/routing hint, never authorization to execute a tool.
function classifyWorkbenchIntent(message, { cetCaseId, recentMessages } = {}) {
  if (isCorrectionTurn(message)) return 'correction';
  const text = String(message || '').toLowerCase();
  if (
    /\b(run|execute|fetch|search|lookup|attach|ausführen|ausfuehren|führe|fuehre|abrufen|suche|anhängen)\b/.test(
      text
    ) &&
    /\b(tool|web|mail|e-?mail|evidence|willi|beleg)\b/.test(text)
  )
    return 'tool_run_request';
  if (
    /\b(start|create|open|starte|erstelle|eröffne|lege)\b/.test(text) &&
    /\b(case|fall|klärfall|klaerfall|evaluation|bewertung)\b/.test(text)
  )
    return 'case_start';
  if (isSystemActivityQuery(message)) return 'system_activity_query';
  if (/prüfe.*\b(case|fall)|check.*\bcase/.test(text)) return 'case_followup';
  if (
    /\b(continue|follow.?up|fortsetzen|weiter|nachreich|cetcaseid)\b|hier (ist|sind).*beleg|provide.*evidence/.test(
      text
    )
  )
    return 'case_followup';
  if (isFunctionKnowledgeQuery(message)) return 'knowledge_query';
  if (
    /\b(status|stand|bearbeitungsstand)\b/.test(text) &&
    /\b(case|fall)\b|\bcase[_-][\w-]+\b/.test(text)
  )
    return 'status_query';
  if (
    /compare|recommend|assess|bewerte|vergleiche|empfehl|abwäg|abwaeg|was soll ich tun|what should i do|nächste.*schritt|naechste.*schritt|next.*step/.test(
      text
    )
  )
    return 'decision_support';
  if (resolveWorkbenchFollowup(message, { recentMessages })) return 'knowledge_query';
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

// Only user turns supply a topic; system instructions and assistant claims are
// never promoted into routing context. Stop at a topic switch or action request.
function resolveWorkbenchFollowup(message, { recentMessages = [] } = {}) {
  const reference =
    /\b(solche[nsrm]?|so eine[nmrs]?|das|dies(?:e[rnms]?|er Fehler|er Status)|dort|daran|it|that|such|there)\b/i;
  const text = String(message || '').trim();
  if (text.length > 400 || !reference.test(text)) return null;
  if (
    /^(was (ist|sind)|what (is|are))\b/i.test(text) &&
    !/^(was ist das|what is that)[?.!\s]*$/i.test(text)
  )
    return null;
  const turns = recentMessages.slice(-8).filter((turn) => turn.role === 'user');
  const observations = [];
  for (const turn of turns.reverse()) {
    const topic = String(turn.content || '')
      .trim()
      .slice(0, 600);
    if (INTERNAL_POLICY.test(topic)) break;
    if (classifyWorkbenchIntent(topic) === 'knowledge_query' && !reference.test(topic)) {
      return { topic, message: text, observations: observations.reverse() };
    }
    if (topic.length <= 400 && reference.test(topic)) observations.push(topic);
    else break;
  }
  return null;
}

function renderContextualExplanation({ topic, message, observations = [] }) {
  const context = [topic, ...observations, message].join(' ');
  let explanation =
    'Die genaue Bedeutung hängt vom fachlichen Prozess und den zugrunde liegenden Daten ab. Bitte teile den relevanten Berichtsausschnitt, Zeitraum und die verwendete Dokumentversion.';
  if (/aperak/i.test(topic)) {
    const code = context.match(/\bZ\d{2}\b/i)?.[0]?.toUpperCase();
    explanation = `Du beziehst dich offenbar auf eine APERAK${code ? ` mit ${code}` : ''} vom Marktpartner. Eine APERAK meldet das Ergebnis der fachlichen Nachrichtenprüfung. Die konkrete Bedeutung des Codes lässt sich erst mit AHB-Version, Nachricht, Segment und Prozesskontext bestimmen. Bitte teile den anonymisierten Nachrichtenausschnitt und die Referenz auf die ursprüngliche Nachricht.`;
  } else if (/ersatzwert/i.test(topic)) {
    explanation =
      'Ein Ersatzwert in der Zeitreihe kann eine Lücke oder einen unplausiblen Messwert ersetzen. Prüfe Qualitätskennzeichen, Bildungsregel, Zeitraum und Herkunft des Werts; daraus allein folgt noch keine Aussage zur Richtigkeit der Zeitreihe.';
  } else if (/evidence gate/i.test(topic)) {
    explanation =
      'Ein Evidence Gate verlangt Nachweise, bevor ein Ausbaupfad weiter bewertet werden kann. Wenn der Pfad dort hängt, prüfe die Gate-Kriterien und fehlende Nachweise, etwa Lastannahmen, Netzberechnungen und Variantenvergleiche. Welche davon erforderlich sind, ergibt sich aus dem konkreten Planungsprozess.';
  } else if (/N-1/i.test(topic)) {
    explanation =
      '„N-1 verletzt“ weist darauf hin, dass ein untersuchter Ausfall die angesetzten Netzgrenzen verletzt. Für die Leitung müssen Ausfallszenario, Lastfall, Grenzwerte und Berechnungsversion geprüft werden; der Berichtshinweis allein bestimmt noch keine Betriebsmaßnahme.';
  }
  return `${topic}\n\n${explanation}\n\nAuf Wunsch können wir einen Klärfall starten oder die Optionen bewerten.`;
}

function isReadOnlyIntent(intent) {
  return ['status_query', 'knowledge_query', 'data_lookup', 'system_activity_query'].includes(
    intent
  );
}

const INTERNAL_POLICY =
  /routing advice only|knowledge hits are unverified routing hints|never claim approval, booking or binding regulatory decisions/i;
function readable(value) {
  if (typeof value === 'string') return INTERNAL_POLICY.test(value) ? '' : value.trim();
  if (value && typeof value === 'object')
    return readable(value.label || value.question || value.description || value.type);
  return '';
}

function renderWorkbenchResponse(result = {}, intent, followup) {
  if (intent === 'system_activity_query') return renderSystemActivity(result);
  const reply = readable(result.responseText);
  if (
    reply &&
    intent !== 'status_query' &&
    !(followup && /^(Case:|Readiness:|Missing evidence:)/im.test(reply))
  )
    return reply;
  if (intent === 'knowledge_query')
    return followup
      ? renderContextualExplanation(followup)
      : 'CET could not provide a verified explanation. Please specify the process and document version.';
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

module.exports = {
  classifyWorkbenchIntent,
  resolveWorkbenchFollowup,
  isReadOnlyIntent,
  renderWorkbenchResponse,
};
