'use strict';

/**
 * ZNP PDF Extractor (Issue 2 — Layer 2 AI Ingestion)
 *
 * Extracts structured transformer load data from VNB statutory structure reports
 * (StromNZV §23c PDFs) using Google Gemini with a strict JSON response schema.
 *
 * Exported functions:
 *   parsePdfToText(filePath)                  — PDF file → plain text via pdf-parse
 *   parsePdfBufferToText(buffer)              — PDF buffer → plain text via pdf-parse
 *   extractLayer2CalibrationFromText(text)    — plain text → structured Layer 2 data
 *   extractLayer2CalibrationFromFile(filePath) — file wrapper
 *   extractLayer2CalibrationFromBuffer(buffer) — buffer wrapper
 *   extractPeakLoadFromText(text)             — compatibility wrapper
 *   extractPeakLoadFromFile(filePath)         — compatibility wrapper
 *
 * PII is scrubbed from the prompt before the LLM call (EU AI Act Art. 12).
 */

const fs = require('fs');
const { generateStructured, SchemaType } = require('./llm-client');

// ─── LLM response schema ──────────────────────────────────────────────────────

/** Structured output schema enforced by Gemini response_schema. */
const LAYER2_EXTRACTION_SCHEMA = {
  type: SchemaType.OBJECT,
  description: 'Extracted transformer calibration data from a VNB structure report.',
  properties: {
    peak_load_value: {
      type: SchemaType.NUMBER,
      description: 'Maximum simultaneous annual peak load (Jahreshöchstlast) at the transformer, numeric only.',
    },
    peak_load_unit: {
      type: SchemaType.STRING,
      description: 'Unit of the peak load value, typically kW or MW.',
    },
    transformer_id: {
      type: SchemaType.STRING,
      description: 'Transformer identifier, Umspannwerk node name, or Trafo ID from the document.',
    },
    nominal_capacity_value: {
      type: SchemaType.NUMBER,
      description: 'Nominal transformer capacity, numeric only.',
    },
    nominal_capacity_unit: {
      type: SchemaType.STRING,
      description: 'Unit of the nominal transformer capacity, typically kVA or MVA.',
    },
  },
  required: ['peak_load_value', 'peak_load_unit', 'transformer_id', 'nominal_capacity_value', 'nominal_capacity_unit'],
};

/** Maximum characters of PDF text forwarded to the LLM (avoids token overflow). */
const MAX_TEXT_CHARS = 30000;
const COS_PHI = 0.95;

// ─── PDF parsing ──────────────────────────────────────────────────────────────

/**
 * Read a PDF file and extract its full plain-text content.
 * @param {string} filePath  Absolute path to the PDF file.
 * @returns {Promise<string>} Extracted plain text.
 */
async function parsePdfBufferToText(buffer) {
  // Lazy-require so test mocks of this module suppress the pdf-parse import
  // eslint-disable-next-line global-require
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  const text = String(data.text || '').trim();
  if (!text) {
    throw new Error('PDF enthält keinen extrahierbaren Text. Nur native textbasierte PDFs werden in V1 unterstützt.');
  }
  return text;
}

async function parsePdfToText(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return parsePdfBufferToText(buf);
}

