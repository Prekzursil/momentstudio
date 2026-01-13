export type UiLang = 'en' | 'ro';

export type PageBlockType = 'text' | 'image' | 'gallery';

export interface PageBlockBase {
  key: string;
  type: PageBlockType;
  enabled: boolean;
  title?: string | null;
}

export interface PageTextBlock extends PageBlockBase {
  type: 'text';
  body_html: string;
}

export interface PageImageBlock extends PageBlockBase {
  type: 'image';
  url: string;
  alt?: string | null;
  caption?: string | null;
  link_url?: string | null;
}

export interface PageGalleryImage {
  url: string;
  alt?: string | null;
  caption?: string | null;
}

export interface PageGalleryBlock extends PageBlockBase {
  type: 'gallery';
  images: PageGalleryImage[];
}

export type PageBlock = PageTextBlock | PageImageBlock | PageGalleryBlock;

function readLocalized(value: unknown, lang: UiLang): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const preferred = typeof record[lang] === 'string' ? String(record[lang]).trim() : '';
  if (preferred) return preferred;
  const otherLang: UiLang = lang === 'ro' ? 'en' : 'ro';
  const fallback = typeof record[otherLang] === 'string' ? String(record[otherLang]).trim() : '';
  return fallback || null;
}

function ensureUniqueKey(value: unknown, fallback: string, existing: Set<string>): string | null {
  const key = (typeof value === 'string' ? value.trim() : '') || fallback;
  if (!key) return null;
  if (existing.has(key)) return null;
  existing.add(key);
  return key;
}

export function parsePageBlocks(
  meta: Record<string, unknown> | null | undefined,
  lang: UiLang,
  renderMarkdown: (md: string) => string
): PageBlock[] {
  const rawBlocks = meta?.['blocks'];
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return [];

  const blocks: PageBlock[] = [];
  const seenKeys = new Set<string>();

  for (const [idx, raw] of rawBlocks.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const typeRaw = typeof rec['type'] === 'string' ? String(rec['type']).trim() : '';
    const enabled = rec['enabled'] === false ? false : true;
    if (typeRaw !== 'text' && typeRaw !== 'image' && typeRaw !== 'gallery') continue;
    if (!enabled) continue;

    const key = ensureUniqueKey(rec['key'], `${typeRaw}_${idx + 1}`, seenKeys);
    if (!key) continue;

    const title = readLocalized(rec['title'], lang);

    if (typeRaw === 'text') {
      const bodyMarkdown = readLocalized(rec['body_markdown'], lang) || '';
      blocks.push({
        key,
        type: 'text',
        enabled: true,
        title,
        body_html: renderMarkdown(bodyMarkdown)
      } satisfies PageTextBlock);
      continue;
    }

    if (typeRaw === 'image') {
      const url = typeof rec['url'] === 'string' ? rec['url'].trim() : '';
      if (!url) continue;
      const linkUrl = typeof rec['link_url'] === 'string' ? rec['link_url'].trim() : '';
      blocks.push({
        key,
        type: 'image',
        enabled: true,
        title,
        url,
        alt: readLocalized(rec['alt'], lang),
        caption: readLocalized(rec['caption'], lang),
        link_url: linkUrl || null
      } satisfies PageImageBlock);
      continue;
    }

    const imagesRaw = rec['images'];
    if (!Array.isArray(imagesRaw)) continue;
    const images: PageGalleryImage[] = [];
    for (const imgRaw of imagesRaw) {
      if (!imgRaw || typeof imgRaw !== 'object') continue;
      const imgRec = imgRaw as Record<string, unknown>;
      const url = typeof imgRec['url'] === 'string' ? imgRec['url'].trim() : '';
      if (!url) continue;
      images.push({
        url,
        alt: readLocalized(imgRec['alt'], lang),
        caption: readLocalized(imgRec['caption'], lang)
      });
    }
    if (!images.length) continue;
    blocks.push({
      key,
      type: 'gallery',
      enabled: true,
      title,
      images
    } satisfies PageGalleryBlock);
  }

  return blocks;
}

export function pageBlocksToPlainText(blocks: PageBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block.enabled) continue;
    if (block.title) parts.push(block.title);
    if (block.type === 'text') {
      const html = block.body_html || '';
      const text = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) parts.push(text);
    }
    if (block.type === 'image' && block.caption) parts.push(block.caption);
    if (block.type === 'gallery') {
      for (const img of block.images) {
        if (img.caption) parts.push(img.caption);
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
