'use strict';

const CCI_TO_OBIS = {
  Z06: '1-0:1.8.0',
  Z07: '1-0:2.8.0',
  Z10: '1-0:1.29.0',
  Z11: '1-0:2.29.0',
};

const STATUS_TO_QUALITY = {
  '67': 'measured',
  '79': 'estimated',
  '68': 'provisional',
  '220': 'corrected',
};

function splitEscaped(input, delimiter, releaseChar) {
  const parts = [];
  let current = '';
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === releaseChar) {
      escaped = true;
      continue;
    }

    if (char === delimiter) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

function parseUnaAndBody(raw) {
  const separators = {
    element: '+',
    component: ':',
    segment: '\'',
    release: '?',
  };

  let body = raw;

  if (body.startsWith('UNA') && body.length >= 9) {
    separators.component = body[3];
    separators.element = body[4];
    separators.release = body[6];
    separators.segment = body[8];
    body = body.slice(9);
    if (body.startsWith(separators.segment)) {
      body = body.slice(1);
    }
  }

  return { separators, body };
}

function splitSegments(body, segmentDelimiter, releaseChar) {
  const segments = [];
  let current = '';
  let escaped = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === releaseChar) {
      escaped = true;
      continue;
    }

    if (char === segmentDelimiter) {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) segments.push(trailing);

  return segments;
}

function tokenizeSegments(edifactString) {
  if (typeof edifactString !== 'string' || !edifactString.trim()) {
    throw new Error('EDIFACT input is empty');
  }

  const normalized = edifactString.replace(/\r?\n/g, '');
  const { separators, body } = parseUnaAndBody(normalized);
  const rawSegments = splitSegments(body, separators.segment, separators.release);

  return rawSegments.map((segmentText) => {
    const elementsRaw = splitEscaped(segmentText, separators.element, separators.release);
    const tag = (elementsRaw.shift() || '').trim();
    const elements = elementsRaw.map((element) =>
      splitEscaped(element, separators.component, separators.release)
    );
    return { tag, elements };
  });
}

function parseDtmToIso(value, format) {
  if (!value) return null;

  if (format === '102' && value.length === 8) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return `${year}-${month}-${day}`;
  }

  if (format === '303' && value.length >= 12) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(8, 10));
    const minute = Number(value.slice(10, 12));
    const date = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function getCciCode(segment) {
  return segment.elements?.[2]?.[0] || null;
}

function getQtyPayload(segment) {
  const payload = segment.elements?.[0] || [];
  const valueRaw = payload[1];
  const numeric = Number(String(valueRaw || '').replace(',', '.'));
  return {
    value: Number.isFinite(numeric) ? numeric : null,
    unit: payload[2] || null,
  };
}

function pushPendingValue(currentTimeseries, pendingValue) {
  if (!currentTimeseries || !pendingValue) return;

  if (!pendingValue.status) {
    pendingValue.status = null;
    pendingValue.quality = 'unknown';
  }

  currentTimeseries.values.push(pendingValue);
}

