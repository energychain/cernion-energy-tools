'use strict';

/**
 * Deterministic format detectors of the domain packs. Format checks only (lengths, character
 * classes, fixed prefixes defined by the code systems); meaning is never inferred from words.
 * Each detector returns [{ value, quote }] with the literal text it found.
 */

const { plainTokens: tokens } = require('../provenance');

const isDigit = (ch) => ch >= '0' && ch <= '9';
const isUpper = (ch) => ch >= 'A' && ch <= 'Z';
const allDigits = (value) => value.length > 0 && [...value].every(isDigit);
const unique = (rows) =>
  rows.filter((row, index) => rows.findIndex((other) => other.value === row.value) === index);

// EDIFACT interchange: message types from the UNH segments (UNH+<ref>+<TYPE>:<version>…).
function edifactMessages(text) {
  const value = String(text ?? '');
  const rows = [];
  let index = value.indexOf('UNH+');
  while (index >= 0) {
    const segment = value.slice(
      index,
      value.indexOf("'", index) > 0 ? value.indexOf("'", index) : index + 80
    );
    const parts = segment.split('+');
    const type = String(parts[2] || '').split(':')[0];
    if (type.length >= 5 && type.length <= 6 && [...type].every(isUpper))
      rows.push({ value: type, quote: segment.slice(0, 120) });
    index = value.indexOf('UNH+', index + 4);
  }
  return unique(rows);
}

// EIC codes: 16 characters, two digits, an object-type letter, then letters, digits or dashes.
function eicCodes(text) {
  return unique(
    tokens(text)
      .filter(
        (token) =>
          token.length === 16 &&
          isDigit(token[0]) &&
          isDigit(token[1]) &&
          'XYZTVWA'.includes(token[2]) &&
          [...token].every((ch) => isDigit(ch) || isUpper(ch) || ch === '-')
      )
      .map((token) => ({ value: token, quote: token }))
  );
}

// Market partner numbers of the BDEW and DVGW code systems: 13 digits with prefix 99 or 98.
function marketPartnerCodes(text) {
  return unique(
    tokens(text)
      .filter(
        (token) =>
          token.length === 13 && allDigits(token) && ['99', '98'].includes(token.slice(0, 2))
      )
      .map((token) => ({ value: token, quote: token }))
  );
}

// Market master data register numbers: a three-letter unit prefix and twelve digits.
function registerUnitNumbers(text) {
  return unique(
    tokens(text)
      .filter(
        (token) =>
          token.length === 15 &&
          ['SEE', 'SME', 'SGE', 'SSE', 'ABR', 'SNE'].includes(token.slice(0, 3)) &&
          allDigits(token.slice(3))
      )
      .map((token) => ({ value: token, quote: token }))
  );
}

// Section references: "§" with a section number, optional subdivisions of the citation format
// (Abs., Satz, Nr. … each followed by a number) and the abbreviation of the act, which is
// written with at least two capitals (EnWG, StromNEV, MsbG). The quote is the literal passage.
const SUBDIVISIONS = new Set(['Abs', 'Absatz', 'S', 'Satz', 'Nr', 'Ziff', 'lit', 'Buchst']);
const capitals = (value) => [...value].filter(isUpper).length;
function sectionReferences(text) {
  const raw = String(text ?? '');
  const parts = tokens(raw);
  const rows = [];
  for (let index = 0; index < parts.length; index++) {
    if (parts[index] !== '§' && parts[index] !== '§§') continue;
    const number = parts[index + 1] || '';
    if (!number || !isDigit(number[0])) continue;
    let next = index + 2;
    while (SUBDIVISIONS.has(parts[next]) && parts[next + 1] && isDigit(parts[next + 1][0]))
      next += 2;
    const act = parts[next] || '';
    const start = raw.indexOf(`${parts[index]} ${number}`);
    if (start < 0) continue;
    let quote = `${parts[index]} ${number}`;
    if (act && isUpper(act[0]) && capitals(act) >= 2) {
      const end = raw.indexOf(act, start);
      if (end > start && end - start < 60) quote = raw.slice(start, end + act.length);
    }
    rows.push({ value: quote, quote });
  }
  return unique(rows);
}

