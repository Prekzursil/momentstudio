import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { SiteSocialService } from '../../core/site-social.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { SupportService } from '../../core/support.service';
import { ContactComponent } from './contact.component';

describe('ContactComponent', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let api: jasmine.SpyObj<ApiService>;
  let seoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
  let auth: jasmine.SpyObj<AuthService>;
  let support: jasmine.SpyObj<SupportService>;
  let translate: TranslateService;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    seoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', [
      'setLocalizedCanonical',
    ]);
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/contact');
    api.get.and.callFake((path: string, params?: Record<string, unknown>) => {
      if (path !== '/content/pages/contact') throw new Error(`Unexpected path: ${path}`);
      if (params?.['lang'] === 'ro') {
        return of({ title: 'Contact RO', body_markdown: 'Salut', images: [] } as any);
      }
      return of({ title: 'Contact', body_markdown: 'Hello', images: [] } as any);
    });
    const markdown = { render: (s: string) => s } as unknown as MarkdownService;
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['user']);
    auth.user.and.returnValue(null);
    support = jasmine.createSpyObj<SupportService>('SupportService', ['submitContact']);
    support.submitContact.and.returnValue(of({} as any));
    const social = {
      get: () =>
        of({
          contact: { phone: '+40723204204', email: 'momentstudio.ro@gmail.com' },
          instagramPages: [],
          facebookPages: [],
        }),
    } as unknown as SiteSocialService;

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, ContactComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: ApiService, useValue: api },
        { provide: SeoHeadLinksService, useValue: seoHeadLinks },
        { provide: MarkdownService, useValue: markdown },
        { provide: SiteSocialService, useValue: social },
        { provide: AuthService, useValue: auth },
        { provide: SupportService, useValue: support },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        contact: { metaTitle: 'Contact | momentstudio', metaDescription: 'Contact desc' },
      },
      true,
    );
    translate.setTranslation(
      'ro',
      {
        contact: { metaTitle: 'Contact | momentstudio (RO)', metaDescription: 'Descriere contact' },
      },
      true,
    );
    translate.use('en');
  });

  it('sets meta tags on init', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    expect(title.setTitle).toHaveBeenCalledWith('Contact | momentstudio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:title',
      content: 'Contact | momentstudio',
    });
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/contact', 'en', {});
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:url',
      content: 'http://localhost:4200/contact',
    });
  });

  it('updates meta tags when language changes', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();
    seoHeadLinks.setLocalizedCanonical.calls.reset();
    seoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/contact?lang=ro');

    translate.use('ro');

    expect(title.setTitle).toHaveBeenCalledWith('Contact RO | momentstudio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Salut' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Salut' });
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:title',
      content: 'Contact RO | momentstudio',
    });
    expect(seoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/contact', 'ro', {});
    expect(meta.updateTag).toHaveBeenCalledWith({
      property: 'og:url',
      content: 'http://localhost:4200/contact?lang=ro',
    });
  });

  it('uses page blocks for meta description when present', () => {
    api.get.and.callFake((path: string, params?: Record<string, unknown>) => {
      if (path !== '/content/pages/contact') throw new Error(`Unexpected path: ${path}`);
      if (params?.['lang'] === 'ro') {
        return of({
          title: 'Contact RO',
          body_markdown: 'Salut',
          meta: {
            blocks: [
              {
                key: 'intro',
                type: 'text',
                enabled: true,
                title: { ro: 'Introducere' },
                body_markdown: { ro: 'Bun venit' },
              },
            ],
          },
        } as any);
      }
      return of({
        title: 'Contact',
        body_markdown: 'Hello',
        meta: {
          blocks: [
            {
              key: 'intro',
              type: 'text',
              enabled: true,
              title: { en: 'Intro' },
              body_markdown: { en: 'Welcome' },
            },
          ],
        },
      } as any);
    });

    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Intro Welcome' });
  });

  it('stops updating after destroy', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.ngOnDestroy();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();

    translate.use('ro');

    expect(title.setTitle).not.toHaveBeenCalled();
    expect(meta.updateTag).not.toHaveBeenCalled();
  });

  it('falls back to default copy and error state when the content request fails', () => {
    api.get.and.returnValue(throwError(() => new Error('boom')));
    translate.setTranslation(
      'en',
      {
        contact: {
          intro: 'Intro copy',
          replyTime: 'Reply soon',
          metaTitle: 'Contact | momentstudio',
          metaDescription: 'Contact desc',
        },
        meta: { descriptions: { contact: 'meta contact' } },
      },
      true,
    );

    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.hasError()).toBeTrue();
    expect(cmp.loading()).toBeFalse();
    expect(cmp.block()).toBeNull();
    expect(cmp.bodyHtml()).toContain('Intro copy');
  });

  it('loads the preview content endpoint when a preview token is present', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    api.get.calls.reset();
    api.get.and.returnValue(of({ title: 'Preview', body_markdown: 'Body', images: [] } as any));
    (cmp as any).previewToken = 'tok-123';
    (cmp as any).load();

    expect(api.get).toHaveBeenCalledWith('/content/pages/contact/preview', {
      token: 'tok-123',
      lang: 'en',
    });
  });

  it('prefills the form from the authenticated user', () => {
    auth.user.and.returnValue({ email: 'u@example.com', name: 'Jane Doe' } as any);
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.formEmail).toBe('u@example.com');
    expect(cmp.formName).toBe('Jane Doe');
  });

  it('prefills the form name from the email when the user has no name', () => {
    auth.user.and.returnValue({ email: 'noname@example.com', name: '' } as any);
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.formName).toBe('noname@example.com');
  });

  it('updates phone and email signals from the social service payload', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.phone()).toBe('+40723204204');
    expect(cmp.email()).toBe('momentstudio.ro@gmail.com');
  });

  it('computes initials for a variety of labels', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    expect(cmp.initialsForLabel('')).toBe('MS');
    expect(cmp.initialsForLabel('   ')).toBe('MS');
    expect(cmp.initialsForLabel('John Doe')).toBe('JD');
    expect(cmp.initialsForLabel('Madonna')).toBe('MA');
    expect(cmp.initialsForLabel('A')).toBe('AS');
  });

  it('clamps focal positions into a percentage string', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(-10, 220)).toBe('0% 100%');
    expect(cmp.focalPosition(30, 70)).toBe('30% 70%');
  });

  it('reflects storefront admin mode in canEditPage and navigates from editPage', () => {
    const sfa = TestBed.inject(StorefrontAdminModeService);
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    spyOn(sfa, 'enabled').and.returnValues(false, true);
    expect(cmp.canEditPage()).toBeFalse();
    expect(cmp.canEditPage()).toBeTrue();

    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    cmp.editPage();
    expect(navSpy).toHaveBeenCalledWith(['/admin/content/pages'], {
      queryParams: { edit: 'contact' },
    });
  });

  it('submits the contact form and resets transient fields on success', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.formName = 'Jane';
    cmp.formEmail = 'jane@example.com';
    cmp.formMessage = 'Hello there';
    cmp.formOrderRef = 'ORD-1';
    cmp.submit();

    expect(support.submitContact).toHaveBeenCalledWith(
      jasmine.objectContaining({
        topic: 'contact',
        name: 'Jane',
        email: 'jane@example.com',
        message: 'Hello there',
        order_reference: 'ORD-1',
      }),
    );
    expect(cmp.submitSuccess()).toBeTrue();
    expect(cmp.submitting()).toBeFalse();
    expect(cmp.formMessage).toBe('');
    expect(cmp.formOrderRef).toBe('');
  });

  it('passes a null order reference when the field is blank', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.formOrderRef = '   ';
    cmp.submit();
    expect(support.submitContact).toHaveBeenCalledWith(
      jasmine.objectContaining({ order_reference: null }),
    );
  });

  it('surfaces the server detail on submit failure', () => {
    support.submitContact.and.returnValue(
      throwError(() => ({ error: { detail: 'Too many requests' } })),
    );
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.submit();
    expect(cmp.submitError()).toBe('Too many requests');
    expect(cmp.submitting()).toBeFalse();
  });

  it('falls back to a translated error when the server gives no detail', () => {
    translate.setTranslation('en', { contact: { form: { error: 'Generic error' } } }, true);
    support.submitContact.and.returnValue(throwError(() => ({})));
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.submit();
    expect(cmp.submitError()).toBe('Generic error');
  });

  it('ignores submit while a submission is already in flight', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.submitting.set(true);
    cmp.submit();
    expect(support.submitContact).not.toHaveBeenCalled();
  });

  it('blocks submission and warns when the captcha token is missing', () => {
    translate.setTranslation('en', { auth: { captchaRequired: 'Captcha required' } }, true);
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.captchaEnabled = true;
    cmp.captchaToken = null;
    cmp.submit();
    expect(cmp.submitError()).toBe('Captcha required');
    expect(support.submitContact).not.toHaveBeenCalled();
  });

  it('renders social follow cards and avatar initials when pages exist', () => {
    const social = TestBed.inject(SiteSocialService);
    spyOn(social, 'get').and.returnValue(
      of({
        contact: { phone: '+40700000000', email: 'hi@example.com' },
        instagramPages: [{ label: 'Studio IG', url: 'https://ig/x', thumbnail_url: '' }],
        facebookPages: [
          { label: 'Studio FB', url: 'https://fb/x', thumbnail_url: 'https://img/fb.png' },
        ],
      } as any),
    );
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('footer.instagram');
    expect(text).toContain('footer.facebook');
    // No thumbnail => initials avatar is rendered for the IG page.
    expect(text).toContain('SI');
  });
});
