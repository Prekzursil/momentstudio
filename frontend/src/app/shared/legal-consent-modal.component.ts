import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SecurityContext, SimpleChanges, ViewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { ModalBodyScrollEvent, ModalComponent } from './modal.component';
import { PageBlock, pageBlockInnerClasses, pageBlockOuterClasses, parsePageBlocks, type UiLang } from './page-blocks';

interface ContentImage {
  url: string;
  alt_text?: string | null;
  focal_x?: number;
  focal_y?: number;
}

interface ContentBlock {
  key: string;
  title: string;
  body_markdown: string;
  meta?: Record<string, unknown> | null;
  images: ContentImage[];
}

@Component({
  selector: 'app-legal-consent-modal',
  standalone: true,
  imports: [CommonModule, TranslateModule, ModalComponent],
  template: `
    <app-modal
      [open]="open"
      [title]="title || ('legal.modal.title' | translate)"
      [subtitle]="subtitle"
      [showActions]="!loading && !error"
      [closeLabel]="'legal.modal.close' | translate"
      [cancelLabel]="'legal.modal.close' | translate"
      [confirmLabel]="'legal.modal.accept' | translate"
      [confirmDisabled]="confirmDisabled()"
      [requireScrollToConfirm]="!loading && !error"
      (confirm)="handleAccept()"
      (closed)="handleClosed()"
      (bodyScroll)="onBodyScroll($event)"
    >
      <div *ngIf="loading" class="text-sm text-slate-600 dark:text-slate-300">
        {{ 'legal.modal.loading' | translate }}
      </div>

      <div *ngIf="!loading && error" class="grid gap-2">
        <p class="text-sm text-amber-800 dark:text-amber-200">{{ error }}</p>
      </div>

      <div *ngIf="!loading && !error" class="grid gap-6">
        <ng-container *ngIf="pageBlocks.length; else markdownTpl">
          <ng-container *ngFor="let b of pageBlocks">
            <div class="w-full" [ngClass]="pageBlockOuterClasses(b.layout)">
              <div [ngClass]="pageBlockInnerClasses(b.layout)">
                <ng-container [ngSwitch]="b.type">
                  <div *ngSwitchCase="'text'" class="grid gap-2">
                    <h2 *ngIf="b.title" class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ b.title }}</h2>
                    <div
                      class="markdown text-slate-700 leading-relaxed dark:text-slate-200"
                      [innerHTML]="sanitizeHtml(b.body_html)"
                    ></div>
                  </div>

                  <div *ngSwitchCase="'image'" class="grid gap-2">
                    <h2 *ngIf="b.title" class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ b.title }}</h2>
                    <a *ngIf="b.link_url; else plainImage" class="block" [href]="b.link_url" target="_blank" rel="noopener noreferrer">
                      <img
                        [src]="b.url"
                        [alt]="b.alt || b.title || ''"
                        class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                        [style.object-position]="focalPosition(b.focal_x, b.focal_y)"
                        loading="lazy"
                      />
                    </a>
                    <ng-template #plainImage>
                      <img
                        [src]="b.url"
                        [alt]="b.alt || b.title || ''"
                        class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                        [style.object-position]="focalPosition(b.focal_x, b.focal_y)"
                        loading="lazy"
                      />
                    </ng-template>
                    <p *ngIf="b.caption" class="text-sm text-slate-600 dark:text-slate-300">{{ b.caption }}</p>
                  </div>

                  <div *ngSwitchCase="'gallery'" class="grid gap-2">
                    <h2 *ngIf="b.title" class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ b.title }}</h2>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <div *ngFor="let img of b.images" class="grid gap-1">
                        <img
                          [src]="img.url"
                          [alt]="img.alt || b.title || ''"
                          class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
                          [style.object-position]="focalPosition(img.focal_x, img.focal_y)"
                          loading="lazy"
                        />
                        <p *ngIf="img.caption" class="text-sm text-slate-600 dark:text-slate-300">{{ img.caption }}</p>
                      </div>
                    </div>
                  </div>
                </ng-container>
              </div>
            </div>
          </ng-container>
        </ng-container>

        <ng-template #markdownTpl>
          <img
            *ngIf="firstImageUrl()"
            [src]="firstImageUrl()!"
            [alt]="title"
            class="w-full rounded-2xl border border-slate-200 bg-slate-50 object-cover dark:border-slate-800 dark:bg-slate-800"
            [style.object-position]="firstImageFocal()"
            loading="lazy"
          />
          <div class="markdown text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="sanitizeHtml(bodyHtml)"></div>
        </ng-template>
      </div>
    </app-modal>
  `
})
export class LegalConsentModalComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() slug = '';
  @Output() accepted = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();
  pageBlockOuterClasses = pageBlockOuterClasses;
  pageBlockInnerClasses = pageBlockInnerClasses;
  @ViewChild(ModalComponent) modal?: ModalComponent;

  loading = false;
  error = '';
  title = '';
  subtitle = '';
  bodyHtml = '';
  pageBlocks: PageBlock[] = [];
  private images: ContentImage[] = [];
  private needsScroll = false;
  private readonly langSub?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly translate: TranslateService,
    private readonly markdown: MarkdownService,
    private readonly sanitizer: DomSanitizer
  ) {
    this.langSub = this.translate.onLangChange.subscribe(() => {
      if (this.open) this.load();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!('open' in changes) && !('slug' in changes)) return;
    if (this.open) {
      this.load();
      return;
    }
    this.reset();
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  focalPosition(focalX?: number, focalY?: number): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  firstImageUrl(): string | null {
    const img = this.images?.[0];
    return img?.url ? String(img.url) : null;
  }

  firstImageFocal(): string {
    const img = this.images?.[0];
    return this.focalPosition(img?.focal_x, img?.focal_y);
  }

  onBodyScroll(evt: ModalBodyScrollEvent): void {
    this.needsScroll = evt.scrollHeight > evt.clientHeight + 8;
    this.subtitle = !this.needsScroll || evt.atBottom ? '' : this.translate.instant('legal.modal.scrollToAccept');
  }

  confirmDisabled(): boolean {
    return this.loading || Boolean(this.error);
  }

  sanitizeHtml(value: string | null | undefined): string {
    return this.sanitizer.sanitize(SecurityContext.HTML, value ?? '') || '';
  }

  handleAccept(): void {
    if (this.confirmDisabled()) return;
    this.accepted.emit();
    this.handleClosed();
  }

  handleClosed(): void {
    this.closed.emit();
    this.reset();
  }

  private reset(): void {
    this.loading = false;
    this.error = '';
    this.title = '';
    this.subtitle = '';
    this.bodyHtml = '';
    this.pageBlocks = [];
    this.images = [];
    this.needsScroll = false;
  }

  private load(): void {
    const slug = (this.slug || '').trim();
    if (!slug) {
      this.loading = false;
      this.error = this.translate.instant('legal.modal.missingDoc');
      this.title = '';
      this.bodyHtml = '';
      this.pageBlocks = [];
      this.images = [];
      this.needsScroll = false;
      return;
    }

    const lang: UiLang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.loading = true;
    this.error = '';
    this.title = '';
    this.bodyHtml = '';
    this.pageBlocks = [];
    this.images = [];
    this.needsScroll = false;
    this.subtitle = this.translate.instant('legal.modal.loading');

    this.api.get<ContentBlock>(`/content/pages/${encodeURIComponent(slug)}`, { lang }).subscribe({
      next: (block) => {
        this.loading = false;
        this.error = '';
        this.title = block?.title || this.translate.instant('legal.modal.title');
        this.images = Array.isArray(block?.images) ? block.images : [];
        this.bodyHtml = this.markdown.render(String(block?.body_markdown || ''));
        this.pageBlocks = parsePageBlocks((block?.meta) || null, lang, (md) => this.markdown.render(md));
        this.subtitle = this.translate.instant('legal.modal.scrollToAccept');
        setTimeout(() => this.modal?.emitBodyScroll());
      },
      error: (err) => {
        this.loading = false;
        this.title = this.translate.instant('legal.modal.title');
        this.bodyHtml = '';
        this.pageBlocks = [];
        this.images = [];
        this.needsScroll = false;
        this.subtitle = '';
        this.error = err?.error?.detail || this.translate.instant('legal.modal.loadError');
      }
    });
  }
}

