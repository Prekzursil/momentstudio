import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { NgIf } from '@angular/common';
import { ButtonComponent } from './button.component';

export type ModalBodyScrollEvent = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  atBottom: boolean;
};

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
      <div
        #bodyRef
        class="min-h-0 overflow-y-auto overflow-x-hidden px-4 sm:px-6 pb-4 sm:pb-6 text-sm text-slate-700 dark:text-slate-200"
        (scroll)="emitBodyScroll()"
      >
        <ng-content></ng-content>
        <div #bodyEndSentinel aria-hidden="true" class="h-px w-full"></div>
      </div>
      <div class="flex justify-end gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 dark:border-slate-800 shrink-0" *ngIf="showActions">
        <app-button variant="ghost" [label]="cancelLabel" (action)="close()"></app-button>
        <app-button [label]="confirmLabel" [disabled]="effectiveConfirmDisabled()" (action)="confirm.emit()"></app-button>
      </div>
    </div>
  </div>
  `
})
export class ModalComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() open = false;
  @Input() title = 'Modal';
  @Input() subtitle = '';
  @Input() showActions = true;
  @Input() closeLabel = 'Close';
  @Input() cancelLabel = 'Cancel';
  @Input() confirmLabel = 'Confirm';
  @Input() confirmDisabled = false;
  @Input() requireScrollToConfirm = false;
  @Output() confirm = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();
  @Output() bodyScroll = new EventEmitter<ModalBodyScrollEvent>();
  @ViewChild('dialogRef') dialogRef?: ElementRef<HTMLDivElement>;
  @ViewChild('bodyRef') bodyRef?: ElementRef<HTMLDivElement>;
  @ViewChild('bodyEndSentinel') bodyEndSentinel?: ElementRef<HTMLDivElement>;
  private previouslyFocused: HTMLElement | null = null;
  private scrollGateReady = true;
  private scrollGateSettled = true;
  private scrollGateSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollGateObserver: IntersectionObserver | null = null;
  private scrollGateMutationObserver: MutationObserver | null = null;
  private scrollGateLoadListener: ((event: Event) => void) | null = null;

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.open) this.close();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.open) return;
    if (event.key !== 'Tab') return;
    this.trapFocus(event);
  }

  ngAfterViewInit(): void {
    this.focusDialog();
    this.emitBodyScroll();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const openChange = changes['open'];
    const gateChange = changes['requireScrollToConfirm'];

    const prevOpen = openChange ? Boolean(openChange.previousValue) : this.open;
    const nextOpen = openChange ? Boolean(openChange.currentValue) : this.open;

    const prevGate = gateChange ? Boolean(gateChange.previousValue) : this.requireScrollToConfirm;
    const nextGate = gateChange ? Boolean(gateChange.currentValue) : this.requireScrollToConfirm;

    if (openChange && nextOpen && !prevOpen) {
      this.capturePreviousFocus();
      this.focusDialog();
    }

    if (openChange && prevOpen && !nextOpen) {
      this.stopScrollGate();
      this.restorePreviousFocus();
      return;
    }

    const shouldStartGate =
      nextOpen &&
      nextGate &&
      ((openChange && nextOpen && !prevOpen) || (gateChange && nextGate && !prevGate));
    if (shouldStartGate) {
      // Disable immediately to avoid a short "click before scroll" window before observers attach.
      this.scrollGateReady = false;
      this.scrollGateSettled = false;
      setTimeout(() => {
        this.startScrollGate();
        this.emitBodyScroll();
      });
      return;
    }

    const shouldStopGate = nextOpen && !nextGate && gateChange && !nextGate && prevGate;
    if (shouldStopGate) {
      this.stopScrollGate();
      return;
    }

    if (openChange && nextOpen && !prevOpen) {
      setTimeout(() => {
        this.emitBodyScroll();
      });
    }
  }

  ngOnDestroy(): void {
    this.stopScrollGate();
  }

  close(): void {
    this.stopScrollGate();
    this.open = false;
    this.closed.emit();
    this.restorePreviousFocus();
  }

  effectiveConfirmDisabled(): boolean {
    if (this.confirmDisabled) return true;
    if (!this.requireScrollToConfirm) return false;
    return !this.scrollGateReady;
  }

  emitBodyScroll(): void {
    const el = this.bodyRef?.nativeElement;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const clientHeight = el.clientHeight;
    const scrollHeight = el.scrollHeight;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 8;
    this.updateScrollGate({ clientHeight, scrollHeight, atBottom });
    this.bodyScroll.emit({ scrollTop, clientHeight, scrollHeight, atBottom });
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

  private trapFocus(event: KeyboardEvent): void {
    if (typeof document === 'undefined') return;
    const container = this.dialogRef?.nativeElement;
    if (!container) return;

    const focusable = this.getFocusableElements(container);
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!active || !container.contains(active) || active === container) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private getFocusableElements(container: HTMLElement): HTMLElement[] {
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const candidates = Array.from(container.querySelectorAll<HTMLElement>(selector));
    return candidates.filter((el) => {
      if (el.tabIndex < 0) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.hasAttribute('inert')) return false;
      return true;
    });
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

  private startScrollGate(): void {
    this.stopScrollGate();
    if (!this.open || !this.requireScrollToConfirm) {
      this.scrollGateReady = true;
      this.scrollGateSettled = true;
      return;
    }

    this.scrollGateReady = false;
    this.scrollGateSettled = false;

    // Avoid a short window where async content (e.g. images/markdown) hasn't affected scrollHeight yet.
    this.scrollGateSettleTimer = setTimeout(() => {
      this.scrollGateSettled = true;
      this.emitBodyScroll();
    }, 250);

    const root = this.bodyRef?.nativeElement;
    const sentinel = this.bodyEndSentinel?.nativeElement;
    if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return;

    this.scrollGateObserver = new IntersectionObserver(
      () => {
        this.emitBodyScroll();
      },
      { root, threshold: [0, 1], rootMargin: '0px 0px 8px 0px' }
    );
    this.scrollGateObserver.observe(sentinel);

    if (typeof MutationObserver !== 'undefined') {
      this.scrollGateMutationObserver = new MutationObserver(() => this.emitBodyScroll());
      this.scrollGateMutationObserver.observe(root, { childList: true, subtree: true });
    }

    this.scrollGateLoadListener = () => this.emitBodyScroll();
    // `load` doesn't bubble, but it is capturable (useful for <img>).
    root.addEventListener('load', this.scrollGateLoadListener, true);
  }

  private stopScrollGate(): void {
    if (this.scrollGateSettleTimer) {
      clearTimeout(this.scrollGateSettleTimer);
      this.scrollGateSettleTimer = null;
    }
    if (this.scrollGateObserver) {
      this.scrollGateObserver.disconnect();
      this.scrollGateObserver = null;
    }
    if (this.scrollGateMutationObserver) {
      this.scrollGateMutationObserver.disconnect();
      this.scrollGateMutationObserver = null;
    }
    const root = this.bodyRef?.nativeElement;
    if (root && this.scrollGateLoadListener) {
      root.removeEventListener('load', this.scrollGateLoadListener, true);
    }
    this.scrollGateLoadListener = null;
    this.scrollGateReady = true;
    this.scrollGateSettled = true;
  }

  private updateScrollGate(measure: Pick<ModalBodyScrollEvent, 'clientHeight' | 'scrollHeight' | 'atBottom'>): void {
    if (!this.open || !this.requireScrollToConfirm) {
      this.scrollGateReady = true;
      return;
    }
    const scrollable = measure.scrollHeight > measure.clientHeight + 8;
    if (scrollable) {
      this.scrollGateSettled = true;
      this.scrollGateReady = measure.atBottom;
      return;
    }
    this.scrollGateReady = this.scrollGateSettled;
  }
}
