import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';

import { ApiService } from '../core/api.service';
import { MarkdownService } from '../core/markdown.service';
import { CmsGlobalSectionBlocksComponent } from './cms-global-section-blocks.component';

describe('CmsGlobalSectionBlocksComponent', () => {
  it('keeps reserved loading space until async CMS blocks resolve', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    const pending$ = new Subject<unknown>();
    api.get.and.returnValue(pending$);
    const markdown = { render: (md: string) => md } as unknown as MarkdownService;

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), CmsGlobalSectionBlocksComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: MarkdownService, useValue: markdown },
      ],
    });

    const fixture = TestBed.createComponent(CmsGlobalSectionBlocksComponent);
    fixture.componentInstance.contentKey = 'site.header-banners';
    fixture.componentInstance.reserveLoadingHeightClass = 'min-h-[9rem]';
    fixture.componentInstance.loadingSkeletonCount = 4;
    fixture.detectChanges();

    const loading = fixture.nativeElement.querySelector('[data-cms-global-loading="true"]') as HTMLElement | null;
    expect(loading).toBeTruthy();
    expect(loading?.className).toContain('min-h-[9rem]');
    expect(fixture.nativeElement.querySelectorAll('app-skeleton').length).toBe(4);

    pending$.next({
      meta: {
        blocks: [
          {
            key: 'intro',
            type: 'text',
            title: { en: 'Header promo' },
            body_markdown: { en: 'Promo copy' },
          },
        ],
      },
    });
    pending$.complete();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-cms-global-loading="true"]')).toBeNull();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Header promo');
    expect(text).toContain('Promo copy');
  });
});
