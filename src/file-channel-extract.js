'use strict';

const { inflateRawSync } = require('node:zlib');
const { fileError, fileSetting } = require('./file-channel-policy');
// Inspect the central directory before allocating expanded data. ZIP64, encrypted files,
// macros, external relationships and traversal entries are deliberately rejected.
function officeEntries(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) fileError('Ungültige Office-Datei.');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16),
    total = 0;
  const entries = new Map();
  const budget = fileSetting('MAX_EXPANDED_BYTES', 32 * 1024 * 1024);
  if (count > 2048 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    fileError('Office-Archiv nicht unterstützt.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      fileError('Ungültiges Office-Archiv.');
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20),
      expanded = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28),
      extraLength = bytes.readUInt16LE(offset + 30),
      commentLength = bytes.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      /(^\/|\\|\x00|(?:^|\/)\.\.(?:\/|$)|vbaProject|embeddings\/)/i.test(name) ||
      entries.has(name)
    )
      fileError('Unsicheres Office-Archiv.');
    total += expanded;
    if (total > budget || expanded > budget || compressed > bytes.length)
      fileError('Office-Datei überschreitet das Entpackbudget.', 413, 'FILE_CHANNEL_LIMIT');
    const local = bytes.readUInt32LE(offset + 42);
    if (local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50)
      fileError('Ungültiger Office-Eintrag.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > offset) fileError('Ungültiger Office-Eintrag.');
    let data;
    try {
      data =
        method === 0
          ? bytes.subarray(start, start + compressed)
          : inflateRawSync(bytes.subarray(start, start + compressed), {
              maxOutputLength: Math.max(1, expanded),
            });
    } catch (_error) {
      fileError('Beschädigte Office-Datei.');
    }
    if (data.length !== expanded) fileError('Ungültige Office-Eintragsgröße.');
    if (/\.rels$/.test(name) && /TargetMode\s*=\s*["']External["']/i.test(data.toString()))
      fileError('Externe Office-Verknüpfungen sind nicht erlaubt.');
    if (
      /\.xml$/.test(name) &&
      /<!DOCTYPE|<!ENTITY|<Override\b[^>]*macroEnabled/i.test(data.toString())
    )
      fileError('Unsichere Office-XML-Inhalte.');
    entries.set(name, data);
    offset = next;
  }
  return entries;
}
function validateOffice(bytes, extension) {
  const entries = officeEntries(bytes);
  const required = {
    xlsx: 'xl/workbook.xml',
    docx: 'word/document.xml',
    pptx: 'ppt/presentation.xml',
  }[extension];
  if (!entries.has('[Content_Types].xml') || !entries.has(required))
    fileError('Dateityp und Inhalt stimmen nicht überein.');
  return entries;
}
function xmlText(xml) {
  return xml
    .replace(/<\/(?:w:p|a:p)>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
async function extractOriginal(file) {
  const bytes = Buffer.from(file.contentBase64, 'base64');
  let text;
  if (file.extension === 'xlsx') {
    validateOffice(bytes, 'xlsx');
    const XLSX = require('xlsx');
    const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true, raw: true });
    text = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      if (
        range.e.r - range.s.r > fileSetting('MAX_SHEET_ROWS', 50000) ||
        range.e.c - range.s.c > 127
      )
        fileError('Tabellenblatt überschreitet die Zeilen- oder Spaltengrenze.', 413);
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
      // Cached formula results are deterministic; never invent or evaluate missing results.
      for (const [address, cell] of Object.entries(sheet))
        if (!address.startsWith('!') && cell.f && cell.v == null)
          fileError(
            'Formelergebnis fehlt. Bitte die Datei in einer Tabellenanwendung neu berechnen und speichern.'
          );
      const csv = matrix
        .map((row) =>
          row.map((cell) => '"' + String(cell ?? '').replace(/"/g, '""') + '"').join(',')
        )
        .join('\n');
      return `Sheet: ${name}\n${csv}`;
    }).join('\n\n');
  } else if (['docx', 'pptx'].includes(file.extension)) {
    const entries = validateOffice(bytes, file.extension);
    text = [...entries]
      .filter(([name]) =>
        file.extension === 'docx'
          ? name === 'word/document.xml'
          : /^ppt\/slides\/slide\d+\.xml$/.test(name)
      )
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(
        ([name, data]) =>
          `${file.extension === 'pptx' ? `\n# ${name}\n` : ''}${xmlText(data.toString('utf8'))}`
      )
      .join('\n');
  } else if (file.extension === 'pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: bytes });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else text = bytes.toString('utf8');
  if (!text?.trim()) fileError('Die Originaldatei enthält keinen lesbaren Text.');
  const max = Number(process.env.WORKBENCH_DOCUMENT_MAX_CHARS || 4000000);
  if (text.length > max) fileError('Extrahiertes Dokument überschreitet das Textbudget.', 413);
  return {
    name: file.name,
    id: file.fileId,
    text,
    original: {
      fileId: file.fileId,
      hash: file.hash,
      size: file.size,
      mimeType: file.mimeType,
      expiresAt: file.expiresAt,
      requiredClearance: file.requiredClearance || [],
    },
    sensitivityLevel: file.sensitivityLevel,
  };
}
module.exports = { officeEntries, validateOffice, extractOriginal };
