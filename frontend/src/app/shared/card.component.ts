import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  template: `
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-6">
      <div *ngIf="title" class="text-base font-semibold text-slate-900 mb-2">{{ title }}</div>
      <ng-content></ng-content>
    </div>
  `
})
export class CardComponent {
  @Input() title = '';
}
