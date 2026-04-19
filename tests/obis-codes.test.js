'use strict';

const {
  OBIS_CODES,
  getObisLabel,
  getObisUnit,
  getObisDirection,
  isValidObis,
  listObisCodes,
} = require('../src/obis-codes');

describe('obis-codes', () => {
  it('OBIS_CODES hat mindestens 10 Einträge', () => {
    expect(Object.keys(OBIS_CODES).length).toBeGreaterThanOrEqual(10);
  });

  it("getObisLabel('1-0:1.8.0')", () => {
    expect(getObisLabel('1-0:1.8.0')).toBe('Wirkarbeit Bezug (Summe)');
  });

  it("getObisUnit('1-0:1.8.0')", () => {
    expect(getObisUnit('1-0:1.8.0')).toBe('kWh');
  });

  it("getObisDirection('1-0:2.8.0')", () => {
    expect(getObisDirection('1-0:2.8.0')).toBe('feedin');
  });

  it("isValidObis('1-0:1.8.0')", () => {
    expect(isValidObis('1-0:1.8.0')).toBe(true);
  });

  it("isValidObis('invalid')", () => {
    expect(isValidObis('invalid')).toBe(false);
  });

  it("listObisCodes('electricity') → nur Strom-Codes", () => {
    const list = listObisCodes('electricity');
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((entry) => entry.medium === 'electricity')).toBe(true);
  });

  it('listObisCodes() → alle Codes', () => {
    expect(listObisCodes().length).toBe(Object.keys(OBIS_CODES).length);
  });
});
