'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { profileRows } = require('./tabular-intelligence');
const { datasetSetting, datasetLimit, parseDatasetText } = require('./dataset-input');
const config = require('./structured-message-adapters.json');
const adapters = config.adapters.map((entry) => ({
  ...entry,
  implementation: require(entry.module),
}));

function adapterFor(id) {
  const adapter = adapters.find((entry) => entry.id === id);
  if (!adapter) throw new Error('Unbekanntes strukturiertes Nachrichtenformat.');
  return adapter.implementation;
}
function queryStructured(pool, record, input) {
  return adapterFor(record.structuredFormat).query(pool, record, input);
}

async function structuredTurn(service, ctx, p) {
  const { question, documents, conversationId } = ctx.params;
  const candidates = documents.length
    ? documents
    : [{ text: question, name: 'Eingefügte Nachricht' }];
  const incoming = candidates
    .map((document) => ({
      document,
      adapter: adapters.find((a) => a.implementation.recognizes(document.text)),
    }))
    .filter((entry) => entry.adapter);
  if (!incoming.length) {
    if (documents.length || parseDatasetText(question, 'Eingefügte Tabelle').length) return null;
    const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
    let associated = records.filter(
      (r) =>
        r.current !== false &&
        r.structuredFormat &&
        (question.includes(r.sourceName) ||
          r.provenance.conversationId === conversationId ||
          r.structured.conversations?.includes(conversationId))
    );
    const hasContext = associated.length > 0;
    if (!associated.length)
      associated = records.filter((r) => r.current !== false && r.structuredFormat);
    if (associated.length !== 1 || !adapterFor(associated[0].structuredFormat).accepts(question))
      return null;
    const competing = records.some(
      (record) =>
        record.current !== false &&
        !record.structuredFormat &&
        (!hasContext ||
          record.provenance.conversationId === conversationId ||
          question.includes(record.sourceName) ||
          ctx.params.previousReads?.some(
            (read) => read.source === 'dataset.query' && read.metadata?.datasetId === record.id
          ))
    );
    if (
      competing &&
      !adapterFor(associated[0].structuredFormat).accepts(question, { explicitOnly: true })
    )
      return null;
    if (/lösch|loesch|delete|korrigier/iu.test(question)) return null;
    const result = await ctx.call('dataset.query', {
      question,
      id: associated[0].id,
      conversationId,
    });
    const presented = await presentStructured(
      ctx,
      associated[0],
      { question, id: associated[0].id, conversationId },
      result
    );
    return {
      handled: true,
      answerMs: presented.answerMs || 0,
      responseText: presented.responseText,
      sources: [{ source: 'dataset.query', status: 'available', called: true }],
      documents,
    };
  }
  const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
  const deleted = await ctx.call('datapoint.datasetCatalog', { operation: 'deleted' });
  const answers = [];
  let askPurpose = false;
  const purposeUnclear = /was.*(?:sagen|dazu|kannst)|^\s*$/iu.test(question) || !documents.length;
  let answerMs = 0;
  for (const { document, adapter } of incoming) {
    if (Buffer.byteLength(document.text) > datasetSetting('MAX_BYTES', 8000000))
      datasetLimit('Die strukturierte Nachricht überschreitet das Bytebudget.');
    const hash = createHash('sha256').update(document.text).digest('hex');
    if (deleted.some((r) => r.hash === hash)) {
      answers.push(
        'Dieser Inhalt wurde bereits gelöscht und wird durch einen erneut übermittelten Anhang nicht wieder abgelegt.'
      );
      continue;
    }
    let record = records.find((r) => r.hash === hash);
    if (!record) {
      const parsed = adapter.implementation.parse(document.text, document.name);
      if (parsed.rows.length > datasetSetting('MAX_ROWS', 50000))
        datasetLimit('Zu viele Nachrichten.');
      const resolutions = await adapter.implementation.resolve(ctx, parsed.codes);
      const prior = records
        .filter((r) => r.sourceName === document.name && r.structuredFormat === adapter.id)
        .sort((a, b) => b.version - a.version)[0];
      const id = `ds_${randomUUID().replaceAll('-', '')}`;
      // Complete message content stays local; profile samples are never needed.
      const rows = parsed.rows.length ? parsed.rows : [{ Befund: 'Keine Nachricht', Inhalt: '' }];
      const profile = profileRows(rows);
      profile.columns.forEach((column) => {
        delete column.examples;
        if (column.name === 'Inhalt') column.sensitive = true;
      });
      const now = new Date().toISOString();
      const auth = ctx.meta.authUser || ctx.meta.apiToken || {};
      record = {
        id,
        tenantId: p.tenantId,
        familyId: prior?.familyId || id,
        version: (prior?.version || 0) + 1,
        current: true,
        hash,
        sourceName: document.name,
        sheet: 'Nachrichten',
        title: parsed.title,
        sensitivityLevel: document.sensitivityLevel || ctx.params.sensitivityLevel,
        requiredClearance: document.original?.requiredClearance || [],
        structuredFormat: adapter.id,
        structured: { ...parsed, rows: undefined, resolutions, original: document.original },
        columns: profile.columns,
        profile,
        rowCount: parsed.rows.length,
        semantic: {
          title: parsed.title,
          anchors: parsed.types,
          units: {},
          assumptions: [],
          timeField: '',
          timezone: 'UTC',
        },
        period: { from: parsed.rows[0]?.Von || null, to: parsed.rows.at(-1)?.Bis || null },
        quality: { findings: parsed.findings, gaps: 0, duplicates: 0, transitions: [] },
        provenance: {
          person: auth.name || auth.displayName || p.actorId,
          actorId: p.actorId,
          roles: p.roles,
          at: now,
          conversationId,
          filename: document.name,
        },
        audit: [{ kind: 'created', actorId: p.actorId, at: now }],
      };
      service.datasetPool.putRows(p.tenantId, id, rows, record.columns);
      try {
        await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
      } catch (error) {
        service.datasetPool.removeRows(p.tenantId, id);
        throw error;
      }
      if (prior)
        await ctx.call('datapoint.datasetCatalog', {
          operation: 'put',
          record: { ...prior, current: false },
        });
      records.push(record);
    }
    if (!record.structured.conversations?.includes(conversationId)) {
      record.structured.conversations = [
        ...(record.structured.conversations || []),
        conversationId,
      ];
      await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
      askPurpose ||= purposeUnclear;
    }
    const result = await ctx.call('dataset.query', {
      id: record.id,
      question: documents.length ? question : 'Überblick',
      conversationId,
    });
    const presented = await presentStructured(
      ctx,
      record,
      { id: record.id, question: documents.length ? question : 'Überblick', conversationId },
      result
    );
    answerMs += presented.answerMs || 0;
    answers.push(presented.responseText);
  }
  if (askPurpose)
    answers.push(
      'Worum geht’s dir – um einen Überblick, eine Prüfung oder die Aufschlüsselung einzelner Nachrichten?'
    );
  return {
    handled: true,
    responseText: answers.join('\n\n'),
    answerMs,
    sources: [{ source: 'dataset.query', status: 'available', called: true }],
    documents: documents.filter((doc) => !incoming.some((item) => item.document === doc)),
  };
}

async function presentStructured(ctx, record, request, result) {
  const loop = await require('./workbench-capability-loop').runCapabilityLoop(ctx, {
    meta: ctx.meta,
    datasetRequest: request,
  });
  const required = adapterFor(record.structuredFormat).markers(record, result);
  const acceptable =
    required.every((text) => loop.responseText.includes(text)) &&
    !/\?|\b(?:Prüfe|Kläre|Nenne|Der Nutzer|Der Anfragende)\b/u.test(loop.responseText);
  return {
    responseText: acceptable ? loop.responseText : result.responseText,
    answerMs: loop.answerMs,
  };
}

module.exports = { structuredTurn, queryStructured };
