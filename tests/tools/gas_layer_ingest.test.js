'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { buildGasGraphFromScigrid } = require('../../tools/gas_layer_ingest');

// Regression test for the duplicate-parallel-edge crash found in t_bb242caf,
// which only manifests on the full-scale real SciGRID_gas export (5009
// nodes / 6526 raw edges), not the small offline sample fixture.
//
// The real IGGIELGNC-3 fixture CSVs use a different (semicolon-delimited,
// route-per-row) schema than scigrid_gas_to_znp.py expects. Rather than
// making the ingest pipeline schema-tolerant, we run them through
// tools/convert_iggielgnc_fixture.py first (see t_0b08c1a1), which maps them
// into the comma-delimited, one-edge-per-row shape the pipeline understands.
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures_real');
const CONVERTER_PATH = path.join(__dirname, '..', '..', 'tools', 'convert_iggielgnc_fixture.py');

describe('buildGasGraphFromScigrid (real IGGIELGNC-3 fixture)', () => {
  let tmpDir;
  let mappedNodesPath;
  let mappedEdgesPath;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iggielgnc3-'));
    mappedNodesPath = path.join(tmpDir, 'nodes_mapped.csv');
    mappedEdgesPath = path.join(tmpDir, 'edges_mapped.csv');

    execFileSync('python3', [
      CONVERTER_PATH,
      '--nodes', path.join(FIXTURES_DIR, 'IGGIELGNC3_Nodes.csv'),
      '--edges', path.join(FIXTURES_DIR, 'IGGIELGNC3_PipeSegments.csv'),
      '--out-nodes', mappedNodesPath,
      '--out-edges', mappedEdgesPath,
    ]);
  });

  afterAll(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('ingests the full-scale export without throwing and yields graph.order === 5009', () => {
    let result;
    expect(() => {
      result = buildGasGraphFromScigrid({
        nodesPath: mappedNodesPath,
        edgesPath: mappedEdgesPath,
        projectId: 'test-project-gas-real-fixture',
      });
    }).not.toThrow();

    expect(result.graph.order).toBe(5009);
  });
});
