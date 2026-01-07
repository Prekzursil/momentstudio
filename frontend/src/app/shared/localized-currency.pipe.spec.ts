import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { LocalizedCurrencyPipe } from './localized-currency.pipe';

describe('LocalizedCurrencyPipe', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()]
    });
  });

  it('appends EUR/USD approximations for EN when currency is RON', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');

    const result = TestBed.runInInjectionContext(() => new LocalizedCurrencyPipe().transform(100, 'RON', 'en-US'));
    expect(result).toContain('RON');
    expect(result).toContain('≈');
    expect(result).toContain('€');
    expect(result).toContain('$');
    expect(result).toMatch(/\(≈.*€.*≈.*\$/);
  });

  it('does not append approximations for RO', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');

    const result = TestBed.runInInjectionContext(() => new LocalizedCurrencyPipe().transform(100, 'RON', 'ro-RO'));
    expect(result).toContain('RON');
    expect(result).not.toContain('≈');
  });

  it('does not append approximations for non-RON currencies', () => {
    const translate = TestBed.inject(TranslateService);
    translate.use('en');

    const result = TestBed.runInInjectionContext(() => new LocalizedCurrencyPipe().transform(100, 'USD', 'en-US'));
    expect(result).toContain('$');
    expect(result).not.toContain('≈');
  });
});

