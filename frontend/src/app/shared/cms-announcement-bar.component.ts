import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { PageBlock, UiLang, parsePageBlocks } from './page-blocks';

type ContentBlockRead = {
  meta?: Record<string, unknown> | null;
};

@Component({
  selector: 'app-cms-announcement-bar',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div
      *ngIf="html()"
      class="border-b border-slate-200 bg-indigo-50 text-indigo-900 dark:border-slate-800 dark:bg-indigo-950/30 dark:text-indigo-100"
    >
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2 text-sm">
        <div class="markdown text-sm leading-relaxed" [innerHTML]="html()"></div>
      </div>
    </div>
  `
})
export class CmsAnnouncementBarComponent implements OnInit, OnDestroy {
  html = signal<string | null>(null);

  private langSub?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly markdown: MarkdownService,
    private readonly translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.load();
    this.langSub = this.translate.onLangChange.subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  private load(): void {
    const key = 'site.announcement';
    const lang: UiLang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    this.api.get<ContentBlockRead>(`/content/${encodeURIComponent(key)}`, { lang }).subscribe({
      next: (block) => {
        const meta = ((block as { meta?: Record<string, unknown> | null })?.meta || {}) as Record<string, unknown>;
        const blocks = parsePageBlocks(meta, lang, (md) => this.markdown.render(md));
        const firstText = blocks.find((b) => b.type === 'text') as (PageBlock & { type: 'text'; body_html: string }) | undefined;
        const html = (firstText?.body_html || '').trim();
        this.html.set(html || null);
      },
      error: () => {
        this.html.set(null);
      }
    });
  }
}

