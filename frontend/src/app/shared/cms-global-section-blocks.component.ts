import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { ContainerComponent } from '../layout/container.component';
import { BannerBlockComponent } from './banner-block.component';
import { CarouselBlockComponent } from './carousel-block.component';
import { PageBlock, UiLang, pageBlockInnerClasses, pageBlockOuterClasses, parsePageBlocks } from './page-blocks';

type ContentBlockRead = {
  meta?: Record<string, unknown> | null;
};

@Component({
  selector: 'app-cms-global-section-blocks',
  standalone: true,
  imports: [CommonModule, TranslateModule, ContainerComponent, BannerBlockComponent, CarouselBlockComponent],
  template: `
    <section *ngIf="blocks().length" class="w-full" [ngClass]="sectionClasses">
      <app-container [classes]="containerClasses">
        <div class="grid gap-6">
          <ng-container *ngFor="let b of blocks()">
            <div class="w-full" [ngClass]="pageBlockOuterClasses(b.layout)">
              <div [ngClass]="pageBlockInnerClasses(b.layout)">
                <ng-container [ngSwitch]="b.type">
                  <div *ngSwitchCase="'text'" class="grid gap-2">
                    <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {{ b.title }}
                    </h2>
                    <div class="markdown text-base text-slate-700 leading-relaxed dark:text-slate-200" [innerHTML]="b.body_html"></div>
                  </div>

                  <div *ngSwitchCase="'image'" class="grid gap-2">
                    <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {{ b.title }}
                    </h2>
                    <a
                      *ngIf="b.link_url; else plainImage"
                      class="block"
                      [href]="b.link_url"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
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
                    <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {{ b.title }}
                    </h2>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <div *ngFor="let img of b.images" class="grid gap-2">
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

                  <div *ngSwitchCase="'banner'" class="grid gap-2">
                    <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {{ b.title }}
                    </h2>
                    <app-banner-block [slide]="b.slide"></app-banner-block>
                  </div>

                  <div *ngSwitchCase="'carousel'" class="grid gap-2">
                    <h2 *ngIf="b.title" class="text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {{ b.title }}
                    </h2>
                    <app-carousel-block [slides]="b.slides" [settings]="b.settings"></app-carousel-block>
                  </div>
                </ng-container>
              </div>
            </div>
          </ng-container>
        </div>
      </app-container>
    </section>
  `
})
export class CmsGlobalSectionBlocksComponent implements OnInit, OnDestroy {
  @Input({ required: true }) contentKey!: string;
  @Input() sectionClasses = '';
  @Input() containerClasses = 'py-6';

  blocks = signal<PageBlock[]>([]);
  pageBlockOuterClasses = pageBlockOuterClasses;
  pageBlockInnerClasses = pageBlockInnerClasses;

  private langSub?: Subscription;

  constructor(
    private api: ApiService,
    private markdown: MarkdownService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.load();
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  focalPosition(focalX?: number, focalY?: number): string {
    const x = Math.max(0, Math.min(100, Math.round(Number(focalX ?? 50))));
    const y = Math.max(0, Math.min(100, Math.round(Number(focalY ?? 50))));
    return `${x}% ${y}%`;
  }

  private load(): void {
    const key = (this.contentKey || '').trim();
    if (!key) {
      this.blocks.set([]);
      return;
    }
    const lang: UiLang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.api.get<ContentBlockRead>(`/content/${encodeURIComponent(key)}`, { lang }).subscribe({
      next: (block) => {
        const meta = ((block as { meta?: Record<string, unknown> | null })?.meta || {}) as Record<string, unknown>;
        this.blocks.set(parsePageBlocks(meta, lang, (md) => this.markdown.render(md)));
      },
      error: (err) => {
        if (err?.status === 404) {
          this.blocks.set([]);
          return;
        }
        this.blocks.set([]);
      }
    });
  }
}

