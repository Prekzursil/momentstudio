import { NgClass, NgForOf, NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ThemePreference } from '../core/theme.service';
import { TranslateModule } from '@ngx-translate/core';

type ThemeOption = {
  value: ThemePreference;
  labelKey: string;
  icon: 'system' | 'light' | 'dark';
};

type ThemeSegmentedLayout = 'horizontal' | 'stacked';

@Component({
  selector: 'app-theme-segmented-control',
  standalone: true,
  imports: [NgClass, NgForOf, NgIf, NgSwitch, NgSwitchCase, TranslateModule],
  styles: [
    `
      :host {
        display: block;
      }
    `
  ],
  template: `
    <div
      role="radiogroup"
      class="inline-flex items-center rounded-full"
      [ngClass]="rootClass()"
      [attr.aria-label]="ariaLabel"
    >
      <button
        *ngFor="let opt of options; let idx = index"
        type="button"
        role="radio"
        [attr.aria-checked]="preference === opt.value"
        [attr.aria-label]="opt.labelKey | translate"
        [attr.title]="opt.labelKey | translate"
        [attr.tabindex]="preference === opt.value ? 0 : -1"
        class="inline-flex items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        [ngClass]="buttonNgClass(opt.value)"
        (click)="setPreference(opt.value)"
        (keydown)="onKeyDown($event, idx)"
      >
        <span class="grid place-items-center" [ngClass]="iconBoxClass()">
          <ng-container [ngSwitch]="opt.icon">
            <svg
              *ngSwitchCase="'system'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              class="h-4 w-4"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 4h18v12H3z" />
              <path d="M8 20h8" />
              <path d="M12 16v4" />
            </svg>
            <svg
              *ngSwitchCase="'light'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              class="h-4 w-4"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="M4.93 4.93l1.41 1.41" />
              <path d="M17.66 17.66l1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="M4.93 19.07l1.41-1.41" />
              <path d="M17.66 6.34l1.41-1.41" />
            </svg>
            <svg
              *ngSwitchCase="'dark'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              class="h-4 w-4"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12.8A8 8 0 0 1 11.2 3 7 7 0 1 0 21 12.8z" />
            </svg>
          </ng-container>
        </span>
        <span
          *ngIf="showLabels"
          class="font-medium min-w-0 text-center"
          [ngClass]="labelClass()"
        >
          {{ opt.labelKey | translate }}
        </span>
      </button>
    </div>
  `
})
export class ThemeSegmentedControlComponent {
  @Input() preference: ThemePreference = 'system';
  @Output() preferenceChange = new EventEmitter<ThemePreference>();
  @Input() showLabels = false;
  @Input() size: 'sm' | 'lg' = 'sm';
  @Input() stretch = false;
  @Input() variant: 'standalone' | 'embedded' = 'standalone';
  @Input() ariaLabel = 'Theme';
  @Input() layout: ThemeSegmentedLayout = 'horizontal';

  readonly options: ThemeOption[] = [
    { value: 'system', labelKey: 'theme.system', icon: 'system' },
    { value: 'light', labelKey: 'theme.light', icon: 'light' },
    { value: 'dark', labelKey: 'theme.dark', icon: 'dark' }
  ];

  rootClass(): string {
    const chrome =
      this.variant === 'standalone'
        ? 'border border-slate-200 bg-white/70 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800/70'
        : 'p-0';
    const gap = this.size === 'lg' ? 'gap-1' : 'gap-0.5';
    const width = this.stretch ? 'w-full' : '';
    return [chrome, gap, width].filter(Boolean).join(' ');
  }

  setPreference(pref: ThemePreference): void {
    this.preferenceChange.emit(pref);
  }

  buttonNgClass(value: ThemePreference): string {
    const layoutClass = this.layout === 'stacked' ? 'flex-col gap-0.5 py-1' : this.showLabels ? 'gap-2' : '';
    return [this.buttonClass(value), this.stretch ? 'flex-1' : '', layoutClass].filter(Boolean).join(' ');
  }

  iconBoxClass(): string {
    if (this.layout === 'stacked') {
      return this.size === 'lg' ? 'h-8 w-8' : 'h-7 w-7';
    }
    return this.size === 'lg' ? 'h-9 w-9' : 'h-8 w-8';
  }

  labelClass(): string {
    if (this.layout === 'stacked') {
      return 'px-1 pb-0.5 text-[11px] leading-tight';
    }
    return ['pr-3 text-sm truncate', this.size === 'lg' ? 'pl-0.5' : 'pl-0'].join(' ');
  }

  buttonClass(value: ThemePreference): string {
    const isActive = this.preference === value;
    const base =
      this.size === 'lg'
        ? 'min-h-10 min-w-0 px-1.5 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/50'
        : 'min-h-9 min-w-0 px-0.5 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/50';
    if (!isActive) return base;
    return `${base} bg-slate-900 text-white hover:bg-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-50`;
  }

  onKeyDown(event: KeyboardEvent, index: number): void {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(key)) return;

    event.preventDefault();
    const last = this.options.length - 1;
    let nextIndex = index;
    if (key === 'Enter' || key === ' ') {
      this.setPreference(this.options[index].value);
      return;
    }
    if (key === 'ArrowLeft') nextIndex = index === 0 ? last : index - 1;
    if (key === 'ArrowRight') nextIndex = index === last ? 0 : index + 1;
    if (key === 'Home') nextIndex = 0;
    if (key === 'End') nextIndex = last;
    this.setPreference(this.options[nextIndex].value);
    this.focusOption(nextIndex, event.currentTarget);
  }

  private focusOption(index: number, target: EventTarget | null): void {
    const container = (target as HTMLElement | null)?.closest('[role="radiogroup"]') as HTMLElement | null;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[];
    buttons[index]?.focus();
  }
}
