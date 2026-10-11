'use strict';

function internalToolText(text, evidence = []) {
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
        (stat) => !/status|code|id|nummer|year|jahr/iu.test(stat.field)
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
    .filter(Boolean)
    .join('\n\n');
}

module.exports = { internalToolText, availableToolAnswer };
