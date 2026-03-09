/**
 * Cernion Energy Tools - MicroService Agent System for Energy Markets
 *
 * Main entry point for starting the Moleculer broker and services
 */

const { setMaxListeners } = require('events');

// ── Fix: MaxListenersExceededWarning from concurrent MCP/fetch abort signals ──
// The MCP SDK's StreamableHTTPClientTransport passes each transport's
// AbortController.signal to every fetch() call (POST tool calls AND SSE streams).
// When a tool call returns a text/event-stream response, _handleSseStream() is
// started without await, so the undici abort listener for that stream stays on
// the signal until the SSE body is fully consumed in the background.
// With 50+ parallel pipeline calls and sequential polling loops (pollJobResult),
// listeners accumulate on the same signal and exceed Node.js's default limit (10).
// Setting max listeners to 0 (unlimited) on every new AbortSignal is the targeted
// fix: it only affects AbortSignal/EventTarget, not EventEmitter instances, so
// real memory leaks in other event emitters are still detected.
const _OriginalAbortController = global.AbortController;
global.AbortController = class extends _OriginalAbortController {
  constructor(...args) {
    super(...args);
    setMaxListeners(0, this.signal);
  }
};

const { ServiceBroker } = require('moleculer');
const config = require('./moleculer.config');
const path = require('path');
const fs = require('fs');

// Create broker
const broker = new ServiceBroker(config);

// Load all services from core and custom directories
const serviceDirs = [path.join(__dirname, 'services'), path.join(__dirname, 'custom-services')];
serviceDirs.forEach((servicesDir) => {
  if (fs.existsSync(servicesDir)) {
    const serviceFiles = fs.readdirSync(servicesDir).filter((file) => file.endsWith('.service.js'));

    serviceFiles.forEach((file) => {
      const servicePath = path.join(servicesDir, file);
      broker.logger.info(`Loading service: ${path.basename(servicesDir)}/${file}`);
      broker.loadService(servicePath);
    });
  }
});

// Start broker
broker
  .start()
  .then(() => {
    broker.logger.info('✅ Moleculer broker started successfully');
    broker.logger.info('Services are ready to accept requests');
    // Start REPL interface only in development mode
    if (process.env.NODE_ENV !== 'production') {
      // broker.repl();
    }
  })
  .catch((err) => {
    broker.logger.error('❌ Failed to start broker:', err);
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGINT', async () => {
  broker.logger.info('Shutting down gracefully...');
  await broker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  broker.logger.info('Shutting down gracefully...');
  await broker.stop();
  process.exit(0);
});
