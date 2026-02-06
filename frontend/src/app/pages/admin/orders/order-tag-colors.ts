export type TagColor = 'slate' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky' | 'teal';

export const TAG_COLOR_PALETTE: TagColor[] = ['slate', 'indigo', 'violet', 'emerald', 'amber', 'rose', 'sky', 'teal'];

export const TAG_COLOR_STORAGE_KEY = 'admin.orders.tagColors.v1';

const TAG_COLOR_CLASSES: Record<TagColor, string> = {
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-100',
  amber:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100',
  rose: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100',
  indigo:
    'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-950/30 dark:text-indigo-100',
  violet:
    'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-950/30 dark:text-violet-100',
  sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-100',
  teal: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-500/40 dark:bg-teal-950/30 dark:text-teal-100',
  slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100'
};

export function normalizeTagKey(tag: string): string {
  const raw = (tag || '').toString().trim().toLowerCase();
  if (!raw) return '';
  const collapsed = raw.replace(/\s+/g, '_');
  const cleaned = collapsed.replace(/[^a-z0-9_-]/g, '').replace(/^[_-]+|[_-]+$/g, '');
  return cleaned.slice(0, 50);
}

export function loadTagColorOverrides(): Record<string, TagColor> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(TAG_COLOR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, TagColor> = {};
    Object.entries(parsed || {}).forEach(([key, value]) => {
      const tagKey = normalizeTagKey(key);
      const color = (typeof value === 'string' ? value : '').trim() as TagColor;
      if (!tagKey || !TAG_COLOR_PALETTE.includes(color)) return;
      out[tagKey] = color;
    });
    return out;
  } catch {
    return {};
  }
}

export function persistTagColorOverrides(overrides: Record<string, TagColor>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TAG_COLOR_STORAGE_KEY, JSON.stringify(overrides || {}));
  } catch {
    // ignore
  }
}

export function tagColorFor(tag: string, overrides: Record<string, TagColor>): TagColor {
  const key = normalizeTagKey(tag);
  if (key && overrides[key]) return overrides[key];

  if (key === 'vip') return 'violet';
  if (key === 'fraud_risk') return 'amber';
  if (key === 'fraud_approved') return 'emerald';
  if (key === 'fraud_denied') return 'rose';
  if (key === 'gift') return 'indigo';
  if (key === 'test') return 'slate';

  if (!key) return 'slate';
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % TAG_COLOR_PALETTE.length;
  return TAG_COLOR_PALETTE[idx] || 'slate';
}

export function tagChipColorClass(tag: string, overrides: Record<string, TagColor>): string {
  const color = tagColorFor(tag, overrides);
  return TAG_COLOR_CLASSES[color] || TAG_COLOR_CLASSES.slate;
}
