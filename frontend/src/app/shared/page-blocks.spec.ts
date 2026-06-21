import {
  pageBlockInnerClasses,
  pageBlockOuterClasses,
  pageBlocksToPlainText,
  parsePageBlocks,
  type PageBlock,
} from './page-blocks';

const md = (s: string) => `<p>${s}</p>`;

function parse(blocks: unknown[], lang: 'en' | 'ro' = 'en'): PageBlock[] {
  return parsePageBlocks({ blocks }, lang, md);
}

describe('pageBlockOuterClasses', () => {
  it('returns empty for null layout', () => {
    expect(pageBlockOuterClasses(null)).toBe('');
    expect(pageBlockOuterClasses(undefined)).toBe('');
  });

  it('maps background and spacing tokens', () => {
    expect(
      pageBlockOuterClasses({
        spacing: 'md',
        background: 'muted',
        align: 'left',
        max_width: 'full',
      }),
    ).toContain('p-5');
    expect(
      pageBlockOuterClasses({
        spacing: 'lg',
        background: 'accent',
        align: 'left',
        max_width: 'full',
      }),
    ).toContain('indigo');
    expect(
      pageBlockOuterClasses({
        spacing: 'sm',
        background: 'none',
        align: 'left',
        max_width: 'full',
      }),
    ).toBe('p-3 md:p-4');
  });
});

describe('pageBlockInnerClasses', () => {
  it('returns w-full for null layout', () => {
    expect(pageBlockInnerClasses(null)).toBe('w-full');
  });

  it('maps max-width and align tokens', () => {
    expect(
      pageBlockInnerClasses({
        spacing: 'none',
        background: 'none',
        align: 'center',
        max_width: 'narrow',
      }),
    ).toContain('max-w-2xl');
    expect(
      pageBlockInnerClasses({
        spacing: 'none',
        background: 'none',
        align: 'center',
        max_width: 'prose',
      }),
    ).toContain('text-center');
    expect(
      pageBlockInnerClasses({
        spacing: 'none',
        background: 'none',
        align: 'left',
        max_width: 'wide',
      }),
    ).toContain('max-w-4xl');
  });
});

