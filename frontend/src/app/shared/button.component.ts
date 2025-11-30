import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';

type ButtonVariant = 'primary' | 'ghost';
type ButtonSize = 'md' | 'sm';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [NgClass, RouterLink],
  template: `
    <ng-container *ngIf="routerLink; else buttonTpl">
      <a
        [routerLink]="routerLink"
        [ngClass]="classes"
        class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ng-content></ng-content>
        <span *ngIf="label">{{ label }}</span>
      </a>
    </ng-container>
    <ng-template #buttonTpl>
      <button
        type="button"
        [ngClass]="classes"
        class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        (click)="action.emit()"
      >
        <ng-content></ng-content>
        <span *ngIf="label">{{ label }}</span>
      </button>
    </ng-template>
  `
})
export class ButtonComponent {
  @Input() label = '';
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() routerLink?: string | any[];
  @Output() action = new EventEmitter<void>();

  get classes(): string {
    const base = this.variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900'
      : 'bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline-slate-900';
    const sizeCls = this.size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-sm';
    return `${base} ${sizeCls}`;
  }
}
