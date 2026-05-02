'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const SlpService = require('../services/slp.service');

function createTempDir() {
  return path.join(os.tmpdir(), `slp-service-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe('slp.service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = createTempDir();
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      ...SlpService,
      settings: {
        ...SlpService.settings,
        dbPath,
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('listProfiles: enthält H0, G0, L0', async () => {
    const res = await broker.call('slp.listProfiles');
    const ids = res.profiles.map((p) => p.id);

    expect(ids).toContain('H0');
    expect(ids).toContain('G0');
    expect(ids).toContain('L0');
  });

  it('getProfile H0: gibt 96 Werte zurück', async () => {
    const res = await broker.call('slp.getProfile', {
      profileId: 'H0',
      date: '2026-01-14',
    });

    expect(res.values).toHaveLength(96);
  });

  it('getProfile H0 Winter Weekday: Abendspitze höher als Nacht', async () => {
    const res = await broker.call('slp.getProfile', {
      profileId: 'H0',
      date: '2026-01-14',
    });

    const evening = res.values.slice(68, 85).reduce((sum, value) => sum + value, 0);
    const night = res.values.slice(0, 25).reduce((sum, value) => sum + value, 0);

    expect(evening).toBeGreaterThan(night);
  });

  it('getProfile: 404 für unbekanntes Profil', async () => {
    await expect(
      broker.call('slp.getProfile', {
        profileId: 'UNKNOWN_PROFILE',
      })
    ).rejects.toMatchObject({ code: 404 });
  });

  it('generateTimeseries: 96 Werte', async () => {
    const res = await broker.call('slp.generateTimeseries', {
      profileId: 'H0',
      date: '2026-01-14',
      annualConsumptionKwh: 3650,
    });

    expect(res.values).toHaveLength(96);
  });

  it('generateTimeseries: Summe ≈ Tagesverbrauch', async () => {
    const annualConsumptionKwh = 3650;
    const res = await broker.call('slp.generateTimeseries', {
      profileId: 'H0',
      date: '2026-01-14',
      annualConsumptionKwh,
    });

    const target = annualConsumptionKwh / 365;
    expect(res.totalKwh).toBeGreaterThan(target * 0.8);
    expect(res.totalKwh).toBeLessThan(target * 1.2);
  });

  it('generateTimeseries: peakKw > 0', async () => {
    const res = await broker.call('slp.generateTimeseries', {
      profileId: 'G0',
      date: '2026-06-11',
      annualConsumptionKwh: 10000,
    });

    expect(res.peakKw).toBeGreaterThan(0);
  });

  it('createCustomProfile: erstellt und lädt Custom-Profil', async () => {
    const values = new Array(96).fill(1 / 96);

    const created = await broker.call('slp.createCustomProfile', {
      profileId: 'custom_muster_001',
      name: 'Nachtspeicher-Profil Muster',
      baseProfile: 'H0',
      season: 'all',
      dayType: 'all',
      values,
      owner: 'Stadtwerke Beispiel',
    });

    expect(created.success).toBe(true);

    const loaded = await broker.call('slp.getProfile', {
      profileId: 'custom_muster_001',
    });

    expect(loaded.values).toHaveLength(96);
  });

  it('deleteCustomProfile: gelöscht', async () => {
    const deleted = await broker.call('slp.deleteCustomProfile', {
      profileId: 'custom_muster_001',
    });

    expect(deleted.deleted).toBe(true);
  });

  it('deleteCustomProfile: Standard-Profil H0 nicht löschbar', async () => {
    await expect(
      broker.call('slp.deleteCustomProfile', {
        profileId: 'H0',
      })
    ).rejects.toMatchObject({ code: 400 });
  });
});
