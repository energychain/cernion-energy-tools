'use strict';

const FILE_ALIAS_ACTIONS = Object.freeze({
  'POST /files': 'files.upload',
  'GET /files/:fileId/content': 'files.download',
  'GET /files/:fileId/link': 'files.link',
  'DELETE /files/:fileId': 'files.remove',
});

function isFileChannelRequest(method, path) {
  const clean = String(path || '').split('?')[0];
  return (
    (method === 'POST' && clean === '/v1/files') ||
    (['GET', 'DELETE'].includes(method) &&
      /^\/v1\/files\/[a-f0-9]{64}(?:\/content|\/link)?$/.test(clean) &&
      (method === 'GET' ? /\/(?:content|link)$/.test(clean) : !/\/(?:content|link)$/.test(clean)))
  );
}
function fileAliases(runFacade) {
  const handler = (action, download = false) =>
    async function fileHttp(req, res) {
      const params = { ...(req.$params || {}), ...(req.body || {}) };
      if (action !== 'upload') params.fileId = req.$params.fileId;
      // Authentication/rate limits/error formatting are exactly the existing /v1 facade.
      const result = await runFacade(
        this,
        { ...req, headers: req.headers, method: req.method, body: params },
        res,
        {
          facadePath: req.originalUrl?.split('?')[0] || req.url?.split('?')[0],
          brokerAction: `files.${action}`,
        }
      );
      if (!result) return;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (download) {
        const file = result.response;
        const bytes = Buffer.from(file.contentBase64, 'base64');
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', bytes.length);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
        );
        res.end(bytes);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result.response));
      }
    };
  return {
    'POST /files': handler('upload'),
    'GET /files/:fileId/content': handler('download', true),
    'GET /files/:fileId/link': handler('link'),
    'DELETE /files/:fileId': handler('remove'),
  };
}
module.exports = { FILE_ALIAS_ACTIONS, isFileChannelRequest, fileAliases };
