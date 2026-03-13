/**
 * DOCX Connector Plugin
 */

const fs = require('fs');
const path = require('path');

function ensureMammoth() {
  try {
    // eslint-disable-next-line global-require
    return require('mammoth');
  } catch (error) {
    const e = new Error('DOCX connector requires optional dependency "mammoth". Install it to enable docx reads.');
    e.code = 'DOCX_DEPENDENCY_MISSING';
    throw e;
  }
}

module.exports = {
  type: 'docx',
  description: 'Extract text/table content from DOCX files.',
  configSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      extractionMode: { type: 'string', enum: ['tables', 'paragraphs', 'both'] },
      tableIndex: { type: 'integer' },
      headingAsKey: { type: 'boolean' },
    },
  },

  async read(connectorConfig) {
    const mammoth = ensureMammoth();
    const resolvedPath = path.resolve(connectorConfig.path);
    const fileBuffer = fs.readFileSync(resolvedPath);

    const mode = connectorConfig.extractionMode || 'paragraphs';
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    const text = result?.value || '';

    if (mode === 'tables') {
      return {
        rows: [{ table_text: text }],
        inferredSchema: { fields: [{ name: 'table_text', type: 'string', example: text.slice(0, 80) }] },
      };
    }

    return {
      rows: [{ document_text: text }],
      inferredSchema: { fields: [{ name: 'document_text', type: 'string', example: text.slice(0, 80) }] },
    };
  },
};
