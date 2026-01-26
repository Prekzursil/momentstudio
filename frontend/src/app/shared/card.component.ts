import { NgClass, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [NgIf, NgClass],
  template: `
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:shadow-none"
      [ngClass]="
        clickable
          ? 'cursor-pointer hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500/40 dark:hover:border-slate-700'
          : ''
      "
      [attr.role]="clickable ? 'button' : null"
      [attr.tabindex]="clickable ? 0 : null"
      (click)="onClick($event)"
      (keydown)="onKeyDown($event)"
    >
      <div *ngIf="title" class="text-base font-semibold text-slate-900 dark:text-slate-50 mb-2">{{ title }}</div>
      <div *ngIf="subtitle" class="text-sm text-slate-600 dark:text-slate-300">{{ subtitle }}</div>
      <ng-content></ng-content>
    </div>
  `
})
export class CardComponent {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() clickable = false;
  @Output() action = new EventEmitter<void>();

  onClick(event: MouseEvent): void {
    if (!this.clickable) return;
    const target = event.target as HTMLElement | null;
    const interactive = target?.closest('button, a, input, textarea, select, label');
    if (interactive) return;
    this.action.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.clickable) return;
    const key = event.key;
    if (key !== 'Enter' && key !== ' ') return;
    event.preventDefault();
    this.action.emit();
  }
}
