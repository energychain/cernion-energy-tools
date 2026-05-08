const cliArgs = process.argv.slice(2);
const hasExplicitTestSelection = cliArgs.some((arg) => {
  if (typeof arg !== 'string') return false;
  if (arg.startsWith('-')) return false;
  return arg.trim().length > 0;
});

const globalCoverageThreshold = {
  global: {
    // Maintenance milestone (v0.13.1): enacted N+1 ramp-up.
    // Next target (v0.14+): branches 65, functions 78, lines 78, statements 78.
    branches: 60,
    functions: 75,
    lines: 75,
    statements: 75,
  },
};

module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    'services/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!services/api.service.js',
  ],
  // Keep strict global gates for full-suite runs, but avoid false failures
  // for explicitly selected subset runs (e.g. single service test files).
  ...(hasExplicitTestSelection ? {} : { coverageThreshold: globalCoverageThreshold }),
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