describe('parsePageBlocks', () => {
  it('returns empty when blocks missing/empty/not array', () => {
    expect(parsePageBlocks(null, 'en', md)).toEqual([]);
    expect(parsePageBlocks({ blocks: [] }, 'en', md)).toEqual([]);
    expect(parsePageBlocks({ blocks: 'nope' as unknown as [] }, 'en', md)).toEqual([]);
  });

  it('skips non-object entries and unknown types', () => {
    expect(parse([null, 'x', 42, { type: 'unknown' }])).toEqual([]);
  });

  it('skips disabled blocks', () => {
    expect(parse([{ type: 'text', enabled: false, body_markdown: 'hi' }])).toEqual([]);
  });

  it('treats undefined enabled as enabled', () => {
    const out = parse([{ type: 'text', body_markdown: 'hi', key: 'k1' }]);
    expect(out.length).toBe(1);
  });

  it('de-duplicates keys and falls back to generated keys', () => {
    const out = parse([
      { type: 'text', key: 'dup', body_markdown: 'a' },
      { type: 'text', key: 'dup', body_markdown: 'b' },
      { type: 'text', body_markdown: 'c' },
    ]);
    expect(out.map((b) => b.key)).toEqual(['dup', 'text_3']);
  });

  it('parses a text block with localized markdown and layout', () => {
    const out = parse([
      {
        type: 'text',
        key: 't',
        title: { en: 'Title', ro: 'Titlu' },
        body_markdown: { en: 'Hello', ro: 'Salut' },
        layout: { spacing: 'md', background: 'muted', align: 'center', max_width: 'narrow' },
      },
    ]);
    expect(out[0]).toEqual(
      jasmine.objectContaining({ type: 'text', title: 'Title', body_html: md('Hello') }),
    );
  });

  it('uses the other language as fallback for localized values', () => {
    const out = parse(
      [{ type: 'text', key: 't', title: { ro: 'DoarRo' }, body_markdown: 'x' }],
      'en',
    );
    expect(out[0].title).toBe('DoarRo');
  });

  it('parses cta blocks and skips empty ones', () => {
    const out = parse([
      {
        type: 'cta',
        key: 'c1',
        body_markdown: 'Body',
        cta_label: 'Go',
        cta_url: '/x',
        cta_new_tab: true,
      },
      { type: 'cta', key: 'c2' },
    ]);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(
      jasmine.objectContaining({ type: 'cta', cta_label: 'Go', cta_url: '/x', cta_new_tab: true }),
    );
  });

  it('parses product_grid blocks with all source aliases and list parsing', () => {
    const out = parse([
      { type: 'product_grid', key: 'g1', source: 'categories', category_slug: 'cat', limit: 100 },
      { type: 'product_grid', key: 'g2', mode: 'collection', collection_slug: 'col' },
      { type: 'product_grid', key: 'g3', source: 'product', products: 'a, b\nc, a' },
      { type: 'product_grid', key: 'g4' },
    ]);
    expect(out.length).toBe(3);
    expect(out[0]).toEqual(jasmine.objectContaining({ source: 'category', limit: 24 }));
    expect(out[1].type === 'product_grid' && out[1].source).toBe('collection');
    expect(out[2].type === 'product_grid' && out[2].product_slugs).toEqual(['a', 'b', 'c']);
  });

  it('parses product_slugs from arrays and respects the limit', () => {
    const out = parse([{ type: 'product_grid', key: 'g', products: ['a', 'a', '', 3, 'b'] }]);
    expect(out[0].type === 'product_grid' && out[0].product_slugs).toEqual(['a', 'b']);
  });

  it('parses form blocks with contact topic and newsletter variant', () => {
    const out = parse([
      { type: 'form', key: 'f1', form_type: 'contact', topic: 'support' },
      { type: 'form', key: 'f2', variant: 'newsletter' },
      { type: 'form', key: 'f3', form_type: 'contact', topic: 'unknown' },
    ]);
    expect(out[0]).toEqual(jasmine.objectContaining({ form_type: 'contact', topic: 'support' }));
    expect(out[1]).toEqual(jasmine.objectContaining({ form_type: 'newsletter', topic: null }));
    expect(out[2].type === 'form' && out[2].topic).toBe('contact');
  });

  it('parses faq blocks, skipping invalid items, and skips empty faq', () => {
    const out = parse([
      {
        type: 'faq',
        key: 'q',
        items: [
          null,
          'x',
          { answer_markdown: 'no question' },
          { question: 'Q?', answer_markdown: 'A' },
        ],
      },
      { type: 'faq', key: 'q2', items: 'not-array' },
      { type: 'faq', key: 'q3', items: [{ answer_markdown: 'only answer' }] },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].type === 'faq' && out[0].items.length).toBe(1);
  });

  it('parses testimonials, skipping blank quotes', () => {
    const out = parse([
      {
        type: 'testimonials',
        key: 'tt',
        items: [
          null,
          { quote_markdown: '   ' },
          { quote_markdown: 'Great', author: 'Me', role: 'CEO' },
        ],
      },
      { type: 'testimonials', key: 'tt2', items: 'x' },
      { type: 'testimonials', key: 'tt3', items: [{ quote_markdown: ' ' }] },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].type === 'testimonials' && out[0].items[0].author).toBe('Me');
  });

  it('parses image blocks and skips ones without url', () => {
    const out = parse([
      {
        type: 'image',
        key: 'i1',
        url: '  /img.png ',
        link_url: ' /go ',
        focal_x: 200,
        focal_y: -5,
      },
      { type: 'image', key: 'i2', url: '' },
      { type: 'image', key: 'i3', url: '/no-link.png' },
    ]);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual(
      jasmine.objectContaining({ url: '/img.png', link_url: '/go', focal_x: 100, focal_y: 0 }),
    );
    expect(out[1].type === 'image' && out[1].link_url).toBeNull();
  });

  it('parses banner blocks and skips ones with empty slides', () => {
    const out = parse([
      { type: 'banner', key: 'b1', slide: { image_url: '/b.png', variant: 'full', size: 'large' } },
      { type: 'banner', key: 'b2', slide: {} },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].type === 'banner' && out[0].slide.variant).toBe('full');
    expect(out[0].type === 'banner' && out[0].slide.size).toBe('L');
  });

  it('parses carousel blocks, dropping invalid slides and empty carousels', () => {
    const out = parse([
      {
        type: 'carousel',
        key: 'c',
        slides: [
          null,
          {},
          { headline: 'H1' },
          { image_url: '/s.png', size: 's', text_style: 'light' },
        ],
        settings: { autoplay: '1', interval_ms: 500, show_dots: 'off', pause_on_hover: 0 },
      },
      { type: 'carousel', key: 'c2', slides: 'no' },
      { type: 'carousel', key: 'c3', slides: [{}] },
    ]);
    expect(out.length).toBe(1);
    const c = out[0];
    expect(c.type === 'carousel' && c.slides.length).toBe(2);
    expect(c.type === 'carousel' && c.settings).toEqual(
      jasmine.objectContaining({
        autoplay: true,
        interval_ms: 1000,
        show_dots: false,
        pause_on_hover: false,
      }),
    );
  });

  it('parses columns blocks with breakpoints and skips short/empty ones', () => {
    const out = parse([
      {
        type: 'columns',
        key: 'col',
        columns: [
          { body_markdown: 'a' },
          { title: 'B' },
          { body_markdown: 'c' },
          { body_markdown: 'extra' },
        ],
        breakpoint: 'lg',
      },
      { type: 'columns', key: 'col2', columns: [{ body_markdown: 'only one' }] },
      { type: 'columns', key: 'col3', columns: 'no' },
      { type: 'columns', key: 'col4', columns: [{}, {}] },
    ]);
    expect(out.length).toBe(1);
    const c = out[0];
    expect(c.type === 'columns' && c.columns_count).toBe(3);
    expect(c.type === 'columns' && c.breakpoint).toBe('lg');
  });

  it('defaults columns_count to 2 and breakpoint to md', () => {
    const out = parse([
      { type: 'columns', key: 'col', columns: [{ body_markdown: 'a' }, { body_markdown: 'b' }] },
    ]);
    expect(out[0].type === 'columns' && out[0].columns_count).toBe(2);
    expect(out[0].type === 'columns' && out[0].breakpoint).toBe('md');
  });

  it('parses gallery blocks, skipping invalid images, and skips empty galleries', () => {
    const out = parse([
      {
        type: 'gallery',
        key: 'g',
        images: [null, { url: '' }, { url: '/g1.png', caption: { en: 'cap' } }],
      },
      { type: 'gallery', key: 'g2', images: 'no' },
      { type: 'gallery', key: 'g3', images: [{ url: '' }] },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].type === 'gallery' && out[0].images.length).toBe(1);
  });
});

