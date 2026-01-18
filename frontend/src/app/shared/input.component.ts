import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [FormsModule, NgIf],
  template: `
    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
      <span *ngIf="label">{{ label }}</span>
      <input
        class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
        [attr.name]="name || null"
        [placeholder]="placeholder"
        [(ngModel)]="value"
        (ngModelChange)="valueChange.emit($event)"
        [type]="type"
        [disabled]="disabled"
        [attr.min]="min ?? null"
        [attr.max]="max ?? null"
        [attr.step]="step ?? null"
        [attr.inputmode]="inputMode || null"
        [attr.autocomplete]="autocomplete || null"
        [attr.aria-label]="ariaLabel || null"
      />
      <span *ngIf="hint" class="text-xs text-slate-500 dark:text-slate-400">{{ hint }}</span>
    </label>
  `
})
export class InputComponent {
  @Input() name = '';
  @Input() label = '';
  @Input() placeholder = '';
  @Input() type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' = 'text';
  @Input() hint = '';
  @Input() value: string | number = '';
  @Input() disabled = false;
  @Input() min?: number;
  @Input() max?: number;
  @Input() step?: number;
  @Input() inputMode = '';
  @Input() autocomplete = '';
  @Input() ariaLabel = '';
  @Output() valueChange = new EventEmitter<string | number>();
}
