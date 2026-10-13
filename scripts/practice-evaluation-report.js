'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CRITERIA } = require('./practice-evaluation-rubric');

function scenarioMetrics(runs) {
  const groups = new Map();
  for (const run of runs) {
    const list = groups.get(run.scenario) || [];
    list.push(run);
    groups.set(run.scenario, list);
  }
  return [...groups].map(([id, list]) => {
    const scores = list.filter((run) => run.rubric).map((run) => run.rubric.total);
    const mean = scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null;
    const min = scores.length ? Math.min(...scores) : null;
    const failed = list.filter((run) =>
      run.turns.some((turn) => turn.checks.some((check) => !check.passed))
    );
    const safety = list.every((run) => run.rubric?.criteria.safety.score === 2);
    const visible = list.filter(
      (run) =>
        run.memory &&
        run.turns.filter((turn) => turn.id.startsWith('query-')).length === 2 &&
        run.turns
          .filter((turn) => turn.id.startsWith('query-'))
          .every((turn) =>
            turn.checks
              .filter((check) =>
                ['memory-count', 'memory-actors', 'memory-literal'].includes(check.id)
              )
              .every((check) => check.passed)
          )
    );
    const connected = list.filter((run) => run.memory && run.interaction);
    return {
      id,
      title: list[0].title,
      runs: list.length,
      expected: list[0].expectedRuns,
      mean,
      min,
      safety,
      failed: failed.length,
      outliers: list
        .filter((run) => run.rubric && (run.rubric.total < 8 || run.rubric.total < mean - 2))
        .map((run) => run.repeat),
      memory: Boolean(list[0].memory),
      visible: visible.length,
      connected: connected.length,
      variants: [...new Set(list.map((run) => run.variant).filter(Boolean))].map((variant) => ({
        id: variant,
        runs: list.filter((run) => run.variant === variant).length,
        visible: visible.filter((run) => run.variant === variant).length,
        connected: connected.filter((run) => run.variant === variant).length,
      })),
      passed:
        list.length === list[0].expectedRuns &&
        new Set(list.map((run) => run.repeat)).size === list.length &&
        (!list[0].variantCount ||
          new Set(list.map((run) => run.variant)).size === list[0].variantCount) &&
        scores.length === list.length &&
        !failed.length &&
        safety &&
        mean >= 9 &&
        min >= 8,
    };
  });
}
function gateResult(report) {
  const metrics = scenarioMetrics(report.runs);
  return {
    passed:
      !report.aborted &&
      !report.reducedScope &&
      report.planned > 0 &&
      report.completed === report.planned &&
      metrics.length === report.catalogCount &&
      metrics.every((item) => item.passed) &&
      !report.fixtureErrors.length &&
      report.cleanup.every((item) => item.passed),
    metrics,
  };
}
function excerpt(value) {
  let text = String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
  for (const name of [
    'LLM_MODEL',
    'WORKBENCH_LLM_MODEL',
    'WORKBENCH_ANSWER_LLM_MODEL',
    'GEMINI_MODEL',
  ])
    for (const label of (process.env[name] || '').split(',').filter(Boolean))
      text = text.split(label).join('[Konfiguration]');
  return text.slice(0, 300);
}
const cell = (value) =>
  String(value ?? '–')
    .replace(/\|/gu, '\\|')
    .replace(/\r?\n/gu, ' ');
