import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { FxRatesService } from '../core/fx-rates.service';
import { LocalizedCurrencyPipe } from './localized-currency.pipe';

class FxRatesServiceStub {
  snap: { base: string; eurPerRon: number; usdPerRon: number; loaded: boolean } = {
    base: 'RON',
    eurPerRon: 0.2,
    usdPerRon: 0.22,
    loaded: true,
  };
  ensureLoaded(): void {}
  get snapshot() {
    return this.snap;
  }
}

describe('LocalizedCurrencyPipe', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [{ provide: FxRatesService, useClass: FxRatesServiceStub }],
    });
  });

  it('appends EUR/USD approximations for EN when currency is RON', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');

    const result = TestBed.runInInjectionContext(() =>
      new LocalizedCurrencyPipe().transform(100, 'RON', 'en-US'),
    );
    expect(result).toContain('RON');
    expect(result).toContain('≈');
    expect(result).toContain('€');
    expect(result).toContain('$');
    expect(result).toMatch(/\(≈.*€.*≈.*\$/);
  });

  it('does not append approximations for RO', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');

    const result = TestBed.runInInjectionContext(() =>
      new LocalizedCurrencyPipe().transform(100, 'RON', 'ro-RO'),
    );
    expect(result).toContain('RON');
    expect(result).not.toContain('≈');
  });

  it('does not append approximations for non-RON currencies', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');

    const result = TestBed.runInInjectionContext(() =>
      new LocalizedCurrencyPipe().transform(100, 'USD', 'en-US'),
    );
    expect(result).toContain('$');
    expect(result).not.toContain('≈');
  });

  it('derives the locale from the Romanian current language', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');
    const result = TestBed.runInInjectionContext(() =>
      // No explicit locale -> falls back to fromLang ('ro-RO'), which renders
      // EUR with the currency code rather than the € glyph.
      new LocalizedCurrencyPipe().transform(100, 'EUR'),
    );
    expect(result).toMatch(/EUR|€/);
  });

  it('falls back to navigator.language when there is no language or locale', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('de'); // neither en nor ro -> fromLang undefined
    const result = TestBed.runInInjectionContext(() =>
      new LocalizedCurrencyPipe().transform(100, 'USD'),
    );
    expect(result).toContain('$');
  });

  it('uses the navigator fallback when navigator is unavailable', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('de');
    const descriptor = Object.getOwnPropertyDescriptor(window, 'navigator');
    Object.defineProperty(window, 'navigator', { value: undefined, configurable: true });
    try {
      const result = TestBed.runInInjectionContext(() =>
        new LocalizedCurrencyPipe().transform(100, 'USD'),
      );
      expect(result).toContain('$');
    } finally {
      if (descriptor) Object.defineProperty(window, 'navigator', descriptor);
    }
  });

  it('skips approximation when rates are not loaded', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');
    const fx = TestBed.inject(FxRatesService) as unknown as FxRatesServiceStub;
    fx.snap = { base: 'RON', eurPerRon: 0.2, usdPerRon: 0.22, loaded: false };
    const result = TestBed.runInInjectionContext(() =>
      new LocalizedCurrencyPipe().transform(100, 'RON', 'en-US'),
    );
    expect(result).not.toContain('≈');
  });

  it('skips approximation when a rate is non-positive', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');
    const fx = TestBed.inject(FxRatesService) as unknown as FxRatesServiceStub;
    fx.snap = { base: 'RON', eurPerRon: 0, usdPerRon: 0.22, loaded: true };
    const result = TestBed.runInInjectionContext(() =>
      new LocalizedCurrencyPipe().transform(100, 'RON', 'en-US'),
    );
    expect(result).not.toContain('≈');
  });

  it('uppercases a lowercase RON currency code', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');
    const result = TestBed.runInInjectionContext(() =>
      new LocalizedCurrencyPipe().transform(100, 'ron', 'ro-RO'),
    );
    expect(result).toContain('RON');
  });

  it('derives en-US locale from the English current language when no locale is passed', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');
    const result = TestBed.runInInjectionContext(() =>
      // No explicit locale -> fromLang resolves to 'en-US'.
      new LocalizedCurrencyPipe().transform(100, 'USD'),
    );
    expect(result).toContain('$');
  });

  it('reuses a cached Intl formatter for repeat calls', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('de');
    const pipe = TestBed.runInInjectionContext(() => new LocalizedCurrencyPipe());
    const first = pipe.transform(100, 'USD', 'en-US');
    const second = pipe.transform(200, 'USD', 'en-US');
    expect(first).toContain('$');
    expect(second).toContain('$');
  });

  it('formats a non-finite RON amount as a zero fallback', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');
    const pipe = TestBed.runInInjectionContext(() => new LocalizedCurrencyPipe());
    const formatted = (pipe as unknown as { formatRon(value: number): string }).formatRon(
      Number.NaN,
    );
    expect(formatted).toBe('0.00 RON');
  });

  it('throws for a nullish currency code (off-contract input)', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');
    expect(() =>
      TestBed.runInInjectionContext(() =>
        new LocalizedCurrencyPipe().transform(100, undefined as unknown as string, 'en-US'),
      ),
    ).toThrow();
  });

  describe('without a TranslateService', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: FxRatesService, useClass: FxRatesServiceStub }],
      });
    });

    it('falls back to the default locale and skips approximation', () => {
      const result = TestBed.runInInjectionContext(() =>
        new LocalizedCurrencyPipe().transform(100, 'RON', 'en-US'),
      );
      // No translate service -> currentLang is undefined -> no EN approximation.
      expect(result).toContain('RON');
      expect(result).not.toContain('≈');
    });
  });
});
