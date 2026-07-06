import { EventEmitter } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SEED_TOKENS } from '../../../core/theme/token-taxonomy';
import { ThemeLivePreviewComponent } from './theme-live-preview.component';

const ROOT = document.documentElement;

/** A handful of seed tokens the WU7 service hydrates the preview from. */
const SEEDED: ReadonlyArray<readonly [string, string]> = [
  ['--accent', '79 70 229'],
  ['--background', '255 255 255'],
  ['--surface', '241 245 249'],
  ['--text', '51 65 85'],
];

/** Strip every seed token this suite may have written to the global `:root`. */
function clearRoot(): void {
  for (const token of SEED_TOKENS) {
    ROOT.style.removeProperty(token.name);
  }
}

describe('ThemeLivePreviewComponent', () => {
  beforeEach(async () => {
    clearRoot();
    // Prime the global `:root` so the WU7 ThemeTokensService hydrates a non-empty
    // in-memory map, which the preview seeds onto its scoped host on construction.
    for (const [name, value] of SEEDED) {
      ROOT.style.setProperty(name, value);
    }
    await TestBed.configureTestingModule({
      imports: [ThemeLivePreviewComponent],
    }).compileComponents();
  });

  afterEach(() => clearRoot());

  it('seeds the scoped preview root from the WU7 in-memory service on construction', () => {
    const fixture = TestBed.createComponent(ThemeLivePreviewComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    // The current server-resolved tokens (hydrated by WU7) are mirrored onto the
    // preview's OWN host element — a self-contained, scoped snapshot.
    expect(host.style.getPropertyValue('--accent')).toBe('79 70 229');
    expect(host.style.getPropertyValue('--background')).toBe('255 255 255');
  });

  it('applies a valid token change to the scoped root only — never the global :root', () => {
    const globalSpy = spyOn(ROOT.style, 'setProperty').and.callThrough();
    const fixture = TestBed.createComponent(ThemeLivePreviewComponent);
    const host = fixture.nativeElement as HTMLElement;

    const result = fixture.componentInstance.applyToken('--accent', '10 20 30');

    expect(result.ok).toBeTrue();
    expect(result.value).toBe('10 20 30');
    // The change lands on the scoped preview host...
    expect(host.style.getPropertyValue('--accent')).toBe('10 20 30');
    // ...and NEVER on the global document root (admin chrome stays untouched).
    expect(globalSpy).not.toHaveBeenCalled();
  });

  it('updates the preview on every change with no service publish / HTTP round-trip', () => {
    const fetchSpy = spyOn(window, 'fetch');
    const fixture = TestBed.createComponent(ThemeLivePreviewComponent);
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.applyToken('--accent', '1 2 3');
    expect(host.style.getPropertyValue('--accent')).toBe('1 2 3');
    fixture.componentInstance.applyToken('--accent', '4 5 6');
    expect(host.style.getPropertyValue('--accent')).toBe('4 5 6');

    // Read-only: no backend round-trip, ever.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the compiled default for a known key with a breakout value', () => {
    const fixture = TestBed.createComponent(ThemeLivePreviewComponent);
    const host = fixture.nativeElement as HTMLElement;

    const result = fixture.componentInstance.applyToken(
      '--background',
      '9 9 9) } html{background:red',
    );

    expect(result.ok).toBeFalse();
    // The tainted value never paints; the WU2 compiled default is applied instead.
    expect(result.value).toBe('255 255 255');
    expect(host.style.getPropertyValue('--background')).toBe('255 255 255');
  });

  it('never touches the scoped root for an unknown (non-registry) token name', () => {
    const fixture = TestBed.createComponent(ThemeLivePreviewComponent);
    const host = fixture.nativeElement as HTMLElement;
    const hostSpy = spyOn(host.style, 'setProperty').and.callThrough();

    const result = fixture.componentInstance.applyToken('--totally-unknown', '1 2 3');

    expect(result.ok).toBeFalse();
    expect(result.value).toBe('');
    expect(hostSpy).not.toHaveBeenCalled();
  });

  it('exposes NO selection / drag / inline-edit affordance (mini-canvas-creep guard)', () => {
    const fixture = TestBed.createComponent(ThemeLivePreviewComponent);
    const instance = fixture.componentInstance as unknown as Record<string, unknown>;

    const forbidden =
      /select|drag|drop|edit|delete|remove|insert|move|reorder|mutate|add(block|section|widget)/i;
    const keys = [
      ...Object.getOwnPropertyNames(instance),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(instance)),
    ];

    for (const key of keys) {
      expect(forbidden.test(key)).withContext(`member "${key}"`).toBeFalse();
      // No @Output()/EventEmitter — the preview emits no block-editing events.
      expect(instance[key] instanceof EventEmitter)
        .withContext(`member "${key}"`)
        .toBeFalse();
    }
  });

  it('renders a representative themed storefront surface (theme-only, read-only)', () => {
    const fixture = TestBed.createComponent(ThemeLivePreviewComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    // A representative home/listing/detail surface exists...
    expect(host.querySelector('[data-preview="heading"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-preview="card"]').length).toBeGreaterThan(0);
    // ...with NO interactive editing controls (no buttons, inputs, or handlers).
    expect(host.querySelectorAll('button, input, textarea, select').length).toBe(0);
  });
});