describe('parsePageBlocks branch edges', () => {
  it('reads localized values with ro-primary fallback to en', () => {
    // lang='ro': otherLang resolves to 'en'; here only en is present -> fallback path.
    const out = parse(
      [{ type: 'text', key: 't', title: { en: 'OnlyEn' }, body_markdown: 'x' }],
      'ro',
    );
    expect(out[0].title).toBe('OnlyEn');
  });

  it('returns null title when a localized object has neither language', () => {
    const out = parse([{ type: 'text', key: 't', title: { de: 'x' }, body_markdown: 'y' }]);
    expect(out[0].title).toBeNull();
  });

  it('treats whitespace-only localized strings as null', () => {
    const out = parse([{ type: 'text', key: 't', title: '   ', body_markdown: 'y' }]);
    expect(out[0].title).toBeNull();
  });

  it('reads numbers from numeric strings and falls back on bad ones', () => {
    const out = parse([{ type: 'image', key: 'i', url: '/x.png', focal_x: '30', focal_y: 'bad' }]);
    expect(out[0].type === 'image' && out[0].focal_x).toBe(30);
    expect(out[0].type === 'image' && out[0].focal_y).toBe(50);
  });

  it('reads boolean tokens in both true and false forms', () => {
    const out = parse([
      {
        type: 'carousel',
        key: 'c',
        slides: [{ image_url: '/s.png' }, { image_url: '/s2.png' }],
        settings: { autoplay: 'off', show_dots: 'yes', show_arrows: 'no', pause_on_hover: 'true' },
      },
    ]);
    const c = out[0];
    expect(c.type === 'carousel' && c.settings.autoplay).toBeFalse();
    expect(c.type === 'carousel' && c.settings.show_dots).toBeTrue();
    expect(c.type === 'carousel' && c.settings.show_arrows).toBeFalse();
    expect(c.type === 'carousel' && c.settings.pause_on_hover).toBeTrue();
  });

  it('uses boolean fallback for unrecognized boolean strings', () => {
    const out = parse([
      {
        type: 'carousel',
        key: 'c',
        slides: [{ image_url: '/s.png' }, { image_url: '/s2.png' }],
        settings: { autoplay: 'maybe' },
      },
    ]);
    expect(out[0].type === 'carousel' && out[0].settings.autoplay).toBeFalse();
  });

  it('accepts exact slide size tokens S/M/L', () => {
    const out = parse([{ type: 'banner', key: 'b', slide: { image_url: '/b.png', size: 'S' } }]);
    expect(out[0].type === 'banner' && out[0].slide.size).toBe('S');
  });

  it('maps product source manual/product aliases to products', () => {
    const out = parse([
      { type: 'product_grid', key: 'g1', source: 'manual', product_slugs: ['a'] },
      { type: 'product_grid', key: 'g2', source: 'somethingelse', product_slugs: ['b'] },
    ]);
    expect(out[0].type === 'product_grid' && out[0].source).toBe('products');
    expect(out[1].type === 'product_grid' && out[1].source).toBe('products');
  });

  it('respects the product_slugs limit for both arrays and strings', () => {
    const big = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const out = parse([
      { type: 'product_grid', key: 'g1', products: big },
      { type: 'product_grid', key: 'g2', products: big.join(',') },
    ]);
    expect(out[0].type === 'product_grid' && out[0].product_slugs?.length).toBe(50);
    expect(out[1].type === 'product_grid' && out[1].product_slugs?.length).toBe(50);
  });

  it('defaults an empty form_type to contact', () => {
    const out = parse([{ type: 'form', key: 'f', form_type: '' }]);
    expect(out[0].type === 'form' && out[0].form_type).toBe('contact');
  });

  it('skips entries whose type is not a string', () => {
    expect(parse([{ type: 123, key: 'x' }])).toEqual([]);
  });

  it('caps faq items at 20 and testimonials at 12', () => {
    const faqItems = Array.from({ length: 25 }, (_, i) => ({
      question: `Q${i}`,
      answer_markdown: 'a',
    }));
    const tItems = Array.from({ length: 15 }, (_, i) => ({ quote_markdown: `quote${i}` }));
    const out = parse([
      { type: 'faq', key: 'q', items: faqItems },
      { type: 'testimonials', key: 't', items: tItems },
    ]);
    expect(out[0].type === 'faq' && out[0].items.length).toBe(20);
    expect(out[1].type === 'testimonials' && out[1].items.length).toBe(12);
  });

  it('caps columns at 3 and skips non-object columns', () => {
    const out = parse([
      {
        type: 'columns',
        key: 'c',
        columns: [
          null,
          { body_markdown: 'a' },
          { body_markdown: 'b' },
          { body_markdown: 'c' },
          { body_markdown: 'd' },
        ],
      },
    ]);
    expect(out[0].type === 'columns' && out[0].columns.length).toBe(3);
  });

  it('skips gallery images that are not objects or lack a url', () => {
    const out = parse([{ type: 'gallery', key: 'g', images: [null, 5, { url: '/ok.png' }] }]);
    expect(out[0].type === 'gallery' && out[0].images.length).toBe(1);
  });
});

