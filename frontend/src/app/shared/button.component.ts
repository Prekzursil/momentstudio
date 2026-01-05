import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';

type ButtonVariant = 'primary' | 'ghost';
type ButtonSize = 'md' | 'sm';
type ButtonType = 'button' | 'submit' | 'reset';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [NgIf, NgClass, RouterLink],
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
        [attr.type]="type"
        [ngClass]="classes"
        class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        [disabled]="disabled"
        (click)="onClick($event)"
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
  @Input() type: ButtonType = 'button';
  @Input() routerLink?: string | any[];
  @Input() disabled = false;
  @Output() action = new EventEmitter<void>();

  get classes(): string {
    const base = this.variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
      : 'bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600';
    const sizeCls = this.size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-sm';
    const state = this.disabled ? 'opacity-60 cursor-not-allowed' : '';
    return `${base} ${sizeCls} ${state}`;
  }

  onClick(event: MouseEvent): void {
    if (this.disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.type === 'button') {
      this.action.emit();
    }
  }
}
