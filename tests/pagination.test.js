'use strict';

const {
  applyCursorPagination,
  buildFilterHash,
  decodeCursor,
  encodeCursor,
} = require('../src/pagination');

describe('pagination helpers', () => {
  test('encodes and decodes signed cursor', () => {
    const filterHash = buildFilterHash({ status: 'ok' });
    const cursor = encodeCursor({
      pivot: { createdAt: '2026-05-05T00:00:00.000Z', id: 'a' },
      direction: 'next',
      filterHash,
      tenantId: 'tenant-a',
    });

    const decoded = decodeCursor(cursor, {
      tenantId: 'tenant-a',
      expectedFilterHash: filterHash,
    });

    expect(decoded.pivot).toEqual({ createdAt: '2026-05-05T00:00:00.000Z', id: 'a' });
    expect(decoded.direction).toBe('next');
  });

  test('rejects tampered cursor', () => {
    const cursor = encodeCursor({
      pivot: { createdAt: '2026-05-05T00:00:00.000Z', id: 'a' },
      direction: 'next',
      filterHash: null,
      tenantId: 'tenant-a',
    });

    const tampered = `${cursor.slice(0, -2)}xx`;

    expect(() => decodeCursor(tampered, { tenantId: 'tenant-a' })).toThrow('INVALID_CURSOR');
  });

  test('paginates sorted items with cursor', () => {
    const items = Array.from({ length: 10 }).map((_, idx) => ({
      id: `id-${10 - idx}`,
      createdAt: `2026-05-${String(10 - idx).padStart(2, '0')}T00:00:00.000Z`,
    }));

    const first = applyCursorPagination({
      items,
      limit: 3,
      tenantId: 'tenant-a',
      filterHash: null,
    });

    expect(first.data).toHaveLength(3);
    expect(first.pageInfo.hasMore).toBe(true);
    expect(first.pageInfo.nextCursor).toBeTruthy();

    const second = applyCursorPagination({
      items,
      limit: 3,
      cursor: first.pageInfo.nextCursor,
      tenantId: 'tenant-a',
      filterHash: null,
    });

    expect(second.data).toHaveLength(3);
    expect(second.data[0].id).toBe('id-7');
  });
});
