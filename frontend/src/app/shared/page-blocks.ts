export type UiLang = 'en' | 'ro';

export type PageBlockType =
  | 'text'
  | 'image'
  | 'gallery'
  | 'banner'
  | 'carousel'
  | 'columns'
  | 'cta'
  | 'faq'
  | 'testimonials'
  | 'product_grid'
  | 'form';

export type ColumnsCount = 2 | 3;
export type ColumnsBreakpoint = 'sm' | 'md' | 'lg';

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

export interface PageCtaBlock extends PageBlockBase {
  type: 'cta';
  body_html: string;
  cta_label?: string | null;
  cta_url?: string | null;
  cta_new_tab?: boolean;
}

export interface PageFaqItem {
  question: string;
  answer_html: string;
}

export interface PageFaqBlock extends PageBlockBase {
  type: 'faq';
  items: PageFaqItem[];
}

export interface PageTestimonialItem {
  quote_html: string;
  author?: string | null;
  role?: string | null;
}

export interface PageTestimonialsBlock extends PageBlockBase {
  type: 'testimonials';
  items: PageTestimonialItem[];
}

export type ProductGridSource = 'category' | 'collection' | 'products';

export interface PageProductGridBlock extends PageBlockBase {
  type: 'product_grid';
  source: ProductGridSource;
  limit: number;
  category_slug?: string | null;
  collection_slug?: string | null;
  product_slugs?: string[];
}

export type CmsFormType = 'contact' | 'newsletter';
export type ContactSubmissionTopic = 'contact' | 'support' | 'refund' | 'dispute';

export interface PageFormBlock extends PageBlockBase {
  type: 'form';
  form_type: CmsFormType;
  topic?: ContactSubmissionTopic | null;
}

export interface PageColumnsColumn {
  title?: string | null;
  body_html: string;
}

export interface PageColumnsBlock extends PageBlockBase {
  type: 'columns';
  columns: PageColumnsColumn[];
  columns_count: ColumnsCount;
  breakpoint: ColumnsBreakpoint;
}

export type PageBlock =
  | PageTextBlock
  | PageImageBlock
  | PageGalleryBlock
  | PageBannerBlock
  | PageCarouselBlock
  | PageColumnsBlock
  | PageCtaBlock
  | PageFaqBlock
  | PageTestimonialsBlock
  | PageProductGridBlock
  | PageFormBlock;

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

function normalizeColumnsBreakpoint(value: unknown): ColumnsBreakpoint {
  const raw = readString(value);
  if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw;
  return 'md';
}

function normalizeProductGridSource(value: unknown): ProductGridSource {
  const raw = readString(value);
  if (!raw) return 'products';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'category' || normalized === 'categories') return 'category';
  if (normalized === 'collection' || normalized === 'collections') return 'collection';
  if (normalized === 'products' || normalized === 'product' || normalized === 'manual') return 'products';
  return 'products';
}

function parseStringList(value: unknown, limit: number): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return;
    if (out.includes(cleaned)) return;
    out.push(cleaned);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  if (typeof value === 'string') {
    for (const part of value.split(/[,\n]/g)) {
      push(part);
      if (out.length >= limit) break;
    }
    return out;
  }

  return out;
}

function normalizeFormType(value: unknown): CmsFormType {
  const raw = readString(value);
  if (!raw) return 'contact';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'newsletter') return 'newsletter';
  return 'contact';
}

