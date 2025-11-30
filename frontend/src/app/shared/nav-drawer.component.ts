import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass, NgForOf } from '@angular/common';
import { RouterLink } from '@angular/router';

export interface NavLink {
  label: string;
  path: string;
}

@Component({
  selector: 'app-nav-drawer',
  standalone: true,
  imports: [NgForOf, NgClass, RouterLink],
  template: `
    <div
      class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity"
      [ngClass]="{ 'opacity-0 pointer-events-none': !open }"
      (click)="onClose()"
    ></div>
    <aside
      class="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-xl border-r border-slate-200 transform transition-transform"
      [ngClass]="{ '-translate-x-full': !open, 'translate-x-0': open }"
      role="dialog"
      aria-modal="true"
    >
      <div class="p-4 flex items-center justify-between border-b border-slate-200">
        <span class="font-semibold text-slate-900">Menu</span>
        <button class="text-slate-600 hover:text-slate-900" (click)="onClose()" aria-label="Close menu">✕</button>
      </div>
      <nav class="p-4 grid gap-3">
        <a
          *ngFor="let link of links"
          [routerLink]="link.path"
          (click)="onClose()"
          class="text-slate-800 hover:text-slate-900 font-medium"
        >
          {{ link.label }}
        </a>
      </nav>
    </aside>
  `
})
export class NavDrawerComponent {
  @Input() open = false;
  @Input() links: NavLink[] = [];
  @Output() closed = new EventEmitter<void>();

  onClose(): void {
    this.closed.emit();
  }
}
