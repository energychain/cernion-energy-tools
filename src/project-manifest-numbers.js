'use strict';

const { parseNumber } = require('./tabular-intelligence');

function answerNumbers(text) {
  const tokens = String(text)
    .normalize('NFKC')
    .replace(/−/gu, '-')
    .matchAll(
      /(?<![\p{L}\p{N}_])[-+]?(?:\d{1,3}(?:[\s'’.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:[eE][-+]?\d+)?(?!\d)/gu
    );
  return [...tokens].map(([token]) => {
    let raw = token.replace(/[\s'’]/gu, '');
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? ',' : '.';
      raw = raw.replace(decimal === ',' ? /\./gu : /,/gu, '');
    } else if (/^[-+]?\d{1,3}(?:\.\d{3})+$/u.test(raw)) raw = raw.replace(/\./gu, '');
    else if (/^[-+]?\d{1,3}(?:,\d{3}){2,}$/u.test(raw)) raw = raw.replace(/,/gu, '');
    if (parseNumber(raw) == null) return null;
    const [mantissa, exponent = '0'] = raw.replace(',', '.').split(/[eE]/u);
    const fraction = mantissa.split('.')[1] || '';
    const digits = mantissa.replace(/[-+.]/gu, '').replace(/^0+/u, '');
    if (!digits) return '0';
    const significant = digits.replace(/0+$/u, '');
    const power = Number(exponent) - fraction.length + digits.length - significant.length;
    return `${mantissa.startsWith('-') ? '-' : ''}${significant}e${power}`;
  });
}

module.exports = { answerNumbers };
