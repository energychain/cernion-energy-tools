'use strict';

const { validateAndBindPlan, heuristicPlan } = require('./tabular-intelligence');
const units = require('./dataset-units.json');

function quoteDatasetField(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}
function formatDatasetNumber(value) {
  return Number(value).toLocaleString('de-DE', { maximumFractionDigits: 3 });
}

function compileDatasetPlan(record, input, sql, params, utcAlias, localAlias) {
  const columns = record.columns;
  const plan = validateAndBindPlan(
    input.plan || heuristicPlan(input.question, record.profile, record.id),
    record.tenantId
  );
  if (plan.sources.length !== 1 || plan.sources[0].sourceId !== record.id)
    throw new Error('Abfrageplan gehört nicht zu diesem Datensatz.');
  if (plan.operations.filter((operation) => operation.op === 'aggregate').length !== 1)
    throw new Error('Genau eine Aggregation ist erforderlich.');
  let scopeSql = sql,
    scopeParams = [...params];
  let available = new Set(
    columns.filter((column) => !column.sensitive).map((column) => column.name)
  );
  let metricScopeSql = sql,
    metricScopeParams = [...params];
  let plannedSql = sql,
    plannedParams = [...params];
  // SQL identifiers are schema-checked, values are bound, and raw SQL is never accepted.
  for (const operation of plan.operations) {
    const fields = [
      operation.field,
      ...(operation.groupBy || []),
      ...(operation.columns || []),
      ...(operation.by || []).map((sort) => sort.field),
      ...(operation.metrics || []).map((metric) => metric.field),
    ].filter(Boolean);
    if (fields.some((field) => !available.has(field)))
      throw new Error('Unbekanntes oder vertrauliches Abfragefeld.');
    if (operation.op === 'filter') {
      let field = quoteDatasetField(operation.field),
        value = operation.value;
      const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (operation.field === record.semantic.timeField && ops[operation.operator]) {
        if (
          ['eq', 'neq'].includes(operation.operator) &&
          /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(String(value))
        ) {
          field = `substr(${quoteDatasetField(localAlias)},1,${String(value).length})`;
        } else {
          field = quoteDatasetField(utcAlias);
          value = require('./dataset-time').normalizeDatasetTimes(
            [{ [operation.field]: String(value).replace(/T00:00:00(?:\.000)?Z$/, 'T00:00:00') }],
            operation.field,
            record.semantic.timezone
          ).utc[0];
        }
        if (!value) throw new Error('Ungültiger Zeitfilter.');
      }
      if (operation.field === record.semantic.timeField) {
        if (ops[operation.operator]) {
          scopeSql = `SELECT * FROM (${scopeSql}) WHERE ${field} ${ops[operation.operator]} ?`;
          scopeParams.push(value);
        }
      }
      if (ops[operation.operator]) {
        plannedSql = `SELECT * FROM (${plannedSql}) WHERE ${field} ${ops[operation.operator]} ?`;
        plannedParams.push(value);
      } else if (['isNull', 'notNull'].includes(operation.operator))
        plannedSql = `SELECT * FROM (${plannedSql}) WHERE ${field} IS ${operation.operator === 'notNull' ? 'NOT ' : ''}NULL`;
      else throw new Error('Dieser Filter wird noch nicht unterstützt.');
    } else if (operation.op === 'aggregate') {
      metricScopeSql = plannedSql;
      metricScopeParams = [...plannedParams];
      const group = (operation.groupBy || []).map(quoteDatasetField);
      if (
        operation.metrics.some(
          (metric) =>
            metric.fn === 'sum' && units[record.semantic.units[metric.field]]?.dimension === 'power'
        )
      )
        throw new Error('Leistungswerte dürfen nur mit Zeitraster zu Energie integriert werden.');
      const metrics = operation.metrics.map(
        (metric) =>
          `${metric.fn.toUpperCase()}(${metric.field ? quoteDatasetField(metric.field) : '*'}) AS ${quoteDatasetField(metric.as)}`
      );
      const aliases = [
        ...(operation.groupBy || []),
        ...operation.metrics.map((metric) => metric.as),
      ];
      if (new Set(aliases).size !== aliases.length)
        throw new Error('Doppelte Ergebnisnamen im Abfrageplan.');
      plannedSql = `SELECT ${[...group, ...metrics].join(',')} FROM (${plannedSql})${group.length ? ` GROUP BY ${group.join(',')}` : ''}`;
      available = new Set([
        ...(operation.groupBy || []),
        ...operation.metrics.map((metric) => metric.as),
      ]);
    } else if (operation.op === 'timeBucket') {
      const field = quoteDatasetField(operation.field);
      const localDate =
        operation.field === record.semantic.timeField
          ? quoteDatasetField(localAlias)
          : `CASE WHEN ${field} GLOB '??.??.????*' THEN substr(${field},7,4)||'-'||substr(${field},4,2)||'-'||substr(${field},1,2)||' '||substr(${field},12) ELSE ${field} END`;
      const patterns = { hour: '%Y-%m-%d %H:00', day: '%Y-%m-%d', week: '%Y-W%W', month: '%Y-%m' };
      const expression =
        operation.interval === '15min'
          ? `strftime('%Y-%m-%d %H:',${localDate})||printf('%02d',CAST(strftime('%M',${localDate}) AS INTEGER)/15*15)`
          : `strftime('${patterns[operation.interval]}',${localDate})`;
      plannedSql = `SELECT *, ${expression} AS ${quoteDatasetField(operation.as)} FROM (${plannedSql})`;
      available.add(operation.as);
    } else if (operation.op === 'sort')
      plannedSql = `SELECT * FROM (${plannedSql}) ORDER BY ${operation.by.map((sort) => `${quoteDatasetField(sort.field)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`).join(',')}`;
    else if (operation.op === 'limit')
      plannedSql = `SELECT * FROM (${plannedSql}) LIMIT ${operation.count}`;
    else throw new Error('Dieser Abfrageschritt wird noch nicht unterstützt.');
  }
  if (!plan.operations.some((operation) => operation.op === 'aggregate'))
    throw new Error('Nur zusammengefasste Abfrageergebnisse sind freigegeben.');
  return {
    plan,
    plannedSql,
    plannedParams,
    scopeSql,
    scopeParams,
    metricScopeSql,
    metricScopeParams,
  };
}

function executeDatasetQuery(pool, record, input) {
  const db = pool.tenant(record.tenantId),
    table = pool.table(record.id);
  const columns = record.columns,
    semantic = record.semantic;
  const timeIndex = columns.findIndex((column) => column.name === semantic.timeField);
  const select = columns.map((column, i) => `c${i} AS ${quoteDatasetField(column.name)}`).join(',');
  const occupied = new Set(columns.map((column) => column.name.toLowerCase()));
  let utcAlias = '__dataset_utc',
    localAlias = '__dataset_local';
  while (occupied.has(utcAlias.toLowerCase())) utcAlias += '_';
  while (occupied.has(localAlias.toLowerCase())) localAlias += '_';
  let sql = `SELECT ${select}, utc AS ${quoteDatasetField(utcAlias)}, local_time AS ${quoteDatasetField(localAlias)} FROM ${table}`;
  let params = [];
  const requestedYear = String(input.question || '').match(/\b(20\d{2})\b/)?.[1];
  if (requestedYear && !input.from && !input.to && timeIndex >= 0) {
    sql = `SELECT * FROM (${sql}) WHERE substr(${quoteDatasetField(localAlias)},1,4) = ?`;
    params.push(requestedYear);
  }
  if (input.from || input.to) {
    if (timeIndex < 0) throw new Error('Kein Zeitfeld für diesen Filter vorhanden.');
    // Floating boundaries use dataset wall time; explicit offsets remain instants.
    sql = `SELECT * FROM (${sql}) WHERE 1=1`;
    if (input.from) {
      sql += ` AND ${quoteDatasetField(utcAlias)} >= ?`;
      const from = require('./dataset-time').normalizeDatasetTimes(
        [{ time: input.from }],
        'time',
        semantic.timezone
      ).utc[0];
      if (!from) throw new Error('Ungültiger Zeitfilter.');
      params.push(from);
    }
    if (input.to) {
      sql += ` AND ${quoteDatasetField(utcAlias)} < ?`;
      const to = require('./dataset-time').normalizeDatasetTimes(
        [{ time: input.to }],
        'time',
        semantic.timezone
      ).utc[0];
      if (!to) throw new Error('Ungültiger Zeitfilter.');
      params.push(to);
    }
  }
  const {
    plan,
    plannedSql,
    plannedParams,
    scopeSql,
    scopeParams,
    metricScopeSql,
    metricScopeParams,
  } = compileDatasetPlan(record, input, sql, params, utcAlias, localAlias);
  sql = scopeSql;
  params = scopeParams;
  const scopedTimes =
    timeIndex >= 0
      ? db
          .prepare(
            `SELECT ${quoteDatasetField(utcAlias)} AS time FROM (${sql}) ORDER BY ${quoteDatasetField(utcAlias)}`
          )
          .all(...params)
      : [];
  const quality =
    timeIndex >= 0
      ? require('./dataset-time').normalizeDatasetTimes(
          scopedTimes,
          'time',
          semantic.timezone,
          record.quality.intervalMinutes
        )
      : record.quality;
  delete quality.utc;
  delete quality.local;
  const summaries = [];
  const intervalHours = record.quality.intervalMinutes / 60;
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (column.type !== 'number' || column.sensitive) continue;
    const field = quoteDatasetField(column.name),
      unit = semantic.units[column.name] || 'Einheit ungeklärt';
    const stats = db
      .prepare(
        `SELECT COUNT(*) AS rows, COUNT(${field}) AS present, SUM(${field}) AS sum, MIN(${field}) AS min, MAX(${field}) AS max, AVG(${field}) AS mean FROM (${sql})`
      )
      .get(...params);
    const peak = db
      .prepare(
        `SELECT ${field} AS value${timeIndex >= 0 ? `, ${quoteDatasetField(semantic.timeField)} AS at, ${quoteDatasetField(utcAlias)} AS utc` : ''} FROM (${sql}) WHERE ${field} IS NOT NULL ORDER BY ${field} DESC, ${quoteDatasetField(utcAlias)} ASC LIMIT 1`
      )
      .get(...params);
    const trough = db
      .prepare(
        `SELECT ${field} AS value${timeIndex >= 0 ? `, ${quoteDatasetField(semantic.timeField)} AS at, ${quoteDatasetField(utcAlias)} AS utc` : ''} FROM (${sql}) WHERE ${field} IS NOT NULL ORDER BY ${field} ASC, ${quoteDatasetField(utcAlias)} ASC LIMIT 1`
      )
      .get(...params);
    const missingAt =
      timeIndex >= 0
        ? db
            .prepare(
              `SELECT ${quoteDatasetField(semantic.timeField)} AS at FROM (${sql}) WHERE ${field} IS NULL LIMIT 20`
            )
            .all(...params)
            .map((row) => row.at)
        : [];
    const scale = units[unit];
    const integral =
      scale?.dimension === 'power' && intervalHours > 0
        ? stats.sum * intervalHours
        : scale?.dimension === 'energy'
          ? stats.sum
          : null;
    const integralUnit = scale?.integratedUnit || unit;
    const mean = stats.mean;
    const deviation = stats.present
      ? Math.sqrt(
          db
            .prepare(`SELECT AVG((${field} - ?) * (${field} - ?)) AS variance FROM (${sql})`)
            .get(mean, mean, ...params).variance || 0
        )
      : 0;
    const outliers = deviation
      ? db
          .prepare(`SELECT COUNT(*) AS n FROM (${sql}) WHERE ABS(${field} - ?) > ?`)
          .get(...params, mean, 3 * deviation).n
      : 0;
    const localDay = `substr(${quoteDatasetField(localAlias)},1,10)`;
    const monthly =
      timeIndex >= 0 && integral != null
        ? db
            .prepare(
              `SELECT substr(${localDay},1,7) AS month, SUM(${field}) AS sum FROM (${sql}) GROUP BY month ORDER BY month`
            )
            .all(...params)
        : [];
    const daily =
      timeIndex >= 0 && integral != null
        ? db
            .prepare(
              `SELECT ${localDay} AS day, COUNT(*) AS intervals, SUM(${field}) AS sum FROM (${sql}) GROUP BY day ORDER BY day`
            )
            .all(...params)
        : [];
    const publishedStats = { ...stats };
    if (scale?.dimension === 'power') delete publishedStats.sum;
    summaries.push({
      field: column.name,
      unit,
      ...publishedStats,
      peak,
      trough,
      missing: stats.rows - stats.present,
      missingAt,
      outliers,
      integral,
      integralUnit,
      monthly: monthly.map((month) => ({
        month: month.month,
        value: month.sum * (scale?.dimension === 'power' ? intervalHours : 1),
        unit: integralUnit,
      })),
      daily: daily.map((day) => ({
        day: day.day,
        intervals: day.intervals,
        value: day.sum * (scale?.dimension === 'power' ? intervalHours : 1),
        unit: integralUnit,
      })),
    });
  }
  const result = db
    .prepare(`SELECT * FROM (${plannedSql}) LIMIT ${plan.output.maxRows + 1}`)
    .all(...plannedParams);
  if (result.length > plan.output.maxRows)
    throw new Error('Das Ergebnis überschreitet das Ausgabebudget; bitte enger filtern.');
  const provenance = `Nutzerangabe von ${record.provenance.person} am ${record.provenance.at.slice(0, 10)}`;
  const period =
    [input.from || record.period?.from, input.to || record.period?.to]
      .filter(Boolean)
      .join(' bis ') || 'ohne bestätigten Zeitraum';
  const lines = [
    `Datensatz ${record.title}, Version ${record.version}, ${period}; ${provenance}.`,
    `Die Abfrage umfasst ${db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n} Zeilen.`,
  ];
  for (const summary of summaries) {
    if (!summary.present) {
      lines.push(`${summary.field}: keine ausgefüllten Werte.`);
      continue;
    }
    lines.push(
      `${summary.field}: Maximum ${formatDatasetNumber(summary.max)} ${summary.unit}${summary.peak?.at ? ` am ${summary.peak.at} (${semantic.timezone})` : ''}; Minimum ${formatDatasetNumber(summary.min)} ${summary.unit}${summary.trough?.at ? ` am ${summary.trough.at} (${semantic.timezone})` : ''}; Mittelwert ${Number(summary.mean).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${summary.unit} aus ${summary.present} vorhandenen Werten. ${summary.missing} leere Werte und ${summary.outliers} statistische Ausreißer (mehr als drei Standardabweichungen).`
    );
    if (summary.missingAt.length)
      lines.push(
        `Leere Werte am ${summary.missingAt.join('; ')} (${semantic.timezone})${summary.missing > summary.missingAt.length ? `; ${summary.missing - summary.missingAt.length} weitere Leerwerte werden hier nicht einzeln aufgezählt` : ''}.`
      );
    if (summary.integral != null) {
      const integratedScale = units[summary.integralUnit];
      const converted =
        integratedScale && integratedScale.factor < 1000000
          ? ` (${formatDatasetNumber((summary.integral * integratedScale.factor) / 1000000)} MWh)`
          : '';
      lines.push(
        `Summe über die vorhandenen Werte: ${formatDatasetNumber(summary.integral)} ${summary.integralUnit}${converted}; Rechenweg: ${units[summary.unit]?.dimension === 'power' ? `Summe der Werte × ${formatDatasetNumber(intervalHours)} h` : 'Summe der Intervallwerte'}. Leere Werte werden ausgelassen, nicht geschätzt.`
      );
      if (/monat|month/i.test(input.question || ''))
        lines.push(
          ...summary.monthly.map(
            (month) =>
              `${month.month}: ${formatDatasetNumber(month.value)} ${month.unit} (${semantic.timezone}).`
          )
        );
    } else if (units[summary.unit]?.dimension === 'power')
      lines.push('Eine Integration ist ohne bestätigtes Zeitraster nicht möglich.');
  }
  lines.push(
    `${quality.gaps} fehlende Zeitintervalle; ${quality.duplicates} doppelte Zeitpunkte nach Zeitzonenauflösung. ${quality.transitions.length} Zeitumstellungen${quality.transitions.length ? ': ' + quality.transitions.map((transition) => `${transition.at} (${transition.offsetMinutes > 0 ? '+' : ''}${transition.offsetMinutes} Minuten)`).join('; ') : ''}.`
  );
  lines.push(...semantic.assumptions);
  const question = input.question || '';
  const overview =
    /welche daten haben wir|auffäll|auffaell|überblick|ueberblick|zusammenfassung|overview|leere|lücken|luecken|fehlende|zeitumstellung|ausreißer|ausreisser/i.test(
      question
    );
  const aggregate = plan.operations.find((operation) => operation.op === 'aggregate');
  const requestedFields = new Set(aggregate.metrics.map((metric) => metric.field).filter(Boolean));
  const summary = summaries.find(
    (entry) => entry.present && (!requestedFields.size || requestedFields.has(entry.field))
  );
  const standard = require('./dataset-semantics').standardDatasetPlan(record, question);
  const groups = aggregate.groupBy || [];
  const labels = {
    count: 'Anzahl',
    avg: 'Mittelwert',
    min: 'Minimum',
    max: 'Maximum',
    sum: 'Summe',
  };
  const metricAnswer = result
    .map((row) => {
      const groupSql = groups.map((field) => `${quoteDatasetField(field)} IS ?`).join(' AND ');
      const groupParams = groups.map((field) => row[field]);
      const values = aggregate.metrics
        .map((metric) => {
          const canonical =
            standard && !groups.length && summaries.find((entry) => entry.field === metric.field);
          const value = canonical
            ? {
                min: canonical.min,
                max: canonical.max,
                avg: canonical.mean,
                sum: canonical.sum,
                count: canonical.rows,
              }[metric.fn]
            : metric.fn === 'count' && standard && !groups.length
              ? db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n
              : row[metric.as];
          const unit =
            metric.fn === 'count' ? 'Zeilen' : semantic.units[metric.field] || 'Einheit ungeklärt';
          const extremum =
            canonical && ['min', 'max'].includes(metric.fn)
              ? metric.fn === 'max'
                ? canonical.peak
                : canonical.trough
              : ['min', 'max'].includes(metric.fn) && timeIndex >= 0
                ? db
                    .prepare(
                      `SELECT ${quoteDatasetField(semantic.timeField)} AS at FROM (${metricScopeSql}) WHERE ${quoteDatasetField(metric.field)} IS NOT NULL${groupSql ? ` AND ${groupSql}` : ''} ORDER BY ${quoteDatasetField(metric.field)} ${metric.fn === 'max' ? 'DESC' : 'ASC'}, ${quoteDatasetField(utcAlias)} ASC LIMIT 1`
                    )
                    .get(...metricScopeParams, ...groupParams)
                : null;
          return `${labels[metric.fn]}${metric.field ? ` (${metric.field})` : ''}: ${typeof value === 'number' ? formatDatasetNumber(value) : value} ${unit}${extremum?.at ? ` am ${extremum.at} (${semantic.timezone})` : ''}.`;
        })
        .join(' ');
      return [groups.map((field) => `${field}: ${row[field]}`).join(', '), values]
        .filter(Boolean)
        .join(' — ');
    })
    .join('\n');
  const origin = `Herkunft: ${record.title}, Version ${record.version}; ${provenance}.`;
  let answer = lines.slice(1).join('\n\n');
  if (!overview && summary) {
    if (/monat|month/i.test(question)) {
      answer = summary.monthly
        .map(
          (month) =>
            `${month.month}: ${formatDatasetNumber(month.value)} ${month.unit} (${semantic.timezone}).`
        )
        .join('\n');
    } else if (
      /energie|arbeit/i.test(question) ||
      (/summe|gesamt/i.test(question) &&
        ['power', 'energy'].includes(units[summary.unit]?.dimension))
    ) {
      answer =
        summary.integral == null
          ? 'Eine Energierechnung ist ohne bestätigte Einheit und Zeitraster nicht möglich.'
          : `Die Energie ${requestedYear ? `im Jahr ${requestedYear}` : `im Zeitraum ${period}`} beträgt ${formatDatasetNumber(summary.integral)} ${summary.integralUnit}${summary.integralUnit !== 'MWh' ? ` (${formatDatasetNumber((summary.integral * (units[summary.integralUnit]?.factor || 1)) / 1000000)} MWh)` : ''}.${summary.missing ? ` ${summary.missing} leere Werte wurden ausgelassen, nicht geschätzt.` : ''}`;
    } else if (/anzahl|wie viele|count/i.test(question)) {
      answer = `Die Abfrage umfasst ${formatDatasetNumber(summary.rows)} Zeilen.`;
    } else if (/summe|gesamt/i.test(question)) {
      answer = `Die Summe beträgt ${formatDatasetNumber(summary.sum)} ${summary.unit}.`;
    } else if (/mittel|durchschnitt/i.test(question)) {
      answer = `Der Mittelwert beträgt ${Number(summary.mean).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${summary.unit}.`;
    } else if (/minim|niedrig|kleinst/i.test(question)) {
      answer = `Der niedrigste Wert beträgt ${formatDatasetNumber(summary.min)} ${summary.unit}${summary.trough?.at ? ` am ${summary.trough.at} (${semantic.timezone})` : ''}.`;
    } else if (/spitzen|maxim|höchst|hoechst|größt|groesst/i.test(question)) {
      answer = `Die Spitzenlast lag bei ${formatDatasetNumber(summary.max)} ${summary.unit}${summary.peak?.at ? ` am ${summary.peak.at} (${semantic.timezone})` : ''}.`;
    } else {
      answer = metricAnswer;
    }
  }
  if (
    !overview &&
    (aggregate.metrics.length > 1 ||
      groups.length ||
      (!standard &&
        plan.operations.some(
          (operation) => operation.op === 'filter' && operation.field !== semantic.timeField
        )))
  )
    answer = metricAnswer;
  return {
    responseText: `${answer}\n\n${origin}`,
    rowCount: db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n,
    datasetId: record.id,
    version: record.version,
    summaries,
    result,
    provenance,
    quality,
  };
}

module.exports = {
  executeDatasetQuery,
  compileDatasetPlan,
  quoteDatasetField,
  formatDatasetNumber,
};
