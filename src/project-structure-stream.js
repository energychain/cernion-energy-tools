'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const iconv = require('iconv-lite');
const { SaxesParser } = require('@rubensworks/saxes');
const { parseCsvLine, detectDelimiter, normalizeEncoding } = require('./connectors/csv.connector');
const { zipDirectory, extractZipEntry } = require('./project-file-zip');
const { assertArchiveEntry } = require('./archive-entry-policy');
const { setting, ROW_SOURCE } = require('./project-structure-policy');

async function* decodedText(source) {
  const iterator = source[Symbol.asyncIterator]();
  let first = await iterator.next();
  if (first.done) return;
  const probe = [];
  let probeSize = 0;
  while (!first.done) {
    probe.push(first.value);
    probeSize += first.value.length;
    if (probeSize >= 65536) break;
    first = await iterator.next();
  }
  first = { value: Buffer.concat(probe, probeSize), done: false };
  let encoding;
  if (first.value[0] === 0xff && first.value[1] === 0xfe) encoding = 'utf16le';
  else if (first.value[0] === 0xfe && first.value[1] === 0xff) encoding = 'utf16be';
  else {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(first.value, { stream: true });
      encoding = 'utf8';
    } catch (_error) {
      encoding = 'windows-1252';
    }
  }
  const decoder = iconv.getDecoder(normalizeEncoding(encoding));
  const validator = encoding === 'utf8' ? new TextDecoder('utf-8', { fatal: true }) : null;
  try {
    while (!first.done) {
      validator?.decode(first.value, { stream: true });
      const text = decoder.write(first.value);
      if (text.includes('\0')) throw new Error('Binary text content');
      yield text;
      first = await iterator.next();
    }
    const tail = decoder.end();
    validator?.decode();
    if (tail) yield tail;
  } finally {
    await iterator.return?.();
  }
}

