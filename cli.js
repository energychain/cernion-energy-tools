#!/usr/bin/env node

/**
 * CLI Tool for Cernion Energy Tools
 *
 * Allows calling microservices via the API Gateway from the command line
 *
 * Usage:
 *   npm run cli -- <action> [params]
 *   npm run cli -- skeleton.hello --name=John
 *   npm run cli -- skeleton.process --data="test" --options.uppercase=true
 */

const axios = require('axios');
require('dotenv').config();

const API_URL = process.env.API_URL || 'http://localhost:3000/api';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const action = args[0];
  const params = parseParams(args.slice(1));

  try {
    console.log(`📡 Calling action: ${action}`);
    console.log(`📦 Parameters:`, JSON.stringify(params, null, 2));
    console.log('');

    const response = await callAction(action, params);

    console.log('✅ Response:');
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    process.exit(1);
  }
}

/**
 * Call a microservice action via the API Gateway
 */
async function callAction(action, params) {
  // Parse action into service and action parts
  // Supports formats: service.action, v1.service.action, example.hello
  const parts = action.split('.');

  if (parts.length < 2) {
    throw new Error('Invalid action format. Use: service.action or v1.service.action');
  }

  let service, actionName, version;

  // Check if first part looks like a version (v1, v2, etc.)
  if (parts[0].match(/^v\d+$/)) {
    version = parts[0];
    service = parts[1];
    actionName = parts.slice(2).join('.');
  } else {
    service = parts[0];
    actionName = parts.slice(1).join('.');
  }

  // Build URL path
  const pathParts = [API_URL];
  if (version) pathParts.push(version);
  pathParts.push(service, actionName);

  const url = pathParts.join('/');

  // Determine HTTP method based on common conventions
  const method =
    actionName.startsWith('get') || actionName === 'health' || actionName === 'hello'
      ? 'GET'
      : 'POST';

  const config = {
    method,
    url,
    ...(method === 'GET' ? { params } : { data: params }),
  };

  const response = await axios(config);
  return response.data;
}

/**
 * Parse command line parameters
 * Supports formats like:
 *   --name=value
 *   --flag
 *   --nested.key=value
 */
function parseParams(args) {
  const params = {};

  args.forEach((arg) => {
    if (arg.startsWith('--')) {
      const keyValue = arg.substring(2);
      const [key, ...valueParts] = keyValue.split('=');
      const value = valueParts.join('=');

      if (value === '') {
        // Boolean flag
        setNestedValue(params, key, true);
      } else {
        // Try to parse as JSON, number, or boolean
        let parsedValue = value;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // Keep as string if not valid JSON
        }
        setNestedValue(params, key, parsedValue);
      }
    }
  });

  return params;
}

/**
 * Set nested object value using dot notation
 * Guards against prototype pollution
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    // Guard against prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`Invalid property name: ${key}`);
    }
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  const finalKey = keys[keys.length - 1];
  // Guard against prototype pollution
  if (finalKey === '__proto__' || finalKey === 'constructor' || finalKey === 'prototype') {
    throw new Error(`Invalid property name: ${finalKey}`);
  }
  current[finalKey] = value;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Cernion Energy Tools CLI

Usage:
  npm run cli -- <service.action> [params]

Examples:
  npm run cli -- example.hello --name=John
  npm run cli -- v1.example.hello --name=John
  npm run cli -- example.process --data="test data" --options.uppercase=true
  npm run cli -- example.health

Parameters:
  --key=value       Set a parameter value
  --key             Set a boolean flag to true
  --nested.key=val  Set nested object values

Environment:
  API_URL           API Gateway URL (default: http://localhost:3000/api)
  `);
}

// Run CLI
main();
