import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { SiteSocialService } from '../../core/site-social.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ContactSubmissionRead, SupportService } from '../../core/support.service';
import { ContactComponent } from './contact.component';

describe('ContactComponent (extra branches)', () => {
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;
  let support: jasmine.SpyObj<SupportService>;
  let adminMode: jasmine.SpyObj<StorefrontAdminModeService>;
  let router: jasmine.SpyObj<Router>;
  let queryParams: BehaviorSubject<Record<string, unknown>>;
  let socialData: {
    contact: { phone: string; email: string };
    instagramPages: { label: string; url: string; thumbnail_url?: string }[];
    facebookPages: { label: string; url: string; thumbnail_url?: string }[];
  };

  function build(): ContactComponent {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({ title: 'Contact', body_markdown: 'Hello', images: [] } as never));
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['user']);
    auth.user.and.returnValue(null);
    support = jasmine.createSpyObj<SupportService>('SupportService', ['submitContact']);
    support.submitContact.and.returnValue(of({} as ContactSubmissionRead));
    adminMode = jasmine.createSpyObj<StorefrontAdminModeService>('StorefrontAdminModeService', [
      'enabled',
    ]);
    adminMode.enabled.and.returnValue(false);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    queryParams = new BehaviorSubject<Record<string, unknown>>({});
    socialData = {
      contact: { phone: '', email: '' },
      instagramPages: [],
      facebookPages: [],
    };

    const seo = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);
    seo.setLocalizedCanonical.and.returnValue('http://localhost/contact');
    const markdown = { render: (s: string) => `<p>${s}</p>` } as unknown as MarkdownService;
    const social = { get: () => of(socialData) } as unknown as SiteSocialService;

    TestBed.configureTestingModule({
      imports: [ContactComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: SupportService, useValue: support },
        { provide: StorefrontAdminModeService, useValue: adminMode },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { queryParams } },
        { provide: SeoHeadLinksService, useValue: seo },
        { provide: MarkdownService, useValue: markdown },
        { provide: SiteSocialService, useValue: social },
        { provide: Title, useValue: jasmine.createSpyObj('Title', ['setTitle']) },
        { provide: Meta, useValue: jasmine.createSpyObj('Meta', ['updateTag']) },
      ],
    });
    TestBed.inject(TranslateService).use('en');
  });

  it('prefills name/email from the authenticated user', () => {
    auth.user.and.returnValue({ email: ' a@b.com ', name: ' Ana ' } as never);
    const cmp = build();
    expect(cmp.formEmail).toBe('a@b.com');
    expect(cmp.formName).toBe('Ana');
  });

  it('falls back to the email as name when the user has no name', () => {
    auth.user.and.returnValue({ email: 'a@b.com', name: '' } as never);
    const cmp = build();
    expect(cmp.formName).toBe('a@b.com');
  });

  it('handles an authenticated user with no email or name', () => {
    auth.user.and.returnValue({ email: null, name: null } as never);
    const cmp = build();
    expect(cmp.formEmail).toBe('');
    expect(cmp.formName).toBe('');
  });

  it('loads the preview endpoint when a preview token is present', () => {
    queryParams.next({ preview: 'tok-1' });
    build();
    expect(api.get).toHaveBeenCalledWith('/content/pages/contact/preview', {
      token: 'tok-1',
      lang: 'en',
    });
  });

  it('ignores a non-string preview token', () => {
    queryParams.next({ preview: 123 });
    build();
    expect(api.get).toHaveBeenCalledWith('/content/pages/contact', { lang: 'en' });
  });

  it('shows an error state and fallback copy when loading fails', () => {
    api.get.and.returnValue(throwError(() => new Error('boom')));
    const cmp = build();
    expect(cmp.hasError()).toBe(true);
    expect(cmp.loading()).toBe(false);
    expect(cmp.block()).toBeNull();
  });

  it('applies social contact details and pages', () => {
    socialData = {
      contact: { phone: '+40000', email: 'shop@x.com' },
      instagramPages: [{ label: 'IG', url: 'https://ig' }],
      facebookPages: [{ label: 'FB', url: 'https://fb' }],
    };
    const cmp = build();
    expect(cmp.phone()).toBe('+40000');
    expect(cmp.email()).toBe('shop@x.com');
    expect(cmp.instagramPages().length).toBe(1);
    expect(cmp.facebookPages().length).toBe(1);
  });

  describe('initialsForLabel', () => {
    it('defaults to MS for an empty or nullish label', () => {
      expect(build().initialsForLabel('   ')).toBe('MS');
      expect(build().initialsForLabel(null as never)).toBe('MS');
    });

    it('uses the first letters of the first two words', () => {
      expect(build().initialsForLabel('Moment Studio')).toBe('MS');
    });

    it('uses the first two characters of a single word', () => {
      expect(build().initialsForLabel('Shop')).toBe('SH');
    });

    it('pads with S when a single-character label has no second letter', () => {
      expect(build().initialsForLabel('A')).toBe('AS');
    });
  });

  describe('setMetaTags branches', () => {
    it('keeps a title that already contains a pipe', () => {
      api.get.and.returnValue(
        of({ title: 'Custom | Brand', body_markdown: 'Body', images: [] } as never),
      );
      const title = TestBed.inject(Title) as jasmine.SpyObj<Title>;
      build();
      expect(title.setTitle).toHaveBeenCalledWith('Custom | Brand');
    });

    it('uses the meta title fallback when the API title is empty', () => {
      api.get.and.returnValue(of({ title: '', body_markdown: '', images: [] } as never));
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation('en', { contact: { metaTitle: 'Fallback Title' } }, true);
      translate.use('en');
      const title = TestBed.inject(Title) as jasmine.SpyObj<Title>;
      build();
      expect(title.setTitle).toHaveBeenCalledWith('Fallback Title');
    });
  });

  describe('focalPosition', () => {
    it('defaults and clamps coordinates', () => {
      const cmp = build();
      expect(cmp.focalPosition()).toBe('50% 50%');
      expect(cmp.focalPosition(-1, 999)).toBe('0% 100%');
    });
  });

  describe('admin editing', () => {
    it('reflects the storefront admin mode', () => {
      adminMode.enabled.and.returnValue(true);
      expect(build().canEditPage()).toBe(true);
    });

    it('navigates to the admin content page on edit', () => {
      build().editPage();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/content/pages'], {
        queryParams: { edit: 'contact' },
      });
    });
  });

  describe('submit', () => {
    it('does nothing when already submitting', () => {
      const cmp = build();
      cmp.submitting.set(true);
      cmp.submit();
      expect(support.submitContact).not.toHaveBeenCalled();
    });

    it('submits and resets on success', () => {
      const cmp = build();
      cmp.formName = ' Ana ';
      cmp.formEmail = ' a@b.com ';
      cmp.formMessage = ' Hi ';
      cmp.formOrderRef = ' ref ';
      cmp.submit();
      expect(support.submitContact).toHaveBeenCalledWith(
        jasmine.objectContaining({
          name: 'Ana',
          email: 'a@b.com',
          message: 'Hi',
          order_reference: 'ref',
        }),
      );
      expect(cmp.submitSuccess()).toBe(true);
      expect(cmp.formMessage).toBe('');
      expect(cmp.submitting()).toBe(false);
    });

    it('sends a null order reference when blank', () => {
      const cmp = build();
      cmp.formOrderRef = '   ';
      cmp.submit();
      expect(support.submitContact).toHaveBeenCalledWith(
        jasmine.objectContaining({ order_reference: null }),
      );
    });

    it('surfaces the API error detail on failure', () => {
      support.submitContact.and.returnValue(throwError(() => ({ error: { detail: 'Bad' } })));
      const cmp = build();
      cmp.submit();
      expect(cmp.submitError()).toBe('Bad');
      expect(cmp.submitting()).toBe(false);
    });

    it('falls back to a generic error message', () => {
      support.submitContact.and.returnValue(throwError(() => ({})));
      const cmp = build();
      cmp.submit();
      expect(cmp.submitError()).toBeTruthy();
    });

    it('requires a captcha token when captcha is enabled', () => {
      const cmp = build();
      (cmp as unknown as { captchaEnabled: boolean }).captchaEnabled = true;
      cmp.captchaToken = null;
      cmp.submit();
      expect(support.submitContact).not.toHaveBeenCalled();
      expect(cmp.submitError()).toBeTruthy();
    });

    it('submits with a captcha token and resets it via the captcha component', () => {
      const cmp = build();
      const reset = jasmine.createSpy('reset');
      (cmp as unknown as { captchaEnabled: boolean }).captchaEnabled = true;
      (cmp as unknown as { contactCaptcha: { reset: () => void } }).contactCaptcha = { reset };
      cmp.captchaToken = 'tok';
      cmp.formMessage = 'Hi';
      cmp.submit();
      expect(support.submitContact).toHaveBeenCalled();
      expect(reset).toHaveBeenCalled();
      expect(cmp.captchaToken).toBeNull();
    });

    it('resets the captcha after a failed submit', () => {
      support.submitContact.and.returnValue(throwError(() => ({})));
      const cmp = build();
      const reset = jasmine.createSpy('reset');
      (cmp as unknown as { contactCaptcha: { reset: () => void } }).contactCaptcha = { reset };
      cmp.captchaToken = 'tok';
      cmp.submit();
      expect(reset).toHaveBeenCalled();
    });
  });

  it('reacts to a language change by reloading', fakeAsync(() => {
    build();
    api.get.calls.reset();
    TestBed.inject(TranslateService).use('ro');
    tick();
    expect(api.get).toHaveBeenCalled();
  }));
});
