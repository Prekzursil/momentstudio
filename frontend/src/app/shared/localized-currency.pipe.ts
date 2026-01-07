import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Pipe({
  name: 'localizedCurrency',
  standalone: true
})
export class LocalizedCurrencyPipe implements PipeTransform {
  private readonly translate = inject(TranslateService, { optional: true });

  transform(value: number, currency: string, locale?: string): string {
    const fromLang = this.translate?.currentLang === 'ro' ? 'ro-RO' : this.translate?.currentLang === 'en' ? 'en-US' : undefined;
    const loc = locale || fromLang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    return new Intl.NumberFormat(loc, { style: 'currency', currency }).format(value);
  }
}
