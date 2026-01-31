import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FxRatesService } from '../core/fx-rates.service';
import { parseMoney } from './money';

@Pipe({
  name: 'localizedCurrency',
  standalone: true,
  pure: false
})
export class LocalizedCurrencyPipe implements PipeTransform {
  private readonly translate = inject(TranslateService, { optional: true });
  private readonly fxRates = inject(FxRatesService);
  private readonly formatters = new Map<string, Intl.NumberFormat>();

  private formatRon(value: number): string {
    if (!Number.isFinite(value)) return `0.00 RON`;
    return `${value.toFixed(2)} RON`;
  }

  private getFormatter(
    locale: string,
    currency: string,
    minFractionDigits?: number,
    maxFractionDigits?: number
  ): Intl.NumberFormat {
    const key = `${locale}|${currency}|${minFractionDigits ?? ''}|${maxFractionDigits ?? ''}`;
    const existing = this.formatters.get(key);
    if (existing) return existing;
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      ...(minFractionDigits !== undefined ? { minimumFractionDigits: minFractionDigits } : {}),
      ...(maxFractionDigits !== undefined ? { maximumFractionDigits: maxFractionDigits } : {})
    });
    this.formatters.set(key, formatter);
    return formatter;
  }

  transform(value: unknown, currency: string, locale?: string): string {
    const normalizedCurrency = (currency ?? '').toUpperCase();
    const fromLang = this.translate?.currentLang === 'ro' ? 'ro-RO' : this.translate?.currentLang === 'en' ? 'en-US' : undefined;
    const loc = locale || fromLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    const amount = parseMoney(value);
    const base = normalizedCurrency === 'RON' ? this.formatRon(amount) : this.getFormatter(loc, currency).format(amount);

    const shouldApproximate =
      (this.translate?.currentLang ?? '').toLowerCase() === 'en' &&
      normalizedCurrency === 'RON';

    if (!shouldApproximate) {
      return base;
    }

    this.fxRates.ensureLoaded();
    const rates = this.fxRates.snapshot;
    if (!rates.loaded || rates.eurPerRon <= 0 || rates.usdPerRon <= 0) {
      return base;
    }

    const eurValue = amount * rates.eurPerRon;
    const usdValue = amount * rates.usdPerRon;

    const eur = this.getFormatter(loc, 'EUR', 2, 2).format(eurValue);

    const usd = this.getFormatter(loc, 'USD', 2, 2).format(usdValue);

    return `${base} (≈${eur}, ≈${usd})`;
  }
}
