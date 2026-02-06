import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { NgForOf, NgIf } from '@angular/common';
import { ToastService } from '../core/toast.service';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'error';
  actionLabel?: string;
  actionAriaLabel?: string;
  onAction?: (() => void) | null;
}

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [NgForOf, NgIf],
  template: `
    <div class="sr-only" aria-live="polite" aria-atomic="true">{{ livePolite }}</div>
    <div class="sr-only" aria-live="assertive" aria-atomic="true">{{ liveAssertive }}</div>
    <div class="pointer-events-none fixed inset-x-0 top-4 z-[9999] flex flex-col items-center gap-3 px-4">
      <div
        *ngFor="let toast of messages"
        class="pointer-events-auto w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg px-4 py-3 grid gap-2 dark:bg-slate-900 dark:border-slate-700 dark:shadow-none"
        [class.border-green-200]="toast.tone === 'success'"
        [class.border-red-200]="toast.tone === 'error'"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="grid gap-1 min-w-0">
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ toast.title }}</div>
            <div *ngIf="toast.description" class="text-xs text-slate-600 dark:text-slate-300">
              {{ toast.description }}
            </div>
          </div>
          <button
            *ngIf="toast.actionLabel && toast.onAction"
            type="button"
            class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
            [attr.aria-label]="toast.actionAriaLabel || toast.actionLabel"
            (click)="runAction(toast, $event)"
          >
            {{ toast.actionLabel }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ToastComponent implements OnChanges {
  @Input() messages: ToastMessage[] = [];
  livePolite = '';
  liveAssertive = '';

  constructor(private toastService: ToastService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!('messages' in changes)) return;
    const latest = this.messages[this.messages.length - 1];
    if (!latest) return;
    const text = [latest.title, latest.description].filter(Boolean).join('. ');
    if (!text) return;
    if (latest.tone === 'error') {
      this.liveAssertive = text;
      this.livePolite = '';
      return;
    }
    this.livePolite = text;
    this.liveAssertive = '';
  }

  runAction(toast: ToastMessage, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const handler = toast.onAction;
    if (!handler) return;
    this.toastService.clear(toast.id);
    handler();
  }
}
