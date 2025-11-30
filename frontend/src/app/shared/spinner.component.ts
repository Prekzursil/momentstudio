import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center justify-center gap-2" [ngClass]="inline ? 'inline-flex' : 'flex'">
      <span class="h-4 w-4 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin"></span>
      <span *ngIf="label" class="text-sm text-slate-600">{{ label }}</span>
    </div>
  `
})
export class SpinnerComponent {
  @Input() label = '';
  @Input() inline = false;
}
