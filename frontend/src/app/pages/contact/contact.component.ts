import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CardComponent } from '../../shared/card.component';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, ContainerComponent, BreadcrumbComponent, CardComponent, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-3xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'contact.title' | translate }}</h1>

      <app-card>
        <div class="grid gap-4 text-slate-700 dark:text-slate-200">
          <p class="leading-relaxed">{{ 'contact.intro' | translate }}</p>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'contact.replyTime' | translate }}</p>

          <div class="grid gap-3 sm:grid-cols-2">
            <a
              class="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              [href]="'tel:' + phone"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'contact.phoneLabel' | translate }}
              </p>
              <p class="mt-1 font-semibold text-slate-900 group-hover:text-slate-950 dark:text-slate-50">
                {{ phone }}
              </p>
            </a>
            <a
              class="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              [href]="'mailto:' + email"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'contact.emailLabel' | translate }}
              </p>
              <p class="mt-1 font-semibold text-slate-900 group-hover:text-slate-950 dark:text-slate-50 break-all">
                {{ email }}
              </p>
            </a>
          </div>
        </div>
      </app-card>
    </app-container>
  `
})
export class ContactComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.contact' }
  ];

  readonly phone = '+40723204204';
  readonly email = 'momentstudio.ro@gmail.com';

  private langSub?: Subscription;

  constructor(
    private translate: TranslateService,
    private title: Title,
    private meta: Meta
  ) {}

  ngOnInit(): void {
    this.setMetaTags();
    this.langSub = this.translate.onLangChange.subscribe(() => this.setMetaTags());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  private setMetaTags(): void {
    const pageTitle = this.translate.instant('contact.metaTitle');
    const description = this.translate.instant('contact.metaDescription');
    this.title.setTitle(pageTitle);
    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:description', content: description });
    }
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
  }
}

