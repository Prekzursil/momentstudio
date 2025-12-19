import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, ViewChild } from '@angular/core';
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
        class="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 p-6 grid gap-4 outline-none"
        tabindex="-1"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="grid gap-1">
            <div class="text-lg font-semibold text-slate-900">{{ title }}</div>
            <div class="text-slate-600 text-sm" *ngIf="subtitle">{{ subtitle }}</div>
          </div>
          <app-button variant="ghost" size="sm" label="Close" (action)="close()"></app-button>
        </div>
        <div class="text-sm text-slate-700">
          <ng-content></ng-content>
        </div>
        <div class="flex justify-end gap-3" *ngIf="showActions">
          <app-button variant="ghost" label="Cancel" (action)="close()"></app-button>
          <app-button label="Confirm" (action)="confirm.emit()"></app-button>
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
  @Output() confirm = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();
  @ViewChild('dialogRef') dialogRef?: ElementRef<HTMLDivElement>;

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.open) this.close();
  }

  ngAfterViewInit(): void {
    this.focusDialog();
  }

  ngOnChanges(): void {
    if (this.open) this.focusDialog();
  }

  close(): void {
    this.open = false;
    this.closed.emit();
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
}
