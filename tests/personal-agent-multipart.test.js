'use strict';

// A real multipart/form-data request to the personal-agent chat is parsed into fields and stored
// files, and the gateway's existing upload checks accept the result (it was rejected with 422).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ServiceBroker } = require('moleculer');
const { personalAgentMultipart, isChatMultipart } = require('../src/personal-agent-multipart');
const ApiService = require('../services/api.service');

const limits = { maxFiles: 5, maxFileSize: 1024 * 1024, maxFields: 16 };

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function send(server, form, route = '/api/personal-agent/chat') {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

describe('personal-agent multipart chat', () => {
  let server;
  let seen;
  beforeEach(async () => {
    seen = null;
    const middleware = personalAgentMultipart(limits);
    server = await serve((req, res) =>
      middleware(req, res, (error) => {
        seen = { error, body: req.body, multipart: req.$multipart };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: !error }));
      })
    );
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  test('fields and files of a real multipart turn are parsed into stored files', async () => {
    const form = new FormData();
    form.append('message', 'Bitte die beigefügte Nachricht einordnen.');
    form.append('sessionId', 'pa_test');
    form.append('fileAttachments', new Blob(['UNH+1+UTILMD:D:11A:UN:S2.1\n']), 'nachricht.txt');
    form.append('fileAttachments', new Blob([Buffer.from([137, 80, 78, 71])]), 'bild.png');
    expect((await send(server, form)).status).toBe(200);
    expect(seen.error).toBeFalsy();
    expect(seen.multipart).toBe(true);
    expect(seen.body.message).toBe('Bitte die beigefügte Nachricht einordnen.');
    expect(seen.body.fileAttachments.map((file) => file.originalname)).toEqual([
      'nachricht.txt',
      'bild.png',
    ]);
    expect(seen.body.fileAttachments[0].size).toBe(
      Buffer.byteLength('UNH+1+UTILMD:D:11A:UN:S2.1\n')
    );
    // The stored path is generated, never taken from the client's file name.
    expect(path.basename(seen.body.fileAttachments[0].path)).not.toContain('nachricht');
  });

  test('the documented field name fileAttachments[] is accepted', async () => {
    const form = new FormData();
    form.append('message', 'Mit Klammern.');
    form.append('fileAttachments[]', new Blob(['UNH+1+UTILMD\n']), 'a.txt');
    form.append('fileAttachments[1]', new Blob(['UNH+2+UTILMD\n']), 'b.txt');
    await send(server, form);
    expect(seen.body.fileAttachments.map((file) => file.originalname)).toEqual(['a.txt', 'b.txt']);
  });

  test('a JSON turn and other paths pass through unparsed', () => {
    expect(
      isChatMultipart({
        method: 'POST',
        url: '/api/personal-agent/chat',
        headers: { 'content-type': 'application/json' },
      })
    ).toBe(false);
    expect(
      isChatMultipart({
        method: 'POST',
        url: '/api/other',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      })
    ).toBe(false);
  });

  test('a file over the size limit is rejected', async () => {
    const form = new FormData();
    form.append('message', 'x');
    form.append('fileAttachments', new Blob([Buffer.alloc(limits.maxFileSize + 10)]), 'gross.txt');
    await send(server, form);
    expect(seen.error).toMatchObject({ code: 413, type: 'FILE_TOO_LARGE' });
  });

  test('the gateway accepts the parsed turn, including an EDIFACT text file', async () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    const apiRoute = ApiService.settings.routes.find((route) => route.path === '/api');
    const middleware = personalAgentMultipart(limits);
    let ctx;
    let stored;
    let seenParams;
    const gateway = await serve((req, res) =>
      middleware(req, res, async (error) => {
        if (error) throw error;
        ctx = { meta: {} };
        Object.assign(req, {
          headers: { ...req.headers, 'x-tenant-id': 'tenant-multipart' },
          query: {},
          params: {},
          $params: req.body,
        });
        // As in the real request: the gateway runs before the reply is sent.
        await apiRoute.onBeforeCall.call(
          { logger: { debug: jest.fn(), warn: jest.fn() }, broker },
          ctx,
          apiRoute,
          req,
          res
        );
        stored = ctx.params.fileAttachments.map((file) => fs.existsSync(file.tempPath));
        seenParams = req.$params;
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
      })
    );
    try {
      const form = new FormData();
      form.append('message', 'Einordnen bitte.');
      form.append('chatMode', 'consultation');
      form.append('fileAttachments', new Blob(['UNH+1+APERAK:D:07B:UN:2.1i\n']), 'aperak.txt');
      await send(gateway, form);
    } finally {
      await new Promise((resolve) => gateway.close(resolve));
    }
    expect(ctx.params.message).toBe('Einordnen bitte.');
    expect(ctx.params.fileAttachments).toHaveLength(1);
    expect(ctx.params.fileAttachments[0].fileName).toBe('aperak.txt');
    expect(stored).toEqual([true]);
    // The action receives req.$params: the checked and stored files, not the raw upload.
    expect(seenParams.fileAttachments[0]).toMatchObject({
      fileName: 'aperak.txt',
      tempPath: ctx.params.fileAttachments[0].tempPath,
    });
    fs.rmSync(path.dirname(path.dirname(ctx.params.fileAttachments[0].tempPath)), {
      recursive: true,
      force: true,
    });
  });
});

describe('personal-agent text attachments', () => {
  test('a .txt/.edi file is recognised as text and its content is readable', () => {
    const handler = require('../src/personal-agent-file-handler');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-text-'));
    for (const name of ['nachricht.txt', 'nachricht.edi']) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, "UNA:+.? 'UNB+UNOC:3'\nUNH+1+UTILMD'\n");
      expect(handler.recognizeFileType(file)).toMatchObject({ category: 'text' });
      expect(handler.readTextContent(file).content).toContain('UNH+1+UTILMD');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('the /api route parses multipart personal-agent turns', () => {
  const apiRoute = ApiService.settings.routes.find((route) => route.path === '/api');
  expect(apiRoute.use.map((fn) => fn.name)).toContain('parsePersonalAgentMultipart');
});
