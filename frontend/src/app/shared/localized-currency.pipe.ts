import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FxRatesService } from '../core/fx-rates.service';

@Pipe({
  name: 'localizedCurrency',
  standalone: true,
  pure: false
})
export class LocalizedCurrencyPipe implements PipeTransform {
  private readonly translate = inject(TranslateService, { optional: true });
  private readonly fxRates = inject(FxRatesService);

  transform(value: number, currency: string, locale?: string): string {
    const fromLang = this.translate?.currentLang === 'ro' ? 'ro-RO' : this.translate?.currentLang === 'en' ? 'en-US' : undefined;
    const loc = locale || fromLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    const base = new Intl.NumberFormat(loc, { style: 'currency', currency }).format(value);

    const shouldApproximate =
      (this.translate?.currentLang ?? '').toLowerCase() === 'en' &&
      (currency ?? '').toUpperCase() === 'RON';

    if (!shouldApproximate) {
      return base;
    }

    this.fxRates.ensureLoaded();
    const rates = this.fxRates.snapshot;
    if (!rates.loaded || rates.eurPerRon <= 0 || rates.usdPerRon <= 0) {
      return base;
    }

    const eurValue = value * rates.eurPerRon;
    const usdValue = value * rates.usdPerRon;

    const eur = new Intl.NumberFormat(loc, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    }).format(eurValue);

    const usd = new Intl.NumberFormat(loc, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    }).format(usdValue);

    return `${base} (≈${eur}, ≈${usd})`;
  }
}
