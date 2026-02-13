import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { CardComponent } from '../../shared/card.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MarkdownService } from '../../core/markdown.service';
import { CmsPageBlocksComponent } from '../../shared/cms-page-blocks.component';
import { PageBlock, pageBlocksToPlainText, parsePageBlocks } from '../../shared/page-blocks';

interface ContentImage {
  url: string;
  alt_text?: string | null;
  focal_x?: number;
  focal_y?: number;
}

interface ContentBlock {
  title: string;
  body_markdown: string;
  meta?: Record<string, unknown> | null;
  images: ContentImage[];
}

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, ContainerComponent, BreadcrumbComponent, CardComponent, TranslateModule, CmsPageBlocksComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-3xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex flex-wrap items-start justify-between gap-3">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ block()?.title || ('nav.about' | translate) }}</h1>
        <app-button
          *ngIf="canEditPage()"
          class="no-print"
          size="sm"
          variant="ghost"
          [label]="'page.admin.edit' | translate"
          (action)="editPage()"
        ></app-button>
      </div>

      <app-card>
        <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'about.loading' | translate }}
        </div>

        <div *ngIf="!loading() && hasError()" class="grid gap-2">
          <p class="font-semibold text-amber-900 dark:text-amber-100">{{ 'about.errorTitle' | translate }}</p>
          <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'about.errorCopy' | translate }}</p>
        </div>

        <div *ngIf="!loading() && !hasError() && block()" class="grid gap-5">
          <ng-container *ngIf="pageBlocks().length; else markdownContent">
            <app-cms-page-blocks [blocks]="pageBlocks()"></app-cms-page-blocks>
          </ng-container>

          <ng-template #markdownContent>
            <img
              *ngIf="block()!.images?.length"
              [src]="block()!.images[0].url"
              [alt]="block()!.images[0].alt_text || block()!.title"
              class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
              [style.object-position]="focalPosition(block()!.images[0].focal_x, block()!.images[0].focal_y)"
              loading="lazy"
            />
            <div class="markdown text-lg text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="bodyHtml()"></div>
          </ng-template>
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
  bodyHtml = signal<string>('');
  pageBlocks = signal<PageBlock[]>([]);

  private langSub?: Subscription;
  private querySub?: Subscription;
  private previewToken = '';

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private storefrontAdminMode: StorefrontAdminModeService,
    private translate: TranslateService,
    private title: Title,
    private meta: Meta,
    private markdown: MarkdownService
  ) {}

  ngOnInit(): void {
    this.querySub = this.route.queryParams.subscribe((query) => {
      this.previewToken = typeof query['preview'] === 'string' ? query['preview'] : '';
      this.load();
    });
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.querySub?.unsubscribe();
  }

  focalPosition(focalX?: number, focalY?: number): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  canEditPage(): boolean {
    return this.storefrontAdminMode.enabled();
  }

  editPage(): void {
    void this.router.navigate(['/admin/content/pages'], { queryParams: { edit: 'about' } });
  }

  private load(): void {
    this.loading.set(true);
    this.hasError.set(false);
    this.pageBlocks.set([]);
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const req = (this.previewToken || '').trim()
      ? this.api.get<ContentBlock>('/content/pages/about/preview', { token: this.previewToken, lang })
      : this.api.get<ContentBlock>('/content/pages/about', { lang });
    req.subscribe({
      next: (block) => {
        this.block.set(block);
        this.bodyHtml.set(this.markdown.render(block.body_markdown));
        this.pageBlocks.set(parsePageBlocks(block.meta, lang, (md) => this.markdown.render(md)));
        this.loading.set(false);
        this.hasError.set(false);
        const metaBody = this.pageBlocks().length ? pageBlocksToPlainText(this.pageBlocks()) : block.body_markdown;
        this.setMetaTags(block.title, metaBody);
      },
      error: () => {
        this.block.set(null);
        this.bodyHtml.set('');
        this.pageBlocks.set([]);
        this.loading.set(false);
        this.hasError.set(true);
        this.setMetaTags(this.translate.instant('about.metaTitle'), this.translate.instant('about.metaDescription'));
      }
    });
  }

  private setMetaTags(title: string, body: string): void {
    const pageTitle = title ? `${title} | momentstudio` : 'About | momentstudio';
    const description = (body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    this.title.setTitle(pageTitle);
    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:description', content: description });
    }
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
  }
}
