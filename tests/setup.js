/**
 * Jest Test Setup
 *
 * Setup environment and mocks for testing
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Load environment variables for tests
require('dotenv').config();

// Set test environment variables if not provided
if (!process.env.CERNION_TOKEN) {
  process.env.CERNION_TOKEN = 'test_token_placeholder';
}

// Mock console in tests to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

let rateQuotaTempDir = null;
if (!process.env.RATE_QUOTA_DIR) {
  rateQuotaTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-rate-quota-'));
  process.env.RATE_QUOTA_DIR = rateQuotaTempDir;
  process.on('exit', () => {
    if (!rateQuotaTempDir) return;
    try {
      fs.rmSync(rateQuotaTempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
}
