'use strict';

const path = require('path');
const { buildGasGraphFromScigrid } = require('../../tools/gas_layer_ingest');

// Regression test for the duplicate-parallel-edge crash found in t_bb242caf,
// which only manifests on the full-scale real SciGRID_gas export (5009
// nodes / 6526 raw edges), not the small offline sample fixture.
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures_real');

describe('buildGasGraphFromScigrid (real IGGIELGNC-3 fixture)', () => {
  test('ingests the full-scale export without throwing and yields graph.order === 5009', () => {
    let result;
    expect(() => {
      result = buildGasGraphFromScigrid({
        nodesPath: path.join(FIXTURES_DIR, 'IGGIELGNC3_Nodes.csv'),
        edgesPath: path.join(FIXTURES_DIR, 'IGGIELGNC3_PipeSegments.csv'),
        projectId: 'test-project-gas-real-fixture',
      });
    }).not.toThrow();

    expect(result.graph.order).toBe(5009);
  });
});