async function* csvRecords(source) {
  let record = '',
    quoted = false,
    carriage = false;
  const max = setting('DATASET_MAX_RECORD_CHARS', 1024 * 1024);
  for await (const text of decodedText(source)) {
    for (const char of text) {
      if (carriage && char === '\n') {
        carriage = false;
        continue;
      }
      carriage = false;
      if (char === '"') quoted = !quoted;
      if (!quoted && (char === '\n' || char === '\r')) {
        if (record.trim()) yield record;
        record = '';
        carriage = char === '\r';
      } else record += char;
      if (record.length > max) throw new Error('Project record character limit exceeded');
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (record.trim()) yield record;
}

async function* csvRows(source, name) {
  let delimiter;
  for await (const record of csvRecords(source)) {
    delimiter ||= detectDelimiter(record, /\.tsv$/i.test(name) ? '\t' : null);
    yield parseCsvLine(record, delimiter);
  }
}

async function officeDirectory(filename) {
  const max = setting('OFFICE_MAX_EXPANDED_BYTES', 2 * 1024 ** 3);
  const entries = await zipDirectory(filename, {
    entries: 10000,
    depth: 32,
    budget: max,
    fileBytes: max,
    ratio: setting('ZIP_MAX_RATIO', 200),
  });
  for (const entry of entries) assertArchiveEntry({ ...entry, flags: 0 }, { office: true });
  if (!entries.some((entry) => entry.name === '[Content_Types].xml'))
    throw new Error('Missing Office content types');
  return entries;
}

// One expanded entry on disk at a time; SAX callbacks retain at most a row/paragraph.
async function* xmlValues(filename, entry, tag, handlers = {}) {
  if (!entry) throw new Error('Missing Office XML entry');
  const spool = path.join(path.dirname(filename), `pending-${randomUUID()}`);
  try {
    await require('./project-file-disk').diskSpace(path.dirname(filename), entry.expanded);
    await extractZipEntry(filename, entry, spool);
    const parser = new SaxesParser({ xmlns: false });
    const pending = [];
    let selected = null,
      length = 0,
      depth = 0;
    parser.on('doctype', () => {
      throw new Error('Unsafe Office XML declaration');
    });
    parser.on('opentag', (node) => {
      if (
        (node.name === 'Override' && /macroEnabled/i.test(node.attributes.ContentType || '')) ||
        node.attributes.TargetMode === 'External'
      )
        throw new Error('Unsafe Office relationship or content type');
      depth++;
      if (depth > 128) throw new Error('Office XML nesting limit exceeded');
      if (node.name === tag) {
        selected = { text: '', attributes: node.attributes };
        length = 0;
      }
      if (selected) handlers.open?.(selected, node);
    });
    const text = (value) => {
      if (selected) {
        length += value.length;
        if (length > setting('DATASET_MAX_RECORD_CHARS', 1024 * 1024))
          throw new Error('Office XML element limit exceeded');
        if (handlers.text) handlers.text(selected, value);
        else selected.text += value;
      }
    };
    parser.on('text', text);
    parser.on('cdata', text);
    parser.on('closetag', (node) => {
      if (selected) handlers.close?.(selected, node);
      if (node.name === tag) {
        pending.push(selected);
        selected = null;
      }
      depth--;
    });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const bytes of fs.createReadStream(spool)) {
      parser.write(decoder.decode(bytes, { stream: true }));
      while (pending.length) yield pending.shift();
    }
    parser.write(decoder.decode()).close();
    while (pending.length) yield pending.shift();
  } finally {
    await fs.promises.rm(spool, { force: true });
  }
}

async function validateRelationships(filename, entries) {
  for (const entry of entries.filter(
    (entry) => entry.name.endsWith('.rels') || entry.name === '[Content_Types].xml'
  )) {
    if (entry.expanded > 4 * 1024 ** 2) throw new Error('Office metadata limit exceeded');
    for await (const _part of xmlValues(filename, entry, 'Relationship')) {
      /* validation */
    }
  }
}

async function* xlsxSheets(filename) {
  const entries = await officeDirectory(filename);
  await validateRelationships(filename, entries);
  const shared = [],
    styles = [],
    sheets = [],
    relationships = new Map();
  const strings = entries.find((entry) => entry.name === 'xl/sharedStrings.xml');
  if (strings) {
    if (strings.expanded > setting('XLSX_SHARED_STRING_BYTES', 16 * 1024 ** 2))
      throw new Error('Shared string budget exceeded');
    for await (const part of xmlValues(filename, strings, 'si')) {
      if (shared.length >= setting('XLSX_SHARED_STRING_COUNT', 100000))
        throw new Error('Shared string count exceeded');
      shared.push(part.text);
    }
  }
  const styleEntry = entries.find((entry) => entry.name === 'xl/styles.xml');
  const formats = new Map();
  if (styleEntry) {
    if (styleEntry.expanded > 4 * 1024 ** 2) throw new Error('Style metadata limit exceeded');
    let inCells = false;
    for await (const _part of xmlValues(filename, styleEntry, 'styleSheet', {
      open(_selected, node) {
        if (node.name === 'numFmt')
          formats.set(node.attributes.numFmtId, node.attributes.formatCode);
        if (node.name === 'cellXfs') inCells = true;
        if (node.name === 'xf' && inCells) styles.push(node.attributes.numFmtId);
      },
      close(_selected, node) {
        if (node.name === 'cellXfs') inCells = false;
      },
    })) {
      /* metadata */
    }
  }
  let date1904 = false;
  for await (const part of xmlValues(
    filename,
    entries.find((entry) => entry.name === 'xl/workbook.xml'),
    'workbook',
    {
      open(_selected, node) {
        if (node.name === 'workbookPr') date1904 = ['1', 'true'].includes(node.attributes.date1904);
        if (node.name === 'sheet') sheets.push(node.attributes);
      },
    }
  )) {
    if (part.text.length > 4 * 1024 ** 2) throw new Error('Workbook metadata limit exceeded');
  }
  for await (const part of xmlValues(
    filename,
    entries.find((entry) => entry.name === 'xl/_rels/workbook.xml.rels'),
    'Relationship'
  ))
    relationships.set(part.attributes.Id, part.attributes.Target);
  const XLSX = require('xlsx');
  for (const sheet of sheets) {
    const target = relationships.get(sheet['r:id']);
    if (!target || target.includes('..') || /[\\\x00-\x1f]/.test(target))
      throw new Error('Unsafe worksheet reference');
    const name = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const entry = entries.find((entry) => entry.name === name);
    async function* rows() {
      for await (const part of xmlValues(filename, entry, 'row', {
        open(selected, node) {
          if (node.name === 'row') selected.cells = [];
          if (node.name === 'c') {
            selected.cell = { ...node.attributes, value: '', inline: '', formula: false };
          }
          selected.tag = node.name;
          if (node.name === 'f' && selected.cell) selected.cell.formula = true;
        },
        text(selected, value) {
          if (!selected.cell) return;
          if (selected.tag === 'v') selected.cell.value += value;
          if (selected.tag === 't') selected.cell.inline += value;
        },
        close(selected, node) {
          if (node.name !== 'c') {
            selected.tag = '';
            return;
          }
          const cell = selected.cell;
          const match = /^([A-Z]+)\d+$/.exec(cell.r || '');
          if (!match) throw new Error('Invalid worksheet cell address');
          let index = 0;
          for (const char of match[1]) index = index * 26 + char.charCodeAt(0) - 64;
          if (index > setting('DATASET_MAX_COLUMNS', 512))
            throw new Error('Project column limit exceeded');
          if (cell.formula && cell.value === '') throw new Error('Missing cached formula result');
          let value = cell.t === 'inlineStr' ? cell.inline : cell.value;
          if (cell.t === 's') {
            if (!/^\d+$/.test(value) || Number(value) >= shared.length)
              throw new Error('Invalid shared string reference');
            value = shared[Number(value)];
          } else if (cell.t === 'e') throw new Error('Worksheet error value');
          else if (cell.t === 'b') value = value === '1' ? 'true' : 'false';
          else if (!cell.t || cell.t === 'n') {
            const format = styles[Number(cell.s || 0)];
            if (
              value !== '' &&
              XLSX.SSF.is_date(formats.get(format) || XLSX.SSF.get_table()[format] || '')
            ) {
              const date = XLSX.SSF.parse_date_code(Number(value), { date1904 });
              if (!date) throw new Error('Invalid worksheet date');
              value = new Date(Date.UTC(date.y, date.m - 1, date.d, date.H, date.M, date.S))
                .toISOString()
                .replace(/Z$/, '');
            }
          }
          selected.cells[index - 1] = value;
          selected.cell = null;
        },
      })) {
        const cells = Array.from(
          { length: part.cells.length },
          (_, index) => part.cells[index] ?? ''
        );
        Object.defineProperty(cells, ROW_SOURCE, { value: Number(part.attributes.r) });
        yield cells;
      }
    }
    yield { name: sheet.name, rows: rows() };
  }
}

module.exports = {
  decodedText,
  csvRecords,
  csvRows,
  officeDirectory,
  xmlValues,
  validateRelationships,
  xlsxSheets,
};
