/**
 * Web Search Service Tests
 *
 * Unit tests for the corrently.cloud web search microservice.
 * Axios is mocked – no live network calls.
 */

const { ServiceBroker } = require('moleculer');

jest.mock('axios');
const axios = require('axios');

const WebSearchService = require('../services/web-search.service');

describe('Web Search Service', () => {
  let broker;

  beforeAll(() => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(WebSearchService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('validation', () => {
    it('should require the query parameter', async () => {
      await expect(broker.call('web-search.query', {})).rejects.toThrow();
    });

    it('should reject an empty query string', async () => {
      await expect(broker.call('web-search.query', { query: '' })).rejects.toThrow();
    });

    it('should reject numResults above maximum (20)', async () => {
      await expect(
        broker.call('web-search.query', { query: 'test', numResults: 25 })
      ).rejects.toThrow();
    });

    it('should reject numResults below minimum (1)', async () => {
      await expect(
        broker.call('web-search.query', { query: 'test', numResults: 0 })
      ).rejects.toThrow();
    });
  });

  describe('successful search', () => {
    it('should return structured results on success', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          results: [
            { title: 'Result 1', url: 'https://example.com/1', content: 'Snippet 1' },
            { title: 'Result 2', url: 'https://example.com/2', content: 'Snippet 2' },
          ],
        },
      });

      const result = await broker.call('web-search.query', {
        query: 'Stadtwerke Heidelberg',
        numResults: 2,
      });

      expect(result.success).toBe(true);
      expect(result.data.query).toBe('Stadtwerke Heidelberg');
      expect(result.data.results).toHaveLength(2);
      expect(result.data.results[0].title).toBe('Result 1');
      expect(result.data.results[0].url).toBe('https://example.com/1');
      expect(result.data.results[0].snippet).toBe('Snippet 1');
    });

    it('should call corrently.cloud with correct URL and params', async () => {
      axios.get.mockResolvedValueOnce({ data: { results: [] } });

      await broker.call('web-search.query', {
        query: 'TWL Netze Netzausbau',
        language: 'de',
        numResults: 5,
      });

      expect(axios.get).toHaveBeenCalledWith(
        'https://search.corrently.cloud/search',
        expect.objectContaining({
          params: expect.objectContaining({
            q: 'TWL Netze Netzausbau',
            format: 'json',
            language: 'de',
            pageno: 1,
          }),
        })
      );
    });

    it('should limit results to numResults even if API returns more', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `Result ${i + 1}`,
            url: `https://example.com/${i + 1}`,
            content: `Snippet ${i + 1}`,
          })),
        },
      });

      const result = await broker.call('web-search.query', { query: 'test', numResults: 3 });

      expect(result.data.results).toHaveLength(3);
      expect(result.data.total).toBe(3);
    });

    it('should use "de" as default language', async () => {
      axios.get.mockResolvedValueOnce({ data: { results: [] } });

      await broker.call('web-search.query', { query: 'Energieversorger' });

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ language: 'de' }),
        })
      );
    });

    it('should handle API returning no results array', async () => {
      axios.get.mockResolvedValueOnce({ data: {} });

      const result = await broker.call('web-search.query', { query: 'obscure query' });

      expect(result.success).toBe(true);
      expect(result.data.results).toEqual([]);
      expect(result.data.total).toBe(0);
    });

    it('should map snippet from "snippet" field if "content" is absent', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          results: [{ title: 'T', url: 'https://x.com', snippet: 'from snippet field' }],
        },
      });

      const result = await broker.call('web-search.query', { query: 'test' });

      expect(result.data.results[0].snippet).toBe('from snippet field');
    });
  });

  describe('error handling', () => {
    it('should return success:false and empty results on network error', async () => {
      axios.get.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await broker.call('web-search.query', { query: 'failing query' });

      expect(result.success).toBe(false);
      expect(result.data.results).toEqual([]);
      expect(result.error).toBeDefined();
    });

    it('should not throw on network error (graceful degradation)', async () => {
      axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        broker.call('web-search.query', { query: 'another failing query' })
      ).resolves.toBeDefined();
    });
  });
});
