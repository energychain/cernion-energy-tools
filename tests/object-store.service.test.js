'use strict';

/**
 * tests/object-store.service.test.js
 * Unit tests for the generic Object Store microservice.
 *
 * Coverage targets:
 *  - put (create): response shape, PouchDB internals stripped
 *  - put (update): payload replaced, createdAt preserved, updatedAt advances
 *  - get: retrieval, 404 for non-existent
 *  - delete: removes doc, follow-up get returns 404, delete of ghost returns 404
 *  - query: empty selector returns all docs in namespace, payload-field filter,
 *            limit, skip, cross-namespace isolation, namespace escape prevention
 *  - namespace isolation: same key in different namespaces is a different document
 *  - compound keys: keys containing colons round-trip correctly
 */

const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');

describe('Object Store Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: `./data/object-store-test-${Date.now()}`,
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  // ─── put ─────────────────────────────────────────────────────────────────────

  describe('put', () => {
    it('creates a document and returns it with clean metadata (no PouchDB internals)', async () => {
      const result = await broker.call('object-store.put', {
        namespace: 'test_ns',
        key: 'create1',
        payload: { title: 'Hello', count: 42 },
      });

      expect(result.namespace).toBe('test_ns');
      expect(result.key).toBe('create1');
      expect(result.payload).toEqual({ title: 'Hello', count: 42 });
      expect(typeof result.createdAt).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
      // PouchDB internals must be absent
      expect(result._id).toBeUndefined();
      expect(result._rev).toBeUndefined();
      expect(result._ns).toBeUndefined();
    });

    it('updates an existing document: payload replaced, createdAt preserved, updatedAt advances', async () => {
      await broker.call('object-store.put', {
        namespace: 'test_ns',
        key: 'upsert1',
        payload: { version: 1 },
      });
      const v1 = await broker.call('object-store.get', { namespace: 'test_ns', key: 'upsert1' });

      // Ensure at least 1 ms passes so ISO timestamps differ
      await new Promise((r) => setTimeout(r, 5));

      const v2 = await broker.call('object-store.put', {
        namespace: 'test_ns',
        key: 'upsert1',
        payload: { version: 2 },
      });

      expect(v2.payload.version).toBe(2);
      expect(v2.createdAt).toBe(v1.createdAt);    // preserved
      expect(v2.updatedAt >= v1.updatedAt).toBe(true); // advanced
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('retrieves an existing document', async () => {
      await broker.call('object-store.put', {
        namespace: 'test_ns',
        key: 'get1',
        payload: { data: 'value' },
      });
      const result = await broker.call('object-store.get', { namespace: 'test_ns', key: 'get1' });

      expect(result.namespace).toBe('test_ns');
      expect(result.key).toBe('get1');
      expect(result.payload.data).toBe('value');
    });

    it('returns 404 OBJECT_NOT_FOUND for a non-existent document', async () => {
      await expect(
        broker.call('object-store.get', { namespace: 'test_ns', key: 'does_not_exist' })
      ).rejects.toMatchObject({ code: 404, type: 'OBJECT_NOT_FOUND' });
    });
  });

  // ─── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes a document and subsequent get returns 404', async () => {
      await broker.call('object-store.put', {
        namespace: 'test_ns',
        key: 'del1',
        payload: { temp: true },
      });

      const result = await broker.call('object-store.delete', { namespace: 'test_ns', key: 'del1' });
      expect(result).toEqual({ success: true, namespace: 'test_ns', key: 'del1' });

      await expect(
        broker.call('object-store.get', { namespace: 'test_ns', key: 'del1' })
      ).rejects.toMatchObject({ code: 404, type: 'OBJECT_NOT_FOUND' });
    });

    it('returns 404 OBJECT_NOT_FOUND when deleting a non-existent document', async () => {
      await expect(
        broker.call('object-store.delete', { namespace: 'test_ns', key: 'ghost_key' })
      ).rejects.toMatchObject({ code: 404, type: 'OBJECT_NOT_FOUND' });
    });
  });

  // ─── query ──────────────────────────────────────────────────────────────────

  describe('query', () => {
    // Seed test data once for all query tests
    beforeAll(async () => {
      await broker.call('object-store.put', {
        namespace: 'query_ns',
        key: 'q1',
        payload: { status: 'active', priority: 1 },
      });
      await broker.call('object-store.put', {
        namespace: 'query_ns',
        key: 'q2',
        payload: { status: 'active', priority: 2 },
      });
      await broker.call('object-store.put', {
        namespace: 'query_ns',
        key: 'q3',
        payload: { status: 'inactive', priority: 3 },
      });
      // Different namespace — must never appear in query_ns results
      await broker.call('object-store.put', {
        namespace: 'other_ns',
        key: 'o1',
        payload: { status: 'active', priority: 99 },
      });
    });

    it('empty selector returns all documents in the namespace', async () => {
      const result = await broker.call('object-store.query', { namespace: 'query_ns', selector: {} });
      expect(result.totalDocs).toBe(3);
      expect(result.docs.every((d) => d.namespace === 'query_ns')).toBe(true);
    });

    it('filters by payload field using Mango selector', async () => {
      const result = await broker.call('object-store.query', {
        namespace: 'query_ns',
        selector: { 'payload.status': 'active' },
      });
      expect(result.totalDocs).toBe(2);
      expect(result.docs.every((d) => d.payload.status === 'active')).toBe(true);
    });

    it('respects the limit parameter', async () => {
      const result = await broker.call('object-store.query', {
        namespace: 'query_ns',
        selector: {},
        limit: 1,
      });
      expect(result.docs).toHaveLength(1);
    });

    it('respects the skip parameter', async () => {
      const all     = await broker.call('object-store.query', { namespace: 'query_ns', selector: {} });
      const skipped = await broker.call('object-store.query', { namespace: 'query_ns', selector: {}, skip: 1 });
      expect(skipped.totalDocs).toBe(all.totalDocs - 1);
    });

    it('enforces namespace isolation — other_ns docs (priority 99) never appear', async () => {
      const result = await broker.call('object-store.query', {
        namespace: 'query_ns',
        selector: { 'payload.priority': { $gte: 90 } },
      });
      expect(result.totalDocs).toBe(0);
    });

    it('namespace escape via ns override in selector is silently blocked', async () => {
      // Caller tries to read other_ns by injecting ns into the selector.
      // Our handler overwrites it with the path-param namespace — must return query_ns docs.
      const result = await broker.call('object-store.query', {
        namespace: 'query_ns',
        selector: { ns: 'other_ns' },
      });
      expect(result.totalDocs).toBe(3);                                  // all query_ns docs
      expect(result.docs.every((d) => d.namespace === 'query_ns')).toBe(true);
      expect(result.docs.find((d) => d.payload && d.payload.priority === 99)).toBeUndefined();
    });
  });

  // ─── namespace isolation ────────────────────────────────────────────────────

  describe('namespace isolation', () => {
    it('same key in different namespaces is a separate document', async () => {
      await broker.call('object-store.put', {
        namespace: 'ns_a',
        key: 'shared_key',
        payload: { source: 'A' },
      });
      // ns_b/shared_key must not exist
      await expect(
        broker.call('object-store.get', { namespace: 'ns_b', key: 'shared_key' })
      ).rejects.toMatchObject({ code: 404, type: 'OBJECT_NOT_FOUND' });

      // ns_a/shared_key is unaffected
      const doc = await broker.call('object-store.get', { namespace: 'ns_a', key: 'shared_key' });
      expect(doc.payload.source).toBe('A');
    });
  });

  // ─── compound keys ──────────────────────────────────────────────────────────

  describe('compound keys', () => {
    it('keys containing colons are stored and retrieved correctly', async () => {
      await broker.call('object-store.put', {
        namespace: 'test_ns',
        key: 'project:sub:abc123',
        payload: { nested: true },
      });
      const result = await broker.call('object-store.get', {
        namespace: 'test_ns',
        key: 'project:sub:abc123',
      });
      expect(result.namespace).toBe('test_ns');
      expect(result.key).toBe('project:sub:abc123');
      expect(result.payload.nested).toBe(true);
    });
  });

});
