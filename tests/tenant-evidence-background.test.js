'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { minimalDescriptor } = require('../src/tenant-evidence-descriptor');
const {
  availableDescriptor,
  scheduleDescriptor,
  runDescriptorJob,
  stopDescriptorWorker,
} = require('../src/tenant-evidence-background');
let service;
const row = (id = 'doc-a') => ({
  id,
  tenantId: 'tenant-a',
  version: 1,
  hash: 'hash-a',
  name: 'Objekt Nord.txt',
  text: '# Objekt Nord\n## Stand\nSECRET-BODY 80 kg',
});
const generated = (source) => ({
  summary: { text: 'Archivierte Grundlage', sources: [source] },
  entities: [],
  timeRanges: [],
  externalLinks: [],
  questionTypes: [
    {
      id: 'read',
      description: 'Belegten Stand einordnen',
      inputs: [],
      skillRefs: [],
      sources: [source],
    },
  ],
});
beforeEach(() => {
  service = { settings: {}, logger: { warn: jest.fn() } };
  llm.generateStructured
    .mockReset()
    .mockImplementation(async (_schema, raw) => generated(JSON.parse(raw).nodes[0].nodeId));
});
afterEach(async () => stopDescriptorWorker(service));

test('immediate minimum is usable; enrichment is coalesced, bounded, metadata-only and persists later', async () => {
  const value = row();
  value.evidenceDescriptor = availableDescriptor('document', value);
  expect(value.evidenceDescriptor.manifest.questionTypes.length).toBeGreaterThan(0);
  const oldPersist = jest.fn(),
    persist = jest.fn();
  scheduleDescriptor(service, 'document', value, oldPersist);
  scheduleDescriptor(service, 'document', structuredClone(value), persist);
  expect(service.evidenceWorker.pending.size).toBe(1);
  expect(llm.generateStructured).not.toHaveBeenCalled();
  await runDescriptorJob(service);
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  const [, raw, options] = llm.generateStructured.mock.calls[0];
  expect(raw).toContain('Stand');
  expect(raw).not.toContain('SECRET-BODY');
  expect(options).toMatchObject({
    maxTokens: 1200,
    timeoutMs: 5000,
    maxRetries: 0,
    transientRecovery: false,
  });
  expect(oldPersist).not.toHaveBeenCalled();
  expect(persist).toHaveBeenCalledWith(
    expect.objectContaining({
      fingerprint: value.evidenceDescriptor.fingerprint,
      generation: expect.objectContaining({ attempts: 1 }),
    })
  );
});

test('a slow enrichment never blocks scheduling or a minimum read; shutdown awaits only the active job', async () => {
  let finish;
  llm.generateStructured.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const value = row();
  value.evidenceDescriptor = minimalDescriptor('document', value);
  const persist = jest.fn();
  scheduleDescriptor(service, 'document', value, persist);
  const work = runDescriptorJob(service);
  expect(availableDescriptor('document', value)).toBe(value.evidenceDescriptor);
  scheduleDescriptor(
    service,
    'document',
    { ...row('doc-b'), evidenceDescriptor: minimalDescriptor('document', row('doc-b')) },
    persist
  );
  const stop = stopDescriptorWorker(service);
  finish(generated('document:doc-a'));
  await Promise.all([work, stop]);
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  expect(service.evidenceWorker.pending.size).toBe(0);
});

test('invalid output spends one bounded attempt and preserves the minimum; generated metadata survives stale writes', async () => {
  const value = row();
  value.evidenceDescriptor = minimalDescriptor('document', value);
  llm.generateStructured.mockResolvedValue({ invalid: true });
  let saved;
  scheduleDescriptor(service, 'document', value, async (enriched) => {
    saved = enriched;
  });
  await runDescriptorJob(service);
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  expect(saved.generation.fallback).toBe(true);
  expect(saved.manifest.summary.text).toBe(value.name);
  expect(availableDescriptor('document', value, { ...value, evidenceDescriptor: saved })).toBe(
    saved
  );
});

test('queue is bounded and shutdown cancels unstarted model calls', async () => {
  for (let id = 0; id < 70; id++)
    scheduleDescriptor(service, 'document', row(`doc-${id}`), jest.fn());
  expect(service.evidenceWorker.pending.size).toBe(64);
  await stopDescriptorWorker(service);
  expect(llm.generateStructured).not.toHaveBeenCalled();
  expect(service.evidenceWorker.pending.size).toBe(0);
});

test('oversized projected metadata stays minimal without scheduling a model request', () => {
  const value = {
    ...row(),
    text: Array.from({ length: 32 }, (_, index) => `## Thema ${index} ${'x'.repeat(900)}`).join(
      '\n'
    ),
  };
  value.evidenceDescriptor = minimalDescriptor('document', value);
  scheduleDescriptor(service, 'document', value, jest.fn());
  expect(value.evidenceDescriptor.manifest).toBeTruthy();
  expect(service.evidenceWorker.pending.size).toBe(0);
  expect(llm.generateStructured).not.toHaveBeenCalled();
});
