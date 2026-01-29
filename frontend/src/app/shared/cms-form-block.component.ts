import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs/operators';

import { AuthService } from '../core/auth.service';
import { NewsletterService } from '../core/newsletter.service';
import { SupportService } from '../core/support.service';
import { ContactSubmissionTopic, PageFormBlock } from './page-blocks';

@Component({
  selector: 'app-cms-form-block',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="grid gap-4">
      <ng-container [ngSwitch]="block.form_type">
        <ng-container *ngSwitchCase="'newsletter'">
          <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">
            {{ block.title || ('blog.newsletter.title' | translate) }}
          </h2>
          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'blog.newsletter.copy' | translate }}
          </p>

          <div
            *ngIf="newsletterSuccess()"
            class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
          >
            {{ 'blog.newsletter.successCopy' | translate }}
          </div>

          <div
            *ngIf="newsletterAlreadySubscribed()"
            class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200"
          >
            {{ 'blog.newsletter.alreadyCopy' | translate }}
          </div>

          <div
            *ngIf="newsletterError()"
            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            <p class="font-semibold">{{ 'blog.newsletter.errorTitle' | translate }}</p>
            <p class="text-sm">{{ newsletterError() }}</p>
          </div>

          <form class="grid gap-4" (ngSubmit)="submitNewsletter()" #newsletterForm="ngForm">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'blog.newsletter.emailLabel' | translate }}
              <input
                class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="email"
                type="email"
                [(ngModel)]="newsletterEmail"
                required
                maxlength="255"
                autocomplete="email"
                [placeholder]="'blog.newsletter.emailPlaceholder' | translate"
              />
            </label>

            <div class="flex items-center justify-end gap-3">
              <button
                type="submit"
                class="h-11 px-5 rounded-xl bg-slate-900 text-white font-semibold shadow-sm hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                [disabled]="newsletterLoading() || !newsletterForm.form.valid"
              >
                {{ 'blog.newsletter.subscribe' | translate }}
              </button>
            </div>
          </form>
        </ng-container>

        <ng-container *ngSwitchDefault>
          <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">
            {{ block.title || ('contact.form.title' | translate) }}
          </h2>

          <div
            *ngIf="contactSuccess()"
            class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
          >
            <p class="font-semibold">{{ 'contact.form.successTitle' | translate }}</p>
            <p class="text-sm">{{ 'contact.form.successCopy' | translate }}</p>
          </div>

          <div
            *ngIf="contactError()"
            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ contactError() }}
          </div>

          <form class="grid gap-4" (ngSubmit)="submitContact()" #contactForm="ngForm">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'contact.form.topicLabel' | translate }}
              <select
                class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                name="topic"
                [(ngModel)]="formTopic"
                required
              >
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="contact">
                  {{ 'contact.form.topicContact' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="support">
                  {{ 'contact.form.topicSupport' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="refund">
                  {{ 'contact.form.topicRefund' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="dispute">
                  {{ 'contact.form.topicDispute' | translate }}
                </option>
              </select>
            </label>

            <div class="grid gap-4 sm:grid-cols-2">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'contact.form.nameLabel' | translate }}
                <input
                  class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  name="name"
                  [(ngModel)]="formName"
                  required
                  minlength="1"
                  maxlength="255"
                  autocomplete="name"
                />
              </label>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'contact.form.emailLabel' | translate }}
                <input
                  class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  name="email"
                  [(ngModel)]="formEmail"
                  required
                  maxlength="255"
                  autocomplete="email"
                  type="email"
                />
              </label>
            </div>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'contact.form.orderLabel' | translate }}
              <input
                class="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="order_reference"
                [(ngModel)]="formOrderRef"
                maxlength="50"
                [placeholder]="'contact.form.orderPlaceholder' | translate"
              />
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'contact.form.messageLabel' | translate }}
              <textarea
                class="min-h-[140px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                name="message"
                [(ngModel)]="formMessage"
                required
                minlength="1"
                maxlength="10000"
                [placeholder]="'contact.form.messagePlaceholder' | translate"
              ></textarea>
            </label>

            <div class="flex items-center justify-end gap-3">
              <button
                type="submit"
                class="h-11 px-5 rounded-xl bg-slate-900 text-white font-semibold shadow-sm hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                [disabled]="contactSubmitting() || !contactForm.form.valid"
              >
                {{ contactSubmitting() ? ('contact.form.sending' | translate) : ('contact.form.submit' | translate) }}
              </button>
            </div>
          </form>
        </ng-container>
      </ng-container>
    </div>
  `
})
export class CmsFormBlockComponent implements OnChanges {
  @Input({ required: true }) block!: PageFormBlock;

  contactSubmitting = signal(false);
  contactSuccess = signal(false);
  contactError = signal('');

  newsletterLoading = signal(false);
  newsletterSuccess = signal(false);
  newsletterAlreadySubscribed = signal(false);
  newsletterError = signal('');

  formTopic: ContactSubmissionTopic = 'contact';
  formName = '';
  formEmail = '';
  formOrderRef = '';
  formMessage = '';
  newsletterEmail = '';

  constructor(
    private auth: AuthService,
    private support: SupportService,
    private newsletter: NewsletterService,
    private translate: TranslateService
  ) {}

  ngOnChanges(): void {
    this.resetMessages();
    this.prefillFromUser();
    const topic = this.block?.topic;
    if (topic === 'support' || topic === 'refund' || topic === 'dispute' || topic === 'contact') {
      this.formTopic = topic;
    } else {
      this.formTopic = 'contact';
    }
  }

  submitContact(): void {
    if (this.contactSubmitting()) return;
    if ((this.block?.form_type || 'contact') !== 'contact') return;

    this.contactError.set('');
    this.contactSuccess.set(false);

    const payload = {
      topic: this.formTopic,
      name: this.formName.trim(),
      email: this.formEmail.trim(),
      message: this.formMessage.trim(),
      order_reference: this.formOrderRef.trim() ? this.formOrderRef.trim() : null
    };

    this.contactSubmitting.set(true);
    this.support
      .submitContact(payload)
      .pipe(
        finalize(() => {
          this.contactSubmitting.set(false);
        })
      )
      .subscribe({
        next: () => {
          this.contactSuccess.set(true);
          this.formMessage = '';
          this.formOrderRef = '';
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('contact.form.error');
          this.contactError.set(msg);
        }
      });
  }

  submitNewsletter(): void {
    if (this.newsletterLoading()) return;
    if ((this.block?.form_type || 'contact') !== 'newsletter') return;

    this.newsletterError.set('');
    this.newsletterSuccess.set(false);
    this.newsletterAlreadySubscribed.set(false);

    const email = (this.newsletterEmail || '').trim();
    this.newsletterLoading.set(true);
    this.newsletter
      .subscribe(email, { source: 'cms', captcha_token: null })
      .pipe(
        finalize(() => {
          this.newsletterLoading.set(false);
        })
      )
      .subscribe({
        next: (res) => {
          if (res?.already_subscribed) {
            this.newsletterAlreadySubscribed.set(true);
            return;
          }
          this.newsletterSuccess.set(true);
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('blog.newsletter.errorCopy');
          this.newsletterError.set(msg);
        }
      });
  }

  private resetMessages(): void {
    this.contactError.set('');
    this.contactSuccess.set(false);
    this.newsletterError.set('');
    this.newsletterSuccess.set(false);
    this.newsletterAlreadySubscribed.set(false);
  }

  private prefillFromUser(): void {
    const current = this.auth.user();
    if (!current) return;
    const email = (current.email || '').trim();
    const name = (current.name || '').trim();
    if (email) {
      this.formEmail = email;
      this.newsletterEmail = email;
    }
    if (name) this.formName = name;
  }
}

