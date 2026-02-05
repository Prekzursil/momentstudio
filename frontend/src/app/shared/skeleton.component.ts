import { Component, Input } from '@angular/core';
import { CommonModule, NgClass } from '@angular/common';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule, NgClass],
  template: `
    <div *ngIf="rows > 1; else singleTpl" class="grid gap-2">
      <div
        *ngFor="let i of rowIndexes()"
        [ngClass]="[shape === 'circle' ? 'rounded-full' : 'rounded-lg', 'bg-slate-200/70 animate-pulse']"
        [style.height]="height"
        [style.width]="rowWidth(i)"
      ></div>
    </div>

    <ng-template #singleTpl>
      <div
        [ngClass]="[shape === 'circle' ? 'rounded-full' : 'rounded-lg', 'bg-slate-200/70 animate-pulse']"
        [style.height]="height"
        [style.width]="width"
      ></div>
    </ng-template>
  `
})
export class SkeletonComponent {
  @Input() rows = 1;
  @Input() width = '100%';
  @Input() height = '1rem';
  @Input() shape: 'rect' | 'circle' = 'rect';

  rowIndexes(): number[] {
    const count = Math.max(0, Math.trunc(Number(this.rows) || 0));
    return Array.from({ length: count }, (_, idx) => idx);
  }

  rowWidth(index: number): string {
    if (this.rows <= 1) return this.width;
    if ((this.width || '').trim() !== '100%') return this.width;
    const last = Math.max(0, this.rows - 1);
    const penultimate = Math.max(0, this.rows - 2);
    if (index === last) return '72%';
    if (index === penultimate) return '88%';
    return '100%';
  }
}
