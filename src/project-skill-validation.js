'use strict';

const { parse, Budgets, contentHash } = require('./cet-script');
const { runProjectSkill } = require('./cet-script/project');

const budgets = Object.freeze({
  runtimeMs: 5000,
  steps: 500000,
  sqlQueries: 8,
  sqlRowsPerQuery: 1000,
  sqlRowsTotal: 4000,
  resultBytes: 64000,
  opCalls: 2,
});
const fail = (message) => {
  throw new Error(message);
};

function equal(actual, expected, tolerance = 1e-8) {
  if (typeof expected === 'number')
    return (
      typeof actual === 'number' &&
      Number.isFinite(actual) &&
      Math.abs(actual - expected) <= tolerance
    );
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, i) => equal(actual[i], item, tolerance))
    );
  if (expected && typeof expected === 'object')
    return (
      actual &&
      typeof actual === 'object' &&
      Object.keys(actual).length === Object.keys(expected).length &&
      Object.keys(expected).every(
        (key) => Object.hasOwn(actual, key) && equal(actual[key], expected[key], tolerance)
      )
    );
  return actual === expected;
}

function assertReadOnly(node) {
  if (!node || typeof node !== 'object') return;
  if (
    node.type === 'MemberExpression' &&
    (node.property?.name === 'derived' || node.property?.value === 'derived')
  )
    fail('Derived storage is unavailable to learned skills');
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(assertReadOnly);
    else if (value && typeof value === 'object') assertReadOnly(value);
  }
}

function checkExpected(output, expect) {
  const result = output.result;
  const rows = result.rows || [];
  const tolerance = Math.min(expect.tolerance ?? 1e-8, 0.001);
  if (expect.error) fail('Expected script error was not raised');
  if (expect.rows !== undefined && rows.length !== expect.rows) fail('Row expectation failed');
  if (
    expect.columns &&
    !expect.columns.every((name) => rows.every((row) => Object.hasOwn(row, name)))
  )
    fail('Column expectation failed');
  if (expect.value !== undefined && !equal(result.value, expect.value, tolerance))
    fail('Value expectation failed');
  if (
    expect.contains &&
    !expect.contains.every((expected) =>
      rows.some((row) =>
        Object.entries(expected).every(([key, value]) => equal(row[key], value, tolerance))
      )
    )
  )
    fail('Contained row expectation failed');
  if (
    expect.gap !== undefined &&
    Boolean(output.log.some((entry) => entry.kind === 'gap')) !== expect.gap
  )
    fail('Gap expectation failed');
}

