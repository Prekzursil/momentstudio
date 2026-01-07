import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { appConfig } from '../core/app-config';

@Pipe({
  name: 'localizedCurrency',
  standalone: true
})
export class LocalizedCurrencyPipe implements PipeTransform {
  private readonly translate = inject(TranslateService, { optional: true });

  transform(value: number, currency: string, locale?: string): string {
    const fromLang = this.translate?.currentLang === 'ro' ? 'ro-RO' : this.translate?.currentLang === 'en' ? 'en-US' : undefined;
    const loc = locale || fromLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    const base = new Intl.NumberFormat(loc, { style: 'currency', currency }).format(value);

    const shouldApproximate =
      (this.translate?.currentLang ?? '').toLowerCase() === 'en' &&
      (currency ?? '').toUpperCase() === 'RON' &&
      Number.isFinite(appConfig.fxEurPerRon) &&
      Number.isFinite(appConfig.fxUsdPerRon) &&
      appConfig.fxEurPerRon > 0 &&
      appConfig.fxUsdPerRon > 0;

    if (!shouldApproximate) {
      return base;
    }

    const eurValue = value * appConfig.fxEurPerRon;
    const usdValue = value * appConfig.fxUsdPerRon;

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
