import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { SkeletonComponent } from './skeleton.component';

@Component({
  selector: 'app-loading-state',
  standalone: true,
  host: {
    'data-loading-state': 'true',
    'aria-busy': 'true',
  },
  imports: [CommonModule, SkeletonComponent],
  template: `
    <div class="grid gap-3" [class.p-4]="padded">
      <div *ngFor="let _ of placeholders" class="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <app-skeleton [height]="titleHeight" [width]="titleWidth"></app-skeleton>
        <app-skeleton [height]="lineHeight" width="95%"></app-skeleton>
        <app-skeleton [height]="lineHeight" width="82%"></app-skeleton>
      </div>
    </div>
  `
})
export class LoadingStateComponent {
  @Input() rows = 3;
  @Input() padded = false;
  @Input() titleHeight = '18px';
  @Input() titleWidth = '45%';
  @Input() lineHeight = '14px';

  get placeholders(): number[] {
    return Array.from({ length: Math.max(1, this.rows) }, (_, idx) => idx);
  }
}
