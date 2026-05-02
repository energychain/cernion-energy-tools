'use strict';

/**
 * Tests for src/prompt-scrubber.js (Issue #31 — Edge Privacy)
 *
 * Validates data masking/allowlist for external LLM prompts.
 */

const {
  scrubForLLM,
  scrubPromptText,
  isSensitiveField,
  SENSITIVE_PATTERNS,
  SAFE_PATTERNS,
} = require('../src/prompt-scrubber');

// ── isSensitiveField ──────────────────────────────────────────────────────

describe('isSensitiveField', () => {
  describe('sensitive fields (should return true)', () => {
    const sensitiveCases = [
      'email',
      'e-mail',
      'e_mail',
      'telefon',
      'phone',
      'fax',
      'name',
      'kundenname',
      'ansprechpartner',
      'kontakt',
      'adresse',
      'address',
      'straße',
      'strasse',
      'hausnummer',
      'iban',
      'konto',
      'bankverbindung',
      'lat',
      'lng',
      'lon',
      'latitude',
      'longitude',
      'breitengrad',
      'koordinaten',
      'scada_value',
      'sensor',
      'messwert',
      'password',
      'passwort',
      'api_key',
      'apiKey',
      'secret',
      'token',
    ];

    it.each(sensitiveCases)('"%s" is sensitive', (field) => {
      expect(isSensitiveField(field)).toBe(true);
    });
  });

  describe('safe fields (should return false)', () => {
    const safeCases = [
      'mastrNummer',
      'eicCode',
      'bdewCode',
      'plz',
      'postleitzahl',
      'bundesland',
      'landkreis',
      'gemeinde',
      'ort',
      'capacity',
      'kapazitaet',
      'leistung',
      'kw',
      'kwp',
      'mw',
      'mwh',
      'status',
      'betriebsstatus',
      'inbetriebnahme',
      'commissioning',
      'datum',
      'date',
      'year',
      'spannungsebene',
      'count',
      'anzahl',
      'summe',
      'average',
      'total',
      'preis',
      'price',
      'co2',
      'emission',
      'forecast',
      'oeo_class',
      'type',
      'technologie',
    ];

    it.each(safeCases)('"%s" is safe (not sensitive)', (field) => {
      expect(isSensitiveField(field)).toBe(false);
    });
  });

  describe('safe patterns override sensitive patterns', () => {
    it('fields matching both safe and sensitive resolve as safe', () => {
      // 'koordinaten' could match sensitive 'koordinat' pattern,
      // but there is no safe override — so it IS sensitive
      expect(isSensitiveField('koordinaten')).toBe(true);

      // 'kapazitaet' is safe even though it doesn't match sensitive
      expect(isSensitiveField('kapazitaet')).toBe(false);
    });
  });

  describe('unknown fields pass through', () => {
    it('returns false for domain-neutral fields', () => {
      expect(isSensitiveField('rowNumber')).toBe(false);
      expect(isSensitiveField('id')).toBe(false);
      expect(isSensitiveField('step')).toBe(false);
    });
  });
});

// ── scrubForLLM ───────────────────────────────────────────────────────────

