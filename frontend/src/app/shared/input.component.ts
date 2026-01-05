import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [FormsModule, NgClass, NgIf],
  template: `
    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
      <span *ngIf="label">{{ label }}</span>
      <input
        class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
        [placeholder]="placeholder"
        [(ngModel)]="value"
        (ngModelChange)="valueChange.emit($event)"
        [type]="type"
      />
      <span *ngIf="hint" class="text-xs text-slate-500 dark:text-slate-400">{{ hint }}</span>
    </label>
  `
})
export class InputComponent {
  @Input() label = '';
  @Input() placeholder = '';
  @Input() type: 'text' | 'email' | 'password' = 'text';
  @Input() hint = '';
  @Input() value: string | number = '';
  @Output() valueChange = new EventEmitter<string | number>();
}