function normalizePowerToKw(value, unit, { applyCosPhi = false } = {}) {
  if (typeof value !== 'number' || !isFinite(value)) {
    throw new Error(`Ungültiger Leistungswert: ${value}`);
  }

  const normalizedUnit = String(unit || '').trim().toLowerCase();
  let kwValue;

  if (normalizedUnit === 'kw') {
    kwValue = value;
  } else if (normalizedUnit === 'mw') {
    kwValue = value * 1000;
  } else if (normalizedUnit === 'kva') {
    kwValue = value * COS_PHI;
  } else if (normalizedUnit === 'mva') {
    kwValue = value * 1000 * COS_PHI;
  } else {
    throw new Error(`Nicht unterstützte Leistungseinheit: ${unit}`);
  }

  return Math.round(kwValue * 1000) / 1000;
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
async function extractLayer2CalibrationFromText(text) {
  // Truncate before embedding in prompt; llm-client applies PII scrubbing internally
  const truncated = String(text || '').trim().slice(0, MAX_TEXT_CHARS);
  if (!truncated) {
    throw new Error('PDF enthält keinen extrahierbaren Text. Nur native textbasierte PDFs werden in V1 unterstützt.');
  }

  const prompt =
    'Extrahiere aus diesem textbasierten VNB-Bericht exakt diese Felder als striktes JSON: ' +
    '{ "peak_load_value": NUMBER, "peak_load_unit": "kW|MW", "transformer_id": STRING, ' +
    '"nominal_capacity_value": NUMBER, "nominal_capacity_unit": "kVA|MVA" }. ' +
    'Die Jahreshöchstlast ist die maximale zeitgleiche Last des Umspannwerks / Trafos. ' +
    'Die Nennleistung ist die Trafoleistung. Keine Freitexterklärung, nur JSON.\n\n' +
    `Dokument:\n${truncated}`;

  const parsed = await generateStructured(LAYER2_EXTRACTION_SCHEMA, prompt);

  // Backward compatibility: legacy extractor tests/callers may still return
  // the old shape `{ peak_load_kw: NUMBER }`.
  if ('peak_load_kw' in (parsed || {})) {
    if (typeof parsed.peak_load_kw !== 'number' || !isFinite(parsed.peak_load_kw)) {
      throw new Error(`LLM returned invalid peak_load_kw: ${JSON.stringify(parsed)}`);
    }

    return {
      peakLoadKw: parsed.peak_load_kw,
      transformerId: 'UNKNOWN',
      nominalCapacityKw: 0,
      peakLoadUnit: 'kW',
      nominalCapacityUnit: 'kVA',
    };
  }

  if (typeof parsed.peak_load_value !== 'number' || !isFinite(parsed.peak_load_value)) {
    throw new Error(`LLM returned invalid peak_load_value: ${JSON.stringify(parsed)}`);
  }
  if (typeof parsed.nominal_capacity_value !== 'number' || !isFinite(parsed.nominal_capacity_value)) {
    throw new Error(`LLM returned invalid nominal_capacity_value: ${JSON.stringify(parsed)}`);
  }

  const transformerId = String(parsed.transformer_id || '').trim();
  if (!transformerId) {
    throw new Error(`LLM returned invalid transformer_id: ${JSON.stringify(parsed)}`);
  }

  return {
    peakLoadKw: normalizePowerToKw(parsed.peak_load_value, parsed.peak_load_unit),
    transformerId,
    nominalCapacityKw: normalizePowerToKw(parsed.nominal_capacity_value, parsed.nominal_capacity_unit, { applyCosPhi: true }),
    peakLoadUnit: String(parsed.peak_load_unit || '').trim(),
    nominalCapacityUnit: String(parsed.nominal_capacity_unit || '').trim(),
  };
}

// ─── Convenience wrapper ──────────────────────────────────────────────────────

/**
 * End-to-end: read PDF from disk, extract text, call LLM, return peak_load_kw.
 * @param {string} filePath  Absolute path to the PDF.
 * @returns {Promise<number>}
 */
async function extractLayer2CalibrationFromBuffer(buffer) {
  const text = await parsePdfBufferToText(buffer);
  return extractLayer2CalibrationFromText(text);
}

async function extractLayer2CalibrationFromFile(filePath) {
  const text = await parsePdfToText(filePath);
  return extractLayer2CalibrationFromText(text);
}

async function extractPeakLoadFromText(text) {
  const result = await extractLayer2CalibrationFromText(text);
  return result.peakLoadKw;
}

async function extractPeakLoadFromFile(filePath) {
  const result = await extractLayer2CalibrationFromFile(filePath);
  return result.peakLoadKw;
}

module.exports = {
  parsePdfToText,
  parsePdfBufferToText,
  extractLayer2CalibrationFromText,
  extractLayer2CalibrationFromBuffer,
  extractLayer2CalibrationFromFile,
  extractPeakLoadFromText,
  extractPeakLoadFromFile,
};
