'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(async () => undefined) }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runLargeStructure } = require('./helpers/project-structure-large');

test('generated streaming CSV has correct aggregates with a fixed memory budget (CI reduced)', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-885-ci-'));
  const env = { ...process.env };
  process.env.JOB_STORE_DIR = path.join(directory, 'jobs');
  try {
    const result = await runLargeStructure(
      directory,
      Number(process.env.CET_PROJECT_LARGE_ROWS || 5000)
    );
    expect(result.sum).toBe((result.rows * (result.rows + 1)) / 2);
    expect(result.maxBatchRows).toBeLessThanOrEqual(1000);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    process.env = env;
  }
}, 120000);
