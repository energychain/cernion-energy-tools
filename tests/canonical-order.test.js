'use strict';

const { createHash } = require('crypto');
const { compareCanonicalStrings } = require('../src/canonical-order');
const { canonical } = require('../src/forecast-portfolio-runtime');
const { hashValue } = require('../src/tabular-intelligence');
const { buildIdempotencyKey } = require('../src/async-job-runner');
const { buildFilterHash } = require('../src/pagination');

const keys = ['é', 'ä', 'Z', 'a', '😀', '\ue000', '10', '2'];
const value = Object.fromEntries(
  keys.map((key, index) => [key, { z: index, a: ['é', 'Z', '😀'] }])
);

// Captured from the pre-change implementations at 3ff2256. Numeric object keys
// retain JavaScript's enumeration behavior; string serializers retain lexical order.
const objectHash = '20d4c68325bc4200b5423e91fe90038d108462dbfd9ea7e43fef5752028d32aa';
const stringHash = '78899da0ad77d8cf77af7c8815c9ddc877b83e2083c2632c3f1f0c2799efa8b9';

describe('canonical order compatibility', () => {
  test('preserves UTF-16 ordering for non-ASCII keys rather than locale ordering', () => {
    expect([...keys].sort(compareCanonicalStrings)).toEqual([
      '10',
      '2',
      'Z',
      'a',
      'ä',
      'é',
      '😀',
      '\ue000',
    ]);
    expect(compareCanonicalStrings('é', 'é')).toBe(0);
    expect(compareCanonicalStrings(10, 2)).toBe(-1);
    expect(['2026-10-02', '2026-01-01'].sort(compareCanonicalStrings)).toEqual([
      '2026-01-01',
      '2026-10-02',
    ]);
  });

  test('keeps existing forecast identities and tabular fingerprints valid', () => {
    expect(createHash('sha256').update(canonical(value)).digest('hex')).toBe(objectHash);
    expect(hashValue(value)).toBe(`sha256:${objectHash}`);
  });

  test('preserves existing async idempotency and pagination filter identities', () => {
    expect(buildIdempotencyKey({ service: 'test', action: 'hash', params: value })).toBe(
      `hash:test:hash:${stringHash}`
    );
    expect(buildFilterHash(value)).toBe(stringHash);
  });
});
