#!/usr/bin/env node

/**
 * Service Creation Tool
 *
 * This tool helps create new microservices based on the skeleton template
 *
 * Usage:
 *   npm run create -- <service-name>
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('🔨 Cernion Energy Tools - Service Creator\n');

  // Get service name from args or prompt
  let serviceName = process.argv[2];

  if (!serviceName) {
    serviceName = await question('Enter service name (e.g., energy-data): ');
  }

  if (!serviceName) {
    console.error('❌ Service name is required');
    process.exit(1);
  }

  // Sanitize service name
  serviceName = serviceName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const serviceFileName = `${serviceName}.service.js`;
  const serviceFilePath = path.join(__dirname, 'services', serviceFileName);

  // Check if service already exists
  if (fs.existsSync(serviceFilePath)) {
    console.error(`❌ Service already exists: ${serviceFileName}`);
    process.exit(1);
  }

  // Read skeleton template
  const templatePath = path.join(__dirname, 'templates', 'skeleton.service.js');
  if (!fs.existsSync(templatePath)) {
    console.error('❌ Skeleton template not found');
    process.exit(1);
  }

  let template = fs.readFileSync(templatePath, 'utf-8');

  // Replace skeleton with service name
  template = template.replace(/name: 'skeleton'/g, `name: '${serviceName}'`);
  template = template.replace(/Skeleton/g, capitalize(serviceName));
  template = template.replace(/skeleton/g, serviceName);
  template = template.replace(/SKELETON/g, serviceName.toUpperCase());

  // Write new service file
  fs.writeFileSync(serviceFilePath, template);

  console.log(`✅ Service created: ${serviceFilePath}`);
  console.log(`\nNext steps:`);
  console.log(`1. Edit the service: ${serviceFilePath}`);
  console.log(`2. Customize actions, events, and methods`);
  console.log(`3. Start services: npm start`);
  console.log(`4. Test via API: http://localhost:3000/api/${serviceName}/hello`);
  console.log(`5. Test via CLI: npm run cli -- ${serviceName}.hello\n`);

  rl.close();
}

function capitalize(str) {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
