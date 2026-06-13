const path = require('path');
const os = require('os');
const fs = require('fs');
const { ServiceBroker } = require('moleculer');
const FileIngestMonitorService = require('../services/file-ingest-monitor.service');

describe('file-ingest-monitor service', () => {
  let broker;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fim-test-'));

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...FileIngestMonitorService,
      settings: {
        ...FileIngestMonitorService.settings,
        dbPath: path.join(os.tmpdir(), `fim-test-db-${Date.now()}`),
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    // cleanup tmpDir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  const defaultMeta = { tenantId: 'test-tenant' };

  // ── Schema registry ─────────────────────────────────────────────────────

  test('createSchema and retrieve it', async () => {
    const schema = await broker.call(
      'file-ingest-monitor.createSchema',
      {
        name: 'Test Schema',
        delimiter: ';',
        encoding: 'utf-8',
        requiredColumns: ['col_a', 'col_b'],
        version: '1.0.0',
      },
      { meta: defaultMeta }
    );

    expect(schema._id).toBeTruthy();
    expect(schema.name).toBe('Test Schema');
    expect(schema.delimiter).toBe(';');
    expect(schema.requiredColumns).toEqual(['col_a', 'col_b']);

    const fetched = await broker.call(
      'file-ingest-monitor.getSchema',
      { schemaId: schema._id },
      { meta: defaultMeta }
    );
    expect(fetched._id).toBe(schema._id);
  });

  // ── Monitor: path does not exist ─────────────────────────────────────────

  test('createMonitor with non-existent watchPath → scan returns red/FIM_FILE_MISSING', async () => {
    const monitor = await broker.call(
      'file-ingest-monitor.createMonitor',
      {
        name: 'Missing Path Monitor',
        watchPath: '/nonexistent/path/that/does/not/exist',
      },
      { meta: defaultMeta }
    );

    expect(monitor._id).toBeTruthy();

    const scanResult = await broker.call(
      'file-ingest-monitor.scan',
      { id: monitor._id },
      { meta: defaultMeta }
    );

    expect(scanResult.status).toBe('red');
    expect(scanResult.findings.some((f) => f.finding === 'FIM_FILE_MISSING')).toBe(true);
  });

  // ── Monitor: existing path → green ───────────────────────────────────────

  test('createMonitor with existing watchPath → scan returns green/FIM_MONITOR_HEALTHY', async () => {
    // Create a file in tmpDir
    fs.writeFileSync(path.join(tmpDir, 'healthy.csv'), 'col_a,col_b\nval1,val2\n');

    const monitor = await broker.call(
      'file-ingest-monitor.createMonitor',
      {
        name: 'Healthy Monitor',
        watchPath: tmpDir,
        stalenessWindowMinutes: 60,
      },
      { meta: defaultMeta }
    );

    const scanResult = await broker.call(
      'file-ingest-monitor.scan',
      { id: monitor._id },
      { meta: defaultMeta }
    );

    expect(scanResult.status).toBe('green');
    expect(scanResult.findings.some((f) => f.finding === 'FIM_MONITOR_HEALTHY')).toBe(true);
    expect(scanResult.files.length).toBeGreaterThan(0);
  });

  // ── Monitor: stale detection ──────────────────────────────────────────────

  test('scan detects stale file (stalenessWindowMinutes set to 1 with old mtime)', async () => {
    const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fim-stale-'));
    try {
      const staleFilePath = path.join(staleDir, 'stale.csv');
      fs.writeFileSync(staleFilePath, 'a,b\n1,2\n');
      // Set mtime to 2 hours ago to ensure it is stale for a 1-minute window
      const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
      fs.utimesSync(staleFilePath, twoHoursAgo, twoHoursAgo);

      const monitor = await broker.call(
        'file-ingest-monitor.createMonitor',
        {
          name: 'Stale Monitor',
          watchPath: staleDir,
          stalenessWindowMinutes: 1, // file is 2h old → stale
        },
        { meta: defaultMeta }
      );

      const scanResult = await broker.call(
        'file-ingest-monitor.scan',
        { id: monitor._id },
        { meta: defaultMeta }
      );

      expect(scanResult.findings.some((f) => f.finding === 'FIM_FILE_STALE')).toBe(true);
    } finally {
      fs.rmSync(staleDir, { recursive: true, force: true });
    }
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  test('getStatus returns status summary after scan', async () => {
    const monitor = await broker.call(
      'file-ingest-monitor.createMonitor',
      {
        name: 'Status Test Monitor',
        watchPath: tmpDir,
      },
      { meta: defaultMeta }
    );

    await broker.call('file-ingest-monitor.scan', { id: monitor._id }, { meta: defaultMeta });

    const status = await broker.call(
      'file-ingest-monitor.getStatus',
      { id: monitor._id },
      { meta: defaultMeta }
    );

    expect(status.monitorId).toBe(monitor._id);
    expect(['green', 'yellow', 'red']).toContain(status.status);
    expect(status.findingsSummary).toBeTruthy();
  });

  // ── getFiles ──────────────────────────────────────────────────────────────

  test('getFiles returns file list from last scan', async () => {
    const monitor = await broker.call(
      'file-ingest-monitor.createMonitor',
      {
        name: 'Files Test Monitor',
        watchPath: tmpDir,
      },
      { meta: defaultMeta }
    );

    await broker.call('file-ingest-monitor.scan', { id: monitor._id }, { meta: defaultMeta });

    const result = await broker.call(
      'file-ingest-monitor.getFiles',
      { id: monitor._id },
      { meta: defaultMeta }
    );

    expect(result.monitorId).toBe(monitor._id);
    expect(Array.isArray(result.files)).toBe(true);
  });

  // ── getFindings ───────────────────────────────────────────────────────────

  test('getFindings returns findings from last scan', async () => {
    const monitor = await broker.call(
      'file-ingest-monitor.createMonitor',
      {
        name: 'Findings Test Monitor',
        watchPath: '/nonexistent/definitely/absent',
      },
      { meta: defaultMeta }
    );

    await broker.call('file-ingest-monitor.scan', { id: monitor._id }, { meta: defaultMeta });

    const result = await broker.call(
      'file-ingest-monitor.getFindings',
      { id: monitor._id },
      { meta: defaultMeta }
    );

    expect(result.monitorId).toBe(monitor._id);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.findings.some((f) => f.finding === 'FIM_FILE_MISSING')).toBe(true);
  });

  // ── listMonitors and deleteMonitor ────────────────────────────────────────

  test('listMonitors and deleteMonitor', async () => {
    const monitor = await broker.call(
      'file-ingest-monitor.createMonitor',
      {
        name: 'To Delete Monitor',
        watchPath: tmpDir,
      },
      { meta: defaultMeta }
    );

    const list = await broker.call('file-ingest-monitor.listMonitors', {}, { meta: defaultMeta });
    expect(list.monitors.some((m) => m._id === monitor._id)).toBe(true);

    const del = await broker.call(
      'file-ingest-monitor.deleteMonitor',
      { id: monitor._id },
      { meta: defaultMeta }
    );
    expect(del.success).toBe(true);

    const list2 = await broker.call('file-ingest-monitor.listMonitors', {}, { meta: defaultMeta });
    expect(list2.monitors.some((m) => m._id === monitor._id)).toBe(false);
  });

  // ── Schema validation: required columns missing ───────────────────────────

  test('schema validation: FIM_REQUIRED_COLUMNS_MISSING for missing required column', async () => {
    const csvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fim-csv-'));
    try {
      // CSV has only col_a, schema requires col_a and col_b
      fs.writeFileSync(path.join(csvDir, 'data.csv'), 'col_a\nval1\n');

      const schema = await broker.call(
        'file-ingest-monitor.createSchema',
        {
          name: 'Two Column Schema',
          delimiter: ',',
          requiredColumns: ['col_a', 'col_b'],
        },
        { meta: defaultMeta }
      );

      const monitor = await broker.call(
        'file-ingest-monitor.createMonitor',
        {
          name: 'Schema Validation Monitor',
          watchPath: csvDir,
          schemaId: schema._id,
          stalenessWindowMinutes: 60,
        },
        { meta: defaultMeta }
      );

      const scanResult = await broker.call(
        'file-ingest-monitor.scan',
        { id: monitor._id },
        { meta: defaultMeta }
      );

      expect(scanResult.findings.some((f) => f.finding === 'FIM_REQUIRED_COLUMNS_MISSING')).toBe(
        true
      );
    } finally {
      fs.rmSync(csvDir, { recursive: true, force: true });
    }
  });
});
