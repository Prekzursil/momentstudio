import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-security',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, ButtonComponent],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="grid gap-1">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'account.sections.security' | translate }}</h2>
        <p class="text-xs text-slate-500 dark:text-slate-400">Manage password, emails, and connected accounts.</p>
      </div>

      <div class="grid gap-3">
        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div class="grid gap-1">
            <p class="font-semibold text-slate-900 dark:text-slate-50">Password</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">Change your password to keep your account secure.</p>
          </div>
          <app-button routerLink="/account/password" size="sm" variant="ghost" label="Change password"></app-button>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <div class="grid gap-1">
            <p class="font-semibold text-slate-900 dark:text-slate-50">Emails</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">Manage the emails you can use to sign in.</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              To change your primary email, add and verify another email, then make it primary (requires password).
            </p>
            <p *ngIf="account.googleEmail()" class="text-xs text-amber-800 dark:text-amber-200">
              Unlink Google before switching primary email.
            </p>
          </div>

          <div class="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Add email
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
              label="Add"
              [disabled]="account.addingSecondaryEmail || !account.secondaryEmailToAdd.trim()"
              (action)="account.addSecondaryEmail()"
            ></app-button>
          </div>

          <p *ngIf="account.secondaryEmailsError()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.secondaryEmailsError() }}</p>
          <p *ngIf="account.secondaryEmailMessage" class="text-xs text-slate-600 dark:text-slate-300">{{ account.secondaryEmailMessage }}</p>

          <div *ngIf="account.secondaryEmailsLoading()" class="text-sm text-slate-600 dark:text-slate-300">Loading…</div>

          <ul class="grid gap-2">
            <li
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{{ account.profile()?.email }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  Primary • {{ account.emailVerified() ? 'Verified' : 'Unverified' }}
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
                  Secondary • {{ e.verified ? 'Verified' : 'Unverified' }}
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-2 sm:ml-auto">
                <app-button
                  *ngIf="!e.verified"
                  size="sm"
                  variant="ghost"
                  label="Resend code"
                  (action)="account.resendSecondaryEmailVerification(e.id)"
                ></app-button>

                <app-button
                  *ngIf="e.verified && account.makePrimarySecondaryEmailId !== e.id"
                  size="sm"
                  variant="ghost"
                  label="Make primary"
                  [disabled]="!!account.googleEmail()"
                  (action)="account.startMakePrimary(e.id)"
                ></app-button>

                <app-button size="sm" variant="ghost" label="Remove" (action)="account.deleteSecondaryEmail(e.id)"></app-button>
              </div>

              <div
                *ngIf="account.makePrimarySecondaryEmailId === e.id"
                class="w-full grid gap-2 sm:grid-cols-[2fr_auto_auto] sm:items-end"
              >
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Confirm password
                  <input
                    name="makePrimaryPassword"
                    type="password"
                    autocomplete="current-password"
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    [disabled]="account.makingPrimaryEmail"
                    [(ngModel)]="account.makePrimaryPassword"
                  />
                </label>
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Confirm"
                  [disabled]="account.makingPrimaryEmail"
                  (action)="account.confirmMakePrimary()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  label="Cancel"
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

          <form class="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end" (ngSubmit)="account.confirmSecondaryEmailVerification()">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              Verify code
              <input
                name="secondaryVerificationToken"
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
              label="Verify"
              [disabled]="account.verifyingSecondaryEmail || !account.secondaryVerificationToken.trim()"
            ></app-button>
          </form>
          <p *ngIf="account.secondaryVerificationStatus" class="text-xs text-slate-600 dark:text-slate-300">
            {{ account.secondaryVerificationStatus }}
          </p>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-2">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
            <img
              *ngIf="account.googlePicture()"
              [src]="account.googlePicture()"
              alt="Google profile"
              class="h-10 w-10 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
            />
            <div class="min-w-0">
              <p class="font-semibold text-slate-900 dark:text-slate-50">Google</p>
              <p class="text-slate-600 dark:text-slate-300 truncate">{{ account.googleEmail() || 'No Google account linked' }}</p>
            </div>
            <div class="flex flex-col sm:flex-row gap-2 sm:ml-auto w-full sm:w-auto">
              <input
                type="password"
                name="googlePassword"
                [(ngModel)]="account.googlePassword"
                autocomplete="current-password"
                placeholder="Confirm password"
                aria-label="Confirm password for Google account"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <app-button
                size="sm"
                variant="ghost"
                label="Link Google"
                *ngIf="!account.googleEmail()"
                [disabled]="account.googleBusy || !account.googlePassword"
                (action)="account.linkGoogle()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                label="Unlink"
                *ngIf="account.googleEmail()"
                [disabled]="account.googleBusy || !account.googlePassword"
                (action)="account.unlinkGoogle()"
              ></app-button>
            </div>
          </div>
          <p *ngIf="account.googleError" class="text-xs text-rose-700 dark:text-rose-300">{{ account.googleError }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">Linking Google lets you sign in faster. We never post without permission.</p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 grid gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">Payment methods</h3>
            <div class="flex gap-2 items-center">
              <app-button size="sm" variant="ghost" label="Add card" (action)="account.addCard()"></app-button>
              <app-button size="sm" label="Save card" (action)="account.confirmCard()" [disabled]="!account.cardReady || account.savingCard"></app-button>
            </div>
          </div>

          <div *ngIf="account.paymentMethods.length === 0" class="text-sm text-slate-700 dark:text-slate-200">No cards saved yet.</div>

          <div class="border border-dashed border-slate-200 rounded-lg p-3 text-sm dark:border-slate-700" *ngIf="account.cardElementVisible">
            <p class="text-slate-600 dark:text-slate-300 mb-2">Enter card details:</p>
            <div #cardHost class="min-h-[48px]"></div>
            <p *ngIf="account.cardError" class="text-rose-700 dark:text-rose-300 text-xs mt-2">{{ account.cardError }}</p>
          </div>

          <div
            *ngFor="let pm of account.paymentMethods"
            class="flex items-center justify-between text-sm border border-slate-200 rounded-lg p-3 dark:border-slate-700"
          >
            <div class="flex items-center gap-2">
              <span class="font-semibold">{{ pm.brand || 'Card' }}</span>
              <span *ngIf="pm.last4">•••• {{ pm.last4 }}</span>
              <span *ngIf="pm.exp_month && pm.exp_year">(exp {{ pm.exp_month }}/{{ pm.exp_year }})</span>
            </div>
            <app-button size="sm" variant="ghost" label="Remove" (action)="account.removePaymentMethod(pm.id)"></app-button>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800 grid gap-3">
          <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">Session</h3>
          <p class="text-sm text-slate-700 dark:text-slate-200">
            You will be logged out after inactivity to keep your account safe.
            <a class="text-indigo-600 dark:text-indigo-300 cursor-pointer" (click)="account.signOut()">Logout now</a>.
          </p>
          <p *ngIf="account.idleWarning()" class="text-xs text-rose-700 dark:text-rose-300">{{ account.idleWarning() }}</p>
          <div class="flex gap-2">
            <app-button size="sm" variant="ghost" label="Refresh session" (action)="account.refreshSession()"></app-button>
          </div>
        </div>
      </div>
    </section>
  `
})
export class AccountSecurityComponent implements OnDestroy {
  protected readonly account = inject(AccountComponent);

  @ViewChild('cardHost')
  private set cardHost(cardHost: ElementRef<HTMLDivElement> | undefined) {
    this.account.setCardHost(cardHost);
  }

  ngOnDestroy(): void {
    this.account.setCardHost(undefined);
  }
}
