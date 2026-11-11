'use strict';

const http = require('node:http');
const { createBootstrapTicket } = require('../lib/session-auth');

const host = process.env.COCKPIT_LAN_REDIRECT_HOST || '10.0.0.101';
const port = Number(process.env.COCKPIT_LAN_REDIRECT_PORT || 3938);
const productionOrigin = process.env.COCKPIT_PRODUCTION_ORIGIN || 'https://hitl.stromdao.de';
const staticToken = String(process.env.HITL_COCKPIT_TOKEN || '');

if (!staticToken) throw new Error('session_auth_token_missing');

const server = http.createServer((request, response) => {
  const incoming = new URL(request.url, `http://${host}:${port}`);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(410, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify({ ok: false, error: 'shadow_preview_retired_reload_production' }));
    return;
  }
  const pathname = incoming.pathname === '/' ? '/management' : incoming.pathname;
  const target = new URL(pathname, productionOrigin);
  if (pathname === '/management') {
    const ticket = createBootstrapTicket({ staticToken, pathname });
    target.searchParams.set('bootstrap_ts', String(ticket.timestamp));
    target.searchParams.set('bootstrap_nonce', ticket.nonce);
    target.searchParams.set('bootstrap_sig', ticket.signature);
  }
  response.writeHead(302, {
    location: target.toString(),
    'cache-control': 'no-store, private, max-age=0',
    pragma: 'no-cache',
    expires: '0',
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end('Das interne Shadow-Preview ist beendet. Weiterleitung zum produktiven Cockpit.');
});

server.listen(port, host, () => {
  console.log(
    JSON.stringify({ ok: true, service: 'agentos-cockpit-production-redirect', host, port })
  );
});
