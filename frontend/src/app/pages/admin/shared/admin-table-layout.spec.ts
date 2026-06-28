import {
  AdminTableColumn,
  AdminTableLayoutV1,
  adminTableCellPaddingClass,
  adminTableLayoutStorageKey,
  defaultAdminTableLayout,
  loadAdminTableLayout,
  sanitizeAdminTableLayout,
  saveAdminTableLayout,
  visibleAdminTableColumnIds,
} from './admin-table-layout';

const COLUMNS: AdminTableColumn[] = [
  { id: 'name' },
  { id: 'email', required: true },
  { id: 'role' },
];

function baseLayout(): AdminTableLayoutV1 {
  return {
    version: 1,
    order: ['name', 'email', 'role'],
    hidden: [],
    density: 'comfortable',
  };
}

describe('adminTableCellPaddingClass', () => {
  it('uses tighter vertical padding for compact density', () => {
    expect(adminTableCellPaddingClass('compact')).toBe('px-3 py-1.5');
  });

  it('uses the comfortable padding otherwise', () => {
    expect(adminTableCellPaddingClass('comfortable')).toBe('px-3 py-2');
  });
});

describe('adminTableLayoutStorageKey', () => {
  it('slugifies the table id and keeps a provided user id', () => {
    expect(adminTableLayoutStorageKey('  Orders Table! ', 'u1')).toBe(
      'admin.tableLayout.v1:orders-table:u1',
    );
  });

  it('falls back to "table" when the cleaned table id is empty', () => {
    expect(adminTableLayoutStorageKey('***', 'u1')).toBe('admin.tableLayout.v1:table:u1');
  });

  it('falls back to "table" when the table id itself is empty', () => {
    expect(adminTableLayoutStorageKey('', 'u1')).toBe('admin.tableLayout.v1:table:u1');
  });

  it('uses "anonymous" when the user id is null', () => {
    expect(adminTableLayoutStorageKey('orders', null)).toBe(
      'admin.tableLayout.v1:orders:anonymous',
    );
  });

  it('uses "anonymous" when the user id is whitespace only', () => {
    expect(adminTableLayoutStorageKey('orders', '   ')).toBe(
      'admin.tableLayout.v1:orders:anonymous',
    );
  });

  it('uses "anonymous" when the user id is undefined', () => {
    expect(adminTableLayoutStorageKey('orders', undefined)).toBe(
      'admin.tableLayout.v1:orders:anonymous',
    );
  });
});

describe('defaultAdminTableLayout', () => {
  it('orders all columns, hides none, and defaults to comfortable density', () => {
    expect(defaultAdminTableLayout(COLUMNS)).toEqual({
      version: 1,
      order: ['name', 'email', 'role'],
      hidden: [],
      density: 'comfortable',
    });
  });
});

