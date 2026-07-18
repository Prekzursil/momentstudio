/**
 * Surface-coverage contract (P1a WU5), CI-authoritative (karma / ChromeHeadless).
 *
 * NON-TAUTOLOGICAL: this drives the REAL compiled Tailwind alias classes
 * (`bg-background`, `hover:bg-surface-muted`, `text-text-heading`, `.font-heading`, …)
 * emitted from `tailwind.config.cjs` + `styles.css`, NOT a hand-written
 * `rgb(var(--token, default))` string. Karma loads `src/styles.css` (Tailwind-compiled),
 * and these class names appear as string literals below so Tailwind's content scan emits
 * their utilities. We then read `getComputedStyle` off real elements, so the assertions
 * exercise the actual alias output the storefront templates consume.
 *
 * It proves three things the adversarial review demanded:
 *   1. a mapped surface RESOLVES THROUGH its `--token` (override the token -> the rendered
 *      colour changes), i.e. the class is not a baked literal;
 *   2. the compiled alias carries its LIGHT compiled-default fallback (never-unstyled);
 *   3. THE REGRESSION GUARD — an interactive control's base fill (`bg-background`) and its
 *      hover fill (`hover:bg-surface-muted`) resolve to DISTINCT rendered colours, so
 *      light-mode hover feedback cannot vanish (the exact blocked bug).
 */
const ROOT = document.documentElement;

function computed(className: string, prop: string): string {
  const el = document.createElement('div');
  el.className = className;
  document.body.appendChild(el);
  const value = getComputedStyle(el).getPropertyValue(prop).trim();
  el.remove();
  return value;
}

/** Text/RGB of the first compiled rule whose selector text includes `needle`. */
function ruleText(needle: string): string {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet — skip
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.includes(needle)) {
        return rule.cssText;
      }
    }
  }
  return '';
}

describe('theme surface-coverage (compiled alias output)', () => {
  const touched: string[] = [];
  const setToken = (name: string, value: string): void => {
    touched.push(name);
    ROOT.style.setProperty(name, value);
  };
  afterEach(() => {
    while (touched.length) {
      ROOT.style.removeProperty(touched.pop() as string);
    }
  });

  // Real alias classes -> the (light) rgb the token resolves to on :root.
  const surfaces: ReadonlyArray<{ cls: string; prop: string; rgb: string }> = [
    { cls: 'bg-background', prop: 'background-color', rgb: 'rgb(255, 255, 255)' },
    { cls: 'bg-surface', prop: 'background-color', rgb: 'rgb(241, 245, 249)' },
    { cls: 'bg-surface-muted', prop: 'background-color', rgb: 'rgb(248, 250, 252)' },
    { cls: 'bg-surface-inverse', prop: 'background-color', rgb: 'rgb(15, 23, 42)' },
    { cls: 'text-text', prop: 'color', rgb: 'rgb(51, 65, 85)' },
    { cls: 'text-text-heading', prop: 'color', rgb: 'rgb(15, 23, 42)' },
    { cls: 'text-text-muted', prop: 'color', rgb: 'rgb(100, 116, 139)' },
    { cls: 'text-accent', prop: 'color', rgb: 'rgb(79, 70, 229)' },
  ];

  for (const { cls, prop, rgb } of surfaces) {
    it(`renders ${cls} through its token to the compiled default`, () => {
      expect(computed(cls, prop)).toBe(rgb);
    });
  }

  it('resolves THROUGH the token (override the CSS var -> rendered colour changes)', () => {
    expect(computed('bg-surface-muted', 'background-color')).toBe('rgb(248, 250, 252)');
    setToken('--surface-muted', '10 20 30');
    expect(computed('bg-surface-muted', 'background-color')).toBe('rgb(10, 20, 30)');
  });

  it('carries the compiled-default fallback in the alias (never renders unstyled)', () => {
    // The Tailwind alias is rgb(var(--surface, 241 245 249) / <alpha>): the light default
    // is inlined as the var() fallback, so a surface paints even before SSR injects :root.
    expect(ruleText('.bg-surface')).toContain('var(--surface, 241 245 249');
  });

  it('THE REGRESSION GUARD: base fill != hover fill in the rendered output', () => {
    const base = computed('bg-background', 'background-color');
    const hover = computed('bg-surface-muted', 'background-color');
    expect(base).toBe('rgb(255, 255, 255)');
    expect(hover).toBe('rgb(248, 250, 252)');
    expect(base).not.toBe(hover);
    expect(computed('bg-surface', 'background-color')).not.toBe(hover);
  });

  it('emits a real :hover rule for the interactive hover fill (distinct token)', () => {
    // `hover:bg-surface-muted` must compile to a :hover rule bound to --surface-muted,
    // proving base (bg-background -> --background) and hover target are different tokens.
    const rule = ruleText('.hover\\:bg-surface-muted:hover');
    expect(rule).toContain(':hover');
    expect(rule).toContain('--surface-muted');
  });

  it('drives the heading typeface through --font-heading', () => {
    expect(computed('font-heading', 'font-family')).toContain('Cinzel');
    setToken('--font-heading', 'Georgia, serif');
    expect(computed('font-heading', 'font-family')).toContain('Georgia');
  });

  it('drives the root type-scale through --font-size-base', () => {
    // styles.css sets :root { font-size: var(--font-size-base, clamp(...)) }.
    const before = getComputedStyle(ROOT).fontSize;
    setToken('--font-size-base', '25px');
    expect(getComputedStyle(ROOT).fontSize).toBe('25px');
    expect(getComputedStyle(ROOT).fontSize).not.toBe(before === '25px' ? 'never' : before);
  });
});
