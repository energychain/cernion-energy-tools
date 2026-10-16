'use strict';

const { createHash } = require('node:crypto');
const { profileRows, parseNumber, hashValue } = require('./tabular-intelligence');
const { datasetSemantics } = require('./dataset-semantics');
const { normalizeDatasetTimes } = require('./dataset-time');
const { storedTableQuality, excludeStoredControls } = require('./dataset-stored-quality');
const { datasetSheetTitle, MAX_CONTROL_ROWS } = require('./dataset-table-quality');
const { registerDatasetVariants } = require('./dataset-variants');
const { setting, VERSION, ROW_SOURCE } = require('./project-structure-policy');

function derivedId(object, sheet) {
  // Content/object identity only: tenant identities are never hashed into keys.
  return `ds_${createHash('sha256')
    .update(JSON.stringify([object.hash, object.objectId, sheet, VERSION]))
    .digest('hex')
    .slice(0, 32)}`;
}

function candidateFields(columns) {
  const domains = require('./semantic-domains');
  const catalog = Array.isArray(domains) ? domains : domains.semanticDomains || [];
  const fields = catalog.flatMap((domain) =>
    Object.entries(domain.fieldProfiles || {}).map(([id, field]) => ({
      id: `${domain.id}.${id}`,
      ...field,
    }))
  );
  return columns.map((column) => ({
    column,
    field: fields.find((field) =>
      (field.aliases || []).some((alias) => alias.toLowerCase() === column.name.toLowerCase())
    ),
  }));
}

function candidates(rows, columns, offset, sheet) {
  const locations = require('./workbench-identifier-kinds.json').nonReferenceKinds;
  return candidateFields(columns).flatMap(({ column, field }) => {
    if (
      !['string', 'timestamp'].includes(column.type) &&
      !column.sensitive &&
      !field?.expectedKinds?.includes('idlike')
    )
      return [];
    return rows.flatMap((row, index) =>
      row[column.name] == null
        ? []
        : [
            {
              kind:
                column.semanticRole ||
                (column.type === 'timestamp' || field?.expectedKinds?.includes('timestamp')
                  ? 'period'
                  : locations.includes(column.name.toLowerCase())
                    ? 'location'
                    : column.sensitive || field?.expectedKinds?.includes('idlike')
                      ? 'identifier'
                      : 'label'),
              value: String(row[column.name]).slice(0, 1000),
              catalogField: field?.id,
              location: { sheet, row: row[ROW_SOURCE] || offset + index + 2, column: column.name },
            },
          ]
    );
  });
}

