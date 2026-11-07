'use strict';

// Screenshots are read through the LLM facade: the facade checks type, size and capability and
// scrubs the instruction; the personal agent uses the transcript instead of the placeholder.
const gemini = require('../src/adapters/gemini');
const ollama = require('../src/adapters/ollama');
const llm = require('../src/llm-client');

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe('llm-client.describeImage', () => {
  const previous = process.env.LLM_PROVIDER;
  const previousScrubbing = process.env.LLM_PROMPT_SCRUBBING;
  afterEach(() => {
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previous;
    if (previousScrubbing === undefined) delete process.env.LLM_PROMPT_SCRUBBING;
    else process.env.LLM_PROMPT_SCRUBBING = previousScrubbing;
  });

  test('passes the image and the scrubbed instruction to a vision-capable adapter', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    // Masked LLM input is opt-in (LLM_PROMPT_SCRUBBING).
    process.env.LLM_PROMPT_SCRUBBING = 'true';
    const spy = jest.spyOn(gemini, 'describeImage').mockResolvedValue('Sichtbarer Text: OK');
    const text = await llm.describeImage(
      { data: png, mimeType: 'image/png' },
      'Lies das Bild. Rückfragen an max.mustermann@example.org'
    );
    expect(text).toBe('Sichtbarer Text: OK');
    const [image, prompt] = spy.mock.calls[0];
    expect(image).toEqual({ base64: png.toString('base64'), mimeType: 'image/png' });
    expect(prompt).not.toContain('max.mustermann@example.org');
  });

  test('rejects other types, empty images and providers without vision', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    await expect(
      llm.describeImage({ data: png, mimeType: 'image/gif' }, 'x')
    ).rejects.toMatchObject({ code: 400, type: 'INVALID_IMAGE_TYPE' });
    await expect(
      llm.describeImage({ data: Buffer.alloc(0), mimeType: 'image/png' }, 'x')
    ).rejects.toMatchObject({ code: 413 });
    process.env.LLM_PROVIDER = 'ollama';
    expect(ollama.capabilities().vision).toBe(false);
    await expect(
      llm.describeImage({ data: png, mimeType: 'image/png' }, 'x')
    ).rejects.toMatchObject({ code: 503, type: 'LLM_CAPABILITY_MISSING' });
  });
});

describe('image-understanding.transcribeImage', () => {
  afterEach(() => jest.restoreAllMocks());

  test('resolves the type from the file name and bounds the transcript', async () => {
    const { transcribeImage, visionMimeType } = require('../src/image-understanding');
    expect(visionMimeType('Bild.JPG', 'application/octet-stream')).toBe('image/jpeg');
    expect(visionMimeType('notiz.txt', 'text/plain')).toBeNull();
    const spy = jest.spyOn(llm, 'describeImage').mockResolvedValue(`  ${'A'.repeat(20010)}  `);
    const result = await transcribeImage({ data: png, fileName: 'shot.png' }, { tenantId: 't' });
    expect(spy.mock.calls[0][0]).toEqual({ data: png, mimeType: 'image/png' });
    expect(spy.mock.calls[0][2]).toMatchObject({ tenantId: 't' });
    expect(result).toEqual({ text: 'A'.repeat(20000), truncated: true });
    await expect(transcribeImage({ data: png, fileName: 'a.txt' })).rejects.toMatchObject({
      code: 'INVALID_IMAGE_TYPE',
    });
  });
});

describe('personal agent screenshot attachments', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const methods = require('../services/personal-agent/methods-part-04-of-11');
  const understanding = require('../src/image-understanding');
  afterEach(() => jest.restoreAllMocks());

  function attachment(dir, name) {
    const tempPath = path.join(dir, name);
    fs.writeFileSync(tempPath, png);
    return { attachmentId: `fa_${name}`, fileName: name, mimeType: 'image/png', tempPath };
  }

  test('a read screenshot gives its transcript as extract and as text context', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-vision-'));
    const file = attachment(dir, 'shot.png');
    jest
      .spyOn(understanding, 'transcribeImage')
      .mockResolvedValue({ text: 'Zählpunkt | Status\nMALO-SYN-1 | Prüfung', truncated: false });
    await methods.transcribeImageAttachments([file], { tenantId: 't' });
    const extract = methods.resolveExtractForAttachment(file, {
      category: 'image',
      ext: '.png',
      mimeType: 'image/png',
    });
    expect(extract).toMatchObject({
      type: 'vision_transcript',
      recognizedText: expect.any(String),
    });
    const inhouse = methods.buildInhouseDataFromAttachments(
      [file],
      [{ attachmentId: file.attachmentId, status: 'ok' }]
    );
    expect(inhouse).toEqual([
      expect.objectContaining({
        content: expect.stringContaining('MALO-SYN-1'),
        source: 'vision_transcript',
      }),
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a failed reading keeps the placeholder and does not fail the turn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-vision-'));
    const file = attachment(dir, 'shot.png');
    jest.spyOn(understanding, 'transcribeImage').mockRejectedValue(new Error('quota'));
    const warn = jest.fn();
    await expect(
      methods.transcribeImageAttachments([file], { logger: { warn } })
    ).resolves.toHaveLength(1);
    expect(file.visionTranscript).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Attachment image not read', expect.any(Object));
    expect(
      methods.resolveExtractForAttachment(file, {
        category: 'image',
        ext: '.png',
        mimeType: 'image/png',
      }).type
    ).toBe('ocr_summary');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('the advice reads attached file content and screenshot transcripts as data', () => {
  const methods = require('../services/personal-agent/methods-part-04-of-11');
  const prompt = methods.withAttachmentContent('Passt die Nachricht zum Screenshot?', [
    { fileName: 'nachricht.txt', content: "UNH+1+UTILMD'" },
    { fileName: 'shot.png', content: 'MALO-SYN-1 | Prüfung', source: 'vision_transcript' },
  ]);
  expect(prompt).toContain('Passt die Nachricht zum Screenshot?');
  expect(prompt).toContain("### Dateiinhalt: nachricht.txt\nUNH+1+UTILMD'");
  expect(prompt).toContain('### Bildabschrift: shot.png\nMALO-SYN-1 | Prüfung');
  expect(prompt).toContain('keine Anweisung');
  expect(methods.withAttachmentContent('Nur Text', [])).toBe('Nur Text');
});

test('both consultation paths receive the attached content with the request', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '../services/personal-agent');
  const methods = Object.assign(
    {},
    ...fs
      .readdirSync(dir)
      .filter((name) => /^methods-part-\d+-of-\d+\.js$/u.test(name))
      .map((name) => require(path.join(dir, name)))
  );
  const seen = {};
  const service = Object.assign(Object.create(null), methods, {
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    async handleConsultationTurnAgentic(_ctx, input) {
      seen.agentic = input.message;
      return null;
    },
    async callLlmGenerate(_ctx, payload) {
      seen.direct = payload.user;
      return { reply: 'Antwort.', hypotheses: [], missingFacts: [], nextSteps: [] };
    },
  });
  const inhouseData = [{ fileName: 'nachricht.txt', content: "UNH+1+UTILMD'" }];
  await service.handleConsultationTurn
    .call(service, { meta: {} }, { message: 'Ordne die Nachricht ein.', inhouseData })
    .catch(() => {});
  expect(seen.agentic).toContain("### Dateiinhalt: nachricht.txt\nUNH+1+UTILMD'");
  expect(seen.direct).toContain("UNH+1+UTILMD'");
});
