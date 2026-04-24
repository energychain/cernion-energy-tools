'use strict';

const { tokenizeSegments, parseMscons } = require('../src/edm-mscons-parser');

const SAMPLE_MSCONS = [
  "UNH+1+MSCONS:D:04B:UN:2.3e'",
  "BGM+7+DOC20260401001+9'",
  "DTM+137:20260401:102'",
  "NAD+MS+9900992720003::293'",
  "NAD+MR+9907015000008::293'",
  "LOC+172+DE0003966698900000000000052335107'",
  "DTM+163:202604010000:303'",
  "DTM+164:202604012359:303'",
  "CCI+11++Z06'",
  "QTY+220:12.4:KWH'",
  "DTM+163:202604010000:303'",
  "DTM+164:202604010015:303'",
  "STS+7++67'",
  "QTY+220:11.8:KWH'",
  "DTM+163:202604010015:303'",
  "DTM+164:202604010030:303'",
  "STS+7++67'",
  "QTY+220:0:KWH'",
  "DTM+163:202604010030:303'",
  "DTM+164:202604010045:303'",
  "STS+7++79'",
  "QTY+220:13.1:KWH'",
  "DTM+163:202604010045:303'",
  "DTM+164:202604010100:303'",
  "STS+7++67'",
  "UNT+25+1'",
].join('');

describe('edm-mscons-parser', () => {
  test('tokenizeSegments parst Segmente korrekt', () => {
    const segments = tokenizeSegments(SAMPLE_MSCONS);
    expect(segments.length).toBeGreaterThan(10);
    expect(segments[0].tag).toBe('UNH');
    expect(segments[segments.length - 1].tag).toBe('UNT');
  });

  test('parseMscons extrahiert Message-Header', () => {
    const result = parseMscons(SAMPLE_MSCONS);
    expect(result.messageRef).toBe('1');
    expect(result.documentNumber).toContain('DOC20260401001');
  });

  test('parseMscons extrahiert Sender/Receiver', () => {
    const result = parseMscons(SAMPLE_MSCONS);
    expect(result.sender.id).toBe('9900992720003');
    expect(result.receiver.id).toBe('9907015000008');
  });

  test('parseMscons extrahiert MeLo-ID aus LOC+172', () => {
    const result = parseMscons(SAMPLE_MSCONS);
    expect(result.locations.length).toBe(1);
    expect(result.locations[0].meloId).toBe('DE0003966698900000000000052335107');
  });

  test('parseMscons extrahiert 4 Zeitreihenwerte', () => {
    const result = parseMscons(SAMPLE_MSCONS);
    const ts = result.locations[0].timeseries[0];
    expect(ts.values.length).toBe(4);
    expect(ts.values[0].value).toBe(12.4);
    expect(ts.values[1].value).toBe(11.8);
    expect(ts.values[2].value).toBe(0);
    expect(ts.values[3].value).toBe(13.1);
  });

  test('parseMscons mappt CCI Z06 → OBIS 1-0:1.8.0', () => {
    const result = parseMscons(SAMPLE_MSCONS);
    expect(result.locations[0].timeseries[0].obisEquivalent).toBe('1-0:1.8.0');
  });

  test('parseMscons mappt STS 67 → measured, 79 → estimated', () => {
    const result = parseMscons(SAMPLE_MSCONS);
    const values = result.locations[0].timeseries[0].values;
    expect(values[0].quality).toBe('measured');
    expect(values[2].quality).toBe('estimated');
  });

  test('parseMscons konvertiert DTM 303 → ISO Timestamps', () => {
    const result = parseMscons(SAMPLE_MSCONS);
    const values = result.locations[0].timeseries[0].values;
    expect(values[0].from).toContain('2026-04-01T00:00');
    expect(values[0].to).toContain('2026-04-01T00:15');
  });

  test('parseMscons wirft bei ungültigem EDIFACT', () => {
    expect(() => parseMscons('THIS IS NOT EDIFACT')).toThrow();
  });

  test('parseMscons leerer String wirft', () => {
    expect(() => parseMscons('')).toThrow();
  });
});
