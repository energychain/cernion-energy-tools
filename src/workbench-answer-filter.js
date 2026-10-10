'use strict';

const { copiesEvidence } = require('./workbench-answer-evidence');
const { exactToken } = require('./workbench-codes');
const { normalizePhrase } = require('./function-resolver');
const { bindingDraftPatterns } = require('./workbench-code-catalog.json');
const REASONS = {
  unresolved_code: 'Keine Aussagen von ungeklärten Codes abhängig machen.',
  salutation: 'Eine neutrale Anrede verwenden.',
  binding_draft: 'Keine verbindliche Prozessantwort oder Bestätigung vorwegnehmen.',
  source_in_text: 'Keine Quellenzeilen oder URLs im Absatz.',
  copies_evidence: 'Evidenz in eigenen Worten wiedergeben.',
  duplicate: 'Absätze nicht wiederholen.',
  empty_text: 'Absätze mit fachlichem Inhalt liefern.',
  completed_action:
    'Keine erledigten Handlungen als Tatsache ohne genau tragende Evidenz darstellen.',
  question_in_claim: 'Keine Rückfragen in Antwortabsätzen stellen.',
  evidence_rules: 'Evidenzregeln einhalten: nur mitgelieferte Evidenz-IDs verwenden.',
  incomplete_variant: 'Jede Variante vollständig und mit einheitlicher Voraussetzung liefern.',
  greeting_only: 'Einen vollständigen fachlichen Entwurf liefern, nicht nur Anrede und Gruß.',
};
function conditionOf(claim, normalizeCondition) {
  const first = claim.text.split('\n')[0];
  return normalizeCondition(
    claim.condition || (/^Variante\s+(?:\d+|[A-Z])\s*[:–—-]/iu.test(first) ? first : '')
  );
}
function substantive(claims) {
  const body = claims
    .map((claim) => claim.text)
    .join('\n')
    .replace(/^(?:Betreff:|Variante\s+(?:\d+|[A-Z])\s*[:–—-]).*$/gimu, '')
    .replace(/(?:Guten Tag|Sehr geehrte[^,\n]*|Hallo)[^,\n]*[,!]?/giu, '')
    .replace(/(?:Mit freundlichen Grüßen|Freundliche Grüße|Viele Grüße|Beste Grüße)[^\n]*/giu, '');
  return (body.match(/[\p{L}]{3,}/gu) || []).length >= 3;
}
function filterAnswer(
  parsed,
  { evidence, answerEvidence, unresolved, message, normalizeCondition, counts }
) {
  const ids = new Set(answerEvidence.map((entry) => entry.evidenceId));
  const seenClaims = new Set();
  const reject = (field, rule) => {
    const key = `${field}:${rule}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (const field of ['interpretation', 'expectation', 'nextSteps', 'assumptions', 'draft']) {
    const original = parsed[field] || [];
    const rejectedConditions = new Set();
    const filtered = original.filter((claim) => {
      const rules = [];
      if (require('./workbench-tool-answer').internalToolText(claim.text, evidence))
        rules.push('raw_tool_output');
      if (
        unresolved.some(
          (code) =>
            exactToken(claim.text, code.value) ||
            (claim.codeDependencies || []).includes(code.value)
        )
      )
        rules.push('unresolved_code');
      const salutation =
        /Sehr geehrte[rn]?\s+(?!Damen\s+und\s+Herren)[^,\n]+/iu.exec(claim.text)?.[0] ||
        /Guten Tag\s+(?:Frau|Herr)\s+[^,\n]+/iu.exec(claim.text)?.[0];
      if (
        field === 'draft' &&
        salutation &&
        !message.toLocaleLowerCase().includes(salutation.toLocaleLowerCase())
      )
        rules.push('salutation');
      if (
        field === 'draft' &&
        bindingDraftPatterns.some((pattern) => new RegExp(pattern, 'i').test(claim.text))
      )
        rules.push('binding_draft');
      if (/Quellen:|https?:\/\//iu.test(claim.text)) rules.push('source_in_text');
      const identity = `${field === 'draft' ? 'draft:' + conditionOf(claim, normalizeCondition) : ''}:${normalizePhrase(claim.text)}`;
      if (copiesEvidence(claim.text, evidence)) rules.push('copies_evidence');
      if (seenClaims.has(identity)) rules.push('duplicate');
      if (!claim.text.trim()) rules.push('empty_text');
      if (
        claim.completedAction &&
        !(field === 'draft' && claim.condition?.trim()) &&
        !(
          claim.supported === 'evidence' &&
          claim.evidenceIds.some((id) =>
            evidence.find((hit) => hit.evidenceId === id)?.value?.includes(claim.text)
          )
        )
      )
        rules.push('completed_action');
      if (field !== 'draft' && claim.text.includes('?')) rules.push('question_in_claim');
      if (
        claim.supported === 'model'
          ? claim.evidenceIds.length !== 0
          : !claim.evidenceIds.length || !claim.evidenceIds.every((id) => ids.has(id))
      )
        rules.push('evidence_rules');
      for (const rule of rules) reject(field, rule);
      if (rules.length) {
        if (field === 'draft') rejectedConditions.add(conditionOf(claim, normalizeCondition));
        return false;
      }
      seenClaims.add(identity);
      return true;
    });
    parsed[field] =
      field !== 'draft'
        ? filtered
        : filtered.filter((claim) => {
            const condition = conditionOf(claim, normalizeCondition);
            // A rejected shared block compromises every variant that uses it.
            if (rejectedConditions.has('') || rejectedConditions.has(condition)) {
              reject(field, 'incomplete_variant');
              return false;
            }
            return true;
          });
    if (field === 'draft') {
      if (
        original.some((claim) => conditionOf(claim, normalizeCondition)) &&
        !parsed.draft.some((claim) => conditionOf(claim, normalizeCondition))
      ) {
        for (const _claim of parsed.draft) reject(field, 'incomplete_variant');
        parsed.draft = [];
      }
      const conditions = [
        ...new Set(
          parsed.draft.map((claim) => conditionOf(claim, normalizeCondition)).filter(Boolean)
        ),
      ];
      const empty = new Set(
        (conditions.length ? conditions : ['']).filter(
          (condition) =>
            !substantive(
              parsed.draft.filter(
                (claim) =>
                  !conditionOf(claim, normalizeCondition) ||
                  conditionOf(claim, normalizeCondition) === condition
              )
            )
        )
      );
      parsed.draft = parsed.draft.filter((claim) => {
        const condition = conditionOf(claim, normalizeCondition);
        if (
          empty.has(condition) ||
          (!condition && conditions.length && empty.size === conditions.length)
        ) {
          reject(field, 'greeting_only');
          return false;
        }
        return true;
      });
      if (
        conditions.length &&
        !parsed.draft.some((claim) => conditionOf(claim, normalizeCondition))
      )
        parsed.draft = [];
    }
  }
  return parsed;
}
function repairForFilters(counts) {
  const rules = [...new Set([...counts.keys()].map((key) => key.split(':')[1]))];
  return [
    'Erzeuge den vollständigen Entwurf erneut und beachte diese Korrekturen:',
    ...rules.map((rule) => REASONS[rule]),
    'Jede bedingte Variante muss vollständig sein; die übrigen Antwortfelder bleiben leer.',
  ].join('\n');
}
module.exports = { filterAnswer, repairForFilters };
