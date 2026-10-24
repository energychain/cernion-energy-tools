'use strict';

const PROJECT_BUNDLE_ALIASES = Object.freeze({
  'POST /project-bundle/prepare': 'project-bundle.prepare',
  'POST /project-bundle/start': 'project-bundle.start',
  'PUT /project-bundle/uploads/:uploadId/chunks/:index': 'project-bundle.chunk',
  'POST /project-bundle/uploads/:uploadId/complete': 'project-bundle.complete',
  'GET /project-bundle/uploads/:uploadId': 'project-bundle.status',
  'GET /project-bundle/result': 'project-bundle.result',
});
function isProjectBundleRequest(method, path) {
  const clean = String(path || '').split('?')[0];
  return Object.keys(PROJECT_BUNDLE_ALIASES).some((alias) => {
    const [verb, route] = alias.split(' ');
    const pattern = route.replace(':uploadId', '[a-f0-9-]{36}').replace(':index', '\\d+');
    return verb === method && new RegExp('^/v1' + pattern + '$').test(clean);
  });
}
function projectBundleAliases(runFacade) {
  return Object.fromEntries(
    Object.entries(PROJECT_BUNDLE_ALIASES).map(([route, brokerAction]) => [
      route,
      async function projectBundleHttp(req, res) {
        const params = { ...req.$params, ...(req.method === 'PUT' ? { stream: req } : req.body) };
        const result = await runFacade(
          this,
          { headers: req.headers, method: req.method, body: params },
          res,
          { facadePath: (req.originalUrl || req.url).split('?')[0], brokerAction }
        );
        if (result) {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.response));
        }
      },
    ])
  );
}
module.exports = { PROJECT_BUNDLE_ALIASES, isProjectBundleRequest, projectBundleAliases };
