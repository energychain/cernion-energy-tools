'use strict';

const { randomUUID } = require('node:crypto');
const { principal, deny } = require('../src/domain-router-policy');
const { parseDatasetText, disposableDataset } = require('../src/dataset-input');
const { datasetSemantics, datasetQueryPlan } = require('../src/dataset-semantics');
const { normalizeDatasetTimes } = require('../src/dataset-time');
const { executeDatasetQuery } = require('../src/dataset-query');
const DatasetSqlitePool = require('../src/dataset-sqlite-pool');

function datasetId() {
  return `ds_${randomUUID().replaceAll('-', '')}`;
}

function matchingDatasets(records, question, conversationId) {
  const normalized = String(question || '').toLocaleLowerCase('de-DE');
  const ranked = records
    .map((record) => {
      const labels = [
        record.id,
        record.title,
        record.sourceName,
        ...(record.semantic.anchors || []),
      ].filter(Boolean);
      const score = labels.reduce(
        (sum, label) => sum + (normalized.includes(label.toLocaleLowerCase('de-DE')) ? 10 : 0),
        0
      );
      return { record, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length)
    return ranked.filter((item) => item.score === ranked[0].score).map((item) => item.record);
  const associated = records.filter(
    (record) => record.provenance.conversationId === conversationId
  );
  return associated.length ? associated : records;
}

module.exports = {
  name: 'dataset',
  created() {
    this.datasetPool = new DatasetSqlitePool(
      process.env.WORKBENCH_DATASET_DB_PATH || 'data/datasets'
    );
    this.datasetQueues = new Map();
  },
  async stopped() {
    await Promise.allSettled([...this.datasetQueues.values()]);
    this.datasetPool.closeAll();
  },
  actions: {
    query: {
      rest: 'GET /query',
      params: {
        question: { type: 'string', optional: true, default: '' },
        id: { type: 'string', optional: true },
        version: { type: 'number', integer: true, optional: true },
        from: { type: 'string', optional: true },
        to: { type: 'string', optional: true },
        plan: { type: 'object', optional: true },
        conversationId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Query tenant datasets deterministically with user provenance',
        tags: ['Datapoints'],
        'x-agentable': true,
        parameters: [
          ...['question', 'id', 'from', 'to', 'conversationId'].map((name) => ({
            name,
            in: 'query',
            schema: { type: 'string' },
          })),
          { name: 'version', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'plan', in: 'query', schema: { type: 'object' } },
        ],
        responses: {
          200: { description: 'Dataset answer in sentences with units, time and provenance' },
        },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
        const active = records.filter((record) =>
          ctx.params.version
            ? record.version === ctx.params.version
            : ctx.params.id === record.id || record.current !== false
        );
        const matches = ctx.params.id
          ? active.filter(
              (record) => record.id === ctx.params.id || record.familyId === ctx.params.id
            )
          : matchingDatasets(active, ctx.params.question, ctx.params.conversationId);
        if (!matches.length)
          return {
            responseText: 'Dazu ist kein zugänglicher Datensatz im Tenant-Katalog vorhanden.',
            datasets: [],
          };
        if (matches.length > 1)
          return {
            responseText: `Mehrere Datensätze passen: ${matches.map((record) => `${record.title} (Version ${record.version}, ${record.id})`).join('; ')}. Bitte wähle den Datensatz.`,
            datasets: matches.map((record) => ({
              id: record.id,
              title: record.title,
              version: record.version,
            })),
          };
        const record = matches[0];
        if (record.tenantId !== p.tenantId) deny('Tenant mismatch');
        if (/welche.*daten|katalog|catalog/i.test(ctx.params.question))
          return {
            responseText: `${record.title}, Version ${record.version}: ${record.rowCount} Zeilen, ${record.period.from || 'Zeitraum ungeklärt'} bis ${record.period.to || 'ungeklärt'}; Nutzerangabe von ${record.provenance.person} am ${record.provenance.at.slice(0, 10)}.`,
            datasets: [{ id: record.id, title: record.title }],
          };
        const plan = ctx.params.plan || (await datasetQueryPlan(record, ctx.params.question));
        return executeDatasetQuery(this.datasetPool, record, { ...ctx.params, plan });
      },
    },
    // Internal ingestion/mutation entrypoint; never offered to the read capability loop.
    turn: {
      visibility: 'protected',
      params: {
        question: 'string',
        documents: { type: 'array', optional: true, default: [] },
        conversationId: 'string',
        sensitivityLevel: { type: 'string', optional: true, default: 'tenant_internal' },
      },
      async handler(ctx) {
        const p = principal(ctx);
        const previous = this.datasetQueues.get(p.tenantId) || Promise.resolve();
        const task = previous.catch(() => {}).then(() => this.datasetTurn(ctx, p));
        this.datasetQueues.set(p.tenantId, task);
        try {
          return await task;
        } finally {
          if (this.datasetQueues.get(p.tenantId) === task) this.datasetQueues.delete(p.tenantId);
        }
      },
    },
  },
  methods: {
    async datasetTurn(ctx, p) {
      const { question, documents, conversationId } = ctx.params;
      const ordinary = [],
        tables = [];
      for (const document of documents) {
        const parsed = parseDatasetText(document.text, document.name);
        if (parsed.length)
          tables.push(
            ...parsed.map((table) => ({ ...table, sensitivityLevel: document.sensitivityLevel }))
          );
        else ordinary.push(document);
      }
      const pasted = !documents.length ? parseDatasetText(question, 'Eingefügte Tabelle') : [];
      tables.push(...pasted);
      const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
      const deleted = tables.length
        ? await ctx.call('datapoint.datasetCatalog', { operation: 'deleted' })
        : [];
      const replayed = [];
      const confirmations = [],
        ids = [];
      for (const table of tables) {
        const deletion = deleted.find((record) => record.hash === table.hash);
        if (deletion) {
          replayed.push({ ...deletion, name: table.name });
          continue;
        }
        const duplicate = records.find((record) => record.hash === table.hash);
        if (duplicate) {
          ids.push(duplicate.id);
          continue;
        }
        const ephemeral = disposableDataset(table, question);
        const semantic = await datasetSemantics(
          table,
          p.tenantId,
          pasted.length ? 'Berechne die Zusammenfassung der Tabelle.' : question
        );
        const times = normalizeDatasetTimes(table.rows, semantic.timeField, semantic.timezone);
        const columns = table.profile.columns;
        const same = records.filter(
          (record) => record.sourceName === table.name && record.sheet === table.sheet
        );
        const prior = same.sort((a, b) => b.version - a.version)[0];
        const id = datasetId(),
          now = new Date().toISOString();
        const auth = ctx.meta.authUser || ctx.meta.apiToken;
        const record = {
          id,
          tenantId: p.tenantId,
          familyId: prior?.familyId || id,
          version: prior ? prior.version + 1 : 1,
          current: true,
          hash: table.hash,
          sourceName: table.name,
          sheet: table.sheet,
          title: semantic.title,
          sensitivityLevel: table.sensitivityLevel || ctx.params.sensitivityLevel,
          semantic,
          columns,
          profile: table.profile,
          rowCount: table.rows.length,
          period: {
            from: table.rows.find((row) => row[semantic.timeField])?.[semantic.timeField] || null,
            to: table.rows.at(-1)?.[semantic.timeField] || null,
          },
          quality: {
            ...times,
            utc: undefined,
            local: undefined,
            missingValues: columns.reduce((sum, column) => sum + column.nullCount, 0),
          },
          provenance: {
            person: auth.name || auth.displayName || p.actorId,
            actorId: p.actorId,
            roles: p.roles,
            at: now,
            conversationId,
            filename: table.name,
          },
          audit: [{ kind: 'created', actorId: p.actorId, at: now }],
        };
        this.datasetPool.putRows(p.tenantId, id, table.rows, columns, times.utc, times.local);
        if (ephemeral) {
          try {
            const answer = executeDatasetQuery(this.datasetPool, record, {
              question: 'Zusammenfassung',
            });
            confirmations.push(
              answer.responseText + '\n\nDie kleine Tabelle wurde nur für diese Frage ausgewertet.'
            );
          } finally {
            this.datasetPool.removeRows(p.tenantId, id);
          }
          continue;
        }
        try {
          await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
        } catch (error) {
          this.datasetPool.removeRows(p.tenantId, id);
          throw error;
        }
        if (prior)
          await ctx.call('datapoint.datasetCatalog', {
            operation: 'put',
            record: { ...prior, current: false },
          });
        records.push(record);
        ids.push(id);
        confirmations.push(
          `Hab ich abgelegt: ${record.title}, Version ${record.version}, ${record.period.from || 'Zeitraum ungeklärt'} bis ${record.period.to || 'ungeklärt'}, ${record.rowCount.toLocaleString('de-DE')} Werte, ${record.quality.missingValues} leere Werte und ${times.gaps} fehlende Intervalle, ${times.intervalMinutes || 'ungeklärtes'}-min-Raster${Object.values(semantic.units).filter(Boolean).length ? ' in ' + [...new Set(Object.values(semantic.units).filter(Boolean))].join(', ') : '; Einheit ungeklärt'}. ${semantic.assumptions.join(' ')}`
        );
      }
      const deletedReference = replayed.find(
        (record) =>
          question.toLocaleLowerCase().includes(record.name.toLocaleLowerCase()) &&
          !records.some(
            (active) =>
              ids.includes(active.id) &&
              active.sourceName.toLocaleLowerCase() === record.name.toLocaleLowerCase()
          )
      );
      if (replayed.length && (replayed.length === tables.length || deletedReference)) {
        const loop = await require('../src/workbench-capability-loop').runCapabilityLoop(ctx, {
          meta: ctx.meta,
          datasetRequest: {
            question,
            conversationId,
            id: (deletedReference || replayed[0]).id,
          },
        });
        return {
          handled: true,
          responseText: [loop.responseText, ...confirmations].filter(Boolean).join('\n\n'),
          sources: loop.trace,
          answerMs: loop.answerMs,
          documents: ordinary,
        };
      }
      if (!confirmations.length) {
        const candidates = matchingDatasets(
          records.filter((record) => record.current !== false),
          question,
          conversationId
        );
        const mutating = /lösch|loesch|delete|korrigier|werte sind|einheit.*(?:ist|sind)/i.test(
          question
        );
        if (mutating && candidates.length > 1)
          return {
            handled: true,
            responseText: `Bitte wähle den Datensatz: ${candidates.map((record) => `${record.title} (${record.id})`).join('; ')}.`,
          };
        if (mutating && candidates.length === 1) {
          const record = candidates[0];
          if (/lösch|loesch|delete/i.test(question)) {
            const family = records.filter((item) => item.familyId === record.familyId);
            for (const item of family) {
              this.datasetPool.removeRows(p.tenantId, item.id);
              await ctx.call('datapoint.datasetCatalog', { operation: 'remove', id: item.id });
            }
            return {
              handled: true,
              responseText: `Der Datensatz ${record.title} und seine ${family.length} Version(en) sind physisch gelöscht. Die Löschung ist auditiert.`,
            };
          }
          const rows = this.datasetPool.rows(p.tenantId, record.id, record.columns);
          const semantic = await datasetSemantics(
            { rows, name: record.title, hash: record.hash },
            p.tenantId,
            question,
            record.semantic
          );
          // No new row version; metadata correction is audited independently.
          if (semantic.interpretationStatus !== 'interpreted')
            return {
              handled: true,
              responseText:
                'Die Semantikkorrektur konnte ich noch nicht sicher zuordnen. Die bisherige Semantik bleibt erhalten. Bitte nenne Spalte, Einheit, Raster und gegebenenfalls Zeitzone ausdrücklich.',
            };
          const updated = {
            ...record,
            semantic,
            audit: [
              ...record.audit,
              {
                kind: 'semantic-correction',
                actorId: p.actorId,
                at: new Date().toISOString(),
                before: record.semantic,
                after: semantic,
              },
            ],
          };
          const times = normalizeDatasetTimes(rows, semantic.timeField, semantic.timezone);
          updated.quality = {
            ...updated.quality,
            ...times,
            utc: undefined,
            local: undefined,
            intervalMinutes: semantic.intervalMinutes || times.intervalMinutes,
          };
          this.datasetPool.updateTimes(p.tenantId, record.id, times.utc, times.local);
          await ctx.call('datapoint.datasetCatalog', { operation: 'put', record: updated });
          return {
            handled: true,
            responseText: `Die Semantik von ${record.title} ist korrigiert: ${Object.entries(
              semantic.units
            )
              .filter(([, unit]) => unit)
              .map(([field, unit]) => `${field}: ${unit}`)
              .join('; ')}. ${semantic.assumptions.join(' ')}`,
          };
        }
        if (
          !candidates.length ||
          !/welche.*daten|wie\s+(?:hoch|viel|groß|gross)|summe|spitzen|energie|überblick|ueberblick|maximum|minimum|gesamt|daten|werte|mittel|durchschnitt|auffäll|auffaell|lücken|luecken|ausreißer|ausreisser|zeitumstellung/i.test(
            question
          )
        )
          return { handled: false, documents: ordinary };
      }
      if (tables.length || records.length) {
        const loop = await require('../src/workbench-capability-loop').runCapabilityLoop(ctx, {
          meta: ctx.meta,
          datasetRequest: {
            question: pasted.length ? 'Zusammenfassung' : question,
            conversationId,
            ...(ids.length === 1 ? { id: ids[0] } : {}),
          },
        });
        const text = [loop.responseText, ...confirmations].filter(Boolean).join('\n\n');
        return {
          handled: Boolean(text),
          responseText: text,
          sources: loop.trace,
          answerMs: loop.answerMs,
          documents: ordinary,
        };
      }
      return { handled: false, documents: ordinary };
    },
  },
};