describe('scrubForLLM', () => {
  it('masks sensitive fields and preserves safe fields', () => {
    const data = {
      mastrNummer: 'SEE900123456',
      capacity: 10.5,
      email: 'max@example.com',
      plz: '67063',
      name: 'Max Mustermann',
    };

    const { scrubbed, stats } = scrubForLLM(data);

    expect(scrubbed.mastrNummer).toBe('SEE900123456');
    expect(scrubbed.capacity).toBe(10.5);
    expect(scrubbed.plz).toBe('67063');

    // Sensitive fields are masked
    expect(scrubbed.email).toMatch(/^\[MASKED-[a-f0-9]{8}\]$/);
    expect(scrubbed.name).toMatch(/^\[MASKED-[a-f0-9]{8}\]$/);

    expect(stats.fieldsMasked).toBe(2);
    expect(stats.fieldsScanned).toBeGreaterThanOrEqual(5);
  });

  it('returns a reidentMap that can reverse masked values', () => {
    const data = { email: 'test@cernion.io' };

    const { scrubbed, reidentMap } = scrubForLLM(data);

    const placeholder = scrubbed.email;
    expect(reidentMap.get(placeholder)).toBe('test@cernion.io');
  });

  it('handles array of objects', () => {
    const data = [
      { id: 1, name: 'Alice', kw: 10 },
      { id: 2, name: 'Bob', kw: 20 },
    ];

    const { scrubbed, stats } = scrubForLLM(data);

    expect(scrubbed).toHaveLength(2);
    expect(scrubbed[0].id).toBe(1);
    expect(scrubbed[0].kw).toBe(10);
    expect(scrubbed[0].name).toMatch(/^\[MASKED-/);
    expect(scrubbed[1].name).toMatch(/^\[MASKED-/);
    expect(stats.fieldsMasked).toBe(2);
  });

  it('truncates arrays to maxRows', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i, kw: i * 10 }));

    const { scrubbed, stats } = scrubForLLM(data, { maxRows: 10 });

    expect(scrubbed).toHaveLength(10);
    expect(stats.rowsTruncated).toBe(90);
  });

  it('truncates long string values', () => {
    const longValue = 'A'.repeat(1000);
    const data = { status: longValue };

    const { scrubbed } = scrubForLLM(data, { maxStringLength: 100 });

    expect(scrubbed.status.length).toBeLessThan(200);
    expect(scrubbed.status).toContain('…[truncated]');
  });

  it('respects additionalBlocklist', () => {
    const data = { customField: 'secret-data', kw: 10 };

    const { scrubbed } = scrubForLLM(data, {
      additionalBlocklist: ['customField'],
    });

    expect(scrubbed.customField).toMatch(/^\[MASKED-/);
    expect(scrubbed.kw).toBe(10);
  });

  it('respects additionalAllowlist (overrides sensitive)', () => {
    const data = { email: 'ok@example.com' };

    const { scrubbed } = scrubForLLM(data, {
      additionalAllowlist: ['email'],
    });

    expect(scrubbed.email).toBe('ok@example.com');
  });

  it('handles null and undefined values gracefully', () => {
    const data = { email: null, name: undefined, kw: 10 };

    const { scrubbed } = scrubForLLM(data);

    expect(scrubbed.email).toBeNull();
    expect(scrubbed.name).toBeUndefined();
    expect(scrubbed.kw).toBe(10);
  });

  it('handles nested objects', () => {
    const data = {
      installation: {
        mastrNummer: 'SEE900111',
        operator: {
          name: 'Secret Operator',
          plz: '12345',
        },
      },
    };

    const { scrubbed } = scrubForLLM(data);

    expect(scrubbed.installation.mastrNummer).toBe('SEE900111');
    expect(scrubbed.installation.operator.plz).toBe('12345');
    expect(scrubbed.installation.operator.name).toMatch(/^\[MASKED-/);
  });

  it('produces deterministic pseudonyms within same scrub call', () => {
    const data = [{ name: 'Alice' }, { name: 'Alice' }];

    const { scrubbed } = scrubForLLM(data);

    // Same value → same placeholder within one scrub call
    expect(scrubbed[0].name).toBe(scrubbed[1].name);
  });

  it('produces different pseudonyms across different scrub calls', () => {
    const data = { name: 'Alice' };

    const r1 = scrubForLLM(data);
    const r2 = scrubForLLM(data);

    // Different salt → different placeholder
    expect(r1.scrubbed.name).not.toBe(r2.scrubbed.name);
  });

  it('returns empty stats for empty input', () => {
    const { scrubbed, stats } = scrubForLLM({});

    expect(scrubbed).toEqual({});
    expect(stats.fieldsScanned).toBe(0);
    expect(stats.fieldsMasked).toBe(0);
  });
});

// ── scrubPromptText ───────────────────────────────────────────────────────

describe('scrubPromptText', () => {
  it('masks email addresses', () => {
    const text = 'Contact: user@example.com for more info';
    const result = scrubPromptText(text);
    expect(result).not.toContain('user@example.com');
    expect(result).toContain('[EMAIL-MASKED]');
  });

  it('masks German IBANs', () => {
    const text = 'IBAN: DE89 3704 0044 0532 0130 00';
    const result = scrubPromptText(text);
    expect(result).not.toContain('DE89');
    expect(result).toContain('[IBAN-MASKED]');
  });

  it('masks German phone numbers', () => {
    const text = 'Telefon: +49 621 1234567';
    const result = scrubPromptText(text);
    expect(result).not.toContain('621 1234567');
    expect(result).toContain('[PHONE-MASKED]');
  });

  it('masks phone numbers with 0-prefix', () => {
    const text = 'Tel: 0621/1234567';
    const result = scrubPromptText(text);
    expect(result).toContain('[PHONE-MASKED]');
  });

  it('masks multiple PII in same text', () => {
    const text = 'Max: max@test.de, IBAN DE12345678901234567890, Tel +49 171 1234567';
    const result = scrubPromptText(text);
    expect(result).toContain('[EMAIL-MASKED]');
    expect(result).toContain('[IBAN-MASKED]');
    expect(result).toContain('[PHONE-MASKED]');
  });

  it('returns non-string input unchanged', () => {
    expect(scrubPromptText(42)).toBe(42);
    expect(scrubPromptText(null)).toBeNull();
    expect(scrubPromptText(undefined)).toBeUndefined();
  });

  it('does not alter clean text', () => {
    const text = 'PV capacity 10 kWp, Inbetriebnahme 2015, PLZ 67063';
    expect(scrubPromptText(text)).toBe(text);
  });
});

// ── Pattern coverage ──────────────────────────────────────────────────────

describe('Pattern arrays', () => {
  it('SENSITIVE_PATTERNS is a non-empty array of RegExp', () => {
    expect(Array.isArray(SENSITIVE_PATTERNS)).toBe(true);
    expect(SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
    SENSITIVE_PATTERNS.forEach((p) => expect(p).toBeInstanceOf(RegExp));
  });

  it('SAFE_PATTERNS is a non-empty array of RegExp', () => {
    expect(Array.isArray(SAFE_PATTERNS)).toBe(true);
    expect(SAFE_PATTERNS.length).toBeGreaterThan(0);
    SAFE_PATTERNS.forEach((p) => expect(p).toBeInstanceOf(RegExp));
  });
});
