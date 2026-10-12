'use strict';

// Structural field names; independent of user text and domain identifiers.
function identifierField(field) {
  if (require('./tabular-intelligence').profileRows([{ [field]: null }]).columns[0]?.sensitive)
    return true;
  const tokens = require('./function-resolver').normalizePhrase(field).split(' ');
  return tokens.some(
    (token) =>
      token.endsWith('nummer') ||
      token.endsWith('kennung') ||
      [
        'id',
        'identity',
        'identifier',
        'identifiers',
        'reference',
        'references',
        'referenz',
        'referenzen',
        'ref',
        'code',
        'nummer',
        'nummern',
        'number',
        'kennung',
        'kennungen',
        'key',
      ].includes(token)
  );
}

function sourceLabel(label) {
  // Unknown catalog summaries are internal metadata, not display translations.
  return typeof label === 'string' &&
    (Object.values(require('./tool-display').catalog).some((entry) => entry.source === label) ||
      (/[äöüÄÖÜß]|\b(?:Daten|Register|Quelle|Abfrage|Kommunikation)\b/u.test(label) &&
        !/[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+/u.test(label)))
    ? label
    : 'Abgefragte Datenquelle';
}

function internalToolText(text, evidence = []) {
  if (/\b(?:fn|ds|case|agent|proc|operation|capability)[_:-][A-Za-z\d_.:-]+\b/u.test(text))
    return true;
  if (/\b[a-z][a-z-]{2,}\.[a-z][A-Za-z\d]+\b/u.test(text)) return true;
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu.test(text)) return true;
  if (/\b[\p{L}][\p{L}\d]*_[\p{L}\d_]+\b/u.test(text)) return true;
  if (/(?:Feldbezeichnung|Auswertungsfeld|korrekte[nr]? Feld|Parametername)/iu.test(text))
    return true;
  if (/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/u.test(text)) return true;
  if (
    /```|\{\s*"|\btruncated\b|Werkzeug außerhalb|Aufrufbudget|Datenabfrage:\s*(?:skipped|blocked|missing|unavailable)|Werkzeug-Zeitbudget/iu.test(
      text
    )
  )
    return true;
  return evidence
    .filter((hit) => hit.retrievalSource === 'capability-read')
    .some((hit) =>
      Object.keys(hit.metadata?.parameters || {}).some(
        (key) => text.includes(key) && /[A-Z_]/u.test(key)
      )
    );
}

function availableToolAnswer(evidence, message = '') {
  const hits = evidence.filter((hit) => hit.retrievalSource === 'capability-read');
  return hits
    .map((hit) => {
      if (hit.source === 'dataset.query') return hit.value.split('\n\nHerkunft:')[0];
      let data;
      try {
        data = JSON.parse(hit.value);
      } catch {
        return '';
      }
      const rows = Array.isArray(data) ? data : data.data;
      const count = hit.metadata?.rowCount ?? data.count ?? rows?.length;
      if (!Number.isSafeInteger(count)) return '';
      const stats = /\b(?:davon|darunter|deren|of those|among them)\b/iu.test(message)
        ? hit.metadata?.sourceStatistics || hit.metadata?.statistics || data.statistics || []
        : hit.metadata?.statistics || data.statistics || [];
      const candidates = stats.filter(
        (stat) => !identifierField(stat.field) && !/status|year|jahr/iu.test(stat.field)
      );
      const statistic =
        candidates.find((stat) => /(?:kW|kWh|MW|MWh|EUR|Hz)$/iu.test(stat.field)) || candidates[0];
      const minimum = /kleinste|niedrigste|minimum|smallest/iu.test(message);
      if (!statistic)
        return `Die vorhandene Abfrage enthält ${count.toLocaleString('de-DE')} Datensätze${count === 0 ? '; es gab keine Treffer' : ''}.`;
      const row = minimum ? statistic.minRow : statistic.maxRow;
      const name = Object.entries(row).find(
        ([key, value]) => typeof value === 'string' && /name|label|title|bezeichnung/iu.test(key)
      )?.[1];
      const suffix = statistic.field.match(/(kWh|MWh|kW|MW|EUR|Hz)$/iu)?.[1]?.toLowerCase();
      const unit = { kwh: 'kWh', mwh: 'MWh', kw: 'kW', mw: 'MW', eur: 'EUR', hz: 'Hz' }[suffix];
      const value = (minimum ? statistic.min : statistic.max).toLocaleString('de-DE');
      return `Die vorhandene Abfrage enthält ${count.toLocaleString('de-DE')} Datensätze. Der ${minimum ? 'kleinste' : 'größte'} erfasste Wert${name ? ` bei ${name}` : ''} beträgt ${value}${unit ? ` ${unit}` : ''}.`;
    })
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join('\n\n');
}

module.exports = { internalToolText, availableToolAnswer, identifierField, sourceLabel };
