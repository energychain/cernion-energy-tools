const { chunkText, normalizeMode } = require('../src/knowledge-rag-chunker');

describe('knowledge-rag-chunker', () => {
  test('normalizeMode keeps valid paragraph', () => {
    expect(normalizeMode('paragraph')).toBe('paragraph');
  });

  test('normalizeMode keeps valid markdown-section', () => {
    expect(normalizeMode('markdown-section')).toBe('markdown-section');
  });

  test('normalizeMode keeps valid fixed-window', () => {
    expect(normalizeMode('fixed-window')).toBe('fixed-window');
  });

  test('normalizeMode keeps valid semantic', () => {
    expect(normalizeMode('semantic')).toBe('semantic');
  });

  test('normalizeMode falls back to paragraph', () => {
    expect(normalizeMode('unknown')).toBe('paragraph');
  });

  test('paragraph chunking splits by empty lines', () => {
    const chunks = chunkText('A\n\nB\n\nC', { mode: 'paragraph' });
    expect(chunks).toEqual(['A', 'B', 'C']);
  });

  test('paragraph chunking trims whitespace', () => {
    const chunks = chunkText('  A  \n\n  B  ', { mode: 'paragraph' });
    expect(chunks).toEqual(['A', 'B']);
  });

  test('markdown-section keeps headings with body', () => {
    const chunks = chunkText('# H1\nBody\n## H2\nMore', { mode: 'markdown-section' });
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain('# H1');
    expect(chunks[1]).toContain('## H2');
  });

  test('markdown-section handles heading-only blocks', () => {
    const chunks = chunkText('# Only', { mode: 'markdown-section' });
    expect(chunks).toEqual(['# Only']);
  });

  test('fixed-window creates multiple chunks with overlap', () => {
    const text = 'x'.repeat(2200);
    const chunks = chunkText(text, { mode: 'fixed-window', windowSize: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(2);
  });

  test('fixed-window clamps too-small window size', () => {
    const text = 'x'.repeat(800);
    const chunks = chunkText(text, { mode: 'fixed-window', windowSize: 10 });
    expect(chunks.length).toBeGreaterThan(0);
  });

  test('semantic chunking groups sentences', () => {
    const text = `${'Satz eins. '.repeat(30)} ${'Satz zwei. '.repeat(30)}`;
    const chunks = chunkText(text, { mode: 'semantic', maxChars: 240 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('semantic chunking falls back for single long sentence', () => {
    const text = 'x'.repeat(1400);
    const chunks = chunkText(text, { mode: 'semantic', maxChars: 300 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('empty text returns empty chunks', () => {
    expect(chunkText('', { mode: 'paragraph' })).toEqual([]);
  });

  test('windows line ending normalization', () => {
    const chunks = chunkText('A\r\n\r\nB', { mode: 'paragraph' });
    expect(chunks).toEqual(['A', 'B']);
  });
});
