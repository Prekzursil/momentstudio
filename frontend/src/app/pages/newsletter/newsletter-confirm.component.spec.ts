import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';

import { NewsletterConfirmComponent } from './newsletter-confirm.component';
import { NewsletterService } from '../../core/newsletter.service';

describe('NewsletterConfirmComponent', () => {
  let newsletter: jasmine.SpyObj<NewsletterService>;

  function configure(token: string | null): void {
    newsletter = jasmine.createSpyObj<NewsletterService>('NewsletterService', ['confirm']);
    TestBed.configureTestingModule({
      imports: [NewsletterConfirmComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: NewsletterService, useValue: newsletter },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => token } } },
        },
      ],
    });
  }

  function create() {
    const fixture = TestBed.createComponent(NewsletterConfirmComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('exposes breadcrumb trail anchored at home', () => {
    configure('any');
    newsletter.confirm.and.returnValue(of({ confirmed: true }));
    const fixture = create();

    expect(fixture.componentInstance.crumbs).toEqual([
      { label: 'nav.home', url: '/' },
      { label: 'newsletter.confirm.title' },
    ]);
  });

  it('shows the missing-token error and skips the API call when no token is present', () => {
    configure(null);
    const fixture = create();
    const component = fixture.componentInstance;

    expect(newsletter.confirm).not.toHaveBeenCalled();
    expect(component.loading).toBeFalse();
    expect(component.success).toBeFalse();
    expect(component.errorMessage).toBe('newsletter.confirm.missingToken');

    const errorBlock: HTMLElement | null = fixture.nativeElement.querySelector('.border-amber-200');
    expect(errorBlock).not.toBeNull();
    expect(errorBlock?.textContent).toContain('newsletter.confirm.missingToken');
    expect(fixture.nativeElement.querySelector('.border-emerald-200')).toBeNull();
  });

  it('confirms the subscription and renders the success state', () => {
    configure('valid-token');
    newsletter.confirm.and.returnValue(of({ confirmed: true }));
    const fixture = create();
    const component = fixture.componentInstance;

    expect(newsletter.confirm).toHaveBeenCalledOnceWith('valid-token');
    expect(component.loading).toBeFalse();
    expect(component.success).toBeTrue();
    expect(component.errorMessage).toBe('');

    const successBlock: HTMLElement | null =
      fixture.nativeElement.querySelector('.border-emerald-200');
    expect(successBlock).not.toBeNull();
    expect(successBlock?.textContent).toContain('newsletter.confirm.successCopy');
    expect(fixture.nativeElement.querySelector('.border-amber-200')).toBeNull();
  });

  it('renders the loading state until the confirm call settles', () => {
    configure('valid-token');
    // A pending Subject keeps the component in its initial loading state.
    const pending = new Subject<{ confirmed: boolean }>();
    newsletter.confirm.and.returnValue(pending.asObservable());

    const fixture = create();
    const component = fixture.componentInstance;

    expect(component.loading).toBeTrue();
    expect(component.success).toBeFalse();
    const loadingBlock: HTMLElement | null =
      fixture.nativeElement.querySelector('.border-slate-200');
    expect(loadingBlock).not.toBeNull();
    expect(loadingBlock?.textContent).toContain('newsletter.confirm.loading');
  });

  it('uses the server-provided detail message on error', () => {
    configure('bad-token');
    newsletter.confirm.and.returnValue(
      throwError(() => ({ error: { detail: 'Token expired' } })),
    );
    const fixture = create();
    const component = fixture.componentInstance;

    expect(component.loading).toBeFalse();
    expect(component.success).toBeFalse();
    expect(component.errorMessage).toBe('Token expired');

    const errorBlock: HTMLElement | null = fixture.nativeElement.querySelector('.border-amber-200');
    expect(errorBlock?.textContent).toContain('Token expired');
  });

  it('falls back to the translated copy when the error has no detail (nested null)', () => {
    configure('bad-token');
    newsletter.confirm.and.returnValue(throwError(() => ({ error: null })));
    const fixture = create();

    expect(fixture.componentInstance.errorMessage).toBe('newsletter.confirm.errorCopy');
  });

  it('falls back to the translated copy when the error itself is nullish', () => {
    configure('bad-token');
    newsletter.confirm.and.returnValue(throwError(() => undefined));
    const fixture = create();

    expect(fixture.componentInstance.errorMessage).toBe('newsletter.confirm.errorCopy');
  });

  it('falls back to the translated copy when detail is an empty string', () => {
    configure('bad-token');
    newsletter.confirm.and.returnValue(throwError(() => ({ error: { detail: '' } })));
    const fixture = create();

    expect(fixture.componentInstance.errorMessage).toBe('newsletter.confirm.errorCopy');
  });

  it('reports the translate service is wired for the missing-token path', () => {
    configure(null);
    const fixture = create();
    const translate = TestBed.inject(TranslateService);
    // With no catalogue loaded, instant() echoes the key — proving the key flows through.
    expect(translate.instant('newsletter.confirm.missingToken')).toBe(
      'newsletter.confirm.missingToken',
    );
    expect(fixture.componentInstance.errorMessage).toBe('newsletter.confirm.missingToken');
  });
});