function parseMscons(edifactString) {
  const segments = tokenizeSegments(edifactString);
  if (!segments.length) {
    throw new Error('No EDIFACT segments found');
  }

  const unh = segments.find((segment) => segment.tag === 'UNH');
  if (!unh) {
    throw new Error('Invalid MSCONS: UNH segment missing');
  }

  const messageType = (unh.elements?.[1] || []).join(':');
  if (!messageType.includes('MSCONS')) {
    throw new Error('Invalid MSCONS: UNH message type is not MSCONS');
  }

  const result = {
    messageRef: unh.elements?.[0]?.[0] || null,
    documentNumber: null,
    documentDate: null,
    sender: { id: null, qualifier: null },
    receiver: { id: null, qualifier: null },
    locations: [],
    parseWarnings: [],
  };

  let currentLocation = null;
  let currentContext = null;
  let currentCciCode = null;
  let currentTimeseries = null;
  let pendingValue = null;

  for (const segment of segments) {
    if (segment.tag === 'BGM') {
      result.documentNumber = segment.elements?.[1]?.[0] || null;
      continue;
    }

    if (segment.tag === 'DTM') {
      const payload = segment.elements?.[0] || [];
      const qualifier = payload[0];
      const dtmValue = payload[1];
      const dtmFormat = payload[2];
      const iso = parseDtmToIso(dtmValue, dtmFormat);

      if (qualifier === '137') {
        result.documentDate = iso || dtmValue || null;
        continue;
      }

      if (!currentLocation) {
        result.parseWarnings.push(`DTM ${qualifier || 'n/a'} without active LOC`);
        continue;
      }

      if (pendingValue && currentContext === 'timeseries') {
        if (qualifier === '163') pendingValue.from = iso || dtmValue || null;
        if (qualifier === '164') pendingValue.to = iso || dtmValue || null;
      } else {
        if (qualifier === '163') currentLocation.periodFrom = iso || dtmValue || null;
        if (qualifier === '164') currentLocation.periodTo = iso || dtmValue || null;
      }
      continue;
    }

    if (segment.tag === 'NAD') {
      const role = segment.elements?.[0]?.[0] || null;
      const party = segment.elements?.[1] || [];
      const id = party[0] || null;
      const qualifier = party[2] || null;

      if (role === 'MS') {
        result.sender = { id, qualifier };
      } else if (role === 'MR') {
        result.receiver = { id, qualifier };
      }
      continue;
    }

    if (segment.tag === 'LOC') {
      pushPendingValue(currentTimeseries, pendingValue);
      pendingValue = null;

      const locQualifier = segment.elements?.[0]?.[0] || null;
      const locationId = segment.elements?.[1]?.[0] || null;

      if (locQualifier !== '172') {
        result.parseWarnings.push(`Unsupported LOC qualifier: ${locQualifier || 'n/a'}`);
      }

      currentLocation = {
        meloId: locationId,
        periodFrom: null,
        periodTo: null,
        networkUsage: [],
        timeseries: [],
      };
      result.locations.push(currentLocation);

      currentContext = null;
      currentCciCode = null;
      currentTimeseries = null;
      continue;
    }

    if (segment.tag === 'CCI') {
      pushPendingValue(currentTimeseries, pendingValue);
      pendingValue = null;

      if (!currentLocation) {
        result.parseWarnings.push('CCI segment outside of LOC group');
        continue;
      }

      currentCciCode = getCciCode(segment);
      if (!currentCciCode) {
        result.parseWarnings.push('CCI without code');
      }

      if (currentCciCode === 'Z10' || currentCciCode === 'Z11') {
        currentContext = 'networkUsage';
        currentTimeseries = null;
        continue;
      }

      currentContext = 'timeseries';

      let timeseries = currentLocation.timeseries.find(
        (item) => item.cciCode === currentCciCode
      );
      if (!timeseries) {
        const obisEquivalent = CCI_TO_OBIS[currentCciCode] || null;
        if (!obisEquivalent) {
          result.parseWarnings.push(`Unknown CCI code: ${currentCciCode || 'n/a'}`);
        }
        timeseries = {
          cciCode: currentCciCode,
          obisEquivalent,
          values: [],
        };
        currentLocation.timeseries.push(timeseries);
      }

      currentTimeseries = timeseries;
      continue;
    }

    if (segment.tag === 'QTY') {
      if (!currentLocation) {
        result.parseWarnings.push('QTY segment outside of LOC group');
        continue;
      }

      const qty = getQtyPayload(segment);
      if (qty.value === null) {
        result.parseWarnings.push('QTY contains non-numeric value');
        continue;
      }

      if (currentContext === 'networkUsage') {
        currentLocation.networkUsage.push({
          type: currentCciCode,
          value: qty.value,
          unit: qty.unit,
        });
        continue;
      }

      if (currentContext === 'timeseries' && currentTimeseries) {
        pushPendingValue(currentTimeseries, pendingValue);
        pendingValue = {
          from: null,
          to: null,
          value: qty.value,
          unit: qty.unit,
          status: null,
          quality: 'unknown',
        };
        continue;
      }

      result.parseWarnings.push('QTY without active CCI context');
      continue;
    }

    if (segment.tag === 'STS') {
      if (!pendingValue) {
        result.parseWarnings.push('STS without pending QTY value');
        continue;
      }

      const status = segment.elements?.[2]?.[0] || null;
      pendingValue.status = status;
      pendingValue.quality = STATUS_TO_QUALITY[status] || 'unknown';
      pushPendingValue(currentTimeseries, pendingValue);
      pendingValue = null;
    }
  }

  pushPendingValue(currentTimeseries, pendingValue);

  if (!result.locations.length) {
    result.parseWarnings.push('No LOC+172 location found');
  }

  return result;
}

module.exports = {
  tokenizeSegments,
  parseMscons,
  CCI_TO_OBIS,
  STATUS_TO_QUALITY,
};
