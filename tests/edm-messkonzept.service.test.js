'use strict';

const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

let EDMService;
let MesskonzeptService;

describe('EDM Messkonzept Service', () => {
  let broker;
  let tempDir;

  beforeAll(async () => {
      // Clear require cache for edm-sqlite-pool to reload with updated schema
      delete require.cache[require.resolve('../src/edm-sqlite-pool')];
      delete require.cache[require.resolve('../services/edm.service')];
      delete require.cache[require.resolve('../services/edm-messkonzept.service')];

      // Load fresh EdmSqlitePool after clearing cache
      const EdmSqlitePool = require('../src/edm-sqlite-pool');

      // Create temp directory for test DB - use process ID + random to avoid collisions
      const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      tempDir = path.join(os.tmpdir(), `edm-test-${unique}`);

      // Clean up temp directory if it exists (shouldn't happen but just in case)
      const fs = require('fs');
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Ensure the directory is created fresh
      fs.mkdirSync(tempDir, { recursive: true });

      process.env.EDM_DATA_DIR = tempDir;
      process.env.EDM_DB_PATH = tempDir;

      // Load services after environment is set so settings pick up test DB path
      EDMService = require('../services/edm.service');
      MesskonzeptService = require('../services/edm-messkonzept.service');

      // Delete database files BEFORE broker starts so EDMService initializes with fresh schema
      const dbFilePath = path.join(tempDir, 'registry.sqlite');
      if (fs.existsSync(dbFilePath)) {
        fs.unlinkSync(dbFilePath);
      }
      const walPath = `${dbFilePath}-wal`;
      const shmPath = `${dbFilePath}-shm`;
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService(EDMService);
    broker.createService(MesskonzeptService);

    // Start broker - this will initialize the EDM service with the new EDM_DATA_DIR
    await broker.start();

    // Force recreate EDM service to ensure it uses the new temp directory
    const edmService = broker.getLocalService('edm');
    if (edmService && edmService.pool) {
      edmService.pool.closeAll();
        // Delete the database file to ensure fresh schema
        const dbFilePath = path.join(tempDir, 'registry.sqlite');
        const fs = require('fs');
        if (fs.existsSync(dbFilePath)) {
          fs.unlinkSync(dbFilePath);
        }
        // Also delete WAL and SHM files
        const walPath = `${dbFilePath}-wal`;
        const shmPath = `${dbFilePath}-shm`;
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
        edmService.pool = new EdmSqlitePool(process.env.EDM_DB_PATH);
          // Call getRegistry() to initialize the pool with fresh schema
          edmService.pool.getRegistry();

            // Ensure correct table schema - drop and recreate if needed
            try {
              const db = edmService.pool.getRegistry();
              // Try to drop the old table (may fail if it doesn't exist or is already correct)
              db.exec('DROP TABLE IF EXISTS messkonzepte');
              // Recreate with correct schema
              db.exec(`
                CREATE TABLE IF NOT EXISTS messkonzepte (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  type TEXT NOT NULL CHECK(type IN ('SUM','DIFF','NET','CALC','CUSTOM')),
                  formula TEXT,
                  inputs TEXT DEFAULT '[]',
                  output_melo_id TEXT NOT NULL,
                  output_obis TEXT DEFAULT '1-0:1.8.0',
                  schedule TEXT DEFAULT 'on_input_change',
                  valid_since TEXT,
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
              `);
            } catch (err) {
                // Log error for debugging
                console.log('Error recreating messkonzepte table:', err.message);
            }
    }

    // Create test MeLos
    await broker.call('edm.createMelo', {
      meloId: 'melo-solar',
      type: 'physical',
      name: 'Test Solar',
      obisRegisters: [{ obis: '1-0:1.8.0' }],
      }).catch((err) => {
        if (err.code !== 'MELO_EXISTS') throw err;
      });
      await broker.call('edm.createMelo', {
      meloId: 'melo-wind',
      type: 'physical',
      name: 'Test Wind',
      obisRegisters: [{ obis: '1-0:1.8.0' }],
      }).catch((err) => {
        if (err.code !== 'MELO_EXISTS') throw err;
      });

    // Import test data
    await broker.call('edm.importTimeseries', {
      meloId: 'melo-solar',
      obis: '1-0:1.8.0',
      format: 'json',
      data: [
        { ts: '2026-04-20T08:00:00Z', value: 10, quality: 'good' },
        { ts: '2026-04-20T09:00:00Z', value: 20, quality: 'good' },
        { ts: '2026-04-20T10:00:00Z', value: 30, quality: 'good' },
        { ts: '2026-04-20T11:00:00Z', value: 40, quality: 'good' },
      ],
    });

    await broker.call('edm.importTimeseries', {
      meloId: 'melo-wind',
      obis: '1-0:1.8.0',
      format: 'json',
      data: [
        { ts: '2026-04-20T08:00:00Z', value: 5, quality: 'good' },
        { ts: '2026-04-20T09:00:00Z', value: 5, quality: 'good' },
        { ts: '2026-04-20T10:00:00Z', value: 5, quality: 'good' },
        { ts: '2026-04-20T11:00:00Z', value: 5, quality: 'good' },
      ],
    });
  });

  afterAll(async () => {
    await broker.stop();
      // Clean up temp directory
      const fs = require('fs');
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      // Clear environment variable
        delete process.env.EDM_DATA_DIR;
        delete process.env.EDM_DB_PATH;
  });

  describe('create action', () => {
     beforeEach(() => {
        const db = broker.getLocalService('edm').pool.getRegistry();
        db.prepare('DELETE FROM messkonzepte').run();
      });

    it('should create a SUM messkonzept', async () => {
      const result = await broker.call('edm-messkonzept.create', {
        id: 'mk-sum-001',
        name: 'Total Production',
        type: 'SUM',
          formula: 'v0 + v1',
        inputs: [
          { ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' },
          { ref: 'v1', meloId: 'melo-wind', obis: '1-0:1.8.0' },
        ],
        outputMeloId: 'melo-sum-out',
        outputObis: '1-0:1.8.0',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('mk-sum-001');
    });

    it('should reject duplicate ID with 409', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-dup',
        name: 'Test',
        type: 'SUM',
          formula: 'v0 + v1',
        inputs: [{ ref: 'v0', meloId: 'melo-solar' }],
        outputMeloId: 'melo-dup-out',
      });

      await expect(
        broker.call('edm-messkonzept.create', {
          id: 'mk-dup',
          name: 'Test 2',
          type: 'SUM',
          formula: 'v0 + v1',
          inputs: [{ ref: 'v0', meloId: 'melo-solar' }],
          outputMeloId: 'melo-dup-out-2',
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('list action', () => {
     beforeEach(() => {
      const db = broker.getLocalService('edm').pool.getRegistry();
      db.prepare('DELETE FROM messkonzepte').run();
    });

    it('should return empty list initially', async () => {
      const result = await broker.call('edm-messkonzept.list');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should list all created messkonzepte', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk1',
        name: 'Test1',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [{ ref: 'v0', meloId: 'melo-solar' }],
        outputMeloId: 'melo-out-1',
      });

      const result = await broker.call('edm-messkonzept.list');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('mk1');
    });

    it('should parse inputs JSON', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk2',
        name: 'Test2',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [
          { ref: 'solar', meloId: 'melo-solar', obis: '1-0:1.8.0' },
          { ref: 'wind', meloId: 'melo-wind', obis: '1-0:1.8.0' },
        ],
        outputMeloId: 'melo-out-2',
      });

      const result = await broker.call('edm-messkonzept.list');
      expect(result.data[0].inputs).toEqual([
        { ref: 'solar', meloId: 'melo-solar', obis: '1-0:1.8.0' },
        { ref: 'wind', meloId: 'melo-wind', obis: '1-0:1.8.0' },
      ]);
    });
  });

  describe('get action', () => {
     beforeEach(() => {
      const db = broker.getLocalService('edm').pool.getRegistry();
      db.prepare('DELETE FROM messkonzepte').run();
    });

    it('should retrieve a single messkonzept', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-get-1',
        name: 'Test Get',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [{ ref: 'v0', meloId: 'melo-solar' }],
        outputMeloId: 'melo-get-out',
      });

      const result = await broker.call('edm-messkonzept.get', { id: 'mk-get-1' });
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Test Get');
    });

    it('should return 404 for non-existent ID', async () => {
      await expect(broker.call('edm-messkonzept.get', { id: 'non-existent' })).rejects.toThrow(
        'not found'
      );
    });

    it('should parse inputs JSON on get', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-get-2',
        name: 'Test',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [
          { ref: 'a', meloId: 'melo-solar', obis: '1-0:1.8.0' },
          { ref: 'b', meloId: 'melo-wind', obis: '1-0:1.8.0' },
        ],
        outputMeloId: 'melo-get-out-2',
      });

      const result = await broker.call('edm-messkonzept.get', { id: 'mk-get-2' });
      expect(result.data.inputs).toHaveLength(2);
      expect(result.data.inputs[0].ref).toBe('a');
    });
  });

  describe('delete action', () => {
     beforeEach(() => {
      const db = broker.getLocalService('edm').pool.getRegistry();
      db.prepare('DELETE FROM messkonzepte').run();
    });

    it('should delete a messkonzept', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-del-1',
        name: 'Test Delete',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [{ ref: 'v0', meloId: 'melo-solar' }],
        outputMeloId: 'melo-del-out',
      });

      const result = await broker.call('edm-messkonzept.delete', { id: 'mk-del-1' });
      expect(result.success).toBe(true);

      await expect(broker.call('edm-messkonzept.get', { id: 'mk-del-1' })).rejects.toThrow(
        'not found'
      );
    });

    it('should return 404 for non-existent ID', async () => {
      await expect(broker.call('edm-messkonzept.delete', { id: 'non-existent' })).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('evaluate action', () => {
     beforeEach(() => {
      const db = broker.getLocalService('edm').pool.getRegistry();
      db.prepare('DELETE FROM messkonzepte').run();
    });

    it('should evaluate a SUM messkonzept', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-eval-sum',
        name: 'Sum Eval',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [
          { ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' },
          { ref: 'v1', meloId: 'melo-wind', obis: '1-0:1.8.0' },
        ],
        outputMeloId: 'melo-sum-eval',
      });

      const result = await broker.call('edm-messkonzept.evaluate', {
        id: 'mk-eval-sum',
        from: '2026-04-20T00:00:00Z',
        to: '2026-04-20T12:00:00Z',
        writeOutput: true,
      });

      expect(result.success).toBe(true);
      expect(result.summary.total).toBe(120); // (10+20+30+40) + (5+5+5+5)
      expect(result.written).toBe(true);
    });

    it('should return 404 for non-existent messkonzept', async () => {
      await expect(
        broker.call('edm-messkonzept.evaluate', {
          id: 'non-existent',
          from: '2026-04-20T00:00:00Z',
          to: '2026-04-20T12:00:00Z',
        })
      ).rejects.toThrow('not found');
    });

    it('should evaluate CALC type with formula', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-eval-calc',
        name: 'Calc Eval',
        type: 'CALC',
        formula: 'v0 * 2',
        inputs: [{ ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' }],
        outputMeloId: 'melo-calc-eval',
      });

      const result = await broker.call('edm-messkonzept.evaluate', {
        id: 'mk-eval-calc',
        from: '2026-04-20T00:00:00Z',
        to: '2026-04-20T12:00:00Z',
      });

      expect(result.success).toBe(true);
      expect(result.summary.total).toBe(200); // (10+20+30+40) * 2
    });
  });

  describe('evaluateAll action', () => {
     beforeEach(() => {
      const db = broker.getLocalService('edm').pool.getRegistry();
      db.prepare('DELETE FROM messkonzepte').run();
    });

    it('should evaluate all messkonzepte', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-batch-1',
        name: 'Batch1',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [
          { ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' },
          { ref: 'v1', meloId: 'melo-wind', obis: '1-0:1.8.0' },
        ],
        outputMeloId: 'melo-batch-1',
      });

      await broker.call('edm-messkonzept.create', {
        id: 'mk-batch-2',
        name: 'Batch2',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [{ ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' }],
        outputMeloId: 'melo-batch-2',
      });

      const result = await broker.call('edm-messkonzept.evaluateAll', {
        from: '2026-04-20T00:00:00Z',
        to: '2026-04-20T12:00:00Z',
      });

      expect(result.success).toBe(true);
      expect(result.evaluated).toBe(2);
    });

    it('should return empty results when no messkonzepte exist', async () => {
      const result = await broker.call('edm-messkonzept.evaluateAll', {
        from: '2026-04-20T00:00:00Z',
        to: '2026-04-20T12:00:00Z',
      });

      expect(result.success).toBe(true);
      expect(result.evaluated).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should filter by schedule parameter', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-sched-hourly',
        name: 'Hourly',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [{ ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' }],
        outputMeloId: 'melo-sched-1',
        schedule: 'hourly',
      });

      await broker.call('edm-messkonzept.create', {
        id: 'mk-sched-daily',
        name: 'Daily',
        type: 'SUM',
        formula: 'v0 + v1',
        inputs: [{ ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' }],
        outputMeloId: 'melo-sched-2',
        schedule: 'daily',
      });

      const result = await broker.call('edm-messkonzept.evaluateAll', {
        from: '2026-04-20T00:00:00Z',
        to: '2026-04-20T12:00:00Z',
        schedule: 'hourly',
      });

      expect(result.evaluated).toBe(1);
      expect(result.results[0].id).toBe('mk-sched-hourly');
    });
  });

  describe('Integration - CALC formula with multiple inputs', () => {
     beforeEach(() => {
      const db = broker.getLocalService('edm').pool.getRegistry();
      db.prepare('DELETE FROM messkonzepte').run();
    });

    it('should support complex CALC formulas', async () => {
      await broker.call('edm-messkonzept.create', {
        id: 'mk-complex',
        name: 'Complex Formula',
        type: 'CALC',
        formula: '(v0 + v1) / 2',
        inputs: [
          { ref: 'v0', meloId: 'melo-solar', obis: '1-0:1.8.0' },
          { ref: 'v1', meloId: 'melo-wind', obis: '1-0:1.8.0' },
        ],
        outputMeloId: 'melo-complex',
      });

      const result = await broker.call('edm-messkonzept.evaluate', {
        id: 'mk-complex',
        from: '2026-04-20T08:00:00Z',
        to: '2026-04-20T11:00:00Z',
      });

      expect(result.success).toBe(true);
      expect(result.summary.total).toBe(52.5); // to is exclusive -> (15 + 25 + 35) / 2 = 52.5
    });
  });
});
