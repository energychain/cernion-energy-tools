'use strict';

const BODY_TOO_LARGE = 'BODY_TOO_LARGE';
const INVALID_JSON = 'INVALID_JSON';

function requestBodyError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readJsonBody(req, { maxBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const fail = (error, drain = false) => {
      cleanup();
      if (drain && !req.destroyed) req.resume();
      reject(error);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(requestBodyError('request body too large', BODY_TOO_LARGE), true);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(requestBodyError('request body must be valid JSON', INVALID_JSON));
      }
    };
    const onError = (error) => fail(error);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

module.exports = {
  BODY_TOO_LARGE,
  INVALID_JSON,
  readJsonBody,
};
