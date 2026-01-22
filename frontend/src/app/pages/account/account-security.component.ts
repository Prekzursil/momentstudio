import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-security',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, ButtonComponent, SkeletonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <ng-container *ngIf="account.loading(); else securityBody">
        <div class="grid gap-3">
          <app-skeleton height="18px" width="220px"></app-skeleton>
          <app-skeleton height="120px"></app-skeleton>
          <app-skeleton height="120px"></app-skeleton>
        </div>
      </ng-container>

      <ng-template #securityBody>
      <div class="grid gap-1">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.sections.security' | translate }}</h2>
        <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.subtitle' | translate }}</p>
      </div>

      <div class="grid gap-3">
        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div class="grid gap-1">
            <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.password.title' | translate }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.password.copy' | translate }}</p>
          </div>
          <app-button
            routerLink="/account/password"
            size="sm"
            variant="ghost"
            [label]="'account.security.password.action' | translate"
          ></app-button>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="grid gap-1">
              <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.twoFactor.title' | translate }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.twoFactor.copy' | translate }}</p>
            </div>
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              [class.bg-emerald-100]="account.twoFactorStatus()?.enabled"
              [class.text-emerald-800]="account.twoFactorStatus()?.enabled"
              [class.dark:bg-emerald-900/40]="account.twoFactorStatus()?.enabled"
              [class.dark:text-emerald-200]="account.twoFactorStatus()?.enabled"
              [class.bg-slate-100]="!account.twoFactorStatus()?.enabled"
              [class.text-slate-700]="!account.twoFactorStatus()?.enabled"
              [class.dark:bg-slate-800]="!account.twoFactorStatus()?.enabled"
              [class.dark:text-slate-200]="!account.twoFactorStatus()?.enabled"
            >
              {{
                (account.twoFactorStatus()?.enabled ? 'account.security.twoFactor.enabled' : 'account.security.twoFactor.disabled') | translate
              }}
            </span>
          </div>

          <div *ngIf="account.twoFactorLoading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'notifications.loading' | translate }}
          </div>

          <p *ngIf="account.twoFactorError()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.twoFactorError() }}</p>

          <ng-container *ngIf="account.twoFactorStatus()?.enabled; else twoFactorSetup">
            <p class="text-sm text-slate-700 dark:text-slate-200">
              {{
                'account.security.twoFactor.recoveryRemaining'
                  | translate: { count: account.twoFactorStatus()?.recovery_codes_remaining || 0 }
              }}
            </p>

            <div
              *ngIf="account.twoFactorRecoveryCodes?.length"
              class="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30 grid gap-2"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.twoFactor.recoveryTitle' | translate }}</p>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.twoFactor.copyCodes' | translate"
                  (action)="account.copyTwoFactorRecoveryCodes()"
                ></app-button>
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-300">{{ 'account.security.twoFactor.recoveryCopy' | translate }}</p>
              <div class="grid gap-1 sm:grid-cols-2">
                <code
                  *ngFor="let code of account.twoFactorRecoveryCodes"
                  class="rounded-md bg-white px-2 py-1 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200 border border-slate-200 dark:border-slate-800"
                  >{{ code }}</code
                >
              </div>
            </div>

            <div class="grid gap-2 sm:grid-cols-[2fr_2fr_auto_auto] sm:items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'account.security.twoFactor.managePasswordLabel' | translate }}
                <div class="relative">
                  <input
                    name="twoFactorManagePassword"
                    [type]="showTwoFactorManagePassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    [disabled]="account.regeneratingTwoFactorCodes || account.disablingTwoFactor"
                    [(ngModel)]="account.twoFactorManagePassword"
                  />
                  <button
                    type="button"
                    class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                    (click)="showTwoFactorManagePassword = !showTwoFactorManagePassword"
                    [attr.aria-label]="(showTwoFactorManagePassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                  >
                    {{ (showTwoFactorManagePassword ? 'auth.hide' : 'auth.show') | translate }}
                  </button>
                </div>
              </label>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'account.security.twoFactor.manageCodeLabel' | translate }}
                <input
                  name="twoFactorManageCode"
                  type="text"
                  autocomplete="one-time-code"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [disabled]="account.regeneratingTwoFactorCodes || account.disablingTwoFactor"
                  [(ngModel)]="account.twoFactorManageCode"
                />
              </label>

              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.security.twoFactor.regenerateAction' | translate"
                [disabled]="
                  account.regeneratingTwoFactorCodes ||
                  account.disablingTwoFactor ||
                  !account.twoFactorManagePassword.trim() ||
                  !account.twoFactorManageCode.trim()
                "
                (action)="account.regenerateTwoFactorRecoveryCodes()"
              ></app-button>

              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.security.twoFactor.disableAction' | translate"
                [disabled]="
                  account.regeneratingTwoFactorCodes ||
                  account.disablingTwoFactor ||
                  !account.twoFactorManagePassword.trim() ||
                  !account.twoFactorManageCode.trim()
                "
                (action)="account.disableTwoFactor()"
              ></app-button>
            </div>
          </ng-container>

          <ng-template #twoFactorSetup>
            <ng-container *ngIf="account.twoFactorSetupSecret && account.twoFactorSetupUrl; else twoFactorStart">
              <p class="text-sm text-slate-700 dark:text-slate-200">{{ 'account.security.twoFactor.setupHint' | translate }}</p>

              <div class="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
                <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 grid gap-2 justify-items-center">
                  <p class="text-xs text-slate-500 dark:text-slate-400 text-center">{{ 'account.security.twoFactor.qrHint' | translate }}</p>
                  <ng-container *ngIf="account.twoFactorSetupQrDataUrl; else qrPending">
                    <img
                      [src]="account.twoFactorSetupQrDataUrl"
                      [alt]="'account.security.twoFactor.qrAlt' | translate"
                      class="h-44 w-44 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950"
                    />
                  </ng-container>
                  <ng-template #qrPending>
                    <app-skeleton height="176px" width="176px"></app-skeleton>
                  </ng-template>
                </div>

                <div class="grid gap-2">
                <div class="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'account.security.twoFactor.secretLabel' | translate }}
                    <input
                      type="text"
                      name="twoFactorSecret"
                      [value]="account.twoFactorSetupSecret"
                      readonly
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    />
                  </label>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'account.security.twoFactor.copySecret' | translate"
                    (action)="account.copyTwoFactorSecret()"
                  ></app-button>
                </div>

                <div class="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'account.security.twoFactor.setupUrlLabel' | translate }}
                    <input
                      type="text"
                      name="twoFactorSetupUrl"
                      [value]="account.twoFactorSetupUrl"
                      readonly
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    />
                  </label>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'account.security.twoFactor.copyUrl' | translate"
                    (action)="account.copyTwoFactorSetupUrl()"
                  ></app-button>
                </div>
                </div>
              </div>

              <div class="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'account.security.twoFactor.codeLabel' | translate }}
                  <input
                    name="twoFactorEnableCode"
                    type="text"
                    autocomplete="one-time-code"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    [disabled]="account.enablingTwoFactor"
                    [(ngModel)]="account.twoFactorEnableCode"
                  />
                </label>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.twoFactor.enableAction' | translate"
                  [disabled]="account.enablingTwoFactor || !account.twoFactorEnableCode.trim()"
                  (action)="account.enableTwoFactor()"
                ></app-button>
              </div>
            </ng-container>

            <ng-template #twoFactorStart>
              <div class="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'account.security.twoFactor.setupPasswordLabel' | translate }}
                  <div class="relative">
                    <input
                      name="twoFactorSetupPassword"
                      [type]="showTwoFactorSetupPassword ? 'text' : 'password'"
                      autocomplete="current-password"
                      class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      [disabled]="account.startingTwoFactor"
                      [(ngModel)]="account.twoFactorSetupPassword"
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                      (click)="showTwoFactorSetupPassword = !showTwoFactorSetupPassword"
                      [attr.aria-label]="(showTwoFactorSetupPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                    >
                      {{ (showTwoFactorSetupPassword ? 'auth.hide' : 'auth.show') | translate }}
                    </button>
                  </div>
                </label>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.twoFactor.setupAction' | translate"
                  [disabled]="account.startingTwoFactor || !account.twoFactorSetupPassword.trim()"
                  (action)="account.startTwoFactorSetup()"
                ></app-button>
              </div>
            </ng-template>
          </ng-template>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="grid gap-1">
              <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.passkeys.title' | translate }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.passkeys.copy' | translate }}</p>
            </div>
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              [class.bg-emerald-100]="account.passkeys().length > 0"
              [class.text-emerald-800]="account.passkeys().length > 0"
              [class.dark:bg-emerald-900/40]="account.passkeys().length > 0"
              [class.dark:text-emerald-200]="account.passkeys().length > 0"
              [class.bg-slate-100]="account.passkeys().length === 0"
              [class.text-slate-700]="account.passkeys().length === 0"
              [class.dark:bg-slate-800]="account.passkeys().length === 0"
              [class.dark:text-slate-200]="account.passkeys().length === 0"
            >
              {{
                (account.passkeys().length > 0 ? 'account.security.passkeys.enabled' : 'account.security.passkeys.disabled') | translate
              }}
            </span>
          </div>

          <p *ngIf="!account.passkeysSupported()" class="text-sm text-slate-700 dark:text-slate-200">
            {{ 'account.security.passkeys.notSupported' | translate }}
          </p>

          <div *ngIf="account.passkeysSupported() && account.passkeysLoading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'notifications.loading' | translate }}
          </div>

          <p *ngIf="account.passkeysError()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.passkeysError() }}</p>

          <p
            *ngIf="account.passkeysSupported() && !account.passkeysLoading() && account.passkeys().length === 0"
            class="text-sm text-slate-700 dark:text-slate-200"
          >
            {{ 'account.security.passkeys.none' | translate }}
          </p>

          <ul *ngIf="account.passkeysSupported() && !account.passkeysLoading() && account.passkeys().length" class="grid gap-2">
            <li
              *ngFor="let p of account.passkeys()"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0 grid gap-1">
                <p class="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
                  {{ p.name || ('account.security.passkeys.defaultName' | translate) }}
                </p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'account.security.passkeys.created' | translate }}: {{ p.created_at | date: 'medium' }}
                  <span *ngIf="p.last_used_at"> • {{ 'account.security.passkeys.lastUsed' | translate }}: {{ p.last_used_at | date: 'medium' }}</span>
                  <span *ngIf="p.device_type"> • {{ p.device_type }}</span>
                  <span *ngIf="p.backed_up"> • {{ 'account.security.passkeys.backedUp' | translate }}</span>
                </p>
              </div>
              <ng-container *ngIf="account.removePasskeyConfirmId !== p.id; else passkeyRemoveConfirm">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.actions.remove' | translate"
                  [disabled]="account.removingPasskeyId === p.id"
                  (action)="account.startRemovePasskey(p.id)"
                ></app-button>
              </ng-container>

              <ng-template #passkeyRemoveConfirm>
                <div class="w-full grid gap-2 sm:grid-cols-[2fr_auto_auto] sm:items-end">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'account.security.passkeys.passwordLabel' | translate }}
                    <div class="relative">
                      <input
                        [attr.name]="'removePasskeyPassword-' + p.id"
                        [type]="showRemovePasskeyPassword ? 'text' : 'password'"
                        autocomplete="current-password"
                        class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        [disabled]="account.removingPasskeyId === p.id"
                        [(ngModel)]="account.removePasskeyPassword"
                      />
                      <button
                        type="button"
                        class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                        (click)="showRemovePasskeyPassword = !showRemovePasskeyPassword"
                        [attr.aria-label]="(showRemovePasskeyPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                      >
                        {{ (showRemovePasskeyPassword ? 'auth.hide' : 'auth.show') | translate }}
                      </button>
                    </div>
                  </label>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'account.security.actions.confirm' | translate"
                    [disabled]="account.removingPasskeyId === p.id || !account.removePasskeyPassword.trim()"
                    (action)="account.confirmRemovePasskey()"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'account.security.actions.cancel' | translate"
                    [disabled]="account.removingPasskeyId === p.id"
                    (action)="account.cancelRemovePasskey()"
                  ></app-button>
                </div>
              </ng-template>
            </li>
          </ul>

          <div *ngIf="account.passkeysSupported()" class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'account.security.passkeys.nameLabel' | translate }}
              <input
                name="passkeyName"
                type="text"
                maxlength="120"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [disabled]="account.registeringPasskey"
                [(ngModel)]="account.passkeyRegisterName"
              />
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'account.security.passkeys.passwordLabel' | translate }}
              <div class="relative">
                <input
                  name="passkeyPassword"
                  [type]="showPasskeyPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [disabled]="account.registeringPasskey"
                  [(ngModel)]="account.passkeyRegisterPassword"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                  (click)="showPasskeyPassword = !showPasskeyPassword"
                  [attr.aria-label]="(showPasskeyPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                >
                  {{ (showPasskeyPassword ? 'auth.hide' : 'auth.show') | translate }}
                </button>
              </div>
            </label>

            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.security.passkeys.addAction' | translate"
              [disabled]="account.registeringPasskey || !account.passkeyRegisterPassword.trim()"
              (action)="account.registerPasskey()"
            ></app-button>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <div class="grid gap-1">
            <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.emails.title' | translate }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.emails.copy' | translate }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{ 'account.security.emails.primaryHint' | translate }}
            </p>
            <p *ngIf="account.googleEmail()" class="text-xs text-amber-800 dark:text-amber-200">
              {{ 'account.security.emails.googleWarning' | translate }}
              <a href="#google-settings" class="underline underline-offset-2 ml-1">{{ 'account.security.emails.googleWarningLink' | translate }}</a>
            </p>
            <p *ngIf="account.emailCooldownSeconds() > 0" class="text-xs text-amber-800 dark:text-amber-200">
              {{ 'account.cooldowns.email' | translate: { time: account.formatCooldown(account.emailCooldownSeconds()) } }}
            </p>
          </div>

          <div class="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'account.security.emails.addLabel' | translate }}
              <input
                name="secondaryEmailAdd"
                type="email"
                autocomplete="email"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [disabled]="account.addingSecondaryEmail"
                [(ngModel)]="account.secondaryEmailToAdd"
              />
            </label>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.security.emails.addAction' | translate"
              [disabled]="account.addingSecondaryEmail || !account.secondaryEmailToAdd.trim()"
              (action)="account.addSecondaryEmail()"
            ></app-button>
          </div>

          <p *ngIf="account.secondaryEmailsError()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.secondaryEmailsError() }}</p>
          <p *ngIf="account.secondaryEmailMessage" class="text-xs text-slate-600 dark:text-slate-300">{{ account.secondaryEmailMessage }}</p>

          <div *ngIf="account.secondaryEmailsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'notifications.loading' | translate }}
          </div>

          <ul class="grid gap-2">
            <li
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{{ account.profile()?.email }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'account.security.emails.primary' | translate }} •
                  {{ account.emailVerified() ? ('account.security.status.verified' | translate) : ('account.security.status.unverified' | translate) }}
                </p>
              </div>
            </li>

            <li
              *ngFor="let e of account.secondaryEmails()"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{{ e.email }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'account.security.emails.secondary' | translate }} •
                  {{ e.verified ? ('account.security.status.verified' | translate) : ('account.security.status.unverified' | translate) }}
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-2 sm:ml-auto">
                <app-button
                  *ngIf="!e.verified"
                  size="sm"
                  variant="ghost"
                  [label]="
                    account.secondaryEmailResendRemainingSeconds(e.id) > 0
                      ? ('account.security.emails.resendIn' | translate: { seconds: account.secondaryEmailResendRemainingSeconds(e.id) })
                      : ('account.security.emails.resend' | translate)
                  "
                  [disabled]="account.secondaryEmailResendRemainingSeconds(e.id) > 0"
                  (action)="account.resendSecondaryEmailVerification(e.id)"
                ></app-button>

                <app-button
                  *ngIf="!e.verified && account.secondaryVerificationEmailId !== e.id"
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.emails.verify' | translate"
                  (action)="account.startSecondaryEmailVerification(e.id)"
                ></app-button>

                <app-button
                  *ngIf="e.verified && account.makePrimarySecondaryEmailId !== e.id"
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.emails.makePrimary' | translate"
                  [disabled]="!!account.googleEmail() || account.emailCooldownSeconds() > 0"
                  (action)="account.startMakePrimary(e.id)"
                ></app-button>

                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.actions.remove' | translate"
                  (action)="account.startDeleteSecondaryEmail(e.id)"
                ></app-button>
              </div>

              <div
                *ngIf="account.removeSecondaryEmailId === e.id"
                class="w-full grid gap-2 sm:grid-cols-[2fr_auto_auto] sm:items-end"
              >
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'account.security.emails.confirmPassword' | translate }}
                  <div class="relative">
                    <input
                      [attr.name]="'removeSecondaryEmailPassword-' + e.id"
                      [type]="showRemoveSecondaryEmailPassword ? 'text' : 'password'"
                      autocomplete="current-password"
                      class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      [disabled]="account.removingSecondaryEmail"
                      [(ngModel)]="account.removeSecondaryEmailPassword"
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                      (click)="showRemoveSecondaryEmailPassword = !showRemoveSecondaryEmailPassword"
                      [attr.aria-label]="(showRemoveSecondaryEmailPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                    >
                      {{ (showRemoveSecondaryEmailPassword ? 'auth.hide' : 'auth.show') | translate }}
                    </button>
                  </div>
                </label>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.actions.confirm' | translate"
                  [disabled]="account.removingSecondaryEmail || !account.removeSecondaryEmailPassword.trim()"
                  (action)="account.confirmDeleteSecondaryEmail()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.actions.cancel' | translate"
                  [disabled]="account.removingSecondaryEmail"
                  (action)="account.cancelDeleteSecondaryEmail()"
                ></app-button>
              </div>

              <form
                *ngIf="!e.verified && account.secondaryVerificationEmailId === e.id"
                class="w-full grid gap-2 sm:grid-cols-[2fr_auto_auto] sm:items-end"
                (ngSubmit)="account.confirmSecondaryEmailVerification()"
              >
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'account.security.emails.verifyCode' | translate }}
                  <input
                    [attr.name]="'secondaryVerificationToken-' + e.id"
                    type="text"
                    autocomplete="one-time-code"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    [disabled]="account.verifyingSecondaryEmail"
                    [(ngModel)]="account.secondaryVerificationToken"
                  />
                </label>
                <app-button
                  size="sm"
                  variant="ghost"
                  type="submit"
                  [label]="'account.security.actions.confirm' | translate"
                  [disabled]="account.verifyingSecondaryEmail || !account.secondaryVerificationToken.trim()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.actions.cancel' | translate"
                  [disabled]="account.verifyingSecondaryEmail"
                  (action)="account.cancelSecondaryEmailVerification()"
                ></app-button>
              </form>

              <p
                *ngIf="!e.verified && account.secondaryVerificationEmailId === e.id && account.secondaryVerificationStatus"
                class="w-full text-xs text-slate-600 dark:text-slate-300"
              >
                {{ account.secondaryVerificationStatus }}
              </p>

              <div
                *ngIf="account.makePrimarySecondaryEmailId === e.id"
                class="w-full grid gap-2 sm:grid-cols-[2fr_auto_auto] sm:items-end"
              >
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'account.security.emails.confirmPassword' | translate }}
                  <div class="relative">
                    <input
                      name="makePrimaryPassword"
                      [type]="showMakePrimaryPassword ? 'text' : 'password'"
                      autocomplete="current-password"
                      class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      [disabled]="account.makingPrimaryEmail"
                      [(ngModel)]="account.makePrimaryPassword"
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                      (click)="showMakePrimaryPassword = !showMakePrimaryPassword"
                      [attr.aria-label]="(showMakePrimaryPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                    >
                      {{ (showMakePrimaryPassword ? 'auth.hide' : 'auth.show') | translate }}
                    </button>
                  </div>
                </label>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.actions.confirm' | translate"
                  [disabled]="account.makingPrimaryEmail"
                  (action)="account.confirmMakePrimary()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'account.security.actions.cancel' | translate"
                  [disabled]="account.makingPrimaryEmail"
                  (action)="account.cancelMakePrimary()"
                ></app-button>
              </div>
              <p
                *ngIf="account.makePrimarySecondaryEmailId === e.id && account.makePrimaryError"
                class="w-full text-xs text-rose-700 dark:text-rose-300"
              >
                {{ account.makePrimaryError }}
              </p>
            </li>
          </ul>
        </div>

        <div id="google-settings" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-2">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
            <img
              *ngIf="account.googlePicture()"
              [src]="account.googlePicture()"
              [attr.alt]="'account.security.google.profileAlt' | translate"
              class="h-10 w-10 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
            />
            <div class="min-w-0">
              <p class="font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.google.title' | translate }}</p>
              <p class="text-slate-600 dark:text-slate-300 truncate">{{ account.googleEmail() || ('account.security.google.none' | translate) }}</p>
            </div>
            <div class="flex flex-col sm:flex-row gap-2 sm:ml-auto w-full sm:w-auto">
              <div class="relative w-full sm:w-auto">
                <input
                  [type]="showGooglePassword ? 'text' : 'password'"
                  name="googlePassword"
                  [(ngModel)]="account.googlePassword"
                  autocomplete="current-password"
                  [placeholder]="'account.security.google.passwordPlaceholder' | translate"
                  [attr.aria-label]="'account.security.google.passwordAria' | translate"
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                  (click)="showGooglePassword = !showGooglePassword"
                  [attr.aria-label]="(showGooglePassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                >
                  {{ (showGooglePassword ? 'auth.hide' : 'auth.show') | translate }}
                </button>
              </div>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.security.google.link' | translate"
                *ngIf="!account.googleEmail()"
                [disabled]="account.googleBusy || !account.googlePassword"
                (action)="account.linkGoogle()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'account.security.google.unlink' | translate"
                *ngIf="account.googleEmail()"
                [disabled]="account.googleBusy || !account.googlePassword"
                (action)="account.unlinkGoogle()"
              ></app-button>
            </div>
          </div>
          <p *ngIf="account.googleError" class="text-xs text-rose-700 dark:text-rose-300">{{ account.googleError }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.google.copy' | translate }}</p>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="grid gap-1">
              <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.devices.title' | translate }}</h3>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.devices.copy' | translate }}</p>
            </div>
            <app-button
              *ngIf="!account.revokeOtherSessionsConfirming"
              size="sm"
              variant="ghost"
              [label]="'account.security.devices.action' | translate"
              [disabled]="account.sessionsLoading() || account.revokingOtherSessions || account.otherSessionsCount() === 0"
              (action)="account.startRevokeOtherSessions()"
            ></app-button>
          </div>

          <div
            *ngIf="account.revokeOtherSessionsConfirming"
            class="w-full grid gap-2 sm:grid-cols-[2fr_auto_auto] sm:items-end"
          >
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.currentPassword' | translate }}
              <div class="relative">
                <input
                  name="revokeOtherSessionsPassword"
                  [type]="showRevokeOtherSessionsPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [disabled]="account.revokingOtherSessions"
                  [(ngModel)]="account.revokeOtherSessionsPassword"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                  (click)="showRevokeOtherSessionsPassword = !showRevokeOtherSessionsPassword"
                  [attr.aria-label]="(showRevokeOtherSessionsPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
                >
                  {{ (showRevokeOtherSessionsPassword ? 'auth.hide' : 'auth.show') | translate }}
                </button>
              </div>
            </label>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.security.actions.confirm' | translate"
              [disabled]="account.revokingOtherSessions || !account.revokeOtherSessionsPassword.trim()"
              (action)="account.confirmRevokeOtherSessions()"
            ></app-button>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.security.actions.cancel' | translate"
              [disabled]="account.revokingOtherSessions"
              (action)="account.cancelRevokeOtherSessions()"
            ></app-button>
          </div>

          <div *ngIf="account.sessionsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'notifications.loading' | translate }}
          </div>

          <p *ngIf="account.sessionsError()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.sessionsError() }}</p>

          <p *ngIf="!account.sessionsLoading() && account.sessions().length === 0" class="text-sm text-slate-700 dark:text-slate-200">
            {{ 'account.security.devices.none' | translate }}
          </p>

          <ul *ngIf="!account.sessionsLoading() && account.sessions().length" class="grid gap-2">
            <li
              *ngFor="let s of account.sessions()"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-1"
            >
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium text-slate-900 dark:text-slate-50 truncate max-w-full">
                  {{ (s.user_agent || ('account.security.devices.unknownDevice' | translate)) | slice: 0: 90 }}
                </p>
                <span
                  *ngIf="s.is_current"
                  class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                >
                  {{ 'account.security.devices.current' | translate }}
                </span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'account.security.devices.created' | translate }}: {{ s.created_at | date: 'medium' }} •
                {{ 'account.security.devices.expires' | translate }}: {{ s.expires_at | date: 'medium' }}
                <span *ngIf="s.ip_address"> • IP {{ s.ip_address }}</span>
                <span *ngIf="s.persistent"> • {{ 'account.security.devices.persistent' | translate }}</span>
              </p>
            </li>
          </ul>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="grid gap-1">
              <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.activity.title' | translate }}</h3>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.security.activity.copy' | translate }}</p>
            </div>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.security.activity.refresh' | translate"
              [disabled]="account.securityEventsLoading()"
              (action)="account.refreshSecurityEvents()"
            ></app-button>
          </div>

          <div *ngIf="account.securityEventsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'notifications.loading' | translate }}
          </div>

          <p *ngIf="account.securityEventsError()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.securityEventsError() }}</p>

          <p
            *ngIf="!account.securityEventsLoading() && account.securityEvents().length === 0"
            class="text-sm text-slate-700 dark:text-slate-200"
          >
            {{ 'account.security.activity.none' | translate }}
          </p>

          <ul *ngIf="!account.securityEventsLoading() && account.securityEvents().length" class="grid gap-2">
            <li
              *ngFor="let e of account.securityEvents()"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-1"
            >
              <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
                {{ ('account.security.activity.' + (e.event_type || 'unknown')) | translate }}
              </p>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ e.created_at | date: 'medium' }}<span *ngIf="e.ip_address"> • IP {{ e.ip_address }}</span>
              </p>
              <p *ngIf="e.user_agent" class="text-xs text-slate-500 dark:text-slate-400 truncate">
                {{ e.user_agent }}
              </p>
            </li>
          </ul>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'account.security.session.title' | translate }}</h3>
          <p class="text-sm text-slate-700 dark:text-slate-200">
            {{ 'account.security.session.copy' | translate }}
            <a class="text-indigo-600 dark:text-indigo-300 cursor-pointer" (click)="account.signOut()">{{
              'account.security.session.logoutNow' | translate
            }}</a
            >.
          </p>
          <p *ngIf="account.idleWarning()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.idleWarning() }}</p>
          <div class="flex gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.security.session.refresh' | translate"
              (action)="account.refreshSession()"
            ></app-button>
          </div>
        </div>
      </div>
      </ng-template>
    </section>
  `
})
export class AccountSecurityComponent {
  protected readonly account = inject(AccountComponent);
  showTwoFactorManagePassword = false;
  showTwoFactorSetupPassword = false;
  showPasskeyPassword = false;
  showRemovePasskeyPassword = false;
  showMakePrimaryPassword = false;
  showRemoveSecondaryEmailPassword = false;
  showGooglePassword = false;
  showRevokeOtherSessionsPassword = false;
}
