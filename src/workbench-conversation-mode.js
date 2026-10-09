'use strict';

// Physical dimensions, independent of process or equipment catalogs.
const UNIT_DIMENSIONS = Object.freeze({
  W: 'power',
  kW: 'power',
  MW: 'power',
  GW: 'power',
  Wh: 'energy',
  kWh: 'energy',
  MWh: 'energy',
  J: 'energy',
  V: 'voltage',
  kV: 'voltage',
  A: 'current',
  mA: 'current',
  s: 'time',
  min: 'time',
  h: 'time',
  kg: 'mass',
  g: 'mass',
  m: 'length',
  km: 'length',
  l: 'volume',
});
const DIMENSION_LABELS = Object.freeze({
  power: 'Leistung in kW',
  energy: 'Energie in kWh',
  voltage: 'Spannung in V',
  current: 'Stromstärke in A',
  time: 'Zeit in s',
  mass: 'Masse in kg',
  length: 'Länge in m',
  volume: 'Volumen in l',
});

function responseMode(message, previous, inferred) {
  const thread = require('./workbench-thread');
  if (thread.isThreadInput(message)) return 'correspondence';
  if (
    /\b(?:gespräch|telefon|schalter)\b|\b(?:steht|sitzt)\s+(?:gerade\s+)?vor mir\b/iu.test(message)
  )
    return 'conversation';
  if (['conversation', 'correspondence'].includes(inferred)) return inferred;
  return previous?.responseMode || inferred || 'standard';
}

function updatePersonFacts(situation, message, previous) {
  // Verbatim evidence survives failed understanding; never turn it into inferred facts.
  situation.personFacts = [...new Set([...(previous?.personFacts || []), message.slice(0, 1200)])]
    .filter(Boolean)
    .slice(-20);
  situation.responseMode = responseMode(message, previous, situation.responseMode);
  if (situation.responseMode === 'conversation') situation.requestedAction.draftRequested = false;
  const facts = situation.personFacts.join('\n');
  const quantities = [
    ...new Map(
      [...(previous?.quantities || []), ...(situation.quantities || [])].map((quantity) => [
        quantity.key,
        quantity,
      ])
    ).values(),
  ]
    .filter(
      (quantity) =>
        UNIT_DIMENSIONS[quantity.unit] && facts.includes(`${quantity.value} ${quantity.unit}`)
    )
    .map((quantity) => ({ ...quantity, dimension: UNIT_DIMENSIONS[quantity.unit] }));
  situation.quantities = quantities;
  const mismatches = quantities.filter(
    (quantity) => quantity.expectedDimension && quantity.dimension !== quantity.expectedDimension
  );
  const missing = [
    ...new Map(
      [...(previous?.missingInformation || []), ...(situation.missingInformation || [])].map(
        (item) => [item.key, item]
      )
    ).values(),
  ];
  situation.missingInformation = [
    ...mismatches.map((quantity) => ({
      key: `dimension:${quantity.key}`,
      decisive: true,
      blocking: true,
      answered: false,
      question: `Für „${quantity.key}“ liegt ${quantity.value} ${quantity.unit} vor; benötigt wird ${DIMENSION_LABELS[quantity.expectedDimension] || quantity.expectedDimension}. Welcher Wert ist dafür angegeben?`,
    })),
    ...missing
      .filter((item) => !mismatches.some((quantity) => item.key === `dimension:${quantity.key}`))
      .map((item) =>
        quantities.some(
          (quantity) =>
            item.key === `dimension:${quantity.key}` &&
            quantity.dimension === quantity.expectedDimension
        )
          ? { ...item, answered: true }
          : item
      ),
  ].slice(0, 10);
  return situation;
}

function markParagraphs(value, mark) {
  let closing = false;
  return String(value)
    .split(/\n\s*\n/u)
    .map((paragraph) => {
      const hadMarker = /\(bitte gegenprüfen\)/iu.test(paragraph);
      const lines = paragraph.replace(/\s*\(bitte gegenprüfen\)/giu, '').split('\n');
      // A claim can contain a complete letter. Mark its body, never its closing team line.
      const body = [];
      lines.forEach((line, index) => {
        if (
          /^(?:Mit freundlichen Grüßen|Freundliche Grüße|Viele Grüße|Beste Grüße|Ihr\b|Ihre\b|Dein\b|Deine\b)/iu.test(
            line.trim()
          )
        )
          closing = true;
        const salutation = /^(?:Guten Tag|Sehr geehrte|Hallo\b|Liebe[r]?\b|Betreff:)/iu.test(
          line.trim()
        );
        if (salutation) closing = false;
        if (line.trim() && !closing && !salutation) body.push(index);
      });
      if ((mark || hadMarker) && body.length) lines[body.at(-1)] += ' (bitte gegenprüfen)';
      return lines.join('\n');
    })
    .join('\n\n');
}

module.exports = { UNIT_DIMENSIONS, responseMode, updatePersonFacts, markParagraphs };
