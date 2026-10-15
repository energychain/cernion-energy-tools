'use strict';

const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  decodedText,
  officeDirectory,
  xmlValues,
  validateRelationships,
} = require('./project-structure-stream');
const { documentSections } = require('./workbench-document');
const { setting } = require('./project-structure-policy');

function parts(text, location, limit) {
  return documentSections(text, limit).map((section) => ({
    text: text.slice(section.start, section.end),
    location: {
      ...location,
      chapter: section.chapter === 'Dokument' ? location.chapter : section.chapter,
    },
  }));
}

async function* documentParts(filename, type) {
  const limit = setting('DOCUMENT_SECTION_CHARS', 12000);
  if (type === 'pdf') {
    // Same PDF engine as the File Channel, with file-backed loading and one page per request.
    const parser = require('./file-channel-extract').createPdfParser({
      url: pathToFileURL(filename).href,
    });
    try {
      const info = await parser.getInfo();
      for (let page = 1; page <= info.total; page++) {
        const result = await parser.getText({ partial: [page], pageJoiner: '' });
        for (const part of parts(result.text, { page }, limit)) if (part.text.trim()) yield part;
      }
    } finally {
      await parser.destroy();
    }
    return;
  }
  if (['docx', 'pptx'].includes(type)) {
    const entries = await officeDirectory(filename);
    await validateRelationships(filename, entries);
    const selected = entries
      .filter((entry) =>
        type === 'docx'
          ? entry.name === 'word/document.xml'
          : /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (!selected.length) throw new Error('Missing document XML');
    let paragraphIndex = 0;
    for (const entry of selected) {
      let text = '',
        chapterTitle = '';
      const location = type === 'pptx' ? { slide: Number(entry.name.match(/slide(\d+)/)[1]) } : {};
      for await (const paragraph of xmlValues(filename, entry, type === 'docx' ? 'w:p' : 'a:p', {
        open(selected, node) {
          if (node.name === 'w:pStyle' && /^Heading[1-6]$/i.test(node.attributes['w:val'] || ''))
            selected.heading = true;
        },
      })) {
        paragraphIndex++;
        if (paragraph.heading) {
          if (text.trim())
            yield {
              text,
              location: { ...location, chapter: chapterTitle || `Paragraph ${paragraphIndex - 1}` },
            };
          text = '';
          chapterTitle = paragraph.text.trim();
        }
        for (const part of parts(
          paragraph.text,
          { ...location, chapter: chapterTitle || `Paragraph ${paragraphIndex}` },
          limit
        )) {
          if (text.length + part.text.length + 1 > limit && text.trim()) {
            yield {
              text,
              location: { ...location, chapter: chapterTitle || `Paragraph ${paragraphIndex - 1}` },
            };
            text = '';
          }
          text += part.text + '\n';
        }
      }
      if (text.trim())
        yield {
          text,
          location: { ...location, chapter: chapterTitle || `Paragraph ${paragraphIndex}` },
        };
    }
    return;
  }
  let buffer = '',
    ordinal = 0;
  for await (const text of decodedText(fs.createReadStream(filename))) {
    buffer += text;
    while (buffer.length >= limit) {
      const end = Math.max(buffer.lastIndexOf('\n', limit), limit / 2);
      const piece = buffer.slice(0, end);
      buffer = buffer.slice(end);
      for (const part of parts(piece, { chapter: `Section ${++ordinal}` }, limit)) yield part;
    }
  }
  if (buffer.trim())
    for (const part of parts(buffer, { chapter: `Section ${++ordinal}` }, limit)) yield part;
}

module.exports = { documentParts };
