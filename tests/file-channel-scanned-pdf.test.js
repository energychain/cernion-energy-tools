'use strict';

const pages = { current: [] };
jest.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText() {
      return {
        text: pages.current.map((page) => page.text).join('\n\n-- n of m --\n\n'),
        pages: pages.current.map((page, index) => ({ text: page.text, num: index + 1 })),
      };
    }
    async getScreenshot({ partial }) {
      return { pages: partial.map((pageNumber) => ({ pageNumber, data: new Uint8Array([1]) })) };
    }
    async destroy() {}
  },
}));
jest.mock('../src/image-understanding', () => ({
  transcribeImage: jest.fn(async () => ({ text: 'Ausgangsreferenz: REQ-SYN-1', truncated: false })),
}));
const { transcribeImage } = require('../src/image-understanding');
const { extractOriginal } = require('../src/file-channel-extract');

const pdf = () => ({
  name: 'scan.pdf',
  extension: 'pdf',
  fileId: 'f1',
  tenantId: 't',
  contentBase64: Buffer.from('%PDF-1.4').toString('base64'),
});

afterEach(() => jest.clearAllMocks());

test('a scanned page without a text layer is read like a screenshot', async () => {
  pages.current = [{ text: 'Textseite eins' }, { text: '  ' }];
  const { text } = await extractOriginal(pdf());
  expect(text).toContain('Seite 1\nTextseite eins');
  expect(text).toContain('Seite 2 (Scan, maschinell gelesen)\nAusgangsreferenz: REQ-SYN-1');
  expect(transcribeImage).toHaveBeenCalledTimes(1);
  expect(transcribeImage.mock.calls[0][0].mimeType).toBe('image/png');
});

test('a PDF with a text layer on every page is not sent to vision', async () => {
  pages.current = [{ text: 'Eins' }, { text: 'Zwei' }];
  expect((await extractOriginal(pdf())).text).toContain('Zwei');
  expect(transcribeImage).not.toHaveBeenCalled();
});

test('an unreadable scan page says so instead of pretending to be empty', async () => {
  pages.current = [{ text: '' }];
  transcribeImage.mockRejectedValueOnce(new Error('vision down'));
  expect((await extractOriginal(pdf())).text).toBe(
    'Seite 1: gescannte Seite, Inhalt nicht gelesen.'
  );
});
