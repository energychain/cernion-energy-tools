'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILE_TYPE_MAP = Object.freeze({
  '.csv': { mimeType: 'text/csv', category: 'tabular' },
  '.xlsx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'tabular',
  },
  '.xls': { mimeType: 'application/vnd.ms-excel', category: 'tabular' },
  '.png': { mimeType: 'image/png', category: 'image' },
  '.jpg': { mimeType: 'image/jpeg', category: 'image' },
  '.jpeg': { mimeType: 'image/jpeg', category: 'image' },
  '.pdf': { mimeType: 'application/pdf', category: 'document' },
});

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_SAMPLE_ROWS = 5;

function buildError(code, message, extras = {}) {
  const error = new Error(message);
  error.code = code;
  return Object.assign(error, extras);
}

function recognizeFileType(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw buildError('FILE_NOT_FOUND', 'Attachment file not found.');
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw buildError('FILE_TOO_LARGE', 'Datei überschreitet die maximale Größe von 10 MB.', {
      maxSize: MAX_FILE_SIZE_BYTES,
      sizeBytes: stat.size,
    });
  }

  const ext = path.extname(filePath).toLowerCase();
  const meta = FILE_TYPE_MAP[ext];
  if (!meta) {
    throw buildError(
      'INVALID_FILE_TYPE',
      'Das Dateiformat wird nicht unterstützt. Erlaubt: CSV, Excel, PNG, JPG, PDF.',
      { allowed: Object.keys(FILE_TYPE_MAP) }
    );
  }

  if (meta.mimeType === 'text/csv') {
    const preview = fs.readFileSync(filePath, 'utf8').slice(0, 512);
    if (!preview.includes(',') && !preview.includes(';') && !preview.includes('\t')) {
      throw buildError(
        'INVALID_FILE_TYPE',
        'Das Dateiformat wird nicht unterstützt. Erlaubt: CSV, Excel, PNG, JPG, PDF.'
      );
    }
  }

  return {
    ...meta,
    ext,
    sizeBytes: stat.size,
  };
}

function parseCsvExtract(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');

  if (lines.length === 0) {
    return {
      type: 'csv',
      rowCount: 0,
      columnCount: 0,
      headers: [],
      sampleRows: [],
      summary: 'Leere CSV-Datei.',
    };
  }

  const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map((part) => part.trim());
  const dataRows = lines.slice(1);
  const sampleRows = dataRows
    .slice(0, MAX_SAMPLE_ROWS)
    .map((row) => row.split(delimiter).map((part) => part.trim()));

  return {
    type: 'csv',
    rowCount: dataRows.length,
    columnCount: headers.length,
    headers,
    sampleRows,
    summary: `${dataRows.length} Zeilen, ${headers.length} Spalten (${headers.join(', ')}).`,
  };
}

function parseExcelExtract(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const header = fs.readFileSync(filePath).slice(0, 8);
    if (ext === '.xlsx') {
      const isZip = header[0] === 0x50 && header[1] === 0x4b;
      if (!isZip) {
        throw new Error('invalid xlsx signature');
      }
    }

    const workbook = XLSX.readFile(filePath, {
      cellFormula: false,
      cellNF: false,
      cellStyles: false,
    });

    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        blankrows: false,
      });

      const headers = Array.isArray(rows[0]) ? rows[0].map((cell) => String(cell || '').trim()) : [];
      const sampleRows = rows.slice(1, MAX_SAMPLE_ROWS + 1);

      return {
        name,
        rowCount: Math.max(rows.length - 1, 0),
        columnCount: headers.length,
        headers,
        sampleRows,
      };
    });

    return {
      type: 'excel',
      sheetCount: sheets.length,
      sheets,
      summary: `${sheets.length} Sheet(s): ${sheets
        .map((sheet) => `${sheet.name} (${sheet.rowCount} Zeilen)`)
        .join(', ')}.`,
    };
  } catch (error) {
    throw buildError('PARSE_ERROR', 'Excel-Datei beschädigt oder ungültiges Format.', {
      causeMessage: error.message,
    });
  }
}

function ocrExtractImage(filePath) {
  const fileName = path.basename(filePath);
  return {
    type: 'ocr_summary',
    recognizedText: null,
    summary: `Bild-Datei "${fileName}" hochgeladen. OCR-Textextraktion ist in dieser Version eingeschränkt — bitte beschreiben Sie den Inhalt kurz im Chat, falls relevant.`,
    language: 'de',
  };
}

function extractDocumentText(filePath) {
  const fileName = path.basename(filePath);
  return {
    type: 'pdf_placeholder',
    summary: `PDF-Dokument "${fileName}" hochgeladen. Die automatische Textextraktion ist in dieser Version eingeschränkt.`,
  };
}

function injectFileIntoL3(session, fileMeta) {
  if (!session || typeof session !== 'object') {
    throw buildError('INVALID_SESSION', 'Session payload for file injection is invalid.');
  }

  if (!session.l3 || typeof session.l3 !== 'object') {
    session.l3 = {};
  }

  if (!Array.isArray(session.l3.fileAttachments)) {
    session.l3.fileAttachments = [];
  }

  session.l3.fileAttachments.push({
    ...fileMeta,
    ts: fileMeta.ts || new Date().toISOString(),
    usedInExecution: Boolean(fileMeta.usedInExecution),
    executionReference: fileMeta.executionReference || null,
  });

  return session;
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_EXTENSIONS: Object.keys(FILE_TYPE_MAP),
  recognizeFileType,
  parseCsvExtract,
  parseExcelExtract,
  ocrExtractImage,
  extractDocumentText,
  injectFileIntoL3,
};
