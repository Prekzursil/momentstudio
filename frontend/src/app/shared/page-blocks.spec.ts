import {
  pageBlockInnerClasses,
  pageBlockOuterClasses,
  pageBlocksToPlainText,
  parsePageBlocks,
} from './page-blocks';

const renderMarkdown = (value: string): string => `<p>${String(value || '').trim()}</p>`;

const richMeta: Record<string, unknown> = {
  blocks: [
    { key: 'intro', type: 'text', enabled: true, title: { en: 'Intro' }, body_markdown: { en: 'Hello world' } },
    {
      key: 'cta_main',
      type: 'cta',
      enabled: true,
      body_markdown: { en: 'Buy now' },
      cta_label: { en: 'Shop now' },
      cta_url: '/shop',
      cta_new_tab: 'true',
    },
    {
      key: 'grid',
      type: 'product_grid',
      enabled: true,
      source: 'categories',
      limit: '30',
      category_slug: 'chairs',
      products: 'chair-a, chair-b',
    },
    { key: 'contact_form', type: 'form', enabled: true, form_type: 'contact', topic: 'support' },
    {
      key: 'faq',
      type: 'faq',
      enabled: true,
      items: [{ question: { en: 'Q1' }, answer_markdown: { en: 'A1' } }],
    },
    {
      key: 'quotes',
      type: 'testimonials',
      enabled: true,
      items: [{ quote_markdown: { en: 'Great product' }, author: { en: 'Ada' }, role: { en: 'Designer' } }],
    },
    {
      key: 'hero_image',
      type: 'image',
      enabled: true,
      url: 'https://img.test/hero.jpg',
      alt: { en: 'Hero' },
      caption: { en: 'Hero caption' },
      focal_x: 120,
      focal_y: -1,
    },
    {
      key: 'hero_banner',
      type: 'banner',
      enabled: true,
      slide: {
        image_url: 'https://img.test/banner.jpg',
        headline: { en: 'Headline' },
        subheadline: { en: 'Sub' },
        cta_label: { en: 'Read more' },
        cta_url: '/blog',
        variant: 'full',
        size: 'large',
        text_style: 'light',
        focal_x: 90,
        focal_y: 10,
      },
    },
    {
      key: 'carousel_home',
      type: 'carousel',
      enabled: true,
      slides: [
        { image_url: 'https://img.test/s1.jpg', headline: { en: 'S1' }, variant: 'split', size: 'S', text_style: 'dark' },
        { image_url: 'https://img.test/s2.jpg', headline: { en: 'S2' }, variant: 'full', size: 'L', text_style: 'light' },
      ],
      settings: { autoplay: 1, interval_ms: 500, show_dots: 0, show_arrows: 'yes', pause_on_hover: 'off' },
    },
    {
      key: 'columns_block',
      type: 'columns',
      enabled: true,
      columns_breakpoint: 'lg',
      columns: [
        { title: { en: 'C1' }, body_markdown: { en: 'Body1' } },
        { title: { en: 'C2' }, body_markdown: { en: 'Body2' } },
        { title: { en: 'C3' }, body_markdown: { en: 'Body3' } },
      ],
    },
    {
      key: 'gallery_block',
      type: 'gallery',
      enabled: true,
      images: [
        { url: 'https://img.test/g1.jpg', alt: { en: 'G1' }, caption: { en: 'Cap1' } },
        { url: 'https://img.test/g2.jpg', alt: { en: 'G2' }, caption: { en: 'Cap2' }, focal_x: 12, focal_y: 88 },
      ],
    },
    { key: 'intro', type: 'text', enabled: true, body_markdown: { en: 'Duplicate key skipped' } },
    { key: 'disabled', type: 'text', enabled: false, body_markdown: { en: 'Skip disabled' } },
  ],
};

function parseRichBlocks(): any[] {
  return parsePageBlocks(richMeta, 'en', renderMarkdown);
}

describe('page-blocks helpers', () => {
  it('keeps enabled unique blocks across supported types', () => {
    const blocks = parseRichBlocks();
    expect(blocks.length).toBe(11);
    expect(blocks.filter((block) => (block as any).key === 'intro').length).toBe(1);
    expect(blocks.some((block) => (block as any).key === 'disabled')).toBeFalse();
  });

  it('normalizes product-grid data from loose metadata payloads', () => {
    const blocks = parseRichBlocks();
    const productGrid = blocks.find((block) => block.type === 'product_grid');
    expect(productGrid).toBeTruthy();
    expect((productGrid as any).source).toBe('category');
    expect((productGrid as any).limit).toBe(24);
    expect((productGrid as any).product_slugs).toEqual(['chair-a', 'chair-b']);
  });

  it('normalizes media focal points plus banner and carousel settings', () => {
    const blocks = parseRichBlocks();
    const banner = blocks.find((block) => block.type === 'banner') as any;
    const carousel = blocks.find((block) => block.type === 'carousel') as any;
    const image = blocks.find((block) => block.type === 'image') as any;

    expect(banner.slide.size).toBe('L');
    expect(banner.slide.text_style).toBe('light');
    expect(carousel.settings.interval_ms).toBe(1000);
    expect(carousel.settings.autoplay).toBeTrue();
    expect(carousel.settings.show_dots).toBeFalse();
    expect(image.focal_x).toBe(100);
    expect(image.focal_y).toBe(0);
  });

  it('returns normalized classes and plain-text extraction', () => {
    const outer = pageBlockOuterClasses({ spacing: 'lg', background: 'accent', align: 'left', max_width: 'full' });
    const inner = pageBlockInnerClasses({ spacing: 'none', background: 'none', align: 'center', max_width: 'prose' });
    expect(outer).toContain('p-8');
    expect(outer).toContain('bg-indigo-50');
    expect(inner).toContain('max-w-prose');
    expect(inner).toContain('text-center');

    const blocks = parsePageBlocks(
      {
        blocks: [
          { key: 'text', type: 'text', enabled: true, title: { en: 'Title' }, body_markdown: { en: 'Body' } },
          { key: 'faq', type: 'faq', enabled: true, items: [{ question: { en: 'Question' }, answer_markdown: { en: 'Answer' } }] },
          { key: 'off', type: 'text', enabled: false, body_markdown: { en: 'Hidden' } },
        ],
      } as Record<string, unknown>,
      'en',
      renderMarkdown
    );

    const plain = pageBlocksToPlainText(blocks);
    expect(plain).toContain('Title');
    expect(plain).toContain('Question');
    expect(plain).toContain('Answer');
    expect(plain).not.toContain('Hidden');
  });

  it('falls back to empty lists for invalid metadata', () => {
    expect(parsePageBlocks(null, 'en', renderMarkdown)).toEqual([]);
    expect(parsePageBlocks({ blocks: 'bad' } as any, 'en', renderMarkdown)).toEqual([]);
  });
});
