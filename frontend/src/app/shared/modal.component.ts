import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { NgIf } from '@angular/common';
import { ButtonComponent } from './button.component';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [NgIf, ButtonComponent],
  template: `
    <div *ngIf="open" class="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div
        #dialogRef
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="title"
        class="w-full max-w-lg min-w-0 max-h-[calc(100dvh-2rem)] sm:max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-xl border border-slate-200 outline-none dark:bg-slate-900 dark:border-slate-700 dark:shadow-none flex flex-col"
        tabindex="-1"
      >
        <div class="flex items-start justify-between gap-4 p-4 sm:p-6 pb-3 sm:pb-4 shrink-0">
          <div class="grid gap-1 min-w-0">
            <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ title }}</div>
            <div class="text-slate-600 text-sm dark:text-slate-300" *ngIf="subtitle">{{ subtitle }}</div>
          </div>
          <app-button variant="ghost" size="sm" [label]="closeLabel" (action)="close()"></app-button>
        </div>
        <div class="min-h-0 overflow-y-auto overflow-x-hidden px-4 sm:px-6 pb-4 sm:pb-6 text-sm text-slate-700 dark:text-slate-200">
          <ng-content></ng-content>
        </div>
        <div class="flex justify-end gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 dark:border-slate-800 shrink-0" *ngIf="showActions">
          <app-button variant="ghost" [label]="cancelLabel" (action)="close()"></app-button>
          <app-button [label]="confirmLabel" (action)="confirm.emit()"></app-button>
        </div>
      </div>
    </div>
  `
})
export class ModalComponent implements AfterViewInit, OnChanges {
  @Input() open = false;
  @Input() title = 'Modal';
  @Input() subtitle = '';
  @Input() showActions = true;
  @Input() closeLabel = 'Close';
  @Input() cancelLabel = 'Cancel';
  @Input() confirmLabel = 'Confirm';
  @Output() confirm = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();
  @ViewChild('dialogRef') dialogRef?: ElementRef<HTMLDivElement>;
  private previouslyFocused: HTMLElement | null = null;

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.open) this.close();
  }

  ngAfterViewInit(): void {
    this.focusDialog();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!('open' in changes)) return;
    const prev = Boolean(changes['open'].previousValue);
    const next = Boolean(changes['open'].currentValue);
    if (next) {
      this.capturePreviousFocus();
      this.focusDialog();
      return;
    }
    if (prev) this.restorePreviousFocus();
  }

  close(): void {
    this.open = false;
    this.closed.emit();
    this.restorePreviousFocus();
  }

  private focusDialog(): void {
    if (!this.dialogRef?.nativeElement) return;
    const el = this.dialogRef.nativeElement;
    setTimeout(() => {
      const focusable =
        el.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || el;
      focusable.focus();
    });
  }

  private capturePreviousFocus(): void {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    this.previouslyFocused = active;
  }

  private restorePreviousFocus(): void {
    if (typeof document === 'undefined') return;
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (!target) return;
    setTimeout(() => {
      if (!document.contains(target)) return;
      target.focus();
    });
  }
}