describe('pageBlocksToPlainText', () => {
  it('serializes content of all block kinds and skips disabled', () => {
    const blocks = parse([
      { type: 'text', key: 't', title: 'T', body_markdown: 'body text' },
      { type: 'cta', key: 'c', body_markdown: 'cta body', cta_label: 'Click' },
      { type: 'faq', key: 'f', items: [{ question: 'Q', answer_markdown: 'Ans' }] },
      {
        type: 'testimonials',
        key: 'ts',
        items: [{ quote_markdown: 'Quote', author: 'Au', role: 'Ro' }],
      },
      { type: 'image', key: 'i', url: '/x.png', caption: 'Cap' },
      { type: 'gallery', key: 'g', images: [{ url: '/y.png', caption: 'GCap' }] },
      {
        type: 'banner',
        key: 'b',
        slide: { image_url: '/b.png', headline: 'BH', subheadline: 'BS', cta_label: 'BC' },
      },
      {
        type: 'carousel',
        key: 'cr',
        slides: [{ image_url: '/s.png', headline: 'CH', subheadline: 'CS', cta_label: 'CC' }],
      },
      {
        type: 'columns',
        key: 'co',
        columns: [{ title: 'CoT', body_markdown: 'col body' }, { body_markdown: 'b2' }],
      },
    ]);
    const text = pageBlocksToPlainText(blocks);
    expect(text).toContain('body text');
    expect(text).toContain('Click');
    expect(text).toContain('Q');
    expect(text).toContain('Ans');
    expect(text).toContain('Quote');
    expect(text).toContain('Au');
    expect(text).toContain('Cap');
    expect(text).toContain('GCap');
    expect(text).toContain('BH');
    expect(text).toContain('CH');
    expect(text).toContain('col body');
  });

  it('skips disabled blocks and empty html', () => {
    const blocks: PageBlock[] = [
      { key: 'd', type: 'text', enabled: false, title: 'X', body_html: '<p>x</p>' },
      { key: 'e', type: 'text', enabled: true, body_html: '   ' },
    ];
    expect(pageBlocksToPlainText(blocks)).toBe('');
  });

  it('htmlToText collapses tags/whitespace in text blocks', () => {
    const blocks: PageBlock[] = [
      { key: 't', type: 'text', enabled: true, body_html: '<p>Hello   <b>world</b></p>' },
    ];
    expect(pageBlocksToPlainText(blocks)).toBe('Hello world');
  });

  it('handles cta/banner/carousel without optional fields', () => {
    const blocks: PageBlock[] = [
      { key: 'c', type: 'cta', enabled: true, body_html: '' },
      {
        key: 'b',
        type: 'banner',
        enabled: true,
        slide: { image_url: '/b.png', variant: 'full', size: 'M', text_style: 'dark' },
      },
      {
        key: 'cr',
        type: 'carousel',
        enabled: true,
        slides: [{ image_url: '/s.png', variant: 'full', size: 'M', text_style: 'dark' }],
        settings: {
          autoplay: false,
          interval_ms: 5000,
          show_dots: true,
          show_arrows: true,
          pause_on_hover: true,
        },
      },
    ];
    expect(pageBlocksToPlainText(blocks)).toBe('');
  });
});
