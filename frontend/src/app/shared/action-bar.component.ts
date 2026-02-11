import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-action-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      [ngClass]="stickyOnMobile ? 'sticky bottom-3 md:static' : ''"
    >
      <ng-content></ng-content>
    </div>
  `
})
export class ActionBarComponent {
  @Input() stickyOnMobile = true;
}

