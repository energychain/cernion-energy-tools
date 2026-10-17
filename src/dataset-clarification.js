'use strict';

const { createHash } = require('node:crypto');
const { datasetQuestion } = require('./dataset-routing');
const { sameSheetStructure, namedSheetCandidates } = require('./dataset-variants');
const { columnUnit, datasetUnits } = require('./dataset-unit-question');

const clean = (value) =>
  String(value || '')
    .trim()
    .replace(/[.!]+$/u, '')
    .trim();
const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Standard library labels supply finite answer options, without hand-maintained names.
function unitOptions() {
  const values = new Set(Object.keys(require('./dataset-units.json')));
  for (const unit of Intl.supportedValuesOf('unit'))
    for (const unitDisplay of ['short', 'long', 'narrow'])
      for (const count of [1, 2]) {
        const format = new Intl.NumberFormat('de-DE', { style: 'unit', unit, unitDisplay });
        const label = format.formatToParts(count).find((part) => part.type === 'unit')?.value;
        if (label) values.add(label);
      }
  return [...values].sort((a, b) => a.localeCompare(b, 'de'));
}
const UNIT_OPTIONS = unitOptions();

function datasetClarification(kind, records, conversationId, fields = {}) {
  const targets = records.map((record) => ({
    datasetId: record.id,
    version: record.version,
    fields: fields[record.id] || [],
  }));
  const id = createHash('sha256')
    .update(JSON.stringify({ kind, conversationId, targets }))
    .digest('hex');
  return {
    id,
    kind,
    status: 'open',
    conversationId,
    targets,
    at: new Date().toISOString(),
    allowedAnswers: {
      datasets: records.map(({ id: datasetId, title, sheet, version }) => ({
        datasetId,
        title,
        sheet,
        version,
      })),
      fields: [...new Set(targets.flatMap((target) => target.fields))],
      units: UNIT_OPTIONS,
      customUnit: { syntax: 'field = unit', maxLength: 30 },
    },
  };
}

async function storeClarification(ctx, records, clarification) {
  for (const record of records) {
    record.clarifications = [
      ...(record.clarifications || []).filter((entry) => entry.id !== clarification.id),
      clarification,
    ];
    await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
  }
}

async function askDatasetSelection(ctx, records, conversationId, unitAnswer) {
  const fields = Object.fromEntries(
    records.map((record) => [record.id, record.semantic.unitQuestion?.fields || []])
  );
  const clarification = datasetClarification('sheet', records, conversationId, fields);
  if (unitAnswer) clarification.unitAnswer = unitAnswer;
  await storeClarification(ctx, records, clarification);
  return {
    handled: true,
    datasets: records.map(({ id, title, version }) => ({ id, title, version })),
    datasetIds: records.map((record) => record.id),
    selectionDatasetIds: records.map((record) => record.id),
    responseText: `Bitte wähle den Datensatz: ${records.map((record) => `${record.title} (Version ${record.version})`).join('; ')}.`,
  };
}