function dateAlternatives(field, manifest) {
  return manifest.timeRanges.flatMap((range) => {
    const from = Date.parse(range.from),
      to = Date.parse(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return [];
    const middle = new Date(Math.floor((from + to) / 2)).toISOString();
    return [middle, range.from, range.to].map((date) =>
      field.format === 'date' ? date.slice(0, 10) : date
    );
  });
}
function preservesDateOrder(module, original, candidate) {
  const keys = Object.keys(original).filter((key) =>
    ['date', 'date-time'].includes(module.meta.inputs.properties?.[key]?.format)
  );
  return keys.every((left) =>
    keys.every((right) => {
      const before = Date.parse(original[left]) - Date.parse(original[right]);
      const after = Date.parse(candidate[left]) - Date.parse(candidate[right]);
      return before === 0 || (before < 0 ? after < 0 : after > 0);
    })
  );
}
// Prefer a shorter nonempty interval from the manifest; equal start/end is not a test case.
function additionalInput(module, input, manifest) {
  const fields = Object.entries(input).sort(([, a], [, b]) => String(b).localeCompare(String(a)));
  for (const [key, value] of fields) {
    const field = module.meta.inputs.properties?.[key];
    const alternatives = ['date', 'date-time'].includes(field?.format)
      ? dateAlternatives(field, manifest)
      : manifest.entities.flatMap((entity) => [entity.name, entity.label]).filter(Boolean);
    for (const alternative of alternatives) {
      const candidate = { ...input, [key]: alternative };
      if (
        alternative !== value &&
        module.validateInput(candidate) &&
        preservesDateOrder(module, input, candidate)
      )
        return candidate;
    }
  }
  fail('No independent manifest input available');
}
function readParameters(output) {
  return output.log
    .filter(
      (entry) =>
        entry.kind === 'sql' ||
        entry.kind.startsWith('graph.') ||
        entry.kind.startsWith('passages.') ||
        entry.kind === 'op'
    )
    .map(({ kind, params }) => ({ kind, params }));
}

async function runModuleTests(module, run) {
  const checks = [];
  for (const test of module.tests) {
    let output;
    try {
      output = await run(test.input);
    } catch (error) {
      if (
        !module.validateInput(test.input) &&
        test.expect.error === 'CET_SCRIPT_RUNTIME_ERROR' &&
        error.type === test.expect.error
      ) {
        checks.push({ kind: 'script', passed: true });
        continue;
      }
      throw error;
    }
    checkExpected(output, test.expect);
    checks.push({ kind: 'script', passed: true });
  }
  return checks;
}

async function validateChecks(skill, manifest, run) {
  const module = parse(skill.program, new Budgets(budgets));
  assertReadOnly(module.skill);
  if (!module.tests.length || module.tests.length > 8) fail('One to eight script tests required');
  const baseline = skill.baseline;
  if (!module.tests.some((test) => equal(test.input, baseline.input)))
    fail('Original input missing from script tests');
  const checks = [{ kind: 'static', passed: true }];
  const first = await run(baseline.input);
  if (!equal(first.result.rows ?? first.result.value, baseline.expected, baseline.tolerance))
    fail('Result differs from the evidenced answer');
  if (
    !first.log.some(
      (entry) =>
        entry.kind === 'sql' ||
        entry.kind.startsWith('graph.') ||
        entry.kind.startsWith('passages.') ||
        entry.kind === 'op'
    )
  )
    fail('A data read is required');
  const replay = await run(baseline.input);
  if (first.replayHash !== replay.replayHash || !equal(first.result, replay.result, 0))
    fail('Replay is unstable');
  checks.push({ kind: 'original', passed: true }, { kind: 'replay', passed: true });
  checks.push(...(await runModuleTests(module, run)));
  const input =
    skill.validation?.additionalInput || additionalInput(module, baseline.input, manifest);
  const extra = await run(input);
  // A changed argument must reach a different read and return actual numeric evidence.
  if (contentHash(readParameters(first)) === contentHash(readParameters(extra)))
    fail('Additional input did not change the data query');
  if (Object.keys(first.provenance).length && !Object.keys(extra.provenance).length)
    fail('Additional case has no numeric evidence');
  if (
    skill.validation?.additionalExpected &&
    !equal(extra.result, skill.validation.additionalExpected)
  )
    fail('Additional case changed');
  checks.push(
    { kind: 'additional', passed: true },
    { kind: 'container_readonly', passed: true },
    { kind: 'budgets', passed: true }
  );
  return {
    checks,
    replayHash: first.replayHash,
    passedAt: new Date().toISOString(),
    additionalInput: input,
    additionalExpected: extra.result,
  };
}

async function validateProjectSkill(ctx, skill, manifest, answerInput) {
  return runProjectSkill(ctx, {
    projectId: skill.projectId,
    source: skill.program,
    asOf: skill.asOf,
    budgets,
    readOnly: true,
    verify: async (run) => {
      const validation = await validateChecks(skill, manifest, run);
      return answerInput === undefined
        ? validation
        : { validation, output: await run(answerInput, new Date().toISOString()) };
    },
  });
}

module.exports = { validateProjectSkill, additionalInput, checkExpected, equal, budgets };
