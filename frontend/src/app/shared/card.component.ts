import { NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [NgIf],
  template: `
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:shadow-none">
      <div *ngIf="title" class="text-base font-semibold text-slate-900 dark:text-slate-50 mb-2">{{ title }}</div>
      <div *ngIf="subtitle" class="text-sm text-slate-600 dark:text-slate-300">{{ subtitle }}</div>
      <ng-content></ng-content>
    </div>
  `
})
export class CardComponent {
  @Input() title = '';
  @Input() subtitle = '';
}
