module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    'services/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!services/api.service.js',
  ],
  coverageThreshold: {
    global: {
      // Maintenance milestone (Release N): staged ramp-up target.
      // Release N+1 target: branches 60, functions 75, lines 75, statements 75.
      branches: 55,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  testMatch: ['**/tests/**/*.test.js', '**/__tests__/**/*.js'],
  verbose: true,
  testTimeout: 30000,
  setupFiles: ['<rootDir>/tests/setup.js'],
  maxWorkers: 1, // Run tests serially to avoid MCP session conflicts
  testPathIgnorePatterns: [
    '<rootDir>/custom-tests/',
    'custom-tests',
    // Live integration tests require a real CERNION_TOKEN and running MCP server.
    // Run them separately with: npm run test:live
    '<rootDir>/tests/assets.integration.test.js',
  ],
};
