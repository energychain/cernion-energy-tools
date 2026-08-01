const cliArgs = process.argv.slice(2);
const hasExplicitTestSelection = cliArgs.some((arg) => {
  if (typeof arg !== 'string') return false;
  if (arg.startsWith('-')) return false;
  return arg.trim().length > 0;
});

const globalCoverageThreshold = {
  global: {
    // Ramp-up milestone (v0.99.0): actual coverage as of this bump was
    // branches 65.92, functions 85.41, lines 82.87, statements 81.06 —
    // thresholds raised below that with headroom so incidental coverage
    // dips don't immediately break CI. Raise again next time actual
    // coverage comfortably clears these numbers.
    branches: 63,
    functions: 80,
    lines: 79,
    statements: 79,
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
