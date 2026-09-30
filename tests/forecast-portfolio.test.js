'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-tests-'));
process.env.FORECAST_PORTFOLIO_DATA_PATH = root;
const { preparePortfolio } = require('../src/forecast-portfolio');
const { savePortfolioDataset, loadPortfolioDatasets } = require('../src/forecast-portfolio-store');
const { executeForecast } = require('../src/forecast-evaluation-jobs');
const config = require('../tools/xlsx-forecast-test/portfolio-0700.json');
function dataset(id) {
  return {
    series_id: id,
    unit: 'kWh',
    timezone: 'UTC',
    period_from: '2024-12-01',
    period_until: '2025-01-03',
    values: Array.from({ length: 34 * 96 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2024, 11, 1) + i * 900000).toISOString(),
      value: 1,
    })),
  };
}
function payload() {
  return {
    datasets: [dataset('a'), dataset('b')],
    payload_fit_confirmed: true,
    configuration: {
      ...config,
      forecast_period_from: '2025-01-01',
      forecast_period_until: '2025-01-03',
    },
  };
}
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
test('portfolio snapshots are immutable, hash-checked and tenant scoped', () => {
  const a = dataset('a'),
    b = dataset('b');
  const first = savePortfolioDataset(a, { tenantId: 'one' }),
    second = savePortfolioDataset(b, { tenantId: 'one' });
  expect(savePortfolioDataset(a, { tenantId: 'one' }).dataset_id).toBe(first.dataset_id);
  expect(loadPortfolioDatasets([first.dataset_id, second.dataset_id], { tenantId: 'one' })).toEqual(
    [a, b]
  );
  expect(() =>
    loadPortfolioDatasets([first.dataset_id, second.dataset_id], { tenantId: 'two' })
  ).toThrow('unavailable');
  expect(() =>
    loadPortfolioDatasets([first.dataset_id, first.dataset_id], { tenantId: 'one' })
  ).toThrow('distinct');
});
test('new baseline rejects incompatible policy, duplicate IDs and incomplete actuals', () => {
  const p = payload();
  expect(preparePortfolio(p).series).toHaveLength(2);
  p.configuration.issue_time = '18:00';
  expect(() => preparePortfolio(p)).toThrow('07:00');
  p.configuration.issue_time = '07:00';
  p.datasets[1].series_id = 'a';
  expect(() => preparePortfolio(p)).toThrow('unique');
  p.datasets[1].series_id = 'b';
  p.datasets[1].values.pop();
  expect(() => preparePortfolio(p)).toThrow('Complete evaluation');
});
test('absent observations stay absent and availability is floored to next midnight', () => {
  const p = payload();
  p.datasets[0].values.shift();
  p.datasets[0].values[0].available_at = '2025-01-02T08:00:00Z';
  const prepared = preparePortfolio(p);
  expect(prepared.series[0].rows).toHaveLength(34 * 96 - 1);
  expect(prepared.series[0].rows[0][2]).toBe(Date.parse('2025-01-02T08:00:00Z'));
  expect(prepared.series[0].rows[1][2]).toBe(Date.parse('2024-12-02T00:00:00Z'));
});
test('portfolio subprocess timeout terminates the native process', async () => {
  const launcher = path.join(root, 'busy-python');
  const pidFile = path.join(root, 'pid');
  fs.writeFileSync(
    launcher,
    `#!/usr/bin/python3\nimport os,time\nopen(${JSON.stringify(pidFile)},'w').write(str(os.getpid()))\ntime.sleep(60)\n`,
    { mode: 0o700 }
  );
  process.env.FORECAST_PYTHON = launcher;
  try {
    await expect(executeForecast(payload(), {}, null, { timeoutMs: 300 })).rejects.toThrow(
      'forecast_timeout'
    );
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    delete process.env.FORECAST_PYTHON;
  }
});
test('missing Python executable becomes a terminal error', async () => {
  process.env.FORECAST_PYTHON = path.join(root, 'absent-python');
  try {
    await expect(executeForecast(payload(), {}, null)).rejects.toThrow('ENOENT');
  } finally {
    delete process.env.FORECAST_PYTHON;
  }
});
test('oversized worker output fails the job without crashing the broker', async () => {
  const launcher = path.join(root, 'oversized-python');
  fs.writeFileSync(
    launcher,
    '#!/usr/bin/python3\nimport sys\nsys.stdin.read()\nsys.stdout.write("x" * (9*1024*1024))\nsys.stdout.flush()\n',
    { mode: 0o700 }
  );
  process.env.FORECAST_PYTHON = launcher;
  try {
    await expect(executeForecast(payload(), {}, null)).rejects.toThrow('message_too_large');
  } finally {
    delete process.env.FORECAST_PYTHON;
  }
});
