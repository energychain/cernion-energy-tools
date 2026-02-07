/**
 * Cernion Energy Tools - MicroService Agent System for Energy Markets
 *
 * Main entry point for starting the Moleculer broker and services
 */

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
