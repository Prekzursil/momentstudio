import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { CardComponent } from '../../../shared/card.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AuthService } from '../../../core/auth.service';
import { AdminService, AdminSummary, OwnerTransferResponse } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
        {{ error() }}
      </div>

      <div *ngIf="loading(); else dashboardTpl">
        <app-skeleton [rows]="6"></app-skeleton>
      </div>

      <ng-template #dashboardTpl>
        <section class="grid gap-3">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.dashboardTitle' | translate }}</h1>

          <div class="grid md:grid-cols-3 gap-4">
            <app-card
              [title]="'adminUi.cards.products' | translate"
              [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.products || 0 }"
            ></app-card>
            <app-card
              [title]="'adminUi.cards.orders' | translate"
              [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.orders || 0 }"
            ></app-card>
            <app-card
              [title]="'adminUi.cards.users' | translate"
              [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.users || 0 }"
            ></app-card>
          </div>

          <div class="grid md:grid-cols-3 gap-4">
            <app-card
              [title]="'adminUi.cards.lowStock' | translate"
              [subtitle]="'adminUi.cards.countItems' | translate: { count: summary()?.low_stock || 0 }"
            ></app-card>
            <app-card [title]="'adminUi.cards.sales30' | translate" [subtitle]="(summary()?.sales_30d || 0) | localizedCurrency : 'RON'"></app-card>
            <app-card
              [title]="'adminUi.cards.orders30' | translate"
              [subtitle]="'adminUi.cards.countOrders' | translate: { count: summary()?.orders_30d || 0 }"
            ></app-card>
          </div>
        </section>

        <section
          *ngIf="isOwner()"
          class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ownerTransfer.title' | translate }}</h2>
          </div>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.ownerTransfer.description' | translate }}</p>

          <div class="grid gap-3 md:grid-cols-3 items-end text-sm">
            <app-input
              [label]="'adminUi.ownerTransfer.identifier' | translate"
              [(value)]="ownerTransferIdentifier"
              [placeholder]="'adminUi.ownerTransfer.identifierPlaceholder' | translate"
              [ariaLabel]="'adminUi.ownerTransfer.identifier' | translate"
            ></app-input>
            <app-input
              [label]="'adminUi.ownerTransfer.confirmLabel' | translate"
              [(value)]="ownerTransferConfirm"
              [placeholder]="'adminUi.ownerTransfer.confirmPlaceholder' | translate"
              [hint]="'adminUi.ownerTransfer.confirmHint' | translate"
              [ariaLabel]="'adminUi.ownerTransfer.confirmLabel' | translate"
            ></app-input>
            <app-input
              [label]="'auth.currentPassword' | translate"
              type="password"
              autocomplete="current-password"
              [(value)]="ownerTransferPassword"
              [ariaLabel]="'auth.currentPassword' | translate"
            ></app-input>
          </div>

          <div *ngIf="ownerTransferError" class="text-sm text-rose-700 dark:text-rose-300">
            {{ ownerTransferError }}
          </div>

          <div class="flex justify-end">
            <app-button
              size="sm"
              [disabled]="ownerTransferLoading"
              [label]="'adminUi.ownerTransfer.action' | translate"
              (action)="submitOwnerTransfer()"
            ></app-button>
          </div>
        </section>
      </ng-template>
    </div>
  `
})
export class AdminDashboardComponent implements OnInit {
  readonly crumbs: Crumb[] = [
    { label: 'adminUi.nav.dashboard', url: '/admin/dashboard' }
  ];

  loading = signal(true);
  error = signal('');
  summary = signal<AdminSummary | null>(null);

  ownerTransferIdentifier = '';
  ownerTransferConfirm = '';
  ownerTransferPassword = '';
  ownerTransferLoading = false;
  ownerTransferError = '';

  constructor(
    private admin: AdminService,
    private auth: AuthService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.loadSummary();
  }

  isOwner(): boolean {
    return this.auth.role() === 'owner';
  }

  private loadSummary(): void {
    this.loading.set(true);
    this.error.set('');
    this.admin.summary().subscribe({
      next: (data) => {
        this.summary.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('adminUi.errors.generic'));
        this.loading.set(false);
      }
    });
  }

  submitOwnerTransfer(): void {
    const identifier = (this.ownerTransferIdentifier || '').trim();
    if (!identifier) {
      this.ownerTransferError = this.translate.instant('adminUi.ownerTransfer.errors.identifier');
      return;
    }
    this.ownerTransferError = '';
    this.ownerTransferLoading = true;
    this.admin
      .transferOwner({ identifier, confirm: this.ownerTransferConfirm, password: this.ownerTransferPassword })
      .subscribe({
        next: (_res: OwnerTransferResponse) => {
          this.ownerTransferLoading = false;
          this.ownerTransferIdentifier = '';
          this.ownerTransferConfirm = '';
          this.ownerTransferPassword = '';
          this.toast.success(
            this.translate.instant('adminUi.ownerTransfer.successTitle'),
            this.translate.instant('adminUi.ownerTransfer.successCopy')
          );
        },
        error: () => {
          this.ownerTransferLoading = false;
          this.ownerTransferError = this.translate.instant('adminUi.ownerTransfer.errors.generic');
        }
      });
  }
}

