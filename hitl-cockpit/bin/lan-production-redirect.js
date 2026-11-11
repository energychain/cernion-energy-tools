'use strict';

const http = require('node:http');
const https = require('node:https');

const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;
const RESPONSE_HEADER_ALLOWLIST = new Set([
  'cache-control',
  'content-disposition',
  'content-length',
  'content-security-policy',
  'content-type',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'etag',
  'expires',
  'last-modified',
  'permissions-policy',
  'pragma',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
]);

function requestBuffer(request, limit = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('request_body_too_large');
        error.status = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function upstreamRequest(target, options = {}, body = Buffer.alloc(0)) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode || 502,
          headers: response.headers,
          body: Buffer.concat(chunks),
        })
      );
    });
    request.on('error', reject);
    if (body.length) request.write(body);
    request.end();
  });
}

function cookiePair(setCookie) {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(value || '').split(';', 1)[0];
}

function safeResponseHeaders(headers, productionOrigin) {
  const result = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (value !== undefined && RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase()))
      result[name] = value;
  }
  const location = String(headers?.location || '');
  if (location) {
    try {
      const resolved = new URL(location, productionOrigin);
      if (resolved.origin === productionOrigin)
        result.location = `${resolved.pathname}${resolved.search}`;
    } catch (_) {
      // Invalid or foreign redirects are intentionally not forwarded.
    }
  }
  result['cache-control'] = 'no-store, private, max-age=0';
  return result;
}

function createLanProductionProxy(options = {}) {
  const host = options.host || '10.0.0.101';
  const port = Number(options.port || 3938);
  const upstreamOrigin = new URL(options.upstreamOrigin || 'http://10.0.0.101:3927');
  const productionOrigin = new URL(options.productionOrigin || 'https://hitl.stromdao.de').origin;
  const staticToken = String(options.staticToken || '');
  const bodyLimit = Number(options.bodyLimit || DEFAULT_BODY_LIMIT);
  let upstreamCookie = '';
  let bootstrapPromise = null;

  if (!staticToken) throw new Error('session_auth_token_missing');
  if (!['http:', 'https:'].includes(upstreamOrigin.protocol))
    throw new Error('lan_proxy_upstream_invalid');

  async function bootstrapSession() {
    if (upstreamCookie) return upstreamCookie;
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      const target = new URL('/management', upstreamOrigin);
      target.searchParams.set('token', staticToken);
      const response = await upstreamRequest(target, {
        method: 'GET',
        headers: {
          accept: 'text/html',
          host: new URL(productionOrigin).host,
          'x-forwarded-host': new URL(productionOrigin).host,
          'x-forwarded-proto': 'https',
        },
      });
      const session = cookiePair(response.headers['set-cookie']);
      if (response.status !== 303 || !session) throw new Error('lan_proxy_bootstrap_failed');
      upstreamCookie = session;
      return session;
    })().finally(() => {
      bootstrapPromise = null;
    });
    return bootstrapPromise;
  }

  async function forward(request, body, retry = true) {
    const incoming = new URL(request.url, `http://${host}:${port}`);
    const pathname = incoming.pathname === '/' ? '/management' : incoming.pathname;
    const target = new URL(`${pathname}${incoming.search}`, upstreamOrigin);
    const productionHost = new URL(productionOrigin).host;
    const headers = {
      accept: request.headers.accept || '*/*',
      cookie: await bootstrapSession(),
      host: productionHost,
      'user-agent': request.headers['user-agent'] || 'agentos-cockpit-lan-proxy',
      'x-forwarded-host': productionHost,
      'x-forwarded-proto': 'https',
    };
    if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'];
    if (body.length) headers['content-length'] = String(body.length);
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) headers.origin = productionOrigin;

    const response = await upstreamRequest(
      target,
      { method: request.method, headers },
      request.method === 'HEAD' ? Buffer.alloc(0) : body
    );
    if (response.status === 401 && retry) {
      upstreamCookie = '';
      await bootstrapSession();
      return forward(request, body, false);
    }
    return response;
  }

  return http.createServer(async (request, response) => {
    try {
      const expectedOrigin = `http://${host}:${port}`;
      const suppliedOrigin = String(request.headers.origin || '');
      if (!['GET', 'HEAD'].includes(request.method || 'GET') && suppliedOrigin !== expectedOrigin) {
        response.writeHead(403, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ ok: false, error: 'cross_origin_denied' }));
        return;
      }
      const body = ['GET', 'HEAD'].includes(request.method || 'GET')
        ? Buffer.alloc(0)
        : await requestBuffer(request, bodyLimit);
      const proxied = await forward(request, body);
      response.writeHead(proxied.status, safeResponseHeaders(proxied.headers, productionOrigin));
      response.end(request.method === 'HEAD' ? undefined : proxied.body);
    } catch (error) {
      const status = Number(error.status || 502);
      response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(
        JSON.stringify({
          ok: false,
          error: status === 413 ? 'request_body_too_large' : 'production_cockpit_unavailable',
        })
      );
    }
  });
}

if (require.main === module) {
  const host = process.env.COCKPIT_LAN_REDIRECT_HOST || '10.0.0.101';
  const port = Number(process.env.COCKPIT_LAN_REDIRECT_PORT || 3938);
  const server = createLanProductionProxy({
    host,
    port,
    upstreamOrigin: process.env.COCKPIT_UPSTREAM_ORIGIN || 'http://10.0.0.101:3927',
    productionOrigin: process.env.COCKPIT_PRODUCTION_ORIGIN || 'https://hitl.stromdao.de',
    staticToken: process.env.HITL_COCKPIT_TOKEN,
  });
  server.listen(port, host, () => {
    console.log(
      JSON.stringify({ ok: true, service: 'agentos-cockpit-production-proxy', host, port })
    );
  });
}

module.exports = {
  createLanProductionProxy,
  safeResponseHeaders,
};
