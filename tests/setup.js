/**
 * Jest Test Setup
 *
 * Setup environment and mocks for testing
 */

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
