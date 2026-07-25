import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { NewsletterService } from '../../core/newsletter.service';
import { NewsletterUnsubscribeComponent } from './newsletter-unsubscribe.component';

type TokenGetter = () => string | null;

function configure(tokenGetter: TokenGetter): {
  newsletter: jasmine.SpyObj<NewsletterService>;
} {
  const newsletter = jasmine.createSpyObj<NewsletterService>('NewsletterService', ['unsubscribe']);

  TestBed.configureTestingModule({
    imports: [NewsletterUnsubscribeComponent, RouterTestingModule, TranslateModule.forRoot()],
    providers: [
      { provide: NewsletterService, useValue: newsletter },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: tokenGetter } } },
      },
    ],
  });

  const translate = TestBed.inject(TranslateService);
  translate.setTranslation(
    'en',
    {
      newsletter: {
        unsubscribe: {
          missingToken: 'Missing token',
          errorCopy: 'Something went wrong',
          successTitle: 'Done',
          successCopy: 'You are unsubscribed',
        },
      },
    },
    true,
  );
  translate.use('en');

  return { newsletter };
}

describe('NewsletterUnsubscribeComponent', () => {
  it('shows a missing-token error and skips the API when no token is present', () => {
    const { newsletter } = configure(() => null);

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.token).toBe('');
    expect(cmp.loading).toBeFalse();
    expect(cmp.success).toBeFalse();
    expect(cmp.errorMessage).toBe('Missing token');
    expect(newsletter.unsubscribe).not.toHaveBeenCalled();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Missing token');
  });

  it('auto-unsubscribes on init with a valid token and renders the success state', () => {
    const { newsletter } = configure(() => 'tok-123');
    newsletter.unsubscribe.and.returnValue(of({ unsubscribed: true }));

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.token).toBe('tok-123');
    expect(newsletter.unsubscribe).toHaveBeenCalledOnceWith('tok-123');
    expect(cmp.loading).toBeFalse();
    expect(cmp.success).toBeTrue();
    expect(cmp.errorMessage).toBe('');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('You are unsubscribed');
  });

  it('uses the server-provided detail message when the unsubscribe call fails', () => {
    const { newsletter } = configure(() => 'tok-err');
    newsletter.unsubscribe.and.returnValue(
      throwError(() => ({ error: { detail: 'Token already used' } })),
    );

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.loading).toBeFalse();
    expect(cmp.success).toBeFalse();
    expect(cmp.errorMessage).toBe('Token already used');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Token already used');
  });

  it('falls back to the translated error copy when the error carries no detail', () => {
    const { newsletter } = configure(() => 'tok-err');
    newsletter.unsubscribe.and.returnValue(throwError(() => ({})));

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.success).toBeFalse();
    expect(cmp.errorMessage).toBe('Something went wrong');
  });

  it('falls back to the translated error copy when the error itself is nullish', () => {
    const { newsletter } = configure(() => 'tok-err');
    newsletter.unsubscribe.and.returnValue(throwError(() => null));

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.success).toBeFalse();
    expect(cmp.errorMessage).toBe('Something went wrong');
  });

  it('ignores manual unsubscribe() calls while a request is already in flight', () => {
    const { newsletter } = configure(() => 'tok-123');

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    const cmp = fixture.componentInstance;
    cmp.token = 'tok-123';
    cmp.loading = true;
    cmp.success = false;

    cmp.unsubscribe();

    expect(newsletter.unsubscribe).not.toHaveBeenCalled();
  });

  it('ignores manual unsubscribe() calls after a successful unsubscribe', () => {
    const { newsletter } = configure(() => 'tok-123');

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    const cmp = fixture.componentInstance;
    cmp.token = 'tok-123';
    cmp.loading = false;
    cmp.success = true;

    cmp.unsubscribe();

    expect(newsletter.unsubscribe).not.toHaveBeenCalled();
  });

  it('ignores manual unsubscribe() calls when there is no token', () => {
    const { newsletter } = configure(() => null);

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    const cmp = fixture.componentInstance;
    cmp.token = '';
    cmp.loading = false;
    cmp.success = false;

    cmp.unsubscribe();

    expect(newsletter.unsubscribe).not.toHaveBeenCalled();
  });

  it('re-runs the request via the CTA after a non-detail failure clears the flags', () => {
    const { newsletter } = configure(() => 'tok-retry');
    newsletter.unsubscribe.and.returnValue(throwError(() => ({ error: {} })));

    const fixture = TestBed.createComponent(NewsletterUnsubscribeComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.errorMessage).toBe('Something went wrong');
    expect(newsletter.unsubscribe).toHaveBeenCalledTimes(1);

    newsletter.unsubscribe.and.returnValue(of({ unsubscribed: true }));
    cmp.unsubscribe();

    expect(newsletter.unsubscribe).toHaveBeenCalledTimes(2);
    expect(cmp.success).toBeTrue();
    expect(cmp.errorMessage).toBe('');
  });
});
