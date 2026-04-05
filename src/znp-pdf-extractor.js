'use strict';

/**
 * ZNP PDF Extractor (Issue 2 — Layer 2 AI Ingestion)
 *
 * Extracts structured transformer load data from VNB statutory structure reports
 * (StromNZV §23c PDFs) using Google Gemini with a strict JSON response schema.
 *
 * Two exported functions:
 *   parsePdfToText(filePath)         — PDF binary → plain text via pdf-parse
 *   extractPeakLoadFromText(text)    — plain text → { peak_load_kw } via Gemini
 *   extractPeakLoadFromFile(filePath) — convenience wrapper (parsePdf + extract)
 *
 * PII is scrubbed from the prompt before the LLM call (EU AI Act Art. 12).
 */

const fs = require('fs');
const { generateStructured, SchemaType } = require('./llm-client');

// ─── LLM response schema ──────────────────────────────────────────────────────

/** Structured output schema enforced by Gemini response_schema. */
const PEAK_LOAD_SCHEMA = {
  type: SchemaType.OBJECT,
  description: 'Extracted transformer peak load data from a VNB structure report.',
  properties: {
    peak_load_kw: {
      type: SchemaType.NUMBER,
      description: 'Maximum simultaneous annual peak load (Jahreshöchstlast) at the transformer in kW.',
    },
  },
  required: ['peak_load_kw'],
};

/** Maximum characters of PDF text forwarded to the LLM (avoids token overflow). */
const MAX_TEXT_CHARS = 30000;

// ─── PDF parsing ──────────────────────────────────────────────────────────────

/**
 * Read a PDF file and extract its full plain-text content.
 * @param {string} filePath  Absolute path to the PDF file.
 * @returns {Promise<string>} Extracted plain text.
 */
async function parsePdfToText(filePath) {
  // Lazy-require so test mocks of this module suppress the pdf-parse import
  // eslint-disable-next-line global-require
  const pdfParse = require('pdf-parse');
  const buf = await fs.promises.readFile(filePath);
  const data = await pdfParse(buf);
  return data.text;
}

// ─── LLM extraction ───────────────────────────────────────────────────────────

/**
 * Use Gemini to extract the maximum annual peak transformer load from plain text.
 * Uses structured JSON output (responseSchema) to guarantee parseable responses.
 *
 * @param {string} text  Plain-text content of the VNB document.
 * @returns {Promise<number>} peak_load_kw value.
 * @throws {Error} If GEMINI_API_KEY is missing, the LLM fails, or no numeric value is found.
 */
async function extractPeakLoadFromText(text) {
  // Truncate before embedding in prompt; llm-client applies PII scrubbing internally
  const truncated = text.slice(0, MAX_TEXT_CHARS);
  const prompt =
    'Extrahiere die maximale zeitgleiche Jahreshöchstlast der Umspannebene in kW aus diesem ' +
    'VNB-Bericht (StromNZV §23c). Antworte als striktes JSON: { "peak_load_kw": NUMBER }.\n\n' +
    `Dokument:\n${truncated}`;

  const parsed = await generateStructured(PEAK_LOAD_SCHEMA, prompt);

  if (typeof parsed.peak_load_kw !== 'number' || !isFinite(parsed.peak_load_kw)) {
    throw new Error(`LLM returned invalid peak_load_kw value: ${JSON.stringify(parsed)}`);
  }
  return parsed.peak_load_kw;
}

// ─── Convenience wrapper ──────────────────────────────────────────────────────

/**
 * End-to-end: read PDF from disk, extract text, call LLM, return peak_load_kw.
 * @param {string} filePath  Absolute path to the PDF.
 * @returns {Promise<number>}
 */
async function extractPeakLoadFromFile(filePath) {
  const text = await parsePdfToText(filePath);
  return extractPeakLoadFromText(text);
}

module.exports = { parsePdfToText, extractPeakLoadFromText, extractPeakLoadFromFile };
