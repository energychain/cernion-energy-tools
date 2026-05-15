'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const {
  recognizeFileType,
  parseCsvExtract,
  parseExcelExtract,
  extractDocumentText,
  injectFileIntoL3,
  MAX_FILE_SIZE_BYTES,
} = require('../src/personal-agent-file-handler');

describe('personal-agent-file-handler', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-file-handler-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('recognizeFileType detects CSV', () => {
    const csvPath = path.join(tmpDir, 'test.csv');
    fs.writeFileSync(csvPath, 'ZaehlerID,Zeitstempel,Zaehlerstand\nM-001,2026-01-01T00:00:00Z,12456.7\n');

    const result = recognizeFileType(csvPath);
    expect(result.mimeType).toBe('text/csv');
    expect(result.category).toBe('tabular');
  });

  test('parseCsvExtract returns structure', () => {
    const csvPath = path.join(tmpDir, 'test.csv');
    fs.writeFileSync(csvPath, 'A,B,C\n1,2,3\n4,5,6\n');

    const result = parseCsvExtract(csvPath);
    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.headers).toEqual(['A', 'B', 'C']);
    expect(result.sampleRows.length).toBe(2);
  });

  test('parseExcelExtract returns sheet metadata', () => {
    const xlsxPath = path.join(tmpDir, 'book.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A', 'B'], ['1', '2']]), 'SheetA');
    XLSX.writeFile(wb, xlsxPath);

    const result = parseExcelExtract(xlsxPath);
    expect(result.type).toBe('excel');
    expect(result.sheetCount).toBe(1);
    expect(result.sheets[0].name).toBe('SheetA');
    expect(result.sheets[0].rowCount).toBe(1);
  });

  test('injectFileIntoL3 adds to session', () => {
    const session = { l3: { history: [], fileAttachments: [] } };
    const extract = { type: 'csv', rowCount: 5, headers: ['A'], sampleRows: [] };

    injectFileIntoL3(session, {
      attachmentId: 'fa_test01',
      fileName: 'test.csv',
      mimeType: 'text/csv',
      category: 'tabular',
      sizeBytes: 100,
      extract,
    });

    expect(session.l3.fileAttachments.length).toBe(1);
    expect(session.l3.fileAttachments[0].attachmentId).toBe('fa_test01');
  });

  test('rejects files larger than limit', () => {
    const csvPath = path.join(tmpDir, 'oversize.csv');
    fs.writeFileSync(csvPath, Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 0x61));

    expect(() => recognizeFileType(csvPath)).toThrow('Datei überschreitet die maximale Größe von 10 MB.');
    expect(() => recognizeFileType(csvPath)).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
  });

  test('returns PDF placeholder extract in MVP', () => {
    const pdfPath = path.join(tmpDir, 'bericht.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.7\n%');

    const extract = extractDocumentText(pdfPath);
    expect(extract.type).toBe('pdf_placeholder');
    expect(extract.summary).toContain('automatische Textextraktion');
  });
});
