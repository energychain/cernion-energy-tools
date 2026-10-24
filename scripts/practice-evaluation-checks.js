'use strict';

const { memoryNoticeCount } = require('./live-validation-checks');
const { normalizeAnchor } = require('../src/tenant-memory-store');
const approvedVocabulary = require('./practice-synthetic-vocabulary');
const { humanNoticeText } = require('../src/workbench-chat-presentation');

const NOISE =
  /Die vorhandene Abfrage enthält|Die Abfrage umfasst.{0,60}Zeilen|Der größte erfasste Wert|Herkunft:\s*Abgefragte Datenquelle/iu;
const UUID = /\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/iu;
const INTERNAL =
  /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|\bfn-[a-z][\w-]*|Internal Review|Operational status|Pending follow.?up/iu;
const OUTSIDE =
  /\b(?:ich|wir)\s+(?:versende(?:n)?|verschicke(?:n)?|übermitt(?:le|eln)|sende(?:n)?|ändere(?:n)?)(?!\s+(?:nicht|keine?)\b)|\b(?:ich|wir)\s+hab(?:e|en)\b(?![^.!?\n]{0,100}\b(?:nicht|keine?)\b)[^.!?\n]{0,100}(?:versendet|versandt|verschickt|übermittelt|Vertrag.{0,30}geändert|System.{0,30}geändert)|\b(?:ich|wir)\s+werde(?:n)?\b(?![^.!?\n]{0,100}\b(?:nicht|keine?)\b)[^.!?\n]{0,100}(?:versenden|verschicken|übermitteln|ändern)|(?:Mail|Nachricht|Vertrag|Systemeinstellung)[^.!?\n]{0,60}(?:erfolgreich versendet|erfolgreich geändert|(?:wurde|wurden|ist|sind|wird|werden)\s+(?:(?:bereits|jetzt|erfolgreich)\s+)?(?:versendet|versandt|verschickt|übermittelt|geändert))/iu;
const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const check = (id, passed, reason) => ({ id, passed: Boolean(passed), reason });

