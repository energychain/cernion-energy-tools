'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { validateSupportToken } = require('./provisioning-registry');
const { applyMapping } = require('./workbench-provisioning');

function socketPath(identityDbPath) {
  if (process.env.CET_PROVISIONING_SOCKET) return path.resolve(process.env.CET_PROVISIONING_SOCKET);
  const db = path.resolve(
    identityDbPath ||
      process.env.CET_WORKBENCH_IDENTITY_DB_PATH ||
      './data/cet_workbench_identity_mappings'
  );
  const key = createHash('sha256').update(db).digest('hex').slice(0, 20);
  return path.join(os.tmpdir(), `cet-provisioning-${process.getuid()}`, `${key}.sock`);
}

function isDatabaseLocked(error) {
  return /(?:lock.*LOCK|Resource temporarily unavailable)/i.test(error?.message || '');
}

async function removeStaleSocket(filename) {
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isSocket() || stat.uid !== process.getuid())
    throw new Error('Unsafe provisioning socket path.');
  await new Promise((resolve, reject) => {
    const probe = net.createConnection(filename);
    probe.once('connect', () => {
      probe.destroy();
      reject(new Error('Provisioning channel is already running.'));
    });
    probe.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        fs.unlinkSync(filename);
        resolve();
      } else reject(error);
    });
  });
}

async function startLocalProvisioning(service) {
  if (
    service.settings.provisioningChannelEnabled === false ||
    process.env.CET_PROVISIONING_CHANNEL_ENABLED === 'false' ||
    !process.env.CERNION_SUPPORT_TOKEN
  )
    return;
  const filename = socketPath(service.settings.identityDbPath);
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parent = fs.lstatSync(directory);
  if (!parent.isDirectory() || parent.uid !== process.getuid() || parent.mode & 0o077) {
    throw new Error(
      'Provisioning socket directory must be owned by the service user and mode 0700.'
    );
  }
  await removeStaleSocket(filename);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (req.method !== 'POST' || req.url !== '/workbench/map') {
        res.writeHead(404);
        res.end(JSON.stringify({ message: 'Not found.' }));
        return;
      }
      const secret = req.headers['x-cet-support-token'];
      // Never let server-side CERNION_SUPPORT_TOKEN_INPUT authenticate a missing header.
      try {
        validateSupportToken(secret, { CERNION_SUPPORT_TOKEN: process.env.CERNION_SUPPORT_TOKEN });
      } catch {
        res.writeHead(403);
        res.end(JSON.stringify({ message: 'Local provisioning authentication required.' }));
        return;
      }
      let data = '';
      for await (const chunk of req) {
        data += chunk;
        if (Buffer.byteLength(data) > 16384) {
          res.writeHead(413);
          res.end(JSON.stringify({ message: 'Provisioning request too large.' }));
          return;
        }
      }
      let args;
      try {
        args = JSON.parse(data);
      } catch {
        res.writeHead(422);
        res.end(JSON.stringify({ message: 'Invalid provisioning request.' }));
        return;
      }
      // Fixed workflow, no action name or caller meta is accepted from the wire.
      const result = await applyMapping(args, service.broker);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      const status = [403, 404, 409, 422].includes(error.code) ? error.code : 422;
      res.writeHead(status);
      res.end(JSON.stringify({ message: error.message }));
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(filename, () => {
      try {
        fs.chmodSync(filename, 0o600);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  service.provisioningServer = server;
  service.provisioningSocket = { filename, ino: fs.lstatSync(filename).ino };
}

async function stopLocalProvisioning(service) {
  if (!service.provisioningServer) return;
  const server = service.provisioningServer;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
  // Node normally removes the socket on close; don't unlink a replacement.
  const { filename, ino } = service.provisioningSocket;
  try {
    if (fs.lstatSync(filename).ino === ino) fs.unlinkSync(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function callLocalProvisioning(filename, args) {
  const secret = args['support-token'] || process.env.CERNION_SUPPORT_TOKEN_INPUT;
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: filename,
        path: '/workbench/map',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CET-Support-Token': secret },
      },
      (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (response.statusCode !== 200)
              reject(new Error(result.message || 'Local provisioning failed.'));
            else resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.setTimeout(10000, () => request.destroy(new Error('Local provisioning timed out.')));
    request.on('error', (error) => {
      // Offline fallback is safe only when no server can be reached; authentication/timeouts fail closed.
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) resolve(null);
      else reject(error);
    });
    const wireArgs = { ...args };
    delete wireArgs['support-token'];
    request.end(JSON.stringify(wireArgs));
  });
}

module.exports = {
  socketPath,
  isDatabaseLocked,
  startLocalProvisioning,
  stopLocalProvisioning,
  callLocalProvisioning,
};