describe('sanitizeAdminTableLayout', () => {
  it('returns the default fallback when no fallback is supplied and input is null', () => {
    expect(sanitizeAdminTableLayout(null, COLUMNS)).toEqual(defaultAdminTableLayout(COLUMNS));
  });

  it('returns a provided fallback when input is not an object', () => {
    const fallback = baseLayout();
    expect(sanitizeAdminTableLayout('not-an-object', COLUMNS, fallback)).toBe(fallback);
  });

  it('returns the fallback when the version is not 1', () => {
    const fallback = baseLayout();
    const result = sanitizeAdminTableLayout(
      { version: 2, order: ['name'] },
      COLUMNS,
      fallback,
    );
    expect(result).toBe(fallback);
  });

  it('keeps valid ordered ids, drops invalid ones, and appends missing columns', () => {
    const result = sanitizeAdminTableLayout(
      {
        version: 1,
        order: ['  role  ', 123, 'unknown', 'role', 'name'],
        hidden: [],
        density: 'comfortable',
      },
      COLUMNS,
    );
    // 'role' trimmed+kept, 123 skipped (non-string), 'unknown' skipped (not allowed),
    // second 'role' skipped (duplicate), 'name' kept, then missing 'email' appended.
    expect(result.order).toEqual(['role', 'name', 'email']);
  });

  it('defaults order to an empty seed when order is not an array, then appends all columns', () => {
    const result = sanitizeAdminTableLayout(
      { version: 1, order: 'nope', hidden: [], density: 'comfortable' },
      COLUMNS,
    );
    expect(result.order).toEqual(['name', 'email', 'role']);
  });

  it('keeps allowed hidden ids, ignores required, invalid, and non-string entries', () => {
    const result = sanitizeAdminTableLayout(
      {
        version: 1,
        order: ['name', 'email', 'role'],
        hidden: [' role ', 'email', 'unknown', 42],
        density: 'comfortable',
      },
      COLUMNS,
    );
    // 'role' trimmed+kept, 'email' dropped (required), 'unknown' dropped (not allowed),
    // 42 dropped (non-string).
    expect(result.hidden).toEqual(['role']);
  });

  it('defaults hidden to empty when hidden is not an array', () => {
    const result = sanitizeAdminTableLayout(
      { version: 1, order: ['name'], hidden: 'nope', density: 'compact' },
      COLUMNS,
    );
    expect(result.hidden).toEqual([]);
  });

  it('accepts compact density', () => {
    const result = sanitizeAdminTableLayout(
      { version: 1, order: ['name'], hidden: [], density: 'compact' },
      COLUMNS,
    );
    expect(result.density).toBe('compact');
  });

  it('coerces an unknown density to comfortable', () => {
    const result = sanitizeAdminTableLayout(
      { version: 1, order: ['name'], hidden: [], density: 'weird' },
      COLUMNS,
    );
    expect(result.density).toBe('comfortable');
  });

  it('keeps a string updated_at', () => {
    const result = sanitizeAdminTableLayout(
      {
        version: 1,
        order: ['name'],
        hidden: [],
        density: 'comfortable',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
      COLUMNS,
    );
    expect(result.updated_at).toBe('2024-01-01T00:00:00.000Z');
  });

  it('drops a non-string updated_at', () => {
    const result = sanitizeAdminTableLayout(
      {
        version: 1,
        order: ['name'],
        hidden: [],
        density: 'comfortable',
        updated_at: 12345,
      },
      COLUMNS,
    );
    expect(result.updated_at).toBeUndefined();
  });
});

describe('loadAdminTableLayout', () => {
  const KEY = 'admin.tableLayout.v1:test:u1';

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns the default fallback when nothing is stored', () => {
    expect(loadAdminTableLayout(KEY, COLUMNS)).toEqual(defaultAdminTableLayout(COLUMNS));
  });

  it('returns the provided fallback when nothing is stored', () => {
    const fallback = baseLayout();
    expect(loadAdminTableLayout(KEY, COLUMNS, fallback)).toBe(fallback);
  });

  it('parses and sanitizes a stored layout', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        order: ['role', 'name'],
        hidden: ['role'],
        density: 'compact',
      }),
    );
    const result = loadAdminTableLayout(KEY, COLUMNS);
    expect(result.order).toEqual(['role', 'name', 'email']);
    expect(result.hidden).toEqual(['role']);
    expect(result.density).toBe('compact');
  });

  it('returns the fallback when the stored value is not valid JSON', () => {
    localStorage.setItem(KEY, '{not valid json');
    const fallback = baseLayout();
    expect(loadAdminTableLayout(KEY, COLUMNS, fallback)).toBe(fallback);
  });

  it('returns the fallback when storage access throws', () => {
    const fallback = baseLayout();
    spyOn(localStorage, 'getItem').and.throwError('blocked');
    expect(loadAdminTableLayout(KEY, COLUMNS, fallback)).toBe(fallback);
  });
});

describe('saveAdminTableLayout', () => {
  const KEY = 'admin.tableLayout.v1:save:u1';

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('persists the layout with a fresh updated_at timestamp', () => {
    const before = Date.now();
    saveAdminTableLayout(KEY, baseLayout());
    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as AdminTableLayoutV1;
    expect(parsed.order).toEqual(['name', 'email', 'role']);
    expect(typeof parsed.updated_at).toBe('string');
    expect(new Date(parsed.updated_at as string).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('silently ignores storage errors', () => {
    spyOn(localStorage, 'setItem').and.throwError('quota exceeded');
    expect(() => saveAdminTableLayout(KEY, baseLayout())).not.toThrow();
  });
});

describe('visibleAdminTableColumnIds', () => {
  it('keeps ordered ids that are not hidden', () => {
    const layout: AdminTableLayoutV1 = {
      version: 1,
      order: ['name', 'email', 'role'],
      hidden: ['role'],
      density: 'comfortable',
    };
    expect(visibleAdminTableColumnIds(layout, COLUMNS)).toEqual(['name', 'email']);
  });

  it('always keeps required columns even when listed as hidden', () => {
    const layout: AdminTableLayoutV1 = {
      version: 1,
      order: ['name', 'email', 'role'],
      hidden: ['email', 'role'],
      density: 'comfortable',
    };
    expect(visibleAdminTableColumnIds(layout, COLUMNS)).toEqual(['name', 'email']);
  });

  it('treats missing order and hidden arrays as empty', () => {
    const layout = { version: 1, density: 'comfortable' } as unknown as AdminTableLayoutV1;
    expect(visibleAdminTableColumnIds(layout, COLUMNS)).toEqual([]);
  });
});