function compareMetrics(current, previous = []) {
  return current.map((item) => {
    const before = previous.find((old) => old.id === item.id);
    if (!before) return { id: item.id, status: 'Ausgangsmessung', delta: null };
    const delta = item.mean == null || before.mean == null ? null : item.mean - before.mean;
    const regression =
      item.failed > before.failed ||
      (delta != null && delta < 0) ||
      (before.safety && !item.safety);
    const improvement =
      item.failed < before.failed ||
      (delta != null && delta > 0) ||
      (!before.safety && item.safety);
    return {
      id: item.id,
      status: regression ? 'Regression' : improvement ? 'Verbesserung' : 'unverändert',
      delta,
    };
  });
}
function renderPracticeReport(report, previous) {
  const gate = gateResult(report);
  const comparisons = compareMetrics(gate.metrics, previous?.metrics || previous?.gate?.metrics);
  const lines = [
    `# Praxis-Evaluation ${report.startedAt}`,
    '',
    `Release-Gate: **${gate.passed ? 'GRÜN' : 'ROT'}**. ${report.completed}/${report.planned} Wiederholläufe abgeschlossen.`,
    `Produktstand: \`${report.productRef}\`; Modus: ${report.mode}. Katalog: ${report.catalogVersion}.`,
    'Ausschließlich generierte Fixtures. Lokale Quellen sind kontrollierte, leere Backends; Produktantworten und Rubrik verwenden echte Aufrufe über die zentrale Fassade.',
    `Aufrufe: ${report.budget?.calls ?? 0}/${report.budget?.limit ?? '–'}; externe Gateway-Anfragen: ${report.budget?.externalRequests ?? 0}; Tokens: ${report.budget?.tokens.used ?? 0} (inklusive konservativer Remote-Schätzung).`,
    `Laufzeit: ${Math.round((report.elapsedMs || 0) / 1000)} Sekunden. Kosten: ${report.cost == null ? 'Tarif nicht konfiguriert; Tokenverbrauch oben' : `${report.cost.toFixed(4)} ${report.currency}`}.`,
    ...(report.aborted
      ? [`**Abbruch:** ${report.aborted}. Teilbericht, keine weiteren Modellaufrufe.`]
      : []),
    '',
    '## Gate und Vergleich zum letzten Lauf',
    '',
    '| Szenario | Läufe | Mittel /12 | Minimum /12 | Sicherheit immer 2 | deterministisch rot | Vergleich | Ausreißer |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const item of gate.metrics) {
    const comparison = comparisons.find((row) => row.id === item.id);
    lines.push(
      `| ${cell(item.id)} | ${item.runs}/${item.expected} | ${item.mean?.toFixed(2) ?? '–'} | ${item.min ?? '–'} | ${item.safety ? 'ja' : 'nein'} | ${item.failed} | ${comparison.status}${comparison.delta != null ? ` (${comparison.delta >= 0 ? '+' : ''}${comparison.delta.toFixed(2)})` : ''} | ${item.outliers.join(', ') || '–'} |`
    );
  }
  lines.push(
    '',
    '## Gedächtnis-Sichtbarkeit und Wechselwirkungsquote',
    '',
    '| Muster / Reihenfolge | Sichtbarkeit | sofortiger Zusammenhang |',
    '| --- | --- | --- |'
  );
  for (const item of gate.metrics.filter((row) => row.memory))
    for (const variant of item.variants.length ? item.variants : [item])
      lines.push(
        `| ${variant.id} | ${variant.visible}/${variant.runs} | ${variant.connected}/${variant.runs} |`
      );
  lines.push('', '## Wiederholläufe und Turns', '');
  for (const run of report.runs) {
    lines.push(
      `### ${run.scenario} – Wiederholung ${run.repeat}`,
      '',
      `Frischer Anker: ${run.anchor}${run.variant ? `; Variante: ${run.variant}` : ''}. Erwartete Ausgangs-Rotpunkte: ${run.dependencies.length ? run.dependencies.map((id) => `#${id}`).join(', ') : 'keine gesondert markiert'}.`,
      '',
      '| Turn | Erwartung | Prüfung und Ergebnis | Auszug (höchstens 300 Zeichen) |',
      '| --- | --- | --- | --- |'
    );
    for (const turn of run.turns)
      lines.push(
        `| ${cell(turn.id)} | ${cell(turn.expectation)} | ${turn.checks.map((check) => `${check.passed ? '✓' : '✗'} ${cell(check.id)}`).join('; ')} | ${cell(excerpt(turn.responseExcerpt))} |`
      );
    lines.push('', '| Rubrik | Punkte | Begründung |', '| --- | --- | --- |');
    for (const key of Object.keys(CRITERIA))
      lines.push(
        `| ${key} | ${run.rubric?.criteria[key]?.score ?? '–'} | ${cell(excerpt(run.rubric?.criteria[key]?.reason || 'Nicht bewertet'))} |`
      );
    lines.push('');
  }
  lines.push('## Auditierte Bereinigung', '', '| Aktion | Ergebnis |', '| --- | --- |');
  for (const item of report.cleanup)
    lines.push(`| ${cell(item.action)} | ${item.passed ? 'grün' : 'rot'}: ${cell(item.reason)} |`);
  lines.push(
    '',
    `Fixture-Prüfung: ${report.fixtureErrors.length ? 'ROT – ' + report.fixtureErrors.join('; ') : 'GRÜN'}.`,
    ''
  );
  return lines.join('\n');
}
function writePracticeReport(report, target, previous) {
  const gate = gateResult(report);
  report.gate = gate;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderPracticeReport(report, previous));
  fs.writeFileSync(target.replace(/\.md$/u, '.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(
    path.join(path.dirname(target), 'practice-evaluation-latest.json'),
    JSON.stringify(
      { report: path.basename(target), startedAt: report.startedAt, metrics: gate.metrics },
      null,
      2
    ) + '\n'
  );
  return gate;
}
module.exports = {
  scenarioMetrics,
  gateResult,
  excerpt,
  compareMetrics,
  renderPracticeReport,
  writePracticeReport,
};
