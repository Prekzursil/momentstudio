export type UiLang = 'en' | 'ro';

export type PageBlockType = 'text' | 'image' | 'gallery' | 'banner' | 'carousel';

export type PageBlockLayoutSpacing = 'none' | 'sm' | 'md' | 'lg';
export type PageBlockLayoutBackground = 'none' | 'muted' | 'accent';
export type PageBlockLayoutAlign = 'left' | 'center';
export type PageBlockLayoutMaxWidth = 'full' | 'narrow' | 'prose' | 'wide';

export interface PageBlockLayout {
  spacing: PageBlockLayoutSpacing;
  background: PageBlockLayoutBackground;
  align: PageBlockLayoutAlign;
  max_width: PageBlockLayoutMaxWidth;
}

export type SlideVariant = 'full' | 'split';
export type SlideSize = 'S' | 'M' | 'L';
export type SlideTextStyle = 'light' | 'dark';

export interface Slide {
  image_url: string;
  alt?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  variant: SlideVariant;
  size: SlideSize;
  text_style: SlideTextStyle;
  focal_x?: number;
  focal_y?: number;
}

export interface PageBlockBase {
  key: string;
  type: PageBlockType;
  enabled: boolean;
  title?: string | null;
  layout?: PageBlockLayout;
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
  focal_x: number;
  focal_y: number;
}

export interface PageGalleryImage {
  url: string;
  alt?: string | null;
  caption?: string | null;
  focal_x: number;
  focal_y: number;
}

export interface PageGalleryBlock extends PageBlockBase {
  type: 'gallery';
  images: PageGalleryImage[];
}

export interface PageBannerBlock extends PageBlockBase {
  type: 'banner';
  slide: Slide;
}

export interface CarouselSettings {
  autoplay: boolean;
  interval_ms: number;
  show_dots: boolean;
  show_arrows: boolean;
  pause_on_hover: boolean;
}

export interface PageCarouselBlock extends PageBlockBase {
  type: 'carousel';
  slides: Slide[];
  settings: CarouselSettings;
}

export type PageBlock = PageTextBlock | PageImageBlock | PageGalleryBlock | PageBannerBlock | PageCarouselBlock;

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

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeLayoutSpacing(value: unknown): PageBlockLayoutSpacing {
  const raw = readString(value);
  if (raw === 'sm' || raw === 'md' || raw === 'lg' || raw === 'none') return raw;
  return 'none';
}

function normalizeLayoutBackground(value: unknown): PageBlockLayoutBackground {
  const raw = readString(value);
  if (raw === 'muted' || raw === 'accent' || raw === 'none') return raw;
  return 'none';
}

function normalizeLayoutAlign(value: unknown): PageBlockLayoutAlign {
  const raw = readString(value);
  if (raw === 'center' || raw === 'left') return raw;
  return 'left';
}

function normalizeLayoutMaxWidth(value: unknown): PageBlockLayoutMaxWidth {
  const raw = readString(value);
  if (raw === 'narrow' || raw === 'prose' || raw === 'wide' || raw === 'full') return raw;
  return 'full';
}

function parseLayout(value: unknown): PageBlockLayout {
  const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    spacing: normalizeLayoutSpacing(rec['spacing']),
    background: normalizeLayoutBackground(rec['background']),
    align: normalizeLayoutAlign(rec['align']),
    max_width: normalizeLayoutMaxWidth(rec['max_width'] ?? rec['maxWidth'])
  };
}

export function pageBlockOuterClasses(layout: PageBlockLayout | null | undefined): string {
  const effective = layout || { spacing: 'none', background: 'none', align: 'left', max_width: 'full' };
  const backgroundClasses: Record<PageBlockLayoutBackground, string> = {
    none: '',
    muted: 'rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/30',
    accent: 'rounded-2xl border border-indigo-200 bg-indigo-50 dark:border-indigo-900/40 dark:bg-indigo-950/20'
  };
  const spacingClasses: Record<PageBlockLayoutSpacing, string> = {
    none: '',
    sm: 'p-3 md:p-4',
    md: 'p-5 md:p-6',
    lg: 'p-8 md:p-10'
  };
  return [backgroundClasses[effective.background], spacingClasses[effective.spacing]].filter(Boolean).join(' ');
}

export function pageBlockInnerClasses(layout: PageBlockLayout | null | undefined): string {
  const effective = layout || { spacing: 'none', background: 'none', align: 'left', max_width: 'full' };
  const maxWidthClasses: Record<PageBlockLayoutMaxWidth, string> = {
    full: '',
    narrow: 'max-w-2xl',
    prose: 'max-w-prose',
    wide: 'max-w-4xl'
  };
  const alignClasses: Record<PageBlockLayoutAlign, string> = {
    left: '',
    center: 'mx-auto text-center'
  };
  return ['w-full', maxWidthClasses[effective.max_width], alignClasses[effective.align]].filter(Boolean).join(' ');
}

function normalizeVariant(value: unknown): SlideVariant {
  const raw = readString(value);
  return raw === 'full' ? 'full' : 'split';
}

function normalizeSize(value: unknown): SlideSize {
  const raw = readString(value);
  if (raw === 'S' || raw === 'M' || raw === 'L') return raw;
  if (raw) {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 's' || normalized === 'small') return 'S';
    if (normalized === 'l' || normalized === 'large') return 'L';
  }
  return 'M';
}

