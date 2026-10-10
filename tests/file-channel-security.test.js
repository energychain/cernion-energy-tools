'use strict';
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { syntheticWorkbook } = require('./helpers/file-channel-fixtures');
const {
  authorizeFile,
  validateFile,
  signDownload,
  verifyDownload,
  namespace,
  storeCapability,
} = require('../src/file-channel-policy');
const { extractOriginal } = require('../src/file-channel-extract');
const XLSX = require('xlsx');

function syntheticOffice(extension, extra = {}) {
  const cfb = XLSX.CFB.utils.cfb_new();
  const parts = {
    '[Content_Types].xml': '<Types/>',
    ...(extension === 'docx'
      ? {
          'word/document.xml':
            '<w:document><w:p><w:t>SYNTHETIC-PRIVATE-790</w:t></w:p></w:document>',
        }
      : {
          'ppt/presentation.xml': '<p:presentation/>',
          'ppt/slides/slide1.xml': '<a:p><a:t>SYNTHETIC-PRIVATE-790</a:t></a:p>',
        }),
    ...extra,
  };
  for (const [name, text] of Object.entries(parts))
    XLSX.CFB.utils.cfb_add(cfb, name, Buffer.from(text));
  return XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip' });
}
function original(name, bytes) {
  return { name, contentBase64: bytes.toString('base64') };
}

test('Office type validation, traversal, expanded budget, embedded/external content, valid DOCX/PPTX extraction', async () => {
  for (const extension of ['docx', 'pptx']) {
    const bytes = syntheticOffice(extension);
    const file = {
      ...validateFile(original('Synthetic.' + extension, bytes)),
      contentBase64: bytes.toString('base64'),
      fileId: 'a'.repeat(64),
    };
    expect((await extractOriginal(file)).text).toContain('SYNTHETIC-PRIVATE-790');
  }
  const zip = syntheticWorkbook();
  expect(() => validateFile(original('Wrong.docx', zip))).toThrow('Dateityp und Inhalt');
  for (const extra of [
    { '../escape.xml': 'Synthetic' },
    { 'word/vbaProject.bin': 'Synthetic' },
    { 'word/embeddings/file.bin': 'Synthetic' },
    {
      'word/_rels/document.xml.rels':
        '<Relationship TargetMode="External" Target="https://example.invalid"/>',
    },
    { 'word/evil.xml': '<!DOCTYPE text [<!ENTITY a "Synthetic">]><text>&a;</text>' },
  ])
    expect(() =>
      validateFile(original('Synthetic.docx', syntheticOffice('docx', extra)))
    ).toThrow();
  const previous = process.env.CET_FILE_MAX_EXPANDED_BYTES;
  process.env.CET_FILE_MAX_EXPANDED_BYTES = '5';
  try {
    expect(() => validateFile(original('Synthetic.xlsx', zip))).toThrow('Entpackbudget');
  } finally {
    if (previous == null) delete process.env.CET_FILE_MAX_EXPANDED_BYTES;
    else process.env.CET_FILE_MAX_EXPANDED_BYTES = previous;
  }
});

test('signed links require the live tenant, version, all clearances and expiry, independently of link possession', () => {
  const previous = process.env.CET_FILE_SIGNING_KEY;
  process.env.CET_FILE_SIGNING_KEY = 'synthetic-key-for-790-security-test-only';
  try {
    const file = {
      fileId: 'a'.repeat(64),
      tenantId: 'tenant-a',
      version: 'synthetic-version',
      sensitivityLevel: 'highly_sensitive',
      requiredClearance: ['restricted'],
      expiresAt: Date.now() + 30 * 86400000,
    };
    const p = { tenantId: 'tenant-a', clearance: ['restricted', 'highly_sensitive'] };
    const signed = signDownload(file);
    expect(new Date(signed.expiresAt).getTime() - Date.now()).toBeGreaterThan(7 * 86400000 - 1100);
    expect(() => verifyDownload(signed.ticket, p, file)).not.toThrow();
    expect(() => verifyDownload(signed.ticket, { ...p, tenantId: 'foreign' }, file)).toThrow();
    expect(() =>
      verifyDownload(signed.ticket, { ...p, clearance: ['highly_sensitive'] }, file)
    ).toThrow();
    expect(() => verifyDownload(signed.ticket, p, { ...file, version: 'new' })).toThrow();
    expect(() => verifyDownload(signed.ticket + 'x', p, file)).toThrow();
    expect(() => verifyDownload(signed.ticket, p, file, Date.now() + 8 * 86400000)).toThrow();
    expect(() => authorizeFile(p, { ...file, expiresAt: Date.now() - 1 })).toThrow();
  } finally {
    if (previous == null) delete process.env.CET_FILE_SIGNING_KEY;
    else process.env.CET_FILE_SIGNING_KEY = previous;
  }
});

