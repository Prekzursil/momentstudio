export type AdminTableDensity = 'comfortable' | 'compact';

export type AdminTableColumn = {
  id: string;
  required?: boolean;
};

export type AdminTableLayoutV1 = {
  version: 1;
  order: string[];
  hidden: string[];
  density: AdminTableDensity;
  updated_at?: string;
};

export function adminTableCellPaddingClass(density: AdminTableDensity): string {
  return density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2';
}

export function adminTableLayoutStorageKey(tableId: string, userId: string | null | undefined): string {
  const cleanedTable = (tableId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cleanedUser = (userId || 'anonymous').trim() || 'anonymous';
  return `admin.tableLayout.v1:${cleanedTable || 'table'}:${cleanedUser}`;
}

export function defaultAdminTableLayout(columns: AdminTableColumn[]): AdminTableLayoutV1 {
  return {
    version: 1,
    order: columns.map((c) => c.id),
    hidden: [],
    density: 'comfortable',
  };
}

export function sanitizeAdminTableLayout(
  input: unknown,
  columns: AdminTableColumn[],
  fallbackLayout?: AdminTableLayoutV1
): AdminTableLayoutV1 {
  const ids = columns.map((c) => c.id);
  const allowed = new Set(ids);
  const required = new Set(columns.filter((c) => c.required).map((c) => c.id));
  const fallback = fallbackLayout ?? defaultAdminTableLayout(columns);

  if (!input || typeof input !== 'object') return fallback;
  const obj = input as Record<string, unknown>;
  const version = obj['version'];
  if (version !== 1) return fallback;

  const rawOrder = Array.isArray(obj['order']) ? (obj['order'] as unknown[]) : [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const value of rawOrder) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!allowed.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const id of ids) {
    if (!seen.has(id)) order.push(id);
  }

  const rawHidden = Array.isArray(obj['hidden']) ? (obj['hidden'] as unknown[]) : [];
  const hiddenSet = new Set<string>();
  for (const value of rawHidden) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!allowed.has(id)) continue;
    if (required.has(id)) continue;
    hiddenSet.add(id);
  }
  const hidden = Array.from(hiddenSet);

  const density = obj['density'] === 'compact' ? 'compact' : 'comfortable';

  const updated_at = typeof obj['updated_at'] === 'string' ? obj['updated_at'] : undefined;
  return { version: 1, order, hidden, density, updated_at };
}

export function loadAdminTableLayout(storageKey: string, columns: AdminTableColumn[], fallbackLayout?: AdminTableLayoutV1): AdminTableLayoutV1 {
  const fallback = fallbackLayout ?? defaultAdminTableLayout(columns);
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return sanitizeAdminTableLayout(JSON.parse(raw), columns, fallback);
  } catch {
    return fallback;
  }
}

export function saveAdminTableLayout(storageKey: string, layout: AdminTableLayoutV1): void {
  try {
    const payload: AdminTableLayoutV1 = { ...layout, updated_at: new Date().toISOString() };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore storage errors (private mode / blocked storage).
  }
}

export function visibleAdminTableColumnIds(layout: AdminTableLayoutV1, columns: AdminTableColumn[]): string[] {
  const required = new Set(columns.filter((c) => c.required).map((c) => c.id));
  const hidden = new Set(layout.hidden || []);
  return (layout.order || []).filter((id) => required.has(id) || !hidden.has(id));
}
