import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';

type ButtonVariant = 'primary' | 'ghost';
type ButtonSize = 'md' | 'sm';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [NgClass],
  template: `
    <button
      type="button"
      [ngClass]="classes"
      class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      (click)="action.emit()"
    >
      <ng-content></ng-content>
      <span *ngIf="label">{{ label }}</span>
    </button>
  `
})
export class ButtonComponent {
  @Input() label = '';
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Output() action = new EventEmitter<void>();

  get classes(): string {
    const base = this.variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900'
      : 'bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline-slate-900';
    const sizeCls = this.size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-sm';
    return `${base} ${sizeCls}`;
  }
}
