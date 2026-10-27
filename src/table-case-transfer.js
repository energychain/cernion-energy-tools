'use strict';

// Explicit request to file cases for rows of an attached record list (#986). The rows come from a
// read-only table analysis; every case is internal (no external effect) and one identifier is filed
// at most once per conversation.
const MAX_CASES = 20;
const FIELDS = ['kennung', 'titel', 'frist', 'owner'];

// Grammatical request form ("lege … Fälle … an", "erstelle Vorgänge"), independent of the subject.
function caseTransferRequested(message) {
  const text = String(message || '').toLowerCase();
  return (
    /\b(?:lege|leg|erstelle|eröffne|eroeffne|anlegen|erstellen|eröffnen)\b/u.test(text) &&
    /\b(?:fälle|faelle|vorgänge|vorgaenge)\b/u.test(text) &&
    !/\b(?:nicht|keine?)\s+(?:fälle|faelle|vorgänge|vorgaenge)\b/u.test(text)
  );
}

function rowsFrom(result) {
  return (result.result || [])
    .map((row) =>
      Object.fromEntries(
        FIELDS.map((field) => {
          const key = Object.keys(row).find((name) => name.toLowerCase() === field);
          return [field, key === undefined || row[key] === null ? '' : String(row[key]).trim()];
        })
      )
    )
    .filter((row) => row.kennung);
}

async function caseTransferReply(service, ctx, { p, envelope, pending, meta, records }) {
  if (!records.length || !caseTransferRequested(envelope.userRequest)) return null;
  const analysis = await ctx.call(
    'dataset.analyze',
    {
      ids: records.map((record) => record.id),
      question: `${envelope.userRequest}\n\nWähle genau die Zeilen, für die nach dieser Bitte Fälle angelegt werden sollen, je Kennung eine Zeile, mit den Spalten kennung, titel (kurze Beschreibung aus vorhandenen Spalten), frist (Datum oder leer) und owner (zuständige Rolle oder Team aus vorhandenen Spalten oder leer).`,
      phrase: false,
    },
    { meta }
  );
  const conversation = require('./workbench-conversation');
  const filed = new Set(pending?.tableCaseIdentifiers || []);
  // The first row of an identifier is kept; repeated export rows add nothing.
  const rows = [];
  for (const row of rowsFrom(analysis))
    if (!rows.some((item) => item.kennung === row.kennung)) rows.push(row);
  const created = [];
  const skipped = [];
  for (const row of rows.slice(0, MAX_CASES)) {
    if (filed.has(row.kennung)) {
      skipped.push(row.kennung);
      continue;
    }
    const title = `${row.kennung}: ${row.titel || 'Klärung aus Tabellenzeile'}`.slice(0, 200);
    const result = await ctx.call(
      'domain-router.classify',
      {
        userRequest: title,
        conversationId: `${envelope.conversationId}:${row.kennung}`.slice(0, 200),
        disableKnowledgeRouting: true,
        knownContext: {
          situation: {
            concern: title,
            situation: `Aus ${analysis.provenance.replace(/^Herkunft:\s*/u, '').replace(/\.$/u, '')}.`,
            participants: [],
            // Typed so a later turn naming the same identifier continues this case.
            identifiers: [{ kind: 'kennung', value: row.kennung }],
            deadlines: row.frist ? [{ value: row.frist, basis: row.frist }] : [],
            hypotheses: [],
            missingInformation: [],
            turnKind: 'work',
            requestedAction: { description: '', draftRequested: false, externalEffect: false },
            caseWork: {
              ownerRole: row.owner,
              deadline: row.frist,
              nextConsideration: '',
              reminder: '',
            },
          },
        },
      },
      { meta }
    );
    const displayRef = await service.store.caseDisplayRef({
      tenantId: p.tenantId,
      caseId: result.cetCaseId,
    });
    filed.add(row.kennung);
    created.push({ ...row, displayRef });
  }
  await conversation.saveTurn(service.conversationsDb, p, envelope, {
    tableCaseIdentifiers: [...filed],
  });
  const lines = created.map(
    (row) =>
      `- Fall ${row.displayRef}: ${row.kennung}${row.titel ? ` – ${row.titel}` : ''}; Frist: ${row.frist || 'zur Abstimmung'}; Owner-Rolle: ${row.owner || 'zur Abstimmung'}; nächster Schritt: zur Abstimmung`
  );
  return {
    state: 'assistance',
    nonBinding: true,
    responseText: [
      created.length
        ? `Ich habe ${created.length} interne Fälle angelegt:\n${lines.join('\n')}`
        : 'Für diese Bitte habe ich in der Tabelle keine neuen Zeilen gefunden, für die ein Fall anzulegen wäre.',
      skipped.length ? `Bereits in diesem Gespräch angelegt: ${skipped.join(', ')}.` : '',
      rows.length > MAX_CASES
        ? `Weitere ${rows.length - MAX_CASES} Zeilen habe ich nicht angelegt; bitte grenze die Auswahl ein.`
        : '',
      'Es wurde nichts an Externe gesendet.',
      analysis.provenance,
    ]
      .filter(Boolean)
      .join('\n\n'),
    sources: [{ source: 'dataset.analyze', status: 'available', called: true }],
  };
}

module.exports = { caseTransferRequested, caseTransferReply, MAX_CASES };