function normalizeContactTopic(value: unknown): ContactSubmissionTopic {
  const raw = readString(value);
  if (raw === 'support' || raw === 'refund' || raw === 'dispute') return raw;
  return 'contact';
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
    if (
      typeRaw !== 'text' &&
      typeRaw !== 'image' &&
      typeRaw !== 'gallery' &&
      typeRaw !== 'banner' &&
      typeRaw !== 'carousel' &&
      typeRaw !== 'columns' &&
      typeRaw !== 'cta' &&
      typeRaw !== 'faq' &&
      typeRaw !== 'testimonials' &&
      typeRaw !== 'product_grid' &&
      typeRaw !== 'form'
    ) {
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

    if (typeRaw === 'cta') {
      const bodyMarkdown = readLocalized(rec['body_markdown'], lang) || '';
      const ctaLabel = readLocalized(rec['cta_label'], lang);
      const ctaUrl = readString(rec['cta_url']);
      const ctaNewTab = readBoolean(rec['cta_new_tab'], false);
      const hasAny = Boolean(title || bodyMarkdown.trim() || ctaLabel || ctaUrl);
      if (!hasAny) continue;
      blocks.push({
        key,
        type: 'cta',
        enabled: true,
        title,
        layout,
        body_html: renderMarkdown(bodyMarkdown),
        cta_label: ctaLabel,
        cta_url: ctaUrl,
        cta_new_tab: ctaNewTab
      } satisfies PageCtaBlock);
      continue;
    }

    if (typeRaw === 'product_grid') {
      const source = normalizeProductGridSource(rec['source'] ?? rec['mode']);
      const limit = Math.max(1, Math.min(24, Math.round(readNumber(rec['limit'], 6))));
      const categorySlug = readString(rec['category_slug'] ?? rec['category']);
      const collectionSlug = readString(rec['collection_slug'] ?? rec['collection']);
      const productSlugs = parseStringList(rec['product_slugs'] ?? rec['products'], 50);
      const hasAny = Boolean(title || categorySlug || collectionSlug || productSlugs.length);
      if (!hasAny) continue;
      blocks.push({
        key,
        type: 'product_grid',
        enabled: true,
        title,
        layout,
        source,
        limit,
        category_slug: categorySlug,
        collection_slug: collectionSlug,
        product_slugs: productSlugs.length ? productSlugs : undefined
      } satisfies PageProductGridBlock);
      continue;
    }

    if (typeRaw === 'form') {
      const formType = normalizeFormType(rec['form_type'] ?? rec['variant']);
      const topic = formType === 'contact' ? normalizeContactTopic(rec['topic']) : null;
      blocks.push({
        key,
        type: 'form',
        enabled: true,
        title,
        layout,
        form_type: formType,
        topic
      } satisfies PageFormBlock);
      continue;
    }

    if (typeRaw === 'faq') {
      const itemsRaw = rec['items'];
      if (!Array.isArray(itemsRaw)) continue;
      const items: PageFaqItem[] = [];
      for (const itemRaw of itemsRaw) {
        if (!itemRaw || typeof itemRaw !== 'object') continue;
        const itemRec = itemRaw as Record<string, unknown>;
        const question = readLocalized(itemRec['question'], lang);
        if (!question) continue;
        const answerMarkdown = readLocalized(itemRec['answer_markdown'], lang) || '';
        items.push({ question, answer_html: renderMarkdown(answerMarkdown) });
        if (items.length >= 20) break;
      }
      if (!items.length) continue;
      blocks.push({ key, type: 'faq', enabled: true, title, layout, items } satisfies PageFaqBlock);
      continue;
    }

    if (typeRaw === 'testimonials') {
      const itemsRaw = rec['items'];
      if (!Array.isArray(itemsRaw)) continue;
      const items: PageTestimonialItem[] = [];
      for (const itemRaw of itemsRaw) {
        if (!itemRaw || typeof itemRaw !== 'object') continue;
        const itemRec = itemRaw as Record<string, unknown>;
        const quoteMarkdown = readLocalized(itemRec['quote_markdown'], lang) || '';
        if (!quoteMarkdown.trim()) continue;
        const author = readLocalized(itemRec['author'], lang);
        const role = readLocalized(itemRec['role'], lang);
        items.push({ quote_html: renderMarkdown(quoteMarkdown), author, role });
        if (items.length >= 12) break;
      }
      if (!items.length) continue;
      blocks.push({ key, type: 'testimonials', enabled: true, title, layout, items } satisfies PageTestimonialsBlock);
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

    if (typeRaw === 'columns') {
      const columnsRaw = rec['columns'];
      if (!Array.isArray(columnsRaw)) continue;
      const columns: PageColumnsColumn[] = [];
      let hasAny = false;

      for (const colRaw of columnsRaw) {
        if (!colRaw || typeof colRaw !== 'object') continue;
        const colRec = colRaw as Record<string, unknown>;
        const colTitle = readLocalized(colRec['title'], lang);
        const bodyMarkdown = readLocalized(colRec['body_markdown'], lang) || '';
        if (colTitle || bodyMarkdown.trim()) hasAny = true;
        columns.push({ title: colTitle, body_html: renderMarkdown(bodyMarkdown) });
        if (columns.length >= 3) break;
      }

      if (columns.length < 2) continue;
      if (!hasAny) continue;

      blocks.push({
        key,
        type: 'columns',
        enabled: true,
        title,
        layout,
        columns,
        columns_count: columns.length === 3 ? 3 : 2,
        breakpoint: normalizeColumnsBreakpoint(rec['columns_breakpoint'] ?? rec['breakpoint'] ?? rec['stack_at'])
      } satisfies PageColumnsBlock);
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

const HTML_TAG_PATTERN = new RegExp('\\x3C[^\\x3E]+\\x3E', 'g');
const WHITESPACE_PATTERN = /\s+/g;

const htmlToPlainText = (html: string): string =>
  (html || '').replace(HTML_TAG_PATTERN, ' ').replace(WHITESPACE_PATTERN, ' ').trim();

const appendTextLikeParts = (parts: string[], bodyHtml: string, ctaLabel?: string): void => {
  const text = htmlToPlainText(bodyHtml || '');
  if (text) parts.push(text);
  if (ctaLabel) parts.push(ctaLabel);
};

const appendFaqParts = (parts: string[], block: PageFaqBlock): void => {
  for (const item of block.items) {
    parts.push(item.question);
    appendTextLikeParts(parts, item.answer_html || '');
  }
};

const appendTestimonialsParts = (parts: string[], block: PageTestimonialsBlock): void => {
  for (const item of block.items) {
    appendTextLikeParts(parts, item.quote_html || '');
    if (item.author) parts.push(item.author);
    if (item.role) parts.push(item.role);
  }
};

const appendImageParts = (parts: string[], block: PageImageBlock): void => {
  if (block.caption) parts.push(block.caption);
};

const appendGalleryParts = (parts: string[], block: PageGalleryBlock): void => {
  for (const image of block.images) {
    if (image.caption) parts.push(image.caption);
  }
};

const appendSlidesParts = (parts: string[], slides: Slide[]): void => {
  for (const slide of slides) {
    if (slide.headline) parts.push(slide.headline);
    if (slide.subheadline) parts.push(slide.subheadline);
    if (slide.cta_label) parts.push(slide.cta_label);
  }
};

const appendColumnsParts = (parts: string[], block: PageColumnsBlock): void => {
  for (const column of block.columns) {
    if (column.title) parts.push(column.title);
    appendTextLikeParts(parts, column.body_html || '');
  }
};

type PageBlockPlainTextAppender = (parts: string[], block: PageBlock) => void;

const pageBlockPlainTextAppenders: Record<PageBlock['type'], PageBlockPlainTextAppender> = {
  text: (parts, block) => appendTextLikeParts(parts, (block as PageTextBlock).body_html || ''),
  image: (parts, block) => appendImageParts(parts, block as PageImageBlock),
  gallery: (parts, block) => appendGalleryParts(parts, block as PageGalleryBlock),
  banner: (parts, block) => appendSlidesParts(parts, [(block as PageBannerBlock).slide]),
  carousel: (parts, block) => appendSlidesParts(parts, (block as PageCarouselBlock).slides),
  columns: (parts, block) => appendColumnsParts(parts, block as PageColumnsBlock),
  cta: (parts, block) => {
    const cta = block as PageCtaBlock;
    appendTextLikeParts(parts, cta.body_html || '', cta.cta_label || undefined);
  },
  faq: (parts, block) => appendFaqParts(parts, block as PageFaqBlock),
  testimonials: (parts, block) => appendTestimonialsParts(parts, block as PageTestimonialsBlock),
  product_grid: () => {},
  form: () => {}
};

function appendBlockParts(parts: string[], block: PageBlock): void {
  pageBlockPlainTextAppenders[block.type](parts, block);
}

export function pageBlocksToPlainText(blocks: PageBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block.enabled) continue;
    if (block.title) parts.push(block.title);
    appendBlockParts(parts, block);
  }
  return parts.join(' ').replace(WHITESPACE_PATTERN, ' ').trim();
}