test('scanner fail-closed, retention purge, expired deletion, and no content in logs or audit', async () => {
  const app = await createCaseBroker();
  const Store = require('../services/object-store.service');
  const File = require('../services/files.service');
  app.broker.createService({ ...Store, settings: { dbPath: path.join(app.dir, 'objects') } });
  const files = app.broker.createService({
    ...File,
    settings: { scanAction: 'synthetic-scanner.scan' },
  });
  let verdict = { clean: false };
  app.broker.createService({
    name: 'synthetic-scanner',
    actions: {
      scan: () => {
        if (verdict instanceof Error) throw verdict;
        return verdict;
      },
    },
  });
  const meta = auth();
  const input = original('Synthetic.txt', Buffer.from('SYNTHETIC-PRIVATE-790'));
  try {
    await app.broker.start();
    await expect(app.broker.call('files.upload', input, { meta })).rejects.toMatchObject({
      type: 'FILE_SCAN_REJECTED',
    });
    verdict = new Error('SYNTHETIC-PRIVATE-790');
    await expect(app.broker.call('files.upload', input, { meta })).rejects.toMatchObject({
      type: 'FILE_SCAN_UNAVAILABLE',
      message: 'Virenscan nicht verfügbar. Datei nicht gespeichert.',
    });
    const before = await app.broker.call(
      'object-store.query',
      { namespace: namespace('tenant-a') },
      { meta: { fileStoreCapability: storeCapability } }
    );
    expect(before.docs).toEqual([]);
    verdict = { clean: true };
    const ref = await app.broker.call('files.upload', input, { meta });
    const stored = await app.broker.call(
      'object-store.get',
      { namespace: namespace('tenant-a'), key: ref.fileId },
      { meta: { fileStoreCapability: storeCapability } }
    );
    await app.broker.call(
      'object-store.put',
      {
        namespace: namespace('tenant-a'),
        key: ref.fileId,
        payload: { ...stored.payload, expiresAt: Date.now() - 1 },
      },
      { meta: { fileStoreCapability: storeCapability } }
    );
    expect(await app.broker.call('files.purge', {}, { meta })).toEqual({ removed: 1 });
    expect(await app.broker.call('files.purge', {}, { meta })).toEqual({ removed: 0 });
    await expect(
      files.readFile(
        { call: (name, input, opts) => app.broker.call(name, input, opts), meta },
        { tenantId: 'tenant-a', clearance: [] },
        ref.fileId
      )
    ).rejects.toMatchObject({ code: 404 });
    const audit = await app.broker.call(
      'object-store.query',
      { namespace: namespace('tenant-a').replace('files:', 'files_audit:') },
      { meta: { fileStoreCapability: storeCapability } }
    );
    expect(audit.docs.some((entry) => entry.payload.operation === 'retention')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('SYNTHETIC-PRIVATE-790');
    for (const method of ['log', 'info', 'error', 'warn'])
      expect(JSON.stringify(console[method].mock?.calls || [])).not.toContain(
        'SYNTHETIC-PRIVATE-790'
      );
  } finally {
    await app.cleanup();
  }
});