async function structureTable(ctx, object, sheet, source, pool, progress) {
  const iterator = source[Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    if (first.done) throw new Error('Empty table');
    const names = first.value.map((value) => String(value).trim());
    if (!names.length || names.some((name) => !name) || new Set(names).size !== names.length)
      throw new Error('Missing or duplicate column names');
    if (names.length > setting('DATASET_MAX_COLUMNS', 512))
      throw new Error('Project column limit exceeded');
    const sampleSize = setting('DATASET_SAMPLE_ROWS', 256);
    const batchSize = setting('DATASET_BATCH_ROWS', 1000);
    const maxRows = setting('DATASET_MAX_ROWS', 5000000);
    const candidateLimit = setting('ENTITY_CANDIDATE_LIMIT', 10000);
    const sampleBytes = setting('DATASET_SAMPLE_BYTES', 1024 * 1024);
    const batchBytes = setting('DATASET_BATCH_BYTES', 4 * 1024 * 1024);
    const rowObject = (values) => {
      if (values.length > names.length) throw new Error('Table row exceeds header width');
      const row = Object.fromEntries(names.map((name, index) => [name, values[index] ?? null]));
      row[ROW_SOURCE] = values[ROW_SOURCE];
      return row;
    };
    const sample = [];
    let sampledBytes = 0;
    for (let i = 0; i < sampleSize; i++) {
      const item = await iterator.next();
      if (item.done) break;
      sample.push(rowObject(item.value));
      sampledBytes += Buffer.byteLength(JSON.stringify(item.value));
      if (sampledBytes >= sampleBytes) break;
    }
    if (!sample.length) throw new Error('Table has no rows');
    const profile = profileRows(sample, { sourceId: object.hash });
    profile.columns.forEach((column) => delete column.examples);
    const semantic = await datasetSemantics(
      { name: object.name, profile, hash: object.hash },
      object.tenantId,
      'Describe the schema.'
    );
    const columns = profile.columns;
    for (const column of columns)
      if (column.sensitive && column.type === 'number') column.type = 'string';
    const id = derivedId(object, sheet);
    pool.putRows(object.tenantId, id, [], columns);
    const stats = columns.map(() => ({
      nulls: 0,
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
    }));
    const sourceRows = new Map();
    const numericColumns = new Set(
      columns.filter((column) => column.type === 'number').map((column) => column.name)
    );
    const numericTextRows = new Set();
    let count = 0,
      candidateCount = pool
        .tenant(object.tenantId)
        .prepare('SELECT COUNT(*) AS n FROM project_candidates WHERE object_id = ?')
        .get(object.objectId).n,
      timeState = {},
      priorTime = null,
      periodFrom = null,
      periodTo = null;
    const quality = {
      gaps: 0,
      duplicates: 0,
      transitions: [],
      intervalMinutes:
        semantic.intervalMinutes ||
        normalizeDatasetTimes(sample, semantic.timeField, semantic.timezone).intervalMinutes,
      missingValues: 0,
    };
    const write = async (rows) => {
      if (!rows.length) return;
      if (count + rows.length > maxRows) throw new Error('Project row limit exceeded');
      await require('./project-file-disk').diskSpace(
        pool.basePath,
        Buffer.byteLength(JSON.stringify(rows)) * 2
      );
      let position = count;
      for (const row of rows) {
        columns.forEach((column, index) => {
          const value = row[column.name];
          if (value == null || String(value).trim() === '') {
            row[column.name] = null;
            stats[index].nulls++;
            return;
          }
          if (numericColumns.has(column.name)) {
            const number = parseNumber(value);
            if (number == null) {
              // Late labels are provisional until the shared numerical detector proves them.
              column.type = 'string';
              row[column.name] = String(value).trim();
              numericTextRows.add(position);
              if (numericTextRows.size > MAX_CONTROL_ROWS)
                throw new Error('Unproven numeric labels exceed control budget');
              return;
            }
            row[column.name] = number;
            stats[index].count++;
            stats[index].sum += number;
            stats[index].min = Math.min(stats[index].min, number);
            stats[index].max = Math.max(stats[index].max, number);
          } else row[column.name] = String(value).trim();
        });
        position++;
      }
      rows.forEach((row, index) => {
        const descriptors = columns.filter(
          (column) => column.type !== 'number' || column.sensitive
        );
        if (
          sourceRows.size < 1000 &&
          descriptors.filter((column) => row[column.name] != null).length <= 1
        )
          sourceRows.set(count + index, row[ROW_SOURCE] || count + index + 2);
      });
      // Keep the time state across batches, including repeated wall times at transitions.
      const normalized = normalizeDatasetTimes(
        rows,
        semantic.timeField,
        semantic.timezone,
        quality.intervalMinutes,
        timeState
      );
      timeState = normalized.state || {};
      const times = { utc: normalized.utc, local: normalized.local };
      quality.intervalMinutes ||= normalized.intervalMinutes;
      quality.transitions.push(
        ...normalized.transitions.slice(0, Math.max(0, 1000 - quality.transitions.length))
      );
      for (let i = 0; i < rows.length; i++) {
        const value = times.utc[i];
        if (!value) continue;
        if (!periodFrom || value < periodFrom) periodFrom = value;
        if (!periodTo || value > periodTo) periodTo = value;
        const current = Date.parse(value);
        if (priorTime != null) {
          if (current === priorTime) quality.duplicates++;
          else if (quality.intervalMinutes)
            quality.gaps += Math.max(
              0,
              Math.round((current - priorTime) / (quality.intervalMinutes * 60000)) - 1
            );
        }
        priorTime = current;
      }
      pool.appendRows(id, rows, columns, times, count);
      const values = candidates(
        rows.slice(0, candidateLimit - candidateCount),
        columns,
        count,
        sheet
      ).slice(0, candidateLimit - candidateCount);
      pool.candidates(object.objectId, VERSION, values);
      candidateCount += values.length;
      count += rows.length;
      await progress(count);
    };
    let batch = [],
      bufferedBytes = 0;
    for (const row of sample) {
      batch.push(row);
      bufferedBytes += Buffer.byteLength(JSON.stringify(row));
      if (batch.length >= batchSize || bufferedBytes >= batchBytes) {
        await write(batch);
        batch = [];
        bufferedBytes = 0;
      }
    }
    for (;;) {
      const item = await iterator.next();
      if (item.done) break;
      batch.push(rowObject(item.value));
      bufferedBytes += Buffer.byteLength(JSON.stringify(item.value));
      if (batch.length >= batchSize || bufferedBytes >= batchBytes) {
        await write(batch);
        batch = [];
        bufferedBytes = 0;
      }
    }
    await write(batch);
    columns.forEach((column, index) => {
      column.nullCount = stats[index].nulls;
      column.nullRatio = stats[index].nulls / count;
      column.nullable = Boolean(stats[index].nulls);
      if (stats[index].count)
        column.numeric = {
          min: stats[index].min,
          max: stats[index].max,
          mean: stats[index].sum / stats[index].count,
        };
      quality.missingValues += stats[index].nulls;
    });
    const controls = storedTableQuality(pool, object.tenantId, id, columns);
    const controlled = new Set(controls.map((entry) => entry.index));
    if ([...numericTextRows].some((index) => !controlled.has(index)))
      throw new Error('Inconsistent numeric column outside verified controls');
    for (const column of columns) if (numericColumns.has(column.name)) column.type = 'number';
    if (controls.length) {
      const cleaned = excludeStoredControls(pool, object.tenantId, id, columns, controls);
      count = cleaned.count;
      quality.missingValues = cleaned.missingValues;
      for (const entry of controls)
        entry.rowNumber = sourceRows.get(entry.index) || entry.rowNumber;
      const db = pool.tenant(object.tenantId);
      db.prepare(
        `DELETE FROM project_candidates WHERE object_id = ? AND json_extract(location, '$.sheet') = ? AND json_extract(location, '$.row') IN (SELECT value FROM json_each(?))`
      ).run(object.objectId, sheet, JSON.stringify(controls.map((entry) => entry.rowNumber)));
    }
    quality.controls = controls;
    profile.totalRows = count;
    profile.hashes.profile = hashValue({ ...profile, hashes: undefined });
    pool.indexes(id, columns);
    const at = new Date().toISOString();
    const record = {
      id,
      tenantId: object.tenantId,
      familyId: id,
      version: 1,
      current: true,
      hash: object.hash,
      sourceName: object.name,
      sheet,
      title: datasetSheetTitle(semantic.title, sheet),
      sensitivityLevel: object.sensitivityLevel,
      requiredClearance: object.requiredClearance,
      semantic,
      columns,
      profile,
      rowCount: count,
      period: { from: periodFrom, to: periodTo },
      quality,
      provenance: {
        ...object.provenance,
        projectId: object.projectId,
        objectId: object.objectId,
        sheet,
        person: object.provenance.actorId,
        at,
      },
      derivation: { version: VERSION, hash: object.hash },
      audit: [{ kind: 'created', actorId: object.provenance.actorId, at }],
    };
    const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
    await registerDatasetVariants(ctx, pool, record, records);
    return record;
  } finally {
    await iterator.return?.();
  }
}

function documentCandidates(text, location) {
  const values = [];
  for (const [index, line] of text.split('\n').entries()) {
    const pair = /^\s*([^:]{1,100}):\s*(.{1,1000})$/.exec(line);
    if (!pair) continue;
    const row = { [pair[1].trim()]: pair[2].trim() };
    const profile = profileRows([row]);
    for (const entry of candidates([row], profile.columns, index, ''))
      values.push({ ...entry, location: { ...location, line: index + 1, field: pair[1].trim() } });
  }
  for (const type of require('./workbench-code-catalog.json').types) {
    for (const match of text.matchAll(new RegExp(type.pattern, 'g'))) {
      if (match[1])
        values.push({
          kind: 'identifier',
          value: match[1],
          catalogField: type.kind,
          location: { ...location, offset: match.index },
        });
    }
  }
  return values;
}

module.exports = { derivedId, structureTable, candidates, documentCandidates };