function sheetAnswer(records, input, openSelection) {
  const message = clean(input).replace(/^Bitte\s+/iu, '');
  const explicit = /\s+verwenden$/iu.test(message) || /^Blatt\s/iu.test(message);
  if (!openSelection && !explicit) return [];
  const name = message.replace(/\s+verwenden$/iu, '').replace(/^Blatt\s+/iu, '');
  return records.filter((record) =>
    [
      record.sheet,
      record.title,
      `${record.sheet} (Version ${record.version})`,
      `${record.title} (Version ${record.version})`,
      `${record.sheet}, Version ${record.version}`,
    ]
      .filter(Boolean)
      .some((option) => option.toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'))
  );
}

function unitAnswer(input, allowedAnswers) {
  const message = clean(input);
  if (allowedAnswers.units.includes(message)) return { unit: message, explicit: false, all: false };
  const token = '[\\p{L}µ%°][\\p{L}\\p{N}µ%°/·^*⁻+−-]{0,29}';
  const columnAssignment = allowedAnswers.fields
    .map((field) => ({
      field,
      match: new RegExp(`^${escape(field)}\\s*(?:=|:)\\s*(?<unit>${token})$`, 'u').exec(message),
    }))
    .find((entry) => entry.match);
  if (columnAssignment)
    return {
      field: columnAssignment.field,
      unit: columnAssignment.match.groups.unit,
      explicit: true,
      all: false,
    };
  // A bounded assignment grammar; arbitrary prose and questions cannot fill its unit slot.
  const assignment = new RegExp(
    `^(?:Die\\s+)?(?:Maß)?[Ee]inheit(?:\\s+in\\s+(?<scope>beiden|allen)\\s+Blättern)?\\s*(?:ist|=|:)\\s*(?<unit>${token})$`,
    'iu'
  ).exec(message);
  return assignment
    ? { unit: assignment.groups.unit, explicit: true, all: Boolean(assignment.groups.scope) }
    : null;
}

async function closeClarifications(ctx, ids, conversationId, kind, answer) {
  const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
  for (const record of records.filter((entry) => ids.includes(entry.id))) {
    const questions = record.clarifications || [];
    if (
      !questions.some(
        (entry) =>
          entry.conversationId === conversationId && entry.kind === kind && entry.status === 'open'
      )
    )
      continue;
    record.clarifications = questions.map((entry) =>
      entry.conversationId === conversationId && entry.kind === kind && entry.status === 'open'
        ? kind === 'unit' &&
          entry.targets.some(
            (target) =>
              target.datasetId === record.id &&
              target.fields.some((field) => !datasetUnits(record)[field])
          )
          ? { ...entry, answer }
          : { ...entry, status: 'answered', answeredAt: new Date().toISOString(), answer }
        : entry
    );
    await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
  }
}

async function resolveDatasetClarification(service, ctx, p, records, input, conversationId) {
  if (!records.length) return null;
  const questions = [
    ...new Map(
      records
        .flatMap((record) => record.clarifications || [])
        .filter((entry) => entry.conversationId === conversationId)
        .map((entry) => [entry.id, entry])
    ).values(),
  ];
  const selection = questions.find((entry) => entry.kind === 'sheet' && entry.status === 'open');
  const options = selection
    ? records.filter((record) =>
        selection.targets.some(
          (target) => target.datasetId === record.id && target.version === record.version
        )
      )
    : records;
  const supplied = selection
    ? selection.allowedAnswers.datasets.map((entry) => ({ ...entry, id: entry.datasetId }))
    : options;
  const matchedIds = sheetAnswer(supplied, input, selection).map((record) => record.id);
  const selected = options.filter((record) => matchedIds.includes(record.id));
  if (selected.length > 1)
    return askDatasetSelection(ctx, selected, conversationId, selection?.unitAnswer);
  if (selected.length === 1) {
    const reply = await require('./dataset-correction').selectDatasetSheet(
      ctx,
      p,
      records,
      selected[0],
      conversationId
    );
    await closeClarifications(
      ctx,
      options.map((record) => record.id),
      conversationId,
      'sheet',
      { datasetId: selected[0].id }
    );
    if (selection?.unitAnswer) {
      const current = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
      const record = current.find((entry) => entry.id === selected[0].id);
      const applied = await applyUnitAnswer(
        service,
        ctx,
        p,
        [record],
        selection.unitAnswer,
        conversationId,
        input
      );
      if (applied) reply.responseText += `\n\n${applied.responseText}`;
    }
    return reply;
  }
  const pendingQuestions = questions.filter(
    (entry) => entry.kind === 'unit' && entry.status === 'open'
  );
  const open = records.filter(
    (record) =>
      pendingQuestions.some((entry) =>
        entry.targets.some(
          (target) => target.datasetId === record.id && target.version === record.version
        )
      ) ||
      (record.semantic.unitQuestion &&
        !record.semantic.unitQuestion.answeredAt &&
        record.semantic.unitQuestion.conversationId === conversationId)
  );
  const fields = [
    ...new Set(
      records.flatMap(
        (record) =>
          record.semantic.unitQuestion?.fields ||
          record.columns
            .filter((column) => column.type === 'number' && !column.sensitive)
            .map((column) => column.name)
      )
    ),
  ];
  const allowedUnits = pendingQuestions.length
    ? [...new Set(pendingQuestions.flatMap((entry) => entry.allowedAnswers.units))]
    : UNIT_OPTIONS;
  const answer = unitAnswer(input, { fields, units: allowedUnits });
  if (!answer || (datasetQuestion(input) && !answer.explicit) || (!open.length && !answer.explicit))
    return null;
  const named = namedSheetCandidates(records, input);
  const preferred = records.filter((record) =>
    record.selectedInConversations?.includes(conversationId)
  );
  const targets = answer.all
    ? records
    : named.length
      ? named
      : preferred.length
        ? preferred
        : open.length
          ? open
          : records;
  if (answer.all && !targets.every((record) => sameSheetStructure(targets[0], record)))
    return askDatasetSelection(ctx, targets, conversationId, answer);
  if (targets.length > 1 && !answer.all)
    return askDatasetSelection(ctx, targets, conversationId, answer);
  return applyUnitAnswer(service, ctx, p, targets, answer, conversationId, input);
}

async function applyUnitAnswer(service, ctx, p, records, answer, conversationId, input) {
  const assignments = records.map((record) => {
    const stored = record.clarifications
      ?.find(
        (entry) =>
          entry.kind === 'unit' &&
          entry.status === 'open' &&
          entry.conversationId === conversationId
      )
      ?.targets.find(
        (target) => target.datasetId === record.id && target.version === record.version
      );
    const pending = record.semantic.unitQuestion;
    const fields = stored
      ? stored.fields
      : pending?.conversationId === conversationId
        ? pending.fields
        : record.columns
            .filter((column) => column.type === 'number' && !column.sensitive)
            .map((column) => column.name);
    const field = answer.field || (fields.length === 1 ? fields[0] : '');
    return { record, field };
  });
  if (
    assignments.some(
      ({ record, field }) =>
        !record.columns.some(
          (column) =>
            column.name === field &&
            column.type === 'number' &&
            !column.sensitive &&
            columnUnit(column, answer.unit) === answer.unit
        )
    )
  ) {
    const fields = Object.fromEntries(
      records.map((record) => [
        record.id,
        record.columns
          .filter((column) => column.type === 'number' && !column.sensitive)
          .map((column) => column.name),
      ])
    );
    for (const record of records)
      await storeClarification(
        ctx,
        [record],
        datasetClarification('unit', [record], conversationId, { [record.id]: fields[record.id] })
      );
    return {
      handled: true,
      datasetIds: records.map((record) => record.id),
      responseText: `Bitte nenne die Wertspalte und die Einheit als „Spaltenname = Einheit“.`,
    };
  }
  const replies = [];
  for (const { record, field } of assignments)
    replies.push(
      await require('./dataset-correction').correctDatasetSemantics(
        service,
        ctx,
        p,
        record,
        { units: [{ field, unit: answer.unit }] },
        input
      )
    );
  await closeClarifications(
    ctx,
    records.map((record) => record.id),
    conversationId,
    'unit',
    { units: assignments.map(({ field }) => ({ field, unit: answer.unit })) }
  );
  return {
    handled: true,
    datasetIds: records.map((record) => record.id),
    selectionDatasetIds: [],
    responseText: replies.map((reply) => reply.responseText).join('\n\n'),
  };
}

async function hasOpenDatasetClarification(ctx, conversationId) {
  if (!conversationId) return false;
  const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
  return require('./workbench-data-scope')
    .scopedDatasets(records, '', { conversationId })
    .some(
      (record) =>
        record.current !== false &&
        !record.structuredFormat &&
        (record.clarifications || []).some(
          (entry) =>
            entry.status === 'open' &&
            entry.conversationId === conversationId &&
            ['sheet', 'unit'].includes(entry.kind) &&
            entry.targets.some(
              (target) => target.datasetId === record.id && target.version === record.version
            )
        )
    );
}

module.exports = {
  hasOpenDatasetClarification,
  closeClarifications,
  datasetClarification,
  storeClarification,
  askDatasetSelection,
  resolveDatasetClarification,
};