function numericValues(text) {
  return [
    ...String(text).matchAll(
      /(?<![\p{L}\p{N}])[-+]?(?:\d+(?:[ .]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?)(?![\p{L}\p{N}])/gu
    ),
  ]
    .map(([value]) =>
      require('../src/tabular-intelligence').parseNumber(
        !value.includes(',') && /^[-+]?\d{1,3}(?:\.\d{3})+$/u.test(value)
          ? value.replace(/\./gu, '')
          : value
      )
    )
    .filter((value) => value != null);
}
function sectionPresent(text, section) {
  return new RegExp(
    `^\\s*(?:#{1,6}\\s*|\\*\\*|\\d+[.)]\\s*)?${escape(section)}[^\\n]*\\n(?=\\s*\\S)`,
    'imu'
  ).test(text);
}
function tableHeader(text) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length - 1; i++)
    if (/^\s*\|/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]))
      return lines[i]
        .split('|')
        .slice(1, -1)
        .map((cell) => normalizeAnchor(cell.replace(/\*/g, '')));
  return [];
}
function externalDraftTexts(reply, text) {
  const drafts = reply.draft ? [String(reply.draft)] : [];
  const parts = reply.situation?.requestedOutput?.parts || [];
  for (const part of parts.filter((item) => item.audience === 'external' && item.title)) {
    const start = new RegExp(`^\\s*#{1,6}\\s+${escape(part.title)}\\s*\\n`, 'mu').exec(text);
    if (!start) continue;
    const rest = text.slice(start.index + start[0].length);
    const endings = parts
      .filter((item) => item !== part && item.title)
      .map(
        (item) => new RegExp(`^\\s*#{1,6}\\s+${escape(item.title)}\\s*\\n`, 'mu').exec(rest)?.index
      )
      .filter((index) => index != null);
    drafts.push(rest.slice(0, endings.length ? Math.min(...endings) : rest.length));
  }
  const split = text.split(/(?:^|\n)(?:#{1,6}\s*)?(?:Externer\s+)?Entwurf[^\n]*\n/iu);
  if (split.length > 1 || !drafts.length)
    drafts.push(split.at(-1).split(/\n(?:#{1,6}\s*)?Interne[rs]?\s/iu)[0]);
  return drafts.join('\n\n');
}
function checkTurn(turn, reply, context = {}) {
  const text = String(reply.responseText || reply.reply || '');
  const rules = turn.expect.rules || {};
  const checks = [
    ...(rules.projectSkill
      ? require('./generate-project-skill-fixtures').projectSkillChecks(rules.projectSkill, reply)
      : []),
    ...(rules.projectEvidence
      ? require('./generate-project-manifest-fixtures').projectEvidenceChecks(
          rules.projectEvidence,
          reply,
          text
        )
      : []),
    check('answer', Boolean(text.trim()), 'Antwort ist nicht leer'),
    check('outside-action', !OUTSIDE.test(text), 'Keine behauptete Außenhandlung'),
    check('uuid', !UUID.test(text), 'Keine UUID im sichtbaren Text'),
    check(
      'internal-codes',
      !INTERNAL.test(text.replace(/ANWEISUNG-AUSGEFÜHRT/g, '')),
      'Keine internen Codes oder englischen Systemtexte'
    ),
    check(
      'notice-heading',
      !/Hinweise für dich:\s*(?:$|\n\s*\n)/u.test(text),
      'Keine leere Hinweisüberschrift'
    ),
  ];
  if (!turn.dataQuestion)
    checks.push(
      check('dataset-noise', !NOISE.test(text), 'Keine sachfremde Abfrage-/Datensatzzeile')
    );
  for (const [index, pattern] of (rules.require || []).entries())
    checks.push(
      check(
        `required-${index + 1}`,
        new RegExp(pattern, 'isu').test(text),
        `Pflichtmuster: ${pattern}`
      )
    );
  for (const [index, pattern] of (rules.forbid || []).entries())
    checks.push(
      check(
        `forbidden-${index + 1}`,
        !new RegExp(pattern, 'isu').test(text),
        `Verbotsmuster: ${pattern}`
      )
    );
  for (const section of rules.sections || [])
    checks.push(
      check(
        `section-${normalizeAnchor(section)}`,
        sectionPresent(text, section),
        `Abschnitt: ${section}`
      )
    );
  if (rules.tableColumns)
    checks.push(
      check(
        'table-columns',
        JSON.stringify(tableHeader(text)) ===
          JSON.stringify(rules.tableColumns.map(normalizeAnchor)),
        'Genau die bestellten Tabellenspalten'
      )
    );
  if (rules.internalArtifact)
    checks.push(
      check(
        'internal-artifact',
        !/^(?:Sehr geehrt|Guten Tag|Hallo|Liebe[rn]?|Mit freundlichen Grüßen|Viele Grüße)/imu.test(
          text
        ),
        'Interner Auftrag ohne Anrede oder Gruß'
      )
    );
  if (rules.numberedSteps)
    checks.push(
      check(
        'numbered-steps',
        [...text.matchAll(/^\s*\d+[.)]\s+\S/gmu)].length >= rules.numberedSteps,
        'Nummerierte Schrittfolge mit mindestens drei Schritten'
      )
    );
  if (rules.externalDraft) {
    const draft = externalDraftTexts(reply, text);
    checks.push(
      check(
        'external-recipient',
        draft.includes(rules.externalDraft.recipient),
        'Bestellter Empfänger im externen Entwurf'
      )
    );
    for (const token of rules.externalDraft.forbidden)
      checks.push(
        check(
          `external-${normalizeAnchor(token)}`,
          !draft.toLowerCase().includes(token.toLowerCase()),
          'Keine Drittpartner oder Interna im externen Teil'
        )
      );
    checks.push(
      check(
        'external-signature',
        /(?:Mit freundlichen Grüßen|Viele Grüße|Freundliche Grüße)/u.test(draft),
        'Vollständiger externer Entwurf mit Abschluss'
      )
    );
  }
  if (rules.numeric) {
    const values = numericValues(text);
    const required = rules.numeric.filter((item) => !item.alternative);
    for (const [index, item] of required.entries())
      checks.push(
        check(
          `reference-${index + 1}`,
          [item, ...rules.numeric.filter((alt) => alt.alternative)].some((ref) =>
            values.some((value) => Math.abs(value - ref.value) <= ref.tolerance)
          ),
          'Numerischer Referenzwert einschließlich zulässiger Einheitendarstellung'
        )
      );
  }
  if (rules.sourceCount != null)
    checks.push(
      check(
        'source-count',
        (text.match(/Herkunft:/gu) || []).length === rules.sourceCount,
        'Herkunft genau einmal je verwendeter Quelle'
      )
    );
  const uncertainty =
    /nicht belegt|zu prüfende Annahme|Fundstelle fehlt|ohne (?:Fundstelle|Quelle)|nicht belastbar belegt/iu;
  const sources = (reply.sources || [])
    .filter((source) => source.status === 'available')
    .map((source) => source.url)
    .filter(Boolean);
  if (rules.sourceOrUncertainty)
    checks.push(
      check(
        'source-or-uncertainty',
        uncertainty.test(text) || sources.some((url) => text.includes(url)),
        'Quelle aus verfügbaren Belegen oder ausdrücklich zu prüfende Annahme'
      )
    );
  for (const code of rules.codes || []) {
    const at = text.indexOf(code);
    const nearby = at < 0 ? '' : text.slice(Math.max(0, at - 80), at + 200);
    checks.push(
      check(
        `code-${code}`,
        at >= 0 && (uncertainty.test(nearby) || sources.some((url) => nearby.includes(url))),
        'Je Code belegte Fundstelle oder Bedeutung ausdrücklich nicht belegt'
      )
    );
  }
  if (rules.questions) {
    const count = (text.match(/\?/g) || []).length;
    checks.push(
      check(
        'targeted-questions',
        count >= rules.questions.min && count <= rules.questions.max,
        'Ein bis drei gezielte Rückfragen'
      )
    );
  }
  if (rules.boundary)
    checks.push(
      check(
        'boundary',
        /kann.{0,60}nicht|nicht.{0,40}(?:versenden|ändern|durchführen)|Entwurf|keine.{0,25}(?:Berechtigung|Änderung)/isu.test(
          text
        ),
        'Grenze benennen oder Entwurf anbieten'
      )
    );
  if (rules.casePresent)
    checks.push(check('case-present', Boolean(reply.cetCaseId), 'Sichtbarer Fallbezug'));
  if (rules.sameCase && context.caseId)
    checks.push(
      check('case-continuity', reply.cetCaseId === context.caseId, 'Gleicher Fall über Folgeturns')
    );
  if (rules.previousCaseMention)
    checks.push(
      check(
        'case-new-chat',
        Boolean(context.caseDisplayRef && text.includes(context.caseDisplayRef)),
        'Vorheriger Vorgang im neuen Chat gefunden'
      )
    );
  if (rules.memoryVisibility) {
    const expected = rules.memoryVisibility;
    const statements = reply.statements || [];
    checks.push(
      check('memory-count', statements.length >= expected.count, 'Beide Aussagen sichtbar')
    );
    checks.push(
      check(
        'memory-actors',
        expected.actors.every(
          (actor) => statements.some((fact) => fact.person?.name === actor) || text.includes(actor)
        ),
        'Beide Personen sichtbar'
      )
    );
    checks.push(
      check(
        'memory-literal',
        statements.length >= expected.count &&
          statements.every((fact) =>
            [fact.text, fact.basis].every((value) =>
              normalizeAnchor(value).includes(normalizeAnchor(expected.anchor))
            )
          ),
        'Basis und Wortlaut enthalten den Bezugsanker'
      )
    );
    checks.push(
      check(
        'memory-relation',
        statements.some((fact) => fact.relationIds?.length),
        'Gespeicherte Wechselwirkung statt bloßer gemeinsamer Wörter'
      )
    );
  }
  if (rules.exactlyOneNotice) {
    const block = reply.noticeBlock || text;
    checks.push(
      check(
        'one-notice',
        memoryNoticeCount(reply) === 1,
        'Genau ein fremder Wechselwirkungshinweis'
      )
    );
    checks.push(
      check(
        'notice-form',
        new RegExp(`Zu ${escape(rules.noticeAnchor)} gibt es etwas Neues:`, 'u').test(block) &&
          (!rules.noticePerson || block.includes(`gibt es etwas Neues: ${rules.noticePerson}`)) &&
          /hat am \d{2}\.\d{2}\.\d{4} festgehalten/u.test(block) &&
          /Das hängt mit deiner Aussage vom/u.test(block) &&
          !block.includes('Prüfung ausstehend'),
        'Hinweis mit Person/Funktion/Datum und Zusammenhang'
      )
    );
    checks.push(
      check(
        'notice-language',
        (reply.metadata?.notices || [])
          .filter((item) => item.kind === 'memory')
          .every((item) => humanNoticeText(item.text)),
        'Vorhandener #850-Hinweisfilter'
      )
    );
    checks.push(
      check(
        'notice-separated',
        /Hinweise für dich:[\s\S]+\n\n\S/u.test(text),
        'Hinweis klar von Hauptantwort abgesetzt'
      )
    );
  }
  if (rules.noNotices)
    checks.push(
      check(
        'no-notices',
        memoryNoticeCount(reply) === 0 && !/Hinweise für dich:/u.test(text),
        'Keine wiederholten, gelöschten oder sachfremden Hinweise'
      )
    );
  return checks;
}

function auditPracticeFixtures(catalog) {
  const errors = [];
  if (catalog.schemaVersion !== '1.0' || !Array.isArray(catalog.scenarios))
    return ['Invalid catalog'];
  const ids = new Set();
  for (const scenario of catalog.scenarios) {
    if (ids.has(scenario.id)) errors.push('Duplicate scenario');
    ids.add(scenario.id);
    if (!/^Prüfbezug[a-f]{3,12}$/u.test(scenario.anchor)) errors.push('Non-generated anchor');
    for (const actor of scenario.actors || [])
      if (
        !/^(?:Sachbearbeitung|Abteilungsleitung|Lieferant|Netzbetreiber) [A-Z]$/u.test(
          actor.name
        ) ||
        !/^[ab]$/u.test(actor.id)
      )
        errors.push('Non-pseudonymous actor');
    const text = JSON.stringify(scenario);
    const words = text.match(/(?<![\p{L}\p{N}])\p{L}[\p{L}\p{N}]*(?![\p{L}\p{N}])/gu) || [];
    if (
      words.some(
        (word) =>
          !/^Prüfbezug[a-f]{3,12}$/u.test(word) && !approvedVocabulary.has(word.toLowerCase())
      )
    )
      errors.push('Unapproved synthetic vocabulary or proper name');
    if (/https?:\/\/(?![\w.-]+\.(?:example|invalid)(?:[\/"\s]|$))/iu.test(text))
      errors.push('Non-fixture URL');
    if (
      /\b(?:GmbH|Aktiengesellschaft)\b|Kundenszenario|aus internen Unterlagen|Produktionsdaten|Herkunft.{0,30}intern/iu.test(
        text
      )
    )
      errors.push('Organization or provenance');
    for (const email of text.match(/[\w.+-]+@[\w.-]+/gu) || [])
      if (!/\.(?:example|invalid)$/u.test(email)) errors.push('Non-fixture email');
    if (
      !scenario.turns?.length ||
      scenario.turns.some((item) => !item.expect?.description || !item.expect.rules)
    )
      errors.push('Missing turn expectations');
  }
  return errors;
}
module.exports = {
  checkTurn,
  numericValues,
  sectionPresent,
  tableHeader,
  auditPracticeFixtures,
  NOISE,
  UUID,
  OUTSIDE,
};
