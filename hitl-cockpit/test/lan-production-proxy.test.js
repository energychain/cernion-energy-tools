'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { after, before, test } = require('node:test');
const { createLanProductionProxy } = require('../bin/lan-production-redirect');

let upstream;
let proxy;
let upstreamOrigin;
let proxyOrigin;
let bootstrapCount = 0;
let validCookie = '';

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function body(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

before(async () => {
  const upstreamPort = await allocatePort();
  const proxyPort = await allocatePort();
  upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;
  proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  upstream = http.createServer(async (request, response) => {
    const url = new URL(request.url, upstreamOrigin);
    if (url.pathname === '/management' && url.searchParams.get('token') === 'proxy-test-token') {
      bootstrapCount += 1;
      validCookie = `__Host-agentos_hitl_session=session-${bootstrapCount}`;
      response.writeHead(303, {
        location: '/management',
        'set-cookie': `${validCookie}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      });
      response.end();
      return;
    }
    if (request.headers.cookie !== validCookie) {
      response.writeHead(401, { 'content-type': 'text/plain' });
      response.end('Nicht autorisiert. Cockpit-Link erneut öffnen.');
      return;
    }
    if (url.pathname === '/api/write') {
      const payload = await body(request);
      response.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'must-not-reach-browser=secret',
        'strict-transport-security': 'max-age=31536000',
      });
      response.end(
        JSON.stringify({
          ok: true,
          origin: request.headers.origin,
          forwardedProto: request.headers['x-forwarded-proto'],
          host: request.headers.host,
          payload: JSON.parse(payload),
        })
      );
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'strict-transport-security': 'max-age=31536000',
    });
    response.end('<h1>Produktives Cockpit</h1>');
  });
  await listen(upstream, upstreamPort);
  proxy = createLanProductionProxy({
    host: '127.0.0.1',
    port: proxyPort,
    upstreamOrigin,
    productionOrigin: 'https://hitl.stromdao.de',
    staticToken: 'proxy-test-token',
  });
  await listen(proxy, proxyPort);
});

after(() => {
  proxy?.close();
  upstream?.close();
});

test('private proxy bootstraps upstream server-side and returns the management page directly', async () => {
  const response = await fetch(`${proxyOrigin}/management?reauth=1`, { redirect: 'manual' });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Produktives Cockpit/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('strict-transport-security'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store, private, max-age=0');
  assert.equal(bootstrapCount, 1);
});

test('private proxy forwards writes with the productive same-origin identity', async () => {
  const response = await fetch(`${proxyOrigin}/api/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: proxyOrigin },
    body: JSON.stringify({ action: 'confirm' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    origin: 'https://hitl.stromdao.de',
    forwardedProto: 'https',
    host: 'hitl.stromdao.de',
    payload: { action: 'confirm' },
  });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('private proxy rejects cross-origin writes before they reach production', async () => {
  const response = await fetch(`${proxyOrigin}/api/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ action: 'confirm' }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'cross_origin_denied' });
});

test('private proxy refreshes its upstream session once after an upstream 401', async () => {
  validCookie = '__Host-agentos_hitl_session=expired-elsewhere';
  const response = await fetch(`${proxyOrigin}/management`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Produktives Cockpit/);
  assert.equal(bootstrapCount, 2);
});
