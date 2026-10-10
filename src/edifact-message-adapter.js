'use strict';

const { tokenizeSegments, parseUnaAndBody } = require('./edifact-base');
const types = require('./edifact-message-types.json');
const { parseMscons } = require('./edm-mscons-parser');
const { exactToken } = require('./workbench-codes');
const { formatDatasetNumber } = require('./dataset-query');

function recognizes(text) {
  return /^(?:UNA.{6}|UNB[+]|UNH[+])/su.test(
    String(text || '')
      .trim()
      .replace(/^\uFEFF/u, '')
  );
}
function value(segment, element = 0, component = 0) {
  return segment?.elements?.[element]?.[component] || '';
}
function dateValue(raw, format) {
  if (format === '102' && /^\d{8}$/u.test(raw))
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (['203', '303'].includes(format) && /^\d{12}/u.test(raw))
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}${format === '303' ? raw.slice(12) : ''}`;
  return raw;
}
function cents(raw, decimal) {
  const escaped = decimal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(`^-?\\d+(?:${escaped}\\d{1,2})?$`, 'u').test(raw)) return null;
  const [whole, fraction = ''] = raw.replace(decimal, '.').split('.');
  const amount =
    (Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, '0'))) *
    (raw.startsWith('-') ? -1 : 1);
  return Number.isSafeInteger(amount) ? amount : null;
}
function finding(code, message, segment, detail) {
  return { code, messageRef: message?.ref || '', segment, detail };
}

function parseMessage(message, separators, findings) {
  const config = types[message.type] || { required: [], groupStarts: [] };
  if (!types[message.type])
    findings.push(
      finding(
        'unsupported_type',
        message,
        message.start,
        `Für Nachrichtentyp ${message.type} sind keine fachlichen Mindestprüfungen konfiguriert; Inhalt und Syntax sind erfasst.`
      )
    );
  const segments = message.segments;
  const bgm = segments.find((s) => s.tag === 'BGM');
  const dates = segments.filter((s) => s.tag === 'DTM');
  const pickDate = (qualifier) => {
    const segment = dates.find((s) => value(s) === qualifier);
    return dateValue(value(segment, 0, 1), value(segment, 0, 2));
  };
  const number = value(bgm, 1) || message.ref;
  const amounts = [],
    groups = [];
  let group = null,
    summary = false;
  for (const segment of segments) {
    if (segment.tag === 'UNS' && value(segment) === 'S') {
      summary = true;
      group = null;
    }
    if (config.groupStarts.includes(segment.tag)) {
      group = { tag: segment.tag, reference: value(segment), start: segment.index, segments: [] };
      groups.push(group);
    }
    if (group) group.segments.push(segment.index);
    if (segment.tag !== 'MOA') continue;
    const amount = cents(value(segment, 0, 1), separators.decimal);
    const qualifier = value(segment);
    let kind = 'unresolved';
    for (const [label, codes] of Object.entries(config.amounts || {}))
      if (codes.includes(qualifier) && (label !== 'line' || !summary)) kind = label;
    amounts.push({ qualifier, cents: amount, kind, segment: segment.index });
    if (amount == null)
      findings.push(
        finding(
          'invalid_amount',
          message,
          segment.index,
          `Betrag in MOA ${qualifier} ist nicht centgenau lesbar.`
        )
      );
    if (amount < 0)
      findings.push(
        finding(
          'negative_amount',
          message,
          segment.index,
          `Negativer Betrag ${formatDatasetNumber(amount / 100)} in Nachricht ${number}; Vorzeichen fachlich prüfen.`
        )
      );
  }
  for (const tag of config.required)
    if (!segments.some((s) => s.tag === tag))
      findings.push(
        finding(
          'missing_segment',
          message,
          message.start,
          `Pflichtsegment ${tag} fehlt (${message.type}; konfigurierte Mindestprüfung).`
        )
      );
  const sum = (kind) => {
    const selected = amounts.filter((a) => a.kind === kind && a.cents != null);
    return selected.length ? selected.reduce((total, a) => total + a.cents, 0) : null;
  };
  const totals = Object.fromEntries(
    ['line', 'net', 'tax', 'total'].map((kind) => [kind, sum(kind)])
  );
  if (totals.line != null && totals.net != null && totals.line !== totals.net)
    findings.push(
      finding(
        'sum_mismatch',
        message,
        amounts.find((a) => a.kind === 'net').segment,
        `Nachricht ${number}: Positionssumme ${formatDatasetNumber(totals.line / 100)} weicht vom Nettobetrag ${formatDatasetNumber(totals.net / 100)} ab.`
      )
    );
  if (
    totals.net != null &&
    totals.tax != null &&
    totals.total != null &&
    totals.net + totals.tax !== totals.total
  )
    findings.push(
      finding(
        'sum_mismatch',
        message,
        amounts.find((a) => a.kind === 'total').segment,
        `Nachricht ${number}: Netto plus Steuer ${formatDatasetNumber((totals.net + totals.tax) / 100)} weicht vom Gesamtbetrag ${formatDatasetNumber(totals.total / 100)} ab.`
      )
    );
  const currencies = [
    ...new Set(
      segments
        .filter((s) => s.tag === 'CUX')
        .map((s) => value(s, 0, 1))
        .filter(Boolean)
    ),
  ];
  if (currencies.length !== 1 && message.type === 'INVOIC')
    findings.push(
      finding(
        'currency_unresolved',
        message,
        message.start,
        'Währung fehlt oder ist mehrdeutig; keine währungsübergreifende Summe.'
      )
    );
  const detail = {
    ...message,
    groups,
    amounts,
    totals,
    currencies,
    locations: segments.filter((s) => s.tag === 'LOC').map((s) => value(s, 1)),
    statuses: segments
      .filter((s) => ['ERC', 'STS'].includes(s.tag))
      .map((s) => ({ tag: s.tag, elements: s.elements, segment: s.index })),
  };
  if (message.type === 'MSCONS') {
    // The shared tokenizer has already decoded escapes; encode again for the
    // existing domain parser, keeping its interface and quality mapping intact.
    const escape = (s) => s.replace(/[?+:'']/gu, (char) => '?' + char);
    const raw = segments
      .map((s) => s.tag + '+' + s.elements.map((e) => e.map(escape).join(':')).join('+') + "'")
      .join('');
    detail.timeseries = parseMscons(raw);
  }
  return {
    Nummer: number,
    Typ: message.type,
    Version: message.version,
    Datum: pickDate(config.date),
    Von: pickDate(config.from),
    Bis: pickDate(config.to),
    Betrag: totals.total == null ? null : totals.total / 100,
    Waehrung: currencies.length === 1 ? currencies[0] : '',
    Inhalt: JSON.stringify(detail),
  };
}

function parse(text, name) {
  const { separators } = parseUnaAndBody(text);
  const segments = tokenizeSegments(text).map((s, i) => ({ ...s, index: i + 1 }));
  const findings = [],
    messages = [],
    interchanges = [];
  let current = null,
    interchange = null;
  for (const segment of segments) {
    if (!/^[A-Z]{3}$/u.test(segment.tag))
      findings.push(
        finding('invalid_tag', current, segment.index, 'Ungültiger Segmentbezeichner.')
      );
    if (segment.tag === 'UNB') {
      if (interchange)
        findings.push(
          finding('missing_unz', current, segment.index, 'Vorheriger Interchange ohne UNZ.')
        );
      interchange = {
        sender: value(segment, 1),
        receiver: value(segment, 2),
        date: segment.elements[3]?.join(' ') || '',
        ref: value(segment, 4),
        count: 0,
      };
      interchanges.push(interchange);
    }
    if (segment.tag === 'UNH') {
      if (current)
        findings.push(
          finding('missing_unt', current, segment.index, 'Nachricht ohne UNT abgeschlossen.')
        );
      current = {
        ref: value(segment),
        type: value(segment, 1),
        version: (segment.elements[1] || []).slice(1).join(':'),
        start: segment.index,
        segments: [],
      };
      messages.push(current);
      if (interchange) interchange.count++;
    }
    if (current) current.segments.push(segment);
    if (segment.tag === 'UNT') {
      if (!current) findings.push(finding('orphan_unt', null, segment.index, 'UNT ohne UNH.'));
      else {
        if (Number(value(segment)) !== current.segments.length)
          findings.push(
            finding(
              'unt_count',
              current,
              segment.index,
              `UNT-Zähler ${value(segment)} stimmt nicht: ${current.segments.length} Segmente zwischen UNH und UNT.`
            )
          );
        if (value(segment, 1) !== current.ref)
          findings.push(
            finding(
              'unt_reference',
              current,
              segment.index,
              'UNT-Referenz stimmt nicht mit UNH überein.'
            )
          );
      }
      current = null;
    }
    if (segment.tag === 'UNZ') {
      if (!interchange) findings.push(finding('orphan_unz', null, segment.index, 'UNZ ohne UNB.'));
      else {
        if (Number(value(segment)) !== interchange.count)
          findings.push(
            finding(
              'unz_count',
              null,
              segment.index,
              `UNZ-Zähler ${value(segment)} stimmt nicht: ${interchange.count} Nachrichten.`
            )
          );
        if (value(segment, 1) !== interchange.ref)
          findings.push(
            finding(
              'unz_reference',
              null,
              segment.index,
              'UNZ-Referenz stimmt nicht mit UNB überein.'
            )
          );
      }
      interchange = null;
    }
  }
  if (current) findings.push(finding('missing_unt', current, segments.length, 'UNT fehlt.'));
  if (interchange) findings.push(finding('missing_unz', null, segments.length, 'UNZ fehlt.'));
  if (!messages.length)
    findings.push(finding('missing_unh', null, 1, 'Keine UNH-Nachricht vorhanden.'));
  const rows = messages.map((message) => parseMessage(message, separators, findings));
  const totals = rows.filter((r) => r.Betrag != null);
  if (totals.length >= 4) {
    const mean = totals.reduce((s, r) => s + r.Betrag, 0) / totals.length;
    const deviation = Math.sqrt(
      totals.reduce((s, r) => s + (r.Betrag - mean) ** 2, 0) / totals.length
    );
    for (const row of totals)
      if (deviation > 0 && Math.abs(row.Betrag - mean) > 3 * deviation)
        findings.push(
          finding(
            'outlier',
            { ref: row.Nummer },
            0,
            `Betrag ${formatDatasetNumber(row.Betrag)} liegt mehr als drei Standardabweichungen vom Mittel entfernt.`
          )
        );
  }
  const codes = new Map();
  for (const s of segments.filter((s) =>
    ['BGM', 'DTM', 'NAD', 'MOA', 'QTY', 'LOC', 'ERC', 'STS', 'CCI'].includes(s.tag)
  )) {
    const code = s.tag === 'CCI' || s.tag === 'STS' ? value(s, 2) : value(s);
    if (code) codes.set(`${s.tag}:${code}`, { tag: s.tag, value: code });
  }
  return {
    rows,
    findings,
    codes: [...codes.values()],
    interchanges,
    title: `${name} · EDIFACT`,
    types: [...new Set(rows.map((r) => r.Typ))],
    segmentCount: segments.length,
  };
}

async function resolve(ctx, codes) {
  const resolutions = [];
  // Bound remote work; every unqueried qualifier stays explicitly unresolved.
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    let sources = [];
    if (
      i < 20 &&
      /^[A-Z0-9]{1,12}$/u.test(code.value) &&
      ctx.meta.workbenchEvidenceAccess?.['willi-mako'] !== false
    ) {
      try {
        const result = await ctx.call(
          'willi-mako.resolveStructure',
          { category: 'edifact', query: `${code.tag} Qualifier ${code.value}`, limit: 3 },
          { timeout: 800 }
        );
        sources =
          result?.success === false
            ? []
            : (result?.data?.sources || []).filter(
                (s) =>
                  exactToken(String(s.excerpt || ''), code.value) &&
                  exactToken(String(s.excerpt || ''), code.tag)
              );
      } catch {
        /* Unknown/unavailable remains unresolved, never guessed. */
      }
    }
    resolutions.push({
      ...code,
      status: sources.length ? 'resolved' : 'unresolved',
      sources: sources.map((s) => ({ title: s.title, excerpt: s.excerpt, sectionId: s.sectionId })),
    });
  }
  return resolutions;
}

function overview(record) {
  const data = record.structured;
  const headers = data.interchanges
    .map(
      (i) =>
        `Absender ${i.sender || 'ungeklärt'}, Empfänger ${i.receiver || 'ungeklärt'}, Datum ${i.date || 'ungeklärt'}`
    )
    .join('; ');
  return `${headers || 'Kein Interchange-Kopf vorhanden'}. ${record.rowCount} Nachrichten (${data.types.join(', ') || 'Typ ungeklärt'}), ${data.segmentCount} Segmente; Inhalt im Datenkatalog abgelegt.\n\n${data.findings.length ? data.findings.map((f) => `- ${f.detail} (Nachricht ${f.messageRef || 'Interchange'}, Segment ${f.segment}).`).join('\n') : 'Keine Befunde in den implementierten Syntax-, Mindestsegment- und Summenprüfungen; keine vollständige fachliche Konformitätsprüfung.'}`;
}

function query(pool, record, input) {
  const question = String(input.question || '');
  if (input.plan || input.from || input.to)
    throw new Error(
      'Für dieses Nachrichtenformat bitte eine gezielte Frage ohne Tabellenplan oder Zeitfilter stellen.'
    );
  const rows = pool.rows(record.tenantId, record.id, record.columns).filter((row) => row.Inhalt);
  const invoice =
    /schlüss|schluess|details|einzelheiten|rechnung\s/iu.test(question) &&
    question.match(/(?:rechnung|nachricht)\s+(?:nr\.?\s*|nummer\s*)?([\p{L}\d_./-]+)/iu);
  const threshold = question.match(
    /(?:über|ueber|größer als|groesser als|mehr als)\s*(-?[\d.,]+)\s*(?:€|eur)?/iu
  );
  let selected = rows;
  if (threshold) {
    const raw = threshold[1].replace(/\.(?=\d{3}(?:\D|$))/gu, '').replace(',', '.');
    const amount = Number(raw);
    if (!Number.isFinite(amount)) throw new Error('Betragsgrenze ist ungeklärt.');
    selected = rows.filter(
      (r) => r.Typ === 'INVOIC' && r.Waehrung === 'EUR' && r.Betrag != null && r.Betrag > amount
    );
  } else if (
    invoice &&
    !/^(?:auf|aufgeschlüsselt|aufschlüsseln|aufschluesseln)$/iu.test(invoice[1])
  )
    selected = rows.filter(
      (r) => r.Nummer.toLocaleLowerCase('de-DE') === invoice[1].toLocaleLowerCase('de-DE')
    );
  if (selected.length > 100 && (threshold || invoice))
    throw new Error(
      'Mehr als 100 Nachrichten passen; bitte enger filtern. Keine gekürzte Antwort.'
    );
  const lines = [];
  if (!threshold && !invoice) lines.push(overview(record));
  const shown = threshold || invoice ? selected : rows.slice(0, 10);
  for (const row of shown) {
    const detail = JSON.parse(row.Inhalt);
    lines.push(
      `${row.Typ} ${row.Nummer} (${row.Version}), ${row.Datum || 'Datum ungeklärt'}: ${row.Betrag == null ? 'Gesamtbetrag ungeklärt' : `${formatDatasetNumber(row.Betrag)} ${row.Waehrung || 'Währung ungeklärt'}`}; Zeitraum ${row.Von || 'ungeklärt'} bis ${row.Bis || 'ungeklärt'}; Lokationen ${detail.locations.join(', ') || 'keine'}.`
    );
    if (invoice && !threshold) {
      lines.push(
        ...detail.amounts.map(
          (a) =>
            `MOA ${a.qualifier} (${a.kind === 'unresolved' ? 'Bedeutung ungeklärt' : a.kind}), Segment ${a.segment}: ${a.cents == null ? 'Betrag ungeklärt' : formatDatasetNumber(a.cents / 100)} ${row.Waehrung || 'Währung ungeklärt'}.`
        )
      );
      if (detail.timeseries) {
        for (const location of detail.timeseries.locations)
          for (const series of location.timeseries) {
            const values = series.values;
            const numeric = values.filter((entry) => Number.isFinite(entry.value));
            lines.push(
              `Zeitreihe ${series.cciCode}, Lokation ${location.meloId}: ${values.length} Werte, Zeitraum ${values[0]?.from || 'ungeklärt'} bis ${values.at(-1)?.to || 'ungeklärt'}; Minimum ${numeric.length ? formatDatasetNumber(numeric.reduce((min, entry) => Math.min(min, entry.value), Infinity)) : 'ungeklärt'}, Maximum ${numeric.length ? formatDatasetNumber(numeric.reduce((max, entry) => Math.max(max, entry.value), -Infinity)) : 'ungeklärt'} ${[...new Set(values.map((entry) => entry.unit))].join(', ')}.`
            );
          }
      }
      for (const group of detail.groups.filter((entry) => entry.tag === 'LIN')) {
        const entries = detail.segments.filter((entry) => group.segments.includes(entry.index));
        const quantities = entries
          .filter((entry) => entry.tag === 'QTY')
          .map(
            (entry) =>
              `${value(entry, 0, 1)} ${value(entry, 0, 2)} (Qualifier ${value(entry)}, Bedeutung separat belegen)`
          );
        const descriptions = entries
          .filter((entry) => entry.tag === 'IMD')
          .map((entry) => (entry.elements[2] || []).slice(3).join(' ').slice(0, 240));
        lines.push(
          `Position ${group.reference}, ab Segment ${group.start}${descriptions.length ? ': ' + descriptions.join('; ') : ''}${quantities.length ? '; Menge ' + quantities.join('; ') : ''}.`
        );
      }
      lines.push(
        ...record.structured.findings
          .filter((entry) => entry.messageRef === detail.ref)
          .map((entry) => `${entry.detail} (Segment ${entry.segment}).`)
      );
      if (detail.statuses.length)
        lines.push(
          `Status-/Vorgangscodes (Bedeutung separat nachschlagen): ${JSON.stringify(detail.statuses)}.`
        );
    }
  }
  if ((threshold || invoice) && !selected.length) lines.push('Keine passende Nachricht gefunden.');
  if (!threshold && !invoice) {
    if (rows.length > shown.length)
      lines.push(
        `${rows.length - shown.length} weitere Nachrichten gespeichert; für Einzelheiten bitte gezielt abfragen.`
      );
    const currencies = [...new Set(rows.map((r) => r.Waehrung).filter(Boolean))];
    for (const currency of currencies) {
      const amounts = rows.filter((r) => r.Waehrung === currency && r.Betrag != null);
      const sum = amounts.reduce((s, r) => s + Math.round(r.Betrag * 100), 0);
      lines.push(
        `Summe der ausgewiesenen Gesamtbeträge: ${formatDatasetNumber(sum / 100)} ${currency} (${amounts.length} Nachrichten; Summenabweichungen bleiben ausgewiesen).`
      );
    }
    const unresolved = record.structured.resolutions.filter((c) => c.status !== 'resolved');
    if (unresolved.length)
      lines.push(
        `Bedeutung ungeklärt: ${unresolved.map((c) => `${c.tag} ${c.value}`).join(', ')}.`
      );
  }
  for (const code of record.structured.resolutions.filter((c) => c.status === 'resolved'))
    lines.push(
      ...code.sources.map(
        (s) =>
          `${code.tag} ${code.value}: ${s.excerpt}\nQuelle: Willi-Mako, ${s.title}${s.sectionId ? ` · ${s.sectionId}` : ''}.`
      )
    );
  const provenance = `Nutzerangabe von ${record.provenance.person} am ${record.provenance.at.slice(0, 10)}`;
  return {
    responseText: `${lines.join('\n\n')}\n\nHerkunft: ${record.title}, Version ${record.version}; ${provenance}.`,
    datasetId: record.id,
    version: record.version,
    rowCount: selected.length,
    provenance,
    quality: record.quality,
    detailMarkers:
      invoice && !threshold
        ? selected.flatMap((row) =>
            JSON.parse(row.Inhalt).amounts.flatMap((amount) => [
              `MOA ${amount.qualifier}`,
              amount.cents == null ? 'ungeklärt' : formatDatasetNumber(amount.cents / 100),
            ])
          )
        : [],
    result: (threshold || invoice ? selected : []).map(({ Inhalt: _content, ...row }) => row),
  };
}

function accepts(question) {
  return /nachricht|rechnung|betrag|qualifier|code|aufschlüss|aufschluess|überblick|ueberblick|auffäll|auffaell|summe|zeitreihe|vorgang/iu.test(
    question
  );
}
function answerRequirements(record, result) {
  if (result.result.length)
    return [
      ...(result.detailMarkers || []),
      ...result.result.flatMap((row) => [
        row.Nummer,
        row.Betrag == null ? '' : formatDatasetNumber(row.Betrag),
      ]),
    ];
  return [
    String(record.rowCount),
    ...record.structured.types,
    ...record.structured.findings.map((f) => f.detail),
    ...record.structured.resolutions
      .filter((c) => c.status === 'resolved')
      .flatMap((c) => c.sources.map((s) => s.title)),
    record.structured.resolutions.some((c) => c.status !== 'resolved') ? 'ungeklärt' : '',
  ];
}
module.exports = {
  recognizes,
  parse,
  resolve,
  query,
  overview,
  accepts,
  markers: answerRequirements,
};
