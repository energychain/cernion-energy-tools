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

function responseMode(_message, previous, inferred) {
  if (['conversation', 'correspondence'].includes(inferred)) return inferred;
  return previous?.responseMode || inferred || 'standard';
}

function updatePersonFacts(situation, message, previous) {
  // Verbatim evidence survives failed understanding; never turn it into inferred facts.
  situation.personFacts = [...new Set([...(previous?.personFacts || []), message.slice(0, 1200)])]
    .filter(Boolean)
    .slice(-20);
  situation.responseMode = situation.conversationShape
    ? situation.conversationShape === 'assistance'
      ? 'conversation'
      : situation.outputKind === 'correspondence'
        ? 'correspondence'
        : 'standard'
    : responseMode(message, previous, situation.responseMode);
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
  const blocks = String(value).split(
    /(?=^(?:\*\*)?(?:Einordnung|Schritte|Nächste Schritte|Entwurf)\b[^\n]*:)/gmu
  );
  return blocks
    .map((block) => {
      const hadMarker = /\(bitte gegenprüfen\)/iu.test(block);
      const lines = block.replace(/[ \t]*\(bitte gegenprüfen\)/giu, '').split('\n');
      let closing = false;
      let lastBody = -1;
      lines.forEach((line, index) => {
        const text = line.trim();
        if (
          /^(?:Mit freundlichen Grüßen|Freundliche Grüße|Viele Grüße|Beste Grüße|Ihr\b|Ihre\b|Dein\b|Deine\b)/iu.test(
            text
          )
        )
          closing = true;
        const salutation = /^(?:Guten Tag|Sehr geehrte|Hallo\b|Liebe[r]?\b|Betreff:)/iu.test(text);
        if (salutation) closing = false;
        if (
          text &&
          !closing &&
          !salutation &&
          !/\?$/u.test(text) &&
          !/^(?:Quellen:|(?:\*\*)?(?:Einordnung|Schritte|Entwurf).*:)/iu.test(text)
        )
          lastBody = index;
      });
      if ((mark || hadMarker) && lastBody >= 0) lines[lastBody] += ' (bitte gegenprüfen)';
      return lines.join('\n');
    })
    .join('');
}

module.exports = { UNIT_DIMENSIONS, responseMode, updatePersonFacts, markParagraphs };
