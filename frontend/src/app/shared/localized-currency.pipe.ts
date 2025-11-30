import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'localizedCurrency',
  standalone: true
})
export class LocalizedCurrencyPipe implements PipeTransform {
  transform(value: number, currency: string, locale?: string): string {
    const loc = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    return new Intl.NumberFormat(loc, { style: 'currency', currency }).format(value);
  }
}
