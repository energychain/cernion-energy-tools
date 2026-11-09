'use strict';

const crypto = require('node:crypto');
const { isPrivateTask } = require('./context-links');

const PRIVATE_BOARDS = new Set(['twl-netze-private']);
const PRIVATE_SENSITIVITIES = new Set([
  'twl-private',
  'twl-netze-private',
  'private',
  'private-quarantine',
  'mixed-sensitive',
  'unclear',
]);

function digestId(task) {
  const hash = crypto
    .createHash('sha256')
    .update(['digest', task.board || '', task.id || ''].join('\0'))
    .digest('hex')
    .slice(0, 24);
  return `digest_${hash}`;
}

function observedAt(task) {
  return Number(task.completed_at || task.started_at || task.updated_at || task.created_at || 0);
}

function dayBucket(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'unknown';
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function sourceText(task) {
  return [
    task.title,
    task.body,
    task.result,
    ...(task.comments || []).map((comment) => comment.body),
    ...(task.attachments || []).map((attachment) => attachment.filename),
  ]
    .filter(Boolean)
    .join('\n');
}

function markerValue(text, names) {
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${names.join('|')})\\s*[:=]\\s*([^\\s,;]+)`, 'im');
  return pattern.exec(text)?.[1] || null;
}

function truthyMarker(text, name) {
  const match = new RegExp(`(?:^|\\n)\\s*${name}(?:\\s*[:=]\\s*([^\\s,;]+))?`, 'im').exec(text);
  if (!match) return false;
  return match[1] === undefined || /^(?:1|true|yes)$/i.test(match[1]);
}

function sourceHints(task) {
  const text = sourceText(task);
  const severity = markerValue(text, ['SEVERITY']);
  return {
    lowerText: text.toLowerCase(),
    duplicateOf: markerValue(text, ['DUPLICATE_OF']),
    parentId: markerValue(text, ['PARENT_TASK', 'PARENT_ID']),
    technicalIntake: truthyMarker(text, 'TECHNICAL_INTAKE'),
    materialDeviation: truthyMarker(text, 'MATERIAL_DEVIATION'),
    severity: severity ? severity.toLowerCase() : null,
  };
}

function strongDeviationReasons(hints) {
  const reasons = [];
  const text = hints.lowerText;
  if (hints.materialDeviation) reasons.push('explicit_material_deviation');
  if (['critical', 'high', 'sev0', 'sev1', 'p0', 'p1'].includes(hints.severity))
    reasons.push(`severity:${hints.severity}`);
  if (
    /\bcritical\b.{0,60}\b(?:alert|incident|security|outage|production|customer|deadline|financial)\b|\b(?:alert|incident|security|outage|production|customer|deadline|financial)\b.{0,60}\bcritical\b/i.test(
      text
    )
  )
    reasons.push('critical_signal');
  if (
    /\b(?:security (?:breach|incident)|data breach|credentials? compromised|ransomware|unauthori[sz]ed access)\b/i.test(
      text
    )
  )
    reasons.push('security_impact');
  if (
    /\b(?:(?:production|service|system)(?: is)? (?:down|unavailable)|production outage|service outage)\b/i.test(
      text
    )
  )
    reasons.push('production_outage');
  if (/\b(?:customer impact|customers? (?:are )?affected|customer-facing outage)\b/i.test(text))
    reasons.push('customer_impact');
  if (
    /\b(?:deadline (?:breach|missed)|(?:regulatory|contractual|compliance|filing) deadline (?:is )?(?:at risk|missed|breached))\b/i.test(
      text
    )
  )
    reasons.push('deadline_impact');
  if (/\b(?:financial (?:loss|exposure|impact)|material monetary loss)\b/i.test(text))
    reasons.push('financial_impact');
  return [...new Set(reasons)];
}

function isPrivate(task) {
  return (
    PRIVATE_BOARDS.has(String(task.board || '')) ||
    PRIVATE_SENSITIVITIES.has(String(task.sensitivity || '').toLowerCase()) ||
    task.sensitivityUnclear === true ||
    isPrivateTask(task)
  );
}

function normalizedSourceKind(task) {
  return String(
    task.digestCategory || task.sourceKind || task.sourceType || task.notificationType || ''
  )
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, '_');
}

function subjectCategory(task) {
  const title = String(task.title || '').trim();
  if (/^(?:\[[^\]]*newsletter[^\]]*\]|newsletter)(?:\s*[:\-–—]|\s|$)/i.test(title))
    return 'newsletter';
  if (/^(?:(?:daily|weekly|monthly)\s+)?digest(?:\s*[:\-–—]|\s|$)/i.test(title)) return 'digest';
  if (/^(?:(?:ordinary|routine|daily|weekly)\s+)?status[- ]mail(?:\s*[:\-–—]|\s|$)/i.test(title))
    return 'status_mail';
  if (/^(?:known|monitoring|routine|system|service)\s+alert(?:\s*[:\-–—]|\s|$)/i.test(title))
    return 'known_alert';
  if (
    /^(?:monitoring|system|service)\s+(?:status|report|summary)(?:\s*[:\-–—]|\s|$)/i.test(title) &&
    /\b(?:all (?:systems|services) (?:green|normal|operational)|no (?:change|incident|action required)|routine|unchanged)\b/i.test(
      sourceText(task)
    )
  )
    return 'status_mail';
  return null;
}

function categoryOf(task) {
  const hints = sourceHints(task);
  if (task.duplicateOf || hints.duplicateOf) return 'duplicate';
  if (
    task.technicalIntakeSubtask === true ||
    task.isTechnicalIntakeSubtask === true ||
    hints.technicalIntake
  )
    return 'technical_intake';
  if (task.knownAlert === true || task.alertKnown === true) return 'known_alert';
  if (task.isDigest === true) return 'digest';
  const sourceKind = normalizedSourceKind(task);
  if (sourceKind === 'newsletter') return 'newsletter';
  if (sourceKind === 'digest') return 'digest';
  if (sourceKind === 'status_mail') return 'status_mail';
  if (['alert', 'known_alert', 'monitoring_alert'].includes(sourceKind)) return 'known_alert';
  const subject = subjectCategory(task);
  if (subject) return subject;
  if (strongDeviationReasons(hints).length > 0) return 'known_alert';
  if (task.isNoise === true) return 'noise';
  return null;
}

function isMaterialDeviation(task) {
  const hints = sourceHints(task);
  return (
    task.materialDeviation === true ||
    task.material === true ||
    task.deviation?.material === true ||
    task.alertStatus === 'deviation' ||
    (task.isAlert === true && task.knownAlert === false) ||
    strongDeviationReasons(hints).length > 0
  );
}

function dispositionOf(category, material) {
  if (material) return 'escalate';
  if (category === 'duplicate') return 'source_only';
  if (category === 'technical_intake') return 'auto_close_candidate';
  return 'digest';
}

function reasonsOf(task, category, material) {
  const hints = sourceHints(task);
  const reasons = [`category:${category}`];
  const duplicateOf = task.duplicateOf || hints.duplicateOf;
  const parentId = task.parent_id || hints.parentId;
  if (duplicateOf) reasons.push(`duplicate_of:${duplicateOf}`);
  if (parentId && category === 'technical_intake') reasons.push(`parent:${parentId}`);
  if (material) reasons.push('material_deviation');
  reasons.push(...strongDeviationReasons(hints));
  for (const reason of task.deviationReasons || task.deviation?.reasons || []) {
    if (reason) reasons.push(String(reason));
  }
  return [...new Set(reasons)];
}

function conciseSignal(task) {
  const value = String(task.title || task.id || 'Untitled observation')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value.slice(0, 240);
}

function projectDigestItems(tasks) {
  const items = [];
  let excludedPrivate = 0;
  let materialCount = 0;

  for (const task of tasks) {
    if (isPrivate(task)) {
      excludedPrivate += 1;
      continue;
    }
    const category = categoryOf(task);
    if (!category) continue;
    const material = isMaterialDeviation(task);
    if (material) materialCount += 1;
    const timestamp = observedAt(task);
    items.push({
      digest_id: digestId(task),
      day_bucket: dayBucket(timestamp),
      source_board: String(task.board || ''),
      source_task_id: String(task.id || ''),
      topic_id: null,
      category,
      disposition: dispositionOf(category, material),
      signal: conciseSignal(task),
      material: material ? 1 : 0,
      recommendation:
        category === 'technical_intake'
          ? 'Review source state; do not auto-close or mutate it.'
          : material
            ? 'Review as a possible material deviation; no source action was performed.'
            : null,
      reasons_json: JSON.stringify(reasonsOf(task, category, material)),
      provenance_json: JSON.stringify({
        board: String(task.board || ''),
        taskId: String(task.id || ''),
      }),
      observed_at: timestamp,
    });
  }

  return {
    items,
    diagnostics: {
      considered: tasks.length,
      projected: items.length,
      material: materialCount,
      escalatable: items.filter((item) => item.disposition === 'escalate').length,
      excludedPrivate,
    },
  };
}

module.exports = {
  categoryOf,
  digestId,
  isMaterialDeviation,
  projectDigestItems,
};
