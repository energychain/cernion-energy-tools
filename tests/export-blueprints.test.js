'use strict';

jest.mock('axios');

const axios = require('axios');
const path = require('path');

const { exportBlueprints, fetchActiveBlueprintIds, fetchBlueprint, parseArgs } = require('../scripts/export-blueprints');

// Minimal fs stub: captures writeFileSync calls, no disk I/O
function makeFsStub() {
  const written = {};
  return {
    _written: written,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn((filePath, content) => {
      written[filePath] = content;
    }),
  };
}

const BLUEPRINT_A = { id: 'bp-alpha-v1', version: '1.0.0', meta: { title: 'Alpha' } };
const BLUEPRINT_B = { id: 'bp-beta-v1', version: '1.0.0', meta: { title: 'Beta' } };

describe('parseArgs', () => {
  it('returns defaults when no args given', () => {
    const { baseUrl, out } = parseArgs([]);
    expect(baseUrl).toBe('http://127.0.0.1:3900');
    expect(out).toBe('src/blueprints');
  });

  it('parses --base-url and --out', () => {
    const { baseUrl, out } = parseArgs(['--base-url', 'http://localhost:4000', '--out', '/tmp/bps']);
    expect(baseUrl).toBe('http://localhost:4000');
    expect(out).toBe('/tmp/bps');
  });
});

describe('fetchActiveBlueprintIds', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts IDs from an array response', async () => {
    axios.get.mockResolvedValueOnce({
      data: [{ blueprintId: 'bp-alpha-v1' }, { blueprintId: 'bp-beta-v1' }],
    });
    const ids = await fetchActiveBlueprintIds('http://127.0.0.1:3900');
    expect(ids).toEqual(['bp-alpha-v1', 'bp-beta-v1']);
    expect(axios.get).toHaveBeenCalledWith(
      'http://127.0.0.1:3900/api/blueprint-management?includeDrafts=false&includeActive=true',
      expect.objectContaining({ timeout: 15000 })
    );
  });

  it('extracts IDs from a { success, data, total } envelope (current API)', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, total: 2, data: [{ blueprintId: 'bp-alpha-v1' }, { blueprintId: 'bp-beta-v1' }] },
    });
    const ids = await fetchActiveBlueprintIds('http://127.0.0.1:3900');
    expect(ids).toEqual(['bp-alpha-v1', 'bp-beta-v1']);
  });

  it('extracts IDs from a { blueprints: [...] } envelope', async () => {
    axios.get.mockResolvedValueOnce({
      data: { blueprints: [{ blueprintId: 'bp-gamma-v1' }] },
    });
    const ids = await fetchActiveBlueprintIds('http://127.0.0.1:3900');
    expect(ids).toEqual(['bp-gamma-v1']);
  });

  it('returns empty array for empty list response', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });
    const ids = await fetchActiveBlueprintIds('http://127.0.0.1:3900');
    expect(ids).toEqual([]);
  });

  it('propagates HTTP errors', async () => {
    axios.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(fetchActiveBlueprintIds('http://127.0.0.1:3900')).rejects.toThrow('connect ECONNREFUSED');
  });
});

describe('fetchBlueprint', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the blueprint field from the response', async () => {
    axios.get.mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_A } });
    const result = await fetchBlueprint('http://127.0.0.1:3900', 'bp-alpha-v1');
    expect(result).toEqual(BLUEPRINT_A);
    expect(axios.get).toHaveBeenCalledWith(
      'http://127.0.0.1:3900/api/blueprint-management/bp-alpha-v1',
      expect.objectContaining({ timeout: 15000 })
    );
  });

  it('throws when blueprint field is missing', async () => {
    axios.get.mockResolvedValueOnce({ data: { status: 'active' } });
    await expect(fetchBlueprint('http://127.0.0.1:3900', 'bp-alpha-v1')).rejects.toThrow(
      "Response for 'bp-alpha-v1' has no 'blueprint' field"
    );
  });

  it('URL-encodes blueprint IDs with special characters', async () => {
    axios.get.mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_A } });
    await fetchBlueprint('http://127.0.0.1:3900', 'bp alpha/v1');
    expect(axios.get).toHaveBeenCalledWith(
      'http://127.0.0.1:3900/api/blueprint-management/bp%20alpha%2Fv1',
      expect.anything()
    );
  });
});

