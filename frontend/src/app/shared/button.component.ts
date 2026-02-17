import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';

type ButtonVariant = 'primary' | 'ghost';
type ButtonSize = 'md' | 'sm';
type ButtonType = 'button' | 'submit' | 'reset';

@Component({
  selector: 'app-button',
  standalone: true,
  host: {
    role: 'none',
    tabindex: '-1',
  },
  imports: [NgIf, NgClass, RouterLink],
  template: `
    <ng-container *ngIf="routerLink; else linkTpl">
      <a
        [routerLink]="routerLink"
        [queryParams]="queryParams"
        [fragment]="fragment"
        [ngClass]="classes"
        class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        [attr.aria-disabled]="disabled || null"
        [attr.tabindex]="disabled ? -1 : null"
        (click)="onAnchorClick($event)"
      >
        <ng-content></ng-content>
        <span *ngIf="label">{{ label }}</span>
      </a>
    </ng-container>
    <ng-template #linkTpl>
      <ng-container *ngIf="href; else buttonTpl">
        <a
          [attr.href]="disabled ? null : href"
          [attr.target]="target || null"
          [attr.rel]="rel || null"
          [ngClass]="classes"
          class="inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          [attr.aria-disabled]="disabled || null"
          [attr.tabindex]="disabled ? -1 : null"
          (click)="onAnchorClick($event)"
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
    </ng-template>
  `
})
export class ButtonComponent {
  @Input() label = '';
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() type: ButtonType = 'button';
  @Input() routerLink?: string | any[];
  @Input() queryParams?: Record<string, any> | null;
  @Input() fragment?: string | null;
  @Input() href?: string | null;
  @Input() target?: string | null;
  @Input() rel?: string | null;
  @Input() disabled = false;
  @Output() action = new EventEmitter<void>();

  get classes(): string {
    const base = this.variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
      : 'bg-white text-slate-900 border border-slate-200 hover:border-slate-300 focus-visible:outline-slate-900 dark:bg-slate-800 dark:text-slate-50 dark:border-slate-700 dark:hover:border-slate-600';
    const sizeCls = this.size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-sm';
    const state = this.disabled ? 'opacity-60 cursor-not-allowed pointer-events-none' : '';
    return `${base} ${sizeCls} ${state}`;
  }

  onAnchorClick(event: MouseEvent): void {
    if (!this.disabled) return;

    event.preventDefault();
    event.stopPropagation();
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
