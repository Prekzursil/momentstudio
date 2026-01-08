import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ApiService } from '../../core/api.service';
import { MarkdownService } from '../../core/markdown.service';
import { SiteSocialLink, SiteSocialService } from '../../core/site-social.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CardComponent } from '../../shared/card.component';

interface ContentBlock {
  title: string;
  body_markdown: string;
}

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, ContainerComponent, BreadcrumbComponent, CardComponent, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-3xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ block()?.title || ('contact.title' | translate) }}</h1>

      <app-card>
        <div class="grid gap-5 text-slate-700 dark:text-slate-200">
          <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'about.loading' | translate }}
          </div>

          <div *ngIf="!loading() && hasError()" class="grid gap-2">
            <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'about.errorTitle' | translate }}</p>
            <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'about.errorCopy' | translate }}</p>
          </div>

          <div *ngIf="!loading() && !hasError()" class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="bodyHtml()"></div>

          <div class="grid gap-3 sm:grid-cols-2">
            <a
              class="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              [href]="'tel:' + (phone() || '')"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'contact.phoneLabel' | translate }}
              </p>
              <p class="mt-1 font-semibold text-slate-900 group-hover:text-slate-950 dark:text-slate-50">
                {{ phone() }}
              </p>
            </a>
            <a
              class="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              [href]="'mailto:' + (email() || '')"
            >
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'contact.emailLabel' | translate }}
              </p>
              <p class="mt-1 font-semibold text-slate-900 group-hover:text-slate-950 dark:text-slate-50 break-all">
                {{ email() }}
              </p>
            </a>
          </div>

          <div *ngIf="instagramPages().length || facebookPages().length" class="grid gap-3">
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {{ 'contact.followUs' | translate }}
            </p>
            <div class="grid gap-3 sm:grid-cols-2">
              <div *ngIf="instagramPages().length" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'footer.instagram' | translate }}</p>
                <div class="mt-2 grid gap-2">
                  <a
                    *ngFor="let page of instagramPages()"
                    class="text-sm text-indigo-700 hover:underline dark:text-indigo-300"
                    [href]="page.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ page.label }}
                  </a>
                </div>
              </div>
              <div *ngIf="facebookPages().length" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'footer.facebook' | translate }}</p>
                <div class="mt-2 grid gap-2">
                  <a
                    *ngFor="let page of facebookPages()"
                    class="text-sm text-indigo-700 hover:underline dark:text-indigo-300"
                    [href]="page.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ page.label }}
                  </a>
                </div>
              </div>
            </div>
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

  block = signal<ContentBlock | null>(null);
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  bodyHtml = signal<string>('');

  phone = signal<string>('+40723204204');
  email = signal<string>('momentstudio.ro@gmail.com');
  instagramPages = signal<SiteSocialLink[]>([]);
  facebookPages = signal<SiteSocialLink[]>([]);

  private langSub?: Subscription;
  private socialSub?: Subscription;

  constructor(
    private api: ApiService,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta,
    private markdown: MarkdownService,
    private social: SiteSocialService
  ) {}

  ngOnInit(): void {
    this.load();
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
    this.socialSub = this.social.get().subscribe((data) => {
      if (data.contact.phone) this.phone.set(data.contact.phone);
      if (data.contact.email) this.email.set(data.contact.email);
      this.instagramPages.set(data.instagramPages);
      this.facebookPages.set(data.facebookPages);
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.socialSub?.unsubscribe();
  }

  private load(): void {
    this.loading.set(true);
    this.hasError.set(false);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.api.get<ContentBlock>('/content/pages/contact', { lang }).subscribe({
      next: (block) => {
        this.block.set(block);
        this.bodyHtml.set(this.markdown.render(block.body_markdown));
        this.loading.set(false);
        this.hasError.set(false);
        this.setMetaTags(block.title, block.body_markdown);
      },
      error: () => {
        this.block.set(null);
        const fallbackBody = `${this.translate.instant('contact.intro')}\n\n${this.translate.instant('contact.replyTime')}`;
        this.bodyHtml.set(this.markdown.render(fallbackBody));
        this.loading.set(false);
        this.hasError.set(true);
        this.setMetaTags(this.translate.instant('contact.metaTitle'), this.translate.instant('contact.metaDescription'));
      }
    });
  }

  private setMetaTags(title: string, body: string): void {
    const baseTitle = (title || '').includes('|') ? title : `${title} | momentstudio`;
    const pageTitle = title ? baseTitle : this.translate.instant('contact.metaTitle');
    const description = (body || '').replace(/\s+/g, ' ').trim().slice(0, 160) || this.translate.instant('contact.metaDescription');
    this.title.setTitle(pageTitle);
    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ name: 'og:description', content: description });
    }
    this.meta.updateTag({ name: 'og:title', content: pageTitle });
  }
}