function normalizeTextStyle(value: unknown): SlideTextStyle {
  const raw = readString(value);
  return raw === 'light' ? 'light' : 'dark';
}

function parseSlide(raw: unknown, lang: UiLang): Slide | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;

  const imageUrl = readString(rec['image_url']) || readString(rec['image']) || '';
  const headline = readLocalized(rec['headline'], lang);
  const subheadline = readLocalized(rec['subheadline'], lang);
  const ctaLabel = readLocalized(rec['cta_label'], lang);
  const ctaUrl = readString(rec['cta_url']);

  const alt = readLocalized(rec['alt'], lang);
  const variant = normalizeVariant(rec['variant']);
  const size = normalizeSize(rec['size']);
  const textStyle = normalizeTextStyle(rec['text_style']);
  const focalX = Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_x'], 50))));
  const focalY = Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_y'], 50))));

  const hasContent = Boolean(imageUrl || headline || subheadline || ctaLabel);
  if (!hasContent) return null;

  return {
    image_url: imageUrl,
    alt,
    headline,
    subheadline,
    cta_label: ctaLabel,
    cta_url: ctaUrl,
    variant,
    size,
    text_style: textStyle,
    focal_x: focalX,
    focal_y: focalY
  };
}

function parseCarouselSettings(raw: unknown): CarouselSettings {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const autoplay = readBoolean(rec['autoplay'], false);
  const intervalMs = Math.max(1000, readNumber(rec['interval_ms'], 5000));
  const showDots = readBoolean(rec['show_dots'], true);
  const showArrows = readBoolean(rec['show_arrows'], true);
  const pauseOnHover = readBoolean(rec['pause_on_hover'], true);
  return { autoplay, interval_ms: intervalMs, show_dots: showDots, show_arrows: showArrows, pause_on_hover: pauseOnHover };
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
    if (typeRaw !== 'text' && typeRaw !== 'image' && typeRaw !== 'gallery' && typeRaw !== 'banner' && typeRaw !== 'carousel') {
      continue;
    }
    if (!enabled) continue;

    const key = ensureUniqueKey(rec['key'], `${typeRaw}_${idx + 1}`, seenKeys);
    if (!key) continue;

    const title = readLocalized(rec['title'], lang);
    const layout = parseLayout(rec['layout']);

    if (typeRaw === 'text') {
      const bodyMarkdown = readLocalized(rec['body_markdown'], lang) || '';
      blocks.push({
        key,
        type: 'text',
        enabled: true,
        title,
        layout,
        body_html: renderMarkdown(bodyMarkdown)
      } satisfies PageTextBlock);
      continue;
    }

    if (typeRaw === 'image') {
      const url = typeof rec['url'] === 'string' ? rec['url'].trim() : '';
      if (!url) continue;
      const linkUrl = typeof rec['link_url'] === 'string' ? rec['link_url'].trim() : '';
      const focalX = Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_x'], 50))));
      const focalY = Math.max(0, Math.min(100, Math.round(readNumber(rec['focal_y'], 50))));
      blocks.push({
        key,
        type: 'image',
        enabled: true,
        title,
        layout,
        url,
        alt: readLocalized(rec['alt'], lang),
        caption: readLocalized(rec['caption'], lang),
        link_url: linkUrl || null,
        focal_x: focalX,
        focal_y: focalY
      } satisfies PageImageBlock);
      continue;
    }

    if (typeRaw === 'banner') {
      const slide = parseSlide(rec['slide'], lang);
      if (!slide) continue;
      blocks.push({
        key,
        type: 'banner',
        enabled: true,
        title,
        layout,
        slide
      } satisfies PageBannerBlock);
      continue;
    }

    if (typeRaw === 'carousel') {
      const slidesRaw = rec['slides'];
      const slides: Slide[] = [];
      if (Array.isArray(slidesRaw)) {
        for (const slideRaw of slidesRaw) {
          const slide = parseSlide(slideRaw, lang);
          if (slide) slides.push(slide);
        }
      }
      if (!slides.length) continue;
      blocks.push({
        key,
        type: 'carousel',
        enabled: true,
        title,
        layout,
        slides,
        settings: parseCarouselSettings(rec['settings'])
      } satisfies PageCarouselBlock);
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
      const focalX = Math.max(0, Math.min(100, Math.round(readNumber(imgRec['focal_x'], 50))));
      const focalY = Math.max(0, Math.min(100, Math.round(readNumber(imgRec['focal_y'], 50))));
      images.push({
        url,
        alt: readLocalized(imgRec['alt'], lang),
        caption: readLocalized(imgRec['caption'], lang),
        focal_x: focalX,
        focal_y: focalY
      });
    }
    if (!images.length) continue;
    blocks.push({
      key,
      type: 'gallery',
      enabled: true,
      title,
      layout,
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
    if (block.type === 'banner') {
      const slide = block.slide;
      if (slide.headline) parts.push(slide.headline);
      if (slide.subheadline) parts.push(slide.subheadline);
      if (slide.cta_label) parts.push(slide.cta_label);
    }
    if (block.type === 'carousel') {
      for (const slide of block.slides) {
        if (slide.headline) parts.push(slide.headline);
        if (slide.subheadline) parts.push(slide.subheadline);
        if (slide.cta_label) parts.push(slide.cta_label);
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
