'use strict';

const OBIS_CODES = {
  '1-0:1.8.0': {
    label: 'Wirkarbeit Bezug (Summe)',
    unit: 'kWh',
    direction: 'consumption',
    medium: 'electricity',
  },
  '1-0:1.8.1': {
    label: 'Wirkarbeit Bezug HT',
    unit: 'kWh',
    direction: 'consumption',
    medium: 'electricity',
  },
  '1-0:1.8.2': {
    label: 'Wirkarbeit Bezug NT',
    unit: 'kWh',
    direction: 'consumption',
    medium: 'electricity',
  },
  '1-0:2.8.0': {
    label: 'Wirkarbeit Einspeisung (Summe)',
    unit: 'kWh',
    direction: 'feedin',
    medium: 'electricity',
  },
  '1-0:1.29.0': {
    label: 'Wirkleistung Bezug',
    unit: 'kW',
    direction: 'consumption',
    medium: 'electricity',
  },
  '1-0:2.29.0': {
    label: 'Wirkleistung Einspeisung',
    unit: 'kW',
    direction: 'feedin',
    medium: 'electricity',
  },
  '1-0:16.7.0': {
    label: 'Momentanleistung (Saldo)',
    unit: 'kW',
    direction: 'net',
    medium: 'electricity',
  },
  '1-0:15.8.0': {
    label: 'Wirkarbeit Total (Betrag)',
    unit: 'kWh',
    direction: 'total',
    medium: 'electricity',
  },
  '7-0:3.0.0': {
    label: 'Gasvolumen',
    unit: 'm³',
    direction: 'consumption',
    medium: 'gas',
  },
  '6-0:1.0.0': {
    label: 'Wärmeenergie',
    unit: 'kWh',
    direction: 'consumption',
    medium: 'heat',
  },
};

function getObisLabel(code) {
  return OBIS_CODES[code]?.label || code;
}

function getObisUnit(code) {
  return OBIS_CODES[code]?.unit || null;
}

function getObisDirection(code) {
  return OBIS_CODES[code]?.direction || null;
}

function isValidObis(code) {
  return /^\d+-\d+:\d+\.\d+\.\d+$/.test(String(code || ''));
}

function listObisCodes(medium) {
  return Object.entries(OBIS_CODES)
    .filter(([, value]) => !medium || value.medium === medium)
    .map(([code, value]) => ({ code, ...value }));
}

module.exports = {
  OBIS_CODES,
  getObisLabel,
  getObisUnit,
  getObisDirection,
  isValidObis,
  listObisCodes,
};