// Ruling numbers of the federal regulator's chambers: BK<digit>-<yy>-<number>.
function rulingNumbers(text) {
  return unique(
    tokens(text)
      .filter((token) => {
        const parts = token.split('-');
        return (
          token.startsWith('BK') &&
          parts.length === 3 &&
          parts[0].length === 3 &&
          isDigit(parts[0][2]) &&
          allDigits(parts[1]) &&
          parts[2].length > 0 &&
          [...parts[2]].every((ch) => isDigit(ch) || isUpper(ch))
        );
      })
      .map((token) => ({ value: token, quote: token }))
  );
}

module.exports = {
  tokens,
  edifactMessages,
  eicCodes,
  marketPartnerCodes,
  registerUnitNumbers,
  sectionReferences,
  rulingNumbers,
};

// Check digit of an 11-digit market location id: digits at odd positions plus twice the digits
// at even positions of the first ten, the check digit completes the sum to a multiple of ten.
function maloCheckDigit(value) {
  const digits = String(value ?? '');
  if (digits.length !== 11 || !allDigits(digits)) return null;
  let sum = 0;
  for (let index = 0; index < 10; index++) sum += Number(digits[index]) * (index % 2 ? 2 : 1);
  return (10 - (sum % 10)) % 10;
}

// Location ids of the market communication: an 11-digit market location id with a valid check
// digit, or a 33-character metering location / metering point id (two country letters, then
// digits and capital letters).
function makoLocationIds(text) {
  return unique(
    tokens(text)
      .filter(
        (token) =>
          (token.length === 11 && maloCheckDigit(token) === Number(token[10])) ||
          (token.length === 33 &&
            isUpper(token[0]) &&
            isUpper(token[1]) &&
            [...token.slice(2)].every((ch) => isDigit(ch) || isUpper(ch)) &&
            [...token.slice(2)].some(isDigit))
      )
      .map((token) => ({ value: token, quote: token }))
  );
}

module.exports.maloCheckDigit = maloCheckDigit;
module.exports.makoLocationIds = makoLocationIds;

// Settlement keys of the settlement service: <type>_<yyyy>q<1-4>_<unit>, type eeg or redispatch.
function isSettlementKey(token) {
  const parts = String(token).split('_');
  if (parts.length !== 3) return false;
  const [type, quarter, unit] = parts;
  return (
    ['eeg', 'redispatch'].includes(type) &&
    quarter.length === 6 &&
    allDigits(quarter.slice(0, 4)) &&
    quarter[4] === 'q' &&
    '1234'.includes(quarter[5]) &&
    unit.length > 0 &&
    [...unit].every((ch) => isDigit(ch) || isUpper(ch) || (ch >= 'a' && ch <= 'z'))
  );
}

function settlementKeys(text) {
  return unique(
    tokens(text)
      .filter(isSettlementKey)
      .map((token) => ({ value: token, quote: token }))
  );
}

// Fee records: rule sets of the tariff rule registry (rel:<uuid>) and variable grid-fee
// calculations (re4de-vgf:<uuid>).
function isUuid(value) {
  const text = String(value);
  return (
    text.length === 36 &&
    [...text].every((ch, index) =>
      [8, 13, 18, 23].includes(index)
        ? ch === '-'
        : isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
    )
  );
}

const FEE_RECORD_PREFIXES = ['rel:', 're4de-vgf:'];

function feeRecordIds(text) {
  return unique(
    tokens(text)
      .filter((token) =>
        FEE_RECORD_PREFIXES.some(
          (prefix) => token.startsWith(prefix) && isUuid(token.slice(prefix.length))
        )
      )
      .map((token) => ({ value: token, quote: token }))
  );
}

module.exports.settlementKeys = settlementKeys;
module.exports.feeRecordIds = feeRecordIds;
