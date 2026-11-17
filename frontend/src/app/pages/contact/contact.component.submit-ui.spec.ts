import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { SiteSocialService } from '../../core/site-social.service';
import { ContactSubmissionRead, SupportService } from '../../core/support.service';
import { ContactComponent } from './contact.component';

/**
 * Golden WU ct52 — template/DOM arms for contact submit UX.
 * Existing contact specs cover service-level submit; these cover
 * validation-disabled CTA, success/error banners, and captcha-disabled gate.
 */
describe('ContactComponent submit UI arms', () => {
  let support: jasmine.SpyObj<SupportService>;

  function submitButton(root: HTMLElement): HTMLButtonElement {
    const btn = root.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (!btn) throw new Error('submit button missing');
    return btn;
  }

  function fillValidForm(cmp: ContactComponent): void {
    cmp.formName = 'Jane';
    cmp.formEmail = 'jane@example.com';
    cmp.formMessage = 'Hello from the contact form';
    cmp.formTopic = 'contact';
  }

  beforeEach(() => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ title: 'Contact', body_markdown: 'Hello', images: [] } as never));
    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['user']);
    auth.user.and.returnValue(null);
    support = jasmine.createSpyObj<SupportService>('SupportService', ['submitContact']);
    support.submitContact.and.returnValue(of({} as ContactSubmissionRead));
    const seo = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);
    seo.setLocalizedCanonical.and.returnValue('http://localhost/contact');
    const markdown = { render: (s: string) => s } as unknown as MarkdownService;
    const social = {
      get: () =>
        of({
          contact: { phone: '+40000', email: 'hi@example.com' },
          instagramPages: [],
          facebookPages: [],
        }),
    } as unknown as SiteSocialService;

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, ContactComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: SupportService, useValue: support },
        { provide: SeoHeadLinksService, useValue: seo },
        { provide: MarkdownService, useValue: markdown },
        { provide: SiteSocialService, useValue: social },
        { provide: Title, useValue: jasmine.createSpyObj('Title', ['setTitle']) },
        { provide: Meta, useValue: jasmine.createSpyObj('Meta', ['updateTag']) },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        contact: {
          form: {
            submit: 'Send message',
            sending: 'Sending…',
            successTitle: 'Message sent',
            successCopy: 'We will reply soon',
            error: 'Could not send',
          },
        },
        auth: { captchaRequired: 'Captcha required' },
      },
      true,
    );
    translate.use('en');
  });

  it('disables the submit CTA until required fields are filled (validation)', async () => {
    const emptyFixture = TestBed.createComponent(ContactComponent);
    emptyFixture.detectChanges();
    await emptyFixture.whenStable();
    emptyFixture.detectChanges();
    expect(submitButton(emptyFixture.nativeElement as HTMLElement).disabled).toBeTrue();

    // Fresh fixture: set required fields before the first CD to avoid NG0100.
    const filledFixture = TestBed.createComponent(ContactComponent);
    fillValidForm(filledFixture.componentInstance);
    filledFixture.detectChanges();
    await filledFixture.whenStable();
    filledFixture.detectChanges();

    const btn = submitButton(filledFixture.nativeElement as HTMLElement);
    expect(btn.disabled).toBeFalse();
    expect((btn.textContent || '').replace(/\s+/g, ' ').trim()).toContain('Send message');
  });

  it('paints the success banner and clears a prior error after a successful submit', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    fillValidForm(cmp);
    cmp.submitError.set('stale error');
    fixture.detectChanges();

    cmp.submit();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(cmp.submitSuccess()).toBeTrue();
    expect(cmp.submitError()).toBe('');
    const text = (root.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Message sent');
    expect(text).toContain('We will reply soon');
    expect(text).not.toContain('stale error');
  });

  it('keeps submit disabled without captcha token and paints the error banner on failure', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    fillValidForm(cmp);
    cmp.captchaEnabled = true;
    cmp.captchaToken = null;
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const btn = submitButton(root);

    // Captcha-missing gate (bot/honeypot-adjacent): CTA stays disabled.
    expect(btn.disabled).toBeTrue();

    // Direct submit path still surfaces the captcha validation error.
    cmp.submit();
    fixture.detectChanges();
    expect(support.submitContact).not.toHaveBeenCalled();
    expect(cmp.submitError()).toBe('Captcha required');

    // With a token, a server failure paints the error banner (not success).
    cmp.captchaToken = 'tok';
    support.submitContact.and.returnValue(
      throwError(() => ({ error: { detail: 'Rate limited' } })),
    );
    cmp.submit();
    fixture.detectChanges();

    expect(cmp.submitSuccess()).toBeFalse();
    expect(cmp.submitError()).toBe('Rate limited');
    expect((root.textContent || '').replace(/\s+/g, ' ')).toContain('Rate limited');

    // Busy/disabled arm: while submitting, the CTA label flips and stays disabled.
    cmp.submitting.set(true);
    cmp.captchaToken = 'tok';
    fixture.detectChanges();
    expect(btn.disabled).toBeTrue();
    expect((btn.textContent || '').replace(/\s+/g, ' ').trim()).toContain('Sending…');
  });
});
