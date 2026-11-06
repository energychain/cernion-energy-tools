'use strict';

// Pasted screenshots (image parts of the user's message) join the turn's files instead of being
// dropped by the text normalisation.
const { imageParts, storeImageParts } = require('../src/openai-image-parts');

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString('base64');
const message = (content) => ({ role: 'user', content });
const image = (url) => ({ type: 'image_url', image_url: { url } });

describe('image parts of the current user message', () => {
  test('only inline images of the latest user message are taken; remote URLs never', () => {
    const messages = [
      message([{ type: 'text', text: 'früher' }, image(`data:image/png;base64,${png}`)]),
      { role: 'assistant', content: 'ok' },
      message([
        { type: 'text', text: 'Was zeigt dieser Screenshot?' },
        image(`data:image/jpeg;base64,${png}`),
        image('https://example.org/bild.png'),
        image('data:image/svg+xml;base64,PHN2Zz4='),
      ]),
    ];
    expect(imageParts(messages)).toEqual([{ mimeType: 'image/jpeg', contentBase64: png }]);
    expect(imageParts([message('nur Text')])).toEqual([]);
  });

  test('they are stored as originals with the turn identity and returned as file references', async () => {
    const call = jest.fn(async (_action, params) => ({
      fileId: 'a'.repeat(64),
      name: params.name,
      mimeType: params.mimeType,
      size: 10,
      hash: 'a'.repeat(64),
      duplicate: false,
    }));
    const refs = await storeImageParts(
      { call, meta: { tenantId: 't' } },
      [message([image(`data:image/png;base64,${png}`)])],
      { openWebuiOrgId: 'org-1', openWebuiUserId: 'user-1' }
    );
    expect(call).toHaveBeenCalledWith(
      'files.upload',
      {
        name: 'bild-1.png',
        contentBase64: png,
        mimeType: 'image/png',
        openWebuiOrgId: 'org-1',
        openWebuiUserId: 'user-1',
      },
      { meta: { tenantId: 't' } }
    );
    expect(refs).toEqual([
      {
        fileId: 'a'.repeat(64),
        name: 'bild-1.png',
        mimeType: 'image/png',
        size: 10,
        hash: 'a'.repeat(64),
      },
    ]);
  });
});

describe('file channel accepts screenshots', () => {
  const policy = require('../src/file-channel-policy');
  const realPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString('base64');

  test('a PNG with its signature is accepted, a disguised file is not', () => {
    expect(() =>
      policy.validateFile({ name: 'shot.png', contentBase64: realPng, mimeType: 'image/png' })
    ).not.toThrow();
    expect(() =>
      policy.validateFile({
        name: 'shot.png',
        contentBase64: Buffer.from('kein Bild').toString('base64'),
        mimeType: 'image/png',
      })
    ).toThrow('Ungültige Bilddatei.');
  });

  test('extraction turns a screenshot into a marked transcript', async () => {
    const understanding = require('../src/image-understanding');
    const spy = jest
      .spyOn(understanding, 'transcribeImage')
      .mockResolvedValue({ text: 'Zählpunkt | Status', truncated: false });
    const { extractOriginal } = require('../src/file-channel-extract');
    const document = await extractOriginal({
      name: 'shot.png',
      mimeType: 'image/png',
      extension: 'png',
      contentBase64: realPng,
      tenantId: 'tenant-a',
      fileId: 'f'.repeat(64),
      hash: 'f'.repeat(64),
      size: 11,
    });
    expect(spy.mock.calls[0][1]).toEqual({ tenantId: 'tenant-a' });
    expect(document.text).toContain('Bildabschrift von „shot.png“');
    expect(document.text).toContain('Zählpunkt | Status');
    spy.mockRestore();
  });
});
