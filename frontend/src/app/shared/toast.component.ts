import { Component, Input } from '@angular/core';
import { NgForOf } from '@angular/common';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'error';
}

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [NgForOf],
  template: `
    <div class="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-3 px-4">
      <div
        *ngFor="let toast of messages"
        class="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg px-4 py-3 grid gap-1 dark:bg-slate-900 dark:border-slate-700 dark:shadow-none"
        [class.border-green-200]="toast.tone === 'success'"
        [class.border-red-200]="toast.tone === 'error'"
      >
        <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ toast.title }}</div>
        <div *ngIf="toast.description" class="text-xs text-slate-600 dark:text-slate-300">
          {{ toast.description }}
        </div>
      </div>
    </div>
  `
})
export class ToastComponent {
  @Input() messages: ToastMessage[] = [];
}
