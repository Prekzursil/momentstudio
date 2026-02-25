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
    order: columnIds(columns),
    hidden: [],
    density: 'comfortable',
  };
}

function columnIds(columns: AdminTableColumn[]): string[] {
  const ids: string[] = [];
  for (const column of columns) {
    ids.push(column.id);
  }
  return ids;
}

function requiredColumnIds(columns: AdminTableColumn[]): Set<string> {
  const required = new Set<string>();
  for (const column of columns) {
    if (column.required) required.add(column.id);
  }
  return required;
}

const normalizeOrderEntry = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isAllowedOrderId = (id: string, allowed: Set<string>): boolean => id.length > 0 && allowed.has(id);

const collectAllowedOrderIds = (rawOrder: unknown[], allowed: Set<string>): string[] => {
  const normalized = rawOrder.map((value) => normalizeOrderEntry(value));
  const allowedIds = normalized.filter((id) => isAllowedOrderId(id, allowed));
  return Array.from(new Set(allowedIds));
};

const appendMissingOrderIds = (order: string[], ids: string[]): string[] => {
  const seen = new Set(order);
  for (const id of ids) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
};

const sanitizeOrder = (rawOrder: unknown[], ids: string[], allowed: Set<string>): string[] =>
  appendMissingOrderIds(collectAllowedOrderIds(rawOrder, allowed), ids);

const sanitizeHidden = (rawHidden: unknown[], allowed: Set<string>, required: Set<string>): string[] => {
  const hiddenSet = new Set<string>();
  for (const value of rawHidden) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!allowed.has(id) || required.has(id)) continue;
    hiddenSet.add(id);
  }
  return Array.from(hiddenSet);
};

const asLayoutObject = (input: unknown): Record<string, unknown> | null => {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  return obj['version'] === 1 ? obj : null;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function sanitizeAdminTableLayout(
  input: unknown,
  columns: AdminTableColumn[],
  fallbackLayout?: AdminTableLayoutV1
): AdminTableLayoutV1 {
  const ids = columnIds(columns);
  const allowed = new Set(ids);
  const required = requiredColumnIds(columns);
  const fallback = fallbackLayout ?? defaultAdminTableLayout(columns);

  const obj = asLayoutObject(input);
  if (!obj) return fallback;

  const order = sanitizeOrder(asArray(obj['order']), ids, allowed);

  const hidden = sanitizeHidden(asArray(obj['hidden']), allowed, required);

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
