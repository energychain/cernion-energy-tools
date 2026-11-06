'use strict';

// A personal-agent turn may carry files as multipart/form-data. The gateway's JSON body parsers
// leave such a request unparsed, so its message never reached the action (422). This middleware
// parses exactly that request into temporary files and plain fields; the gateway then applies its
// existing checks (allowlist, sizes, storage) to them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Busboy = require('@fastify/busboy');

const CHAT_PATH = '/personal-agent/chat';

function isChatMultipart(req) {
  const url = String(req.url || '').split('?')[0];
  return (
    String(req.method || '').toUpperCase() === 'POST' &&
    (url === CHAT_PATH || url === `/api${CHAT_PATH}`) &&
    /^multipart\/form-data\b/iu.test(String(req.headers?.['content-type'] || ''))
  );
}

function personalAgentMultipart({ maxFiles, maxFileSize, maxFields }) {
  return function parsePersonalAgentMultipart(req, res, next) {
    if (!isChatMultipart(req)) return next();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-pa-upload-'));
    // The gateway moves accepted files into the session store; whatever is left goes with the reply.
    res.on?.('close', () => fs.rmSync(dir, { recursive: true, force: true }));
    const fields = {};
    const files = [];
    const writes = [];
    let failure = null;
    let busboy;
    try {
      busboy = new Busboy({
        headers: req.headers,
        limits: { files: maxFiles, fileSize: maxFileSize, fields: maxFields },
      });
    } catch (error) {
      return next(error);
    }
    busboy.on('field', (name, value) => {
      fields[name] = value;
    });
    busboy.on('file', (fieldname, stream, filename, _encoding, mimetype) => {
      // The client's file name is kept only as a label; the stored path is generated.
      const target = path.join(dir, crypto.randomUUID());
      const file = { originalname: String(filename || ''), mimetype, size: 0, path: target };
      stream.on('data', (chunk) => {
        file.size += chunk.length;
      });
      stream.on('limit', () => {
        failure ||= Object.assign(new Error('File exceeds maximum size.'), {
          code: 413,
          type: 'FILE_TOO_LARGE',
        });
        stream.resume();
      });
      writes.push(
        new Promise((resolve, reject) => {
          const out = fs.createWriteStream(target);
          out.on('finish', resolve).on('error', reject);
          stream.pipe(out);
        })
      );
      // The documented field is `fileAttachments[]`; the bracket suffix of array fields is optional.
      const field = String(fieldname || '').replace(/\[\d*\]$/u, '');
      if (['fileAttachments', 'files'].includes(field)) files.push(file);
    });
    busboy.on('filesLimit', () => {
      failure ||= Object.assign(new Error('Too many files.'), {
        code: 413,
        type: 'FILE_TOO_LARGE',
      });
    });
    busboy.on('error', (error) => next(error));
    busboy.on('finish', async () => {
      try {
        await Promise.all(writes);
      } catch (error) {
        return next(error);
      }
      if (failure) return next(failure);
      req.body = { ...fields, fileAttachments: files };
      req.$multipart = true;
      return next();
    });
    req.pipe(busboy);
  };
}

module.exports = { personalAgentMultipart, isChatMultipart };