describe('exportBlueprints', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists blueprints, fetches each, and writes JSON files', async () => {
    axios.get
      .mockResolvedValueOnce({ data: [{ blueprintId: 'bp-alpha-v1' }, { blueprintId: 'bp-beta-v1' }] })
      .mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_A } })
      .mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_B } });

    const fsStub = makeFsStub();
    const result = await exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/bps', _fs: fsStub });

    expect(result.errors).toHaveLength(0);
    expect(result.written).toHaveLength(2);
    expect(result.written).toContain(path.join('/tmp/bps', 'bp-alpha-v1.json'));
    expect(result.written).toContain(path.join('/tmp/bps', 'bp-beta-v1.json'));
  });

  it('writes deterministic pretty-printed JSON with trailing newline', async () => {
    axios.get
      .mockResolvedValueOnce({ data: [{ blueprintId: 'bp-alpha-v1' }] })
      .mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_A } });

    const fsStub = makeFsStub();
    await exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/bps', _fs: fsStub });

    const filePath = path.join('/tmp/bps', 'bp-alpha-v1.json');
    const content = fsStub._written[filePath];
    expect(content).toBe(JSON.stringify(BLUEPRINT_A, null, 2) + '\n');
  });

  it('calls GET /:id for each active blueprint ID', async () => {
    axios.get
      .mockResolvedValueOnce({ data: [{ blueprintId: 'bp-alpha-v1' }, { blueprintId: 'bp-beta-v1' }] })
      .mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_A } })
      .mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_B } });

    const fsStub = makeFsStub();
    await exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/bps', _fs: fsStub });

    expect(axios.get).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3900/api/blueprint-management/bp-alpha-v1',
      expect.anything()
    );
    expect(axios.get).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:3900/api/blueprint-management/bp-beta-v1',
      expect.anything()
    );
  });

  it('records an error when blueprint field is missing and continues processing others', async () => {
    axios.get
      .mockResolvedValueOnce({ data: [{ blueprintId: 'bp-alpha-v1' }, { blueprintId: 'bp-beta-v1' }] })
      .mockResolvedValueOnce({ data: {} })                             // bp-alpha: no blueprint field
      .mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_B } });    // bp-beta: ok

    const fsStub = makeFsStub();
    const result = await exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/bps', _fs: fsStub });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('bp-alpha-v1');
    expect(result.errors[0].message).toMatch(/no 'blueprint' field/);
    expect(result.written).toHaveLength(1);
    expect(result.written[0]).toContain('bp-beta-v1.json');
  });

  it('records an error on HTTP failure for a single blueprint and continues', async () => {
    axios.get
      .mockResolvedValueOnce({ data: [{ blueprintId: 'bp-alpha-v1' }, { blueprintId: 'bp-beta-v1' }] })
      .mockRejectedValueOnce(new Error('Request failed with status code 500'))
      .mockResolvedValueOnce({ data: { blueprint: BLUEPRINT_B } });

    const fsStub = makeFsStub();
    const result = await exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/bps', _fs: fsStub });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('bp-alpha-v1');
    expect(result.written).toHaveLength(1);
  });

  it('throws (does not swallow) a total list-fetch failure', async () => {
    axios.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const fsStub = makeFsStub();
    await expect(
      exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/bps', _fs: fsStub })
    ).rejects.toThrow('Failed to list blueprints');
  });

  it('returns empty written array when no active blueprints exist', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });

    const fsStub = makeFsStub();
    const result = await exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/bps', _fs: fsStub });

    expect(result.written).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('creates the output directory if it does not exist', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });

    const fsStub = makeFsStub();
    await exportBlueprints({ baseUrl: 'http://127.0.0.1:3900', out: '/tmp/new-dir', _fs: fsStub });

    expect(fsStub.mkdirSync).toHaveBeenCalledWith('/tmp/new-dir', { recursive: true });
  });
});
