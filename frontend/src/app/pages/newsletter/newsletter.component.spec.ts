import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { NewsletterService } from '../../core/newsletter.service';
import { NewsletterUnsubscribeComponent } from './newsletter-unsubscribe.component';

/**
 * Golden WU nl46 — first newsletter *page* specs.
 * There is no newsletter.component.ts; the subscribe form lives on blog/CMS.
 * This suite covers NewsletterUnsubscribeComponent submit/busy/success/error arms
 * (the only newsletter page with an explicit submit CTA).
 */
describe('NewsletterUnsubscribeComponent submit arms', () => {
  let newsletter: jasmine.SpyObj<NewsletterService>;

  function configure(token: string | null): void {
    newsletter = jasmine.createSpyObj<NewsletterService>('NewsletterService', ['unsubscribe']);

    TestBed.configureTestingModule({
      imports: [NewsletterUnsubscribeComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: NewsletterService, useValue: newsletter },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(token ? { token } : {}),
            },
          },
        },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        newsletter: {
          unsubscribe: {
            missingToken: 'missing-token',
            errorCopy: 'fallback-error',
          },
        },
      },
      true,
    );
    translate.use('en');
  }

  it('ngOnInit sets missing-token error and skips API when token is absent', () => {
    configure(null);
    newsletter.unsubscribe.and.returnValue(of({ unsubscribed: true }));

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.loading).toBeFalse();
    expect(cmp.success).toBeFalse();
    expect(cmp.errorMessage).toBe('missing-token');
    expect(newsletter.unsubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribe success path clears loading and marks success', () => {
    configure('tok-ok');
    newsletter.unsubscribe.and.returnValue(of({ unsubscribed: true }));

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(newsletter.unsubscribe).toHaveBeenCalledWith('tok-ok');
    expect(cmp.loading).toBeFalse();
    expect(cmp.success).toBeTrue();
    expect(cmp.errorMessage).toBe('');
  });

  it('unsubscribe uses error detail and refuses re-entry while busy or already success', () => {
    configure('tok-err');
    newsletter.unsubscribe.and.returnValue(
      throwError(() => ({ error: { detail: 'backend-detail' } })),
    );

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.loading).toBeFalse();
    expect(cmp.success).toBeFalse();
    expect(cmp.errorMessage).toBe('backend-detail');
    expect(newsletter.unsubscribe).toHaveBeenCalledTimes(1);

    // Busy guard: while loading, further submits are no-ops.
    cmp.loading = true;
    cmp.unsubscribe();
    expect(newsletter.unsubscribe).toHaveBeenCalledTimes(1);

    // Success guard: after a completed success, further submits are no-ops.
    cmp.loading = false;
    cmp.success = true;
    cmp.errorMessage = '';
    newsletter.unsubscribe.and.returnValue(of({ unsubscribed: true }));
    cmp.unsubscribe();
    expect(newsletter.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
