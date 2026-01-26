import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';

@Component({
  selector: 'app-admin-ip-bypass',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, BreadcrumbComponent, ButtonComponent],
  template: `
    <div class="grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

      <div class="rounded-2xl border border-slate-200 bg-white p-5 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-1">
          <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ipBypass.title' | translate }}</div>
          <div class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.ipBypass.copy' | translate }}</div>
        </div>

        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.ipBypass.tokenLabel' | translate }}
          <input
            class="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [(ngModel)]="token"
            [placeholder]="'adminUi.ipBypass.tokenPh' | translate"
            autocomplete="off"
            spellcheck="false"
          />
        </label>

        <div class="flex flex-wrap gap-2">
          <app-button
            [label]="'adminUi.ipBypass.submit' | translate"
            [disabled]="busy() || !token.trim()"
            (action)="submit()"
          ></app-button>
          <app-button
            variant="ghost"
            [label]="'adminUi.ipBypass.clear' | translate"
            [disabled]="busy()"
            (action)="clear()"
          ></app-button>
        </div>
      </div>
    </div>
  `
})
export class AdminIpBypassComponent {
  token = '';
  busy = signal(false);
  crumbs = signal([
    { label: 'adminUi.nav.title', url: '/admin/dashboard' },
    { label: 'adminUi.ipBypass.title', url: '/admin/ip-bypass' }
  ]);
  private returnUrl: string;

  constructor(
    private auth: AuthService,
    private toast: ToastService,
    private router: Router,
    route: ActivatedRoute,
    private translate: TranslateService
  ) {
    this.returnUrl = route.snapshot.queryParamMap.get('returnUrl') || '/admin/dashboard';
  }

  submit(): void {
    if (this.busy() || !this.token.trim()) return;
    this.busy.set(true);
    this.auth.setAdminIpBypass(this.token.trim()).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.ipBypass.success'));
        void this.router.navigateByUrl(this.returnUrl);
        this.busy.set(false);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.errors.generic');
        this.toast.error(msg);
        this.busy.set(false);
      }
    });
  }

  clear(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.auth.clearAdminIpBypass().subscribe({
      next: () => {
        this.token = '';
        this.toast.info(this.translate.instant('adminUi.ipBypass.cleared'));
        this.busy.set(false);
      },
      error: () => {
        this.token = '';
        this.busy.set(false);
      }
    });
  }
}
