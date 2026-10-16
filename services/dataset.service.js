'use strict';

const { randomUUID } = require('node:crypto');
const { principal, deny } = require('../src/domain-router-policy');
const {
  parseDatasetText,
  disposableDataset,
  datasetPlausibility,
} = require('../src/dataset-input');
const { datasetSemantics, datasetQueryPlan } = require('../src/dataset-semantics');
const { normalizeDatasetTimes } = require('../src/dataset-time');
const { executeDatasetQuery } = require('../src/dataset-query');
const { controlConfirmation, datasetSheetTitle } = require('../src/dataset-table-quality');
const {
  registerDatasetVariants,
  variantDifference,
  compareDatasetResults,
} = require('../src/dataset-variants');
const DatasetSqlitePool = require('../src/dataset-sqlite-pool');

function datasetId() {
  return `ds_${randomUUID().replaceAll('-', '')}`;
}

async function matchingDatasets(records, question, conversationId) {
  if (
    /(?:datensatz|tabelle|dataset|werte|einheit)/i.test(question) &&
    /lösch|loesch|delete|korrigier|werte sind|einheit.*(?:ist|sind)/i.test(question)
  ) {
    const text = String(question || '').toLocaleLowerCase('de-DE');
    const namedSheet = require('../src/dataset-variants').namedSheetCandidates(records, question);
    if (namedSheet.length) return namedSheet;
    const explicit = records.filter((record) =>
      [record.id, record.title, record.sourceName]
        .filter(Boolean)
        .some((label) => text.includes(label.toLocaleLowerCase('de-DE')))
    );
    if (explicit.length) return explicit;
    const preferred = records.filter((record) =>
      record.selectedInConversations?.includes(conversationId)
    );
    if (preferred.length) return preferred;
    return records.filter(
      (record) =>
        record.provenance.conversationId === conversationId ||
        record.projectRefs?.some((ref) => ref.conversationId === conversationId)
    );
  }
  return require('../src/dataset-routing').selectDatasetCandidates(records, question, {
    conversationId,
    scopeRequired: Boolean(conversationId),
  });
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
    for (const pending of this.projectDatasetPools?.values() || []) (await pending).closeAll();
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
          ? active.some((record) => record.id === ctx.params.id)
            ? active.filter((record) => record.id === ctx.params.id)
            : active.filter((record) => record.familyId === ctx.params.id)
          : await matchingDatasets(active, ctx.params.question, ctx.params.conversationId);
        if (!matches.length)
          return {
            responseText: 'Dazu ist kein zugänglicher Datensatz im Tenant-Katalog vorhanden.',
            datasets: [],
          };
        if (
          matches.length > 1 &&
          matches.every(
            (record) => record.id === matches[0].id || matches[0].variants?.includes(record.id)
          )
        ) {
          matches.sort((a, b) =>
            require('../src/canonical-order').compareCanonicalStrings(a.sheet, b.sheet)
          );
          const answers = [];
          const differences = [];
          for (const record of matches) {
            answers.push(await ctx.call('dataset.query', { ...ctx.params, id: record.id }));
            if (record.id !== matches[0].id) {
              const pool = await require('../src/project-dataset-pool').datasetPoolFor(
                this,
                record
              );
              differences.push(variantDifference(pool, matches[0], record));
            }
          }
          return {
            responseText: [
              ...answers.map((answer) => answer.responseText),
              compareDatasetResults(matches, answers, differences),
            ].join('\n\n'),
            datasets: matches.map(({ id, title, version }) => ({ id, title, version })),
            comparisons: differences,
            answers,
          };
        }
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
        const pool = await require('../src/project-dataset-pool').datasetPoolFor(this, record);
        const unusable = await this.datasetHealth(ctx, p, record);
        if (unusable)
          return {
            responseText: `Der Datensatz ist unbrauchbar: ${unusable}`,
            datasetId: record.id,
            status: 'unusable',
          };
        if (/welche.*daten|katalog|catalog/i.test(ctx.params.question))
          return {
            responseText: `${record.title}, Version ${record.version}: ${record.rowCount} Zeilen, ${record.period.from || 'Zeitraum ungeklärt'} bis ${record.period.to || 'ungeklärt'}; Nutzerangabe von ${record.provenance.person} am ${record.provenance.at.slice(0, 10)}.`,
            datasets: [{ id: record.id, title: record.title }],
            datasetId: record.id,
            version: record.version,
            rowCount: record.rowCount,
          };
        if (record.structuredFormat)
          return require('../src/structured-message').queryStructured(pool, record, ctx.params);
        if (
          require('../src/dataset-query').requestedDatasetField(record, ctx.params.question) ===
          false
        )
          return {
            responseText: 'Die angefragte Spalte wurde im Datensatz nicht gefunden.',
            datasetId: record.id,
            status: 'unavailable',
          };
        const plan = ctx.params.plan || (await datasetQueryPlan(record, ctx.params.question));
        const answer = executeDatasetQuery(pool, record, { ...ctx.params, plan });
        answer.variantDifferences = [];
        for (const peer of active.filter(
          (item) => record.variants?.includes(item.id) && !item.quality?.unusable
        )) {
          const difference = variantDifference(pool, record, peer);
          if (difference) answer.variantDifferences.push({ datasetId: peer.id, ...difference });
        }
        answer.aggregation = plan.operations.find((operation) => operation.op === 'aggregate');
        answer.filtered = plan.operations.some(
          (operation) => operation.op === 'filter' && operation.field !== record.semantic.timeField
        );
        const fields = require('../src/dataset-unit-question').unresolvedAnswerUnits(
          record,
          answer
        );
        if (fields.length && !record.semantic.unitQuestion) {
          record.semantic.unitQuestion = { fields, at: new Date().toISOString() };
          await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
          answer.responseText += `\n\nWelche Einheit gilt in ${record.title} für ${fields.join(', ')}?`;
        }
        return answer;
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
    async datasetHealth(ctx, p, record) {
      if (record.structuredFormat) return null;
      if (record.provenance?.projectId) {
        const pool = await require('../src/project-dataset-pool').datasetPoolFor(this, record);
        const count = pool
          .tenant(p.tenantId)
          .prepare(`SELECT COUNT(*) AS n FROM ${pool.table(record.id)}`)
          .get().n;
        return count === record.rowCount ? null : 'Stored project row count mismatch';
      }
      if (record.quality?.unusable) return record.quality.reason;
      let reason = datasetPlausibility(record);
      if (!reason) {
        try {
          const rows = this.datasetPool.rows(p.tenantId, record.id, record.columns);
          reason = datasetPlausibility(record, rows);
          if (!rows.length) reason = 'Die gespeicherten Tabellenwerte fehlen.';
        } catch (_error) {
          reason = 'Die gespeicherten Tabellenwerte sind nicht zugänglich.';
        }
      }
      if (!reason) return null;
      const updated = {
        ...record,
        current: false,
        quality: { ...record.quality, unusable: true, reason },
        audit: [
          ...(record.audit || []),
          { kind: 'quarantined', actorId: p.actorId, at: new Date().toISOString(), reason },
        ],
      };
      await ctx.call('datapoint.datasetCatalog', { operation: 'put', record: updated });
      Object.assign(record, updated);
      return reason;
    },
    async datasetTurn(ctx, p) {
      const structured = await require('../src/structured-message').structuredTurn(this, ctx, p);
      if (structured) return structured;
      const { question, documents, conversationId } = ctx.params;
      const ordinary = [],
        tables = [];
      try {
        for (const document of documents) {
          const parsed = parseDatasetText(document.text, document.name);
          if (parsed.length)
            tables.push(
              ...parsed.map((table) => ({ ...table, sensitivityLevel: document.sensitivityLevel }))
            );
          else ordinary.push(document);
        }
        if (!documents.length) tables.push(...parseDatasetText(question, 'Eingefügte Tabelle'));
      } catch (error) {
        if (!['WORKBENCH_DATASET_DAMAGED', 'WORKBENCH_DATASET_UNUSABLE'].includes(error.type))
          throw error;
        return { handled: true, responseText: error.message, documents: [], datasetIds: [] };
      }
      const pasted = !documents.length ? tables : [];
      const allRecords = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
      const records = allRecords.filter((record) => !record.provenance?.projectId);
      if (tables.length) for (const record of records) await this.datasetHealth(ctx, p, record);
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
        const duplicate = records.find(
          (record) =>
            record.hash === table.hash && record.sheet === table.sheet && !record.quality?.unusable
        );
        if (duplicate) {
          ids.push(duplicate.id);
          continue;
        }
        const damage = datasetPlausibility(table, table.rows);
        if (damage)
          return {
            handled: true,
            responseText:
              'Die Datei kam beschädigt an; bitte lade sie erneut hoch oder schalte den Dateikanal ein.',
          };
        const ephemeral =
          tables.length === 1 && !table.controls?.length && disposableDataset(table, question);
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
          title: datasetSheetTitle(semantic.title, table.sheet, table.explicitSheet),
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
            controls: table.controls || [],
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
        if (prior) prior.current = false;
        await registerDatasetVariants(ctx, this.datasetPool, record, records);
        records.push(record);
        ids.push(id);
        confirmations.push(
          `Hab ich abgelegt: ${record.title}, Version ${record.version}, ${record.period.from || 'Zeitraum ungeklärt'} bis ${record.period.to || 'ungeklärt'}, ${record.rowCount.toLocaleString('de-DE')} Werte, ${record.quality.missingValues} leere Werte und ${times.gaps} fehlende Intervalle, ${times.intervalMinutes || 'ungeklärtes'}-min-Raster${Object.values(semantic.units).filter(Boolean).length ? ' in ' + [...new Set(Object.values(semantic.units).filter(Boolean))].join(', ') : '; Einheit ungeklärt'}. ${semantic.assumptions.join(' ')}${controlConfirmation(record.quality.controls) ? ` ${controlConfirmation(record.quality.controls)}` : ''}${table.emptyColumns?.length ? ` ${table.emptyColumns.length} Spalten sind durchgehend leer und für Auswertungen nicht nutzbar.` : ''}`
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
      if (deletedReference) {
        return {
          handled: true,
          responseText: [
            'Dazu ist kein zugänglicher Datensatz im Tenant-Katalog vorhanden.',
            ...confirmations,
          ].join('\n\n'),
          documents: ordinary,
        };
      }
      const correctionRecords = require('../src/workbench-data-scope').scopedDatasets(
        allRecords.filter((record) => record.current !== false && !record.structuredFormat),
        question,
        { conversationId }
      );
      const legacyCorrection =
        /(?:datensatz|tabelle|dataset|werte|einheit)/i.test(question) &&
        /lösch|loesch|delete|korrigier|werte sind|einheit.*(?:ist|sind)/i.test(question);
      const correction =
        !confirmations.length && (!documents.length || tables.length) && !legacyCorrection
          ? await require('../src/dataset-correction').datasetCorrection(
              correctionRecords,
              question,
              p.tenantId
            )
          : null;
      if (!confirmations.length && (legacyCorrection || correction)) {
        const deleting = /lösch|loesch|delete/i.test(question);
        const candidates = correction
          ? correctionRecords.filter(
              (record) => !correction.datasetId || record.id === correction.datasetId
            )
          : await matchingDatasets(
              deleting ? records.filter((record) => record.current !== false) : correctionRecords,
              question,
              conversationId
            );
        const mutating = Boolean(correction) || legacyCorrection;
        if (mutating && candidates.length > 1)
          return {
            handled: true,
            responseText: `Bitte wähle den Datensatz: ${candidates.map((record) => `${record.title} (${record.id})`).join('; ')}.`,
          };
        if (mutating && candidates.length === 1) {
          const record = candidates[0];
          if (correction?.kind === 'restore-rows')
            return require('../src/dataset-correction').restoreDatasetControls(
              this,
              ctx,
              p,
              record,
              correction.rowNumbers
            );
          if (correction?.kind === 'select-sheet')
            return require('../src/dataset-correction').selectDatasetSheet(
              ctx,
              p,
              correctionRecords,
              record,
              conversationId
            );
          if (deleting) {
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
          const correctionPool = await require('../src/project-dataset-pool').datasetPoolFor(
            this,
            record
          );
          const semantic = await datasetSemantics(
            { profile: record.profile, name: record.title, hash: record.hash },
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
          const temporalChange = [
            'timeField',
            'timezone',
            'intervalConvention',
            'intervalMinutes',
          ].some((key) => semantic[key] !== record.semantic[key]);
          if (temporalChange) {
            const rows = correctionPool.rows(p.tenantId, record.id, record.columns);
            const times = normalizeDatasetTimes(rows, semantic.timeField, semantic.timezone);
            updated.quality = {
              ...updated.quality,
              ...times,
              utc: undefined,
              local: undefined,
              intervalMinutes: semantic.intervalMinutes || times.intervalMinutes,
            };
            const db = correctionPool.tenant(p.tenantId);
            const positions = db
              .prepare(
                `SELECT row_number FROM ${correctionPool.table(record.id)} ORDER BY row_number`
              )
              .all();
            const updateTime = db.prepare(
              `UPDATE ${correctionPool.table(record.id)} SET utc = ?, local_time = ? WHERE row_number = ?`
            );
            db.transaction(() =>
              positions.forEach((row, i) =>
                updateTime.run(times.utc[i] || null, times.local[i] || null, row.row_number)
              )
            )();
          }
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
      if (confirmations.length && !ids.length)
        return {
          handled: true,
          responseText: confirmations.join('\n\n'),
          documents: ordinary,
        };
      return { handled: false, documents: ordinary, confirmations, datasetIds: ids };
    },
  },
};
