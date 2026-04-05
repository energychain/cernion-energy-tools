'use strict';

/**
 * Unit tests for src/znp-pdf-extractor.js
 *
 * External dependencies (pdf-parse, llm-client) are fully mocked.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('pdf-parse', () =>
  jest.fn().mockResolvedValue({ text: 'Jahreshöchstlast: 650 kW im Jahr 2024.' })
);

// Mock the centralized llm-client so no real Gemini calls are made.
// Expose a shared generateStructured mock for per-test control.
const mockGenerateStructured = jest.fn().mockResolvedValue({ peak_load_kw: 650 });
jest.mock('../src/llm-client', () => ({
  generateStructured: mockGenerateStructured,
  SchemaType: { OBJECT: 'OBJECT', NUMBER: 'NUMBER' },
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue(Buffer.from('PDF content')),
  },
}));

const pdfParse = require('pdf-parse');
const {
  parsePdfToText,
  extractPeakLoadFromText,
  extractPeakLoadFromFile,
} = require('../src/znp-pdf-extractor');

// ─── parsePdfToText ───────────────────────────────────────────────────────────

describe('parsePdfToText', () => {
  it('reads the file and returns text from pdf-parse', async () => {
    const text = await parsePdfToText('/uploads/report.pdf');
    expect(text).toBe('Jahreshöchstlast: 650 kW im Jahr 2024.');
  });

  it('passes the file buffer to pdf-parse', async () => {
    await parsePdfToText('/uploads/report.pdf');
    expect(pdfParse).toHaveBeenCalledWith(expect.any(Buffer));
  });
});

// ─── extractPeakLoadFromText ──────────────────────────────────────────────────

describe('extractPeakLoadFromText', () => {
  beforeEach(() => {
    mockGenerateStructured.mockResolvedValue({ peak_load_kw: 650 });
  });

  it('returns the numeric peak_load_kw from the LLM response', async () => {
    const result = await extractPeakLoadFromText('Jahreshöchstlast: 650 kW');
    expect(result).toBe(650);
  });

  it('throws when LLM_NOT_CONFIGURED (503 from llm-client)', async () => {
    // Construct a plain Error with matching properties — avoids loading moleculer
    // inside this test context where `fs` is mocked (would break file-logger init).
    const llmError = Object.assign(new Error('API key missing'), {
      type: 'LLM_NOT_CONFIGURED',
      code: 503,
    });
    mockGenerateStructured.mockRejectedValueOnce(llmError);
    await expect(extractPeakLoadFromText('some text')).rejects.toMatchObject({
      type: 'LLM_NOT_CONFIGURED',
    });
  });

  it('throws when LLM returns a non-numeric peak_load_kw', async () => {
    mockGenerateStructured.mockResolvedValueOnce({ peak_load_kw: 'not-a-number' });
    await expect(extractPeakLoadFromText('text')).rejects.toThrow('invalid peak_load_kw');
  });
});

// ─── extractPeakLoadFromFile ──────────────────────────────────────────────────

describe('extractPeakLoadFromFile', () => {
  beforeEach(() => {
    mockGenerateStructured.mockResolvedValue({ peak_load_kw: 650 });
  });

  it('chains parsePdfToText and extractPeakLoadFromText, returning 650', async () => {
    const value = await extractPeakLoadFromFile('/uploads/test.pdf');
    expect(value).toBe(650);
  });
});
