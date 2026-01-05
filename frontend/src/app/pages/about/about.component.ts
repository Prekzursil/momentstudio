import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CardComponent } from '../../shared/card.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

interface ContentImage {
  url: string;
  alt_text?: string | null;
}

interface ContentBlock {
  title: string;
  body_markdown: string;
  images: ContentImage[];
}

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, ContainerComponent, BreadcrumbComponent, CardComponent, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-3xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ block()?.title || ('nav.about' | translate) }}</h1>

      <app-card>
        <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'about.loading' | translate }}
        </div>

        <div *ngIf="!loading() && hasError()" class="grid gap-2">
          <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'about.errorTitle' | translate }}</p>
          <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'about.errorCopy' | translate }}</p>
        </div>

        <div *ngIf="!loading() && !hasError() && block()" class="grid gap-5">
          <img
            *ngIf="block()!.images?.length"
            [src]="block()!.images[0].url"
            [alt]="block()!.images[0].alt_text || block()!.title"
            class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
            loading="lazy"
          />
          <div class="text-slate-700 leading-relaxed whitespace-pre-line dark:text-slate-200">
            {{ block()!.body_markdown }}
          </div>
        </div>
      </app-card>
    </app-container>
  `
})
export class AboutComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.about' }
  ];

  block = signal<ContentBlock | null>(null);
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);

  private langSub?: Subscription;

  constructor(private api: ApiService, private translate: TranslateService, private title: Title, private meta: Meta) {}

  ngOnInit(): void {
    this.load();
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  private load(): void {
    this.loading.set(true);
    this.hasError.set(false);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.api.get<ContentBlock>('/content/pages/about', { lang }).subscribe({
      next: (block) => {
        this.block.set(block);
        this.loading.set(false);
        this.hasError.set(false);
        this.setMetaTags(block.title, block.body_markdown);
      },
      error: () => {
        this.block.set(null);
        this.loading.set(false);
        this.hasError.set(true);
        this.setMetaTags(this.translate.instant('about.metaTitle'), this.translate.instant('about.metaDescription'));
      }
    });
  }

  private setMetaTags(title: string, body: string): void {
    const pageTitle = title ? `${title} | AdrianaArt` : 'About | AdrianaArt';
    const description = (body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    this.title.setTitle(pageTitle);
    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ name: 'og:description', content: description });
    }
    this.meta.updateTag({ name: 'og:title', content: pageTitle });
  }
}

