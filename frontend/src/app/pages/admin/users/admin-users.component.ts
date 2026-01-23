import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminUserAliasesResponse, AdminService } from '../../../core/admin.service';
import { AdminUserListItem, AdminUserListResponse, AdminUsersService } from '../../../core/admin-users.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { formatIdentity } from '../../../shared/user-identity';

type RoleFilter = 'all' | 'customer' | 'admin' | 'owner';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, BreadcrumbComponent, ButtonComponent, InputComponent, SkeletonComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="grid gap-1">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.users.title' | translate }}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.users.hint' | translate }}</p>
      </div>

      <div class="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] items-start">
        <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="grid gap-3 lg:grid-cols-[1fr_240px_auto] items-end">
            <app-input [label]="'adminUi.users.search' | translate" [(value)]="q"></app-input>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.users.roleFilter' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="role"
              >
                <option value="all">{{ 'adminUi.users.all' | translate }}</option>
                <option value="customer">{{ 'adminUi.users.roles.customer' | translate }}</option>
                <option value="admin">{{ 'adminUi.users.roles.admin' | translate }}</option>
                <option value="owner">{{ 'adminUi.users.roles.owner' | translate }}</option>
              </select>
            </label>

            <div class="flex items-center gap-2">
              <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetFilters()"></app-button>
            </div>
          </div>

          <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ error() }}
          </div>

          <div *ngIf="loading(); else listTpl">
            <app-skeleton [rows]="8"></app-skeleton>
          </div>
          <ng-template #listTpl>
            <div *ngIf="users().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.users.empty' | translate }}
            </div>

            <div *ngIf="users().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[880px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.users.table.identity' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.users.table.email' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.users.table.role' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.users.table.verified' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.users.table.created' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.users.table.actions' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="let user of users()"
                    class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                  >
                    <td class="px-3 py-2 font-medium text-slate-900 dark:text-slate-50">
                      {{ identityLabel(user) }}
                    </td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {{ user.email }}
                    </td>
                    <td class="px-3 py-2">
                      <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="rolePillClass(user.role)">
                        {{ ('adminUi.users.roles.' + user.role) | translate }}
                      </span>
                    </td>
                    <td class="px-3 py-2">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                        [ngClass]="user.email_verified ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'"
                      >
                        {{ user.email_verified ? ('adminUi.users.verified' | translate) : ('adminUi.users.unverified' | translate) }}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {{ user.created_at | date: 'short' }}
                    </td>
                    <td class="px-3 py-2 text-right">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.users.manage' | translate" (action)="select(user)"></app-button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div *ngIf="meta()" class="flex items-center justify-between gap-3 pt-2 text-sm text-slate-700 dark:text-slate-200">
              <div>
                {{ 'adminUi.users.pagination' | translate: { page: meta()!.page, total_pages: meta()!.total_pages, total_items: meta()!.total_items } }}
              </div>
              <div class="flex items-center gap-2">
                <app-button size="sm" variant="ghost" [label]="'adminUi.users.prev' | translate" [disabled]="meta()!.page <= 1" (action)="goToPage(meta()!.page - 1)"></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.users.next' | translate" [disabled]="meta()!.page >= meta()!.total_pages" (action)="goToPage(meta()!.page + 1)"></app-button>
              </div>
            </div>
          </ng-template>
        </section>

        <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.users.detailTitle' | translate }}</h2>

          <div *ngIf="!selectedUser()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.users.selectHint' | translate }}
          </div>

          <div *ngIf="selectedUser()" class="grid gap-3">
            <div class="rounded-xl border border-slate-200 p-3 grid gap-1 dark:border-slate-800">
              <div class="font-semibold text-slate-900 dark:text-slate-50">{{ identityLabel(selectedUser()!) }}</div>
              <div class="text-sm text-slate-600 dark:text-slate-300">{{ selectedUser()!.email }}</div>
            </div>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.users.role' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="selectedRole"
                [disabled]="selectedUser()!.role === 'owner'"
              >
                <option value="customer">{{ 'adminUi.users.roles.customer' | translate }}</option>
                <option value="admin">{{ 'adminUi.users.roles.admin' | translate }}</option>
              </select>
              <span *ngIf="selectedUser()!.role === 'owner'" class="text-xs font-normal text-slate-500 dark:text-slate-400">
                {{ 'adminUi.users.ownerLocked' | translate }}
              </span>
            </label>

            <div class="flex gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.users.setRole' | translate"
                [disabled]="selectedUser()!.role === 'owner' || selectedRole === selectedUser()!.role"
                (action)="updateRole()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.users.forceLogout' | translate"
                (action)="forceLogout()"
              ></app-button>
            </div>

            <div class="grid gap-2">
              <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                {{ 'adminUi.users.aliasHistory' | translate }}
              </div>

              <div *ngIf="aliasesLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.users.loadingAliases' | translate }}
              </div>
              <div *ngIf="aliasesError()" class="text-sm text-rose-700 dark:text-rose-200">
                {{ aliasesError() }}
              </div>

              <ng-container *ngIf="aliases()">
                <div class="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.users.usernameHistory' | translate }}</p>
                    <p *ngIf="aliases()!.usernames.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.noHistory' | translate }}
                    </p>
                    <ul *ngIf="aliases()!.usernames.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let h of aliases()!.usernames" class="flex items-center justify-between gap-2">
                        <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.username }}</span>
                        <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                      </li>
                    </ul>
                  </div>

                  <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.users.displayNameHistory' | translate }}</p>
                    <p *ngIf="aliases()!.display_names.length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.users.noHistory' | translate }}
                    </p>
                    <ul *ngIf="aliases()!.display_names.length > 0" class="mt-2 grid gap-2">
                      <li *ngFor="let h of aliases()!.display_names" class="flex items-center justify-between gap-2">
                        <span class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ h.name }}#{{ h.name_tag }}</span>
                        <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ h.created_at | date: 'short' }}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </ng-container>
            </div>
          </div>
        </section>
      </div>
    </div>
  `
})
export class AdminUsersComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.users.title' }
  ];

  loading = signal(true);
  error = signal<string | null>(null);
  users = signal<AdminUserListItem[]>([]);
  meta = signal<AdminUserListResponse['meta'] | null>(null);

  q = '';
  role: RoleFilter = 'all';
  page = 1;
  limit = 25;

  selectedUser = signal<AdminUserListItem | null>(null);
  selectedRole = 'customer';

  aliases = signal<AdminUserAliasesResponse | null>(null);
  aliasesLoading = signal(false);
  aliasesError = signal<string | null>(null);

  private pendingPrefillSearch: string | null = null;
  private autoSelectAfterLoad = false;

  constructor(
    private usersApi: AdminUsersService,
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const state = history.state as any;
    const prefill = typeof state?.prefillUserSearch === 'string' ? state.prefillUserSearch : '';
    this.pendingPrefillSearch = prefill.trim() ? prefill.trim() : null;
    this.autoSelectAfterLoad = Boolean(state?.autoSelectFirst);
    if (this.pendingPrefillSearch) {
      this.q = this.pendingPrefillSearch;
      this.page = 1;
    }
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  resetFilters(): void {
    this.q = '';
    this.role = 'all';
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    this.page = page;
    this.load();
  }

  select(user: AdminUserListItem): void {
    this.selectedUser.set(user);
    this.selectedRole = user.role;
    this.loadAliases(user.id);
  }

  updateRole(): void {
    const user = this.selectedUser();
    if (!user) return;
    if (user.role === 'owner') return;
    this.admin.updateUserRole(user.id, this.selectedRole).subscribe({
      next: (updated) => {
        this.toast.success(this.t('adminUi.users.success.role'));
        this.selectedUser.set({ ...user, role: updated.role });
        this.users.set(this.users().map((u) => (u.id === user.id ? { ...u, role: updated.role } : u)));
      },
      error: () => this.toast.error(this.t('adminUi.users.errors.role'))
    });
  }

  forceLogout(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.admin.revokeSessions(user.id).subscribe({
      next: () => this.toast.success(this.t('adminUi.users.success.revoke')),
      error: () => this.toast.error(this.t('adminUi.users.errors.revoke'))
    });
  }

  identityLabel(user: AdminUserListItem): string {
    return formatIdentity(user, user.email);
  }

  rolePillClass(role: string): string {
    if (role === 'owner') return 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100';
    if (role === 'admin') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.usersApi
      .search({
        q: this.q.trim() ? this.q.trim() : undefined,
        role: this.role === 'all' ? undefined : this.role,
        page: this.page,
        limit: this.limit
      })
      .subscribe({
        next: (res) => {
          const items = res.items || [];
          this.users.set(items);
          this.meta.set(res.meta || null);
          this.loading.set(false);

          if (this.autoSelectAfterLoad && items.length > 0) {
            const needle = (this.pendingPrefillSearch || '').trim().toLowerCase();
            const match =
              items.find((u) => u.email.toLowerCase() === needle || u.username.toLowerCase() === needle) || items[0];
            this.autoSelectAfterLoad = false;
            this.pendingPrefillSearch = null;
            this.select(match);
          }
        },
        error: () => {
          this.error.set(this.t('adminUi.users.errors.load'));
          this.loading.set(false);
        }
      });
  }

  private loadAliases(userId: string): void {
    this.aliasesLoading.set(true);
    this.aliasesError.set(null);
    this.aliases.set(null);
    this.admin.userAliases(userId).subscribe({
      next: (res) => {
        this.aliases.set(res);
        this.aliasesLoading.set(false);
      },
      error: () => {
        this.aliasesError.set(this.t('adminUi.users.errors.aliases'));
        this.aliasesLoading.set(false);
      }
    });
  }

  private t(key: string): string {
    return this.translate.instant(key) as string;
  }
}
