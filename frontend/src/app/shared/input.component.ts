import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [FormsModule, NgClass],
  template: `
    <label class="grid gap-1 text-sm font-medium text-slate-700">
      <span *ngIf="label">{{ label }}</span>
      <input
        class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
        [placeholder]="placeholder"
        [(ngModel)]="value"
        [type]="type"
      />
      <span *ngIf="hint" class="text-xs text-slate-500">{{ hint }}</span>
    </label>
  `
})
export class InputComponent {
  @Input() label = '';
  @Input() placeholder = '';
  @Input() type: 'text' | 'email' | 'password' = 'text';
  @Input() hint = '';
  @Input() value = '';
}
