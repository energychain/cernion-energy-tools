'use strict';
const { documentAnchors } = require('../src/project-graph-anchors');
const { normalizeAnchor } = require('../src/tenant-memory-store');
const policy = require('../src/project-graph-policy');

const values = ['Alpha001', 'Bravo002', 'Delta003'];
const objects = [{ objectId: 'object-a', derivation: { version: '1' } }];
const candidates = values.map((value) => ({
  object_id: 'object-a',
  version: '1',
  value,
  location: '{}',
}));
function documents() {
  return ['section-a', 'section-b'].map((id) => ({
    id,
    provenance: { objectId: 'object-a' },
    sourceLocation: {},
  }));
}
test.each([
  [{ documentAnchors: 1 }, 2, 4, 2],
  [{ documentAnchorChars: 8 }, 2, 4, 2],
  [{ runAnchors: 2 }, 2, 4, 2],
  [{ runAnchorChars: 24 }, 3, 3, 1],
])(
  'anchor budgets %j truncate without retaining full text',
  async (overrides, retained, skipped, truncatedDocuments) => {
    const docs = documents();
    let active = 0;
    const ctx = {
      call: jest.fn(async (action, { id }) => {
        expect(action).toBe('knowledge-rag.documentGet');
        expect(++active).toBe(1);
        if (id === 'section-b') expect(docs[0].anchors).toBeDefined();
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return { text: `${values.join(' ')} ${'other '.repeat(10000)}` };
      }),
    };
    const report = await documentAnchors(ctx, docs, objects, candidates, {
      ...policy.limits(),
      ...overrides,
    });
    expect(report).toEqual({
      documents: 2,
      retained,
      chars: retained * 8,
      skipped,
      truncatedDocuments,
      truncated: true,
    });
    expect(ctx.call).toHaveBeenCalledTimes(2);
    for (const doc of docs) {
      expect(Object.keys(doc).sort()).toEqual(['anchors', 'id', 'provenance', 'sourceLocation']);
      expect(doc.anchors.every((value) => values.map(normalizeAnchor).includes(value))).toBe(true);
    }
  }
);
test('only present, current, located document candidates become anchors', async () => {
  const docs = documents();
  docs[0].sourceLocation = { page: 1 };
  docs[1].sourceLocation = { page: 2 };
  const current = [
    { ...candidates[0], location: '{"page":1}' },
    { ...candidates[1], version: 'obsolete' },
    { ...candidates[1], location: '{"column":"Token"}' },
    { ...candidates[2], object_id: 'foreign' },
    { ...candidates[2] },
    { ...candidates[0], value: '12' },
  ];
  const report = await documentAnchors(
    { call: async () => ({ text: values[0] }) },
    docs,
    objects,
    current,
    policy.limits()
  );
  expect(docs.map((doc) => doc.anchors)).toEqual([[normalizeAnchor(values[0])], []]);
  expect(report).toMatchObject({ retained: 1, skipped: 0, truncated: false });
});
