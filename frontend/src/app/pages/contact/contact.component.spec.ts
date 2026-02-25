import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { SiteSocialService } from '../../core/site-social.service';
import { SupportService } from '../../core/support.service';
import { ContactComponent } from './contact.component';

let contactMeta: jasmine.SpyObj<Meta>;
let contactTitle: jasmine.SpyObj<Title>;
let contactApi: jasmine.SpyObj<ApiService>;
let contactSeoHeadLinks: jasmine.SpyObj<SeoHeadLinksService>;
let contactAuth: jasmine.SpyObj<AuthService>;
let contactSupport: jasmine.SpyObj<SupportService>;
let contactSocial: jasmine.SpyObj<SiteSocialService>;
let contactTranslate: TranslateService;

describe('ContactComponent SEO', () => {
  beforeEach(setupContactSpec);

  it('sets meta tags on init', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    expect(contactTitle.setTitle).toHaveBeenCalledWith('Contact | momentstudio');
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Hello' });
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Hello' });
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Contact | momentstudio' });
    expect(contactSeoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/contact', 'en', {});
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/contact' });
  });

  it('updates meta tags when language changes', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    contactTitle.setTitle.calls.reset();
    contactMeta.updateTag.calls.reset();
    contactSeoHeadLinks.setLocalizedCanonical.calls.reset();
    contactSeoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/contact?lang=ro');

    contactTranslate.use('ro');

    expect(contactTitle.setTitle).toHaveBeenCalledWith('Contact RO | momentstudio');
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Salut' });
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Salut' });
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Contact RO | momentstudio' });
    expect(contactSeoHeadLinks.setLocalizedCanonical).toHaveBeenCalledWith('/contact', 'ro', {});
    expect(contactMeta.updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'http://localhost:4200/contact?lang=ro' });
  });
});

describe('ContactComponent content + lifecycle', () => {
  beforeEach(setupContactSpec);

  it('uses page blocks for meta description when present', () => {
    contactApi.get.and.callFake(contactPageBlocksCallFake);

    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    expect(contactMeta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Intro Welcome' });
  });

  it('stops updating after destroy', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.ngOnDestroy();

    contactTitle.setTitle.calls.reset();
    contactMeta.updateTag.calls.reset();

    contactTranslate.use('ro');

    expect(contactTitle.setTitle).not.toHaveBeenCalled();
    expect(contactMeta.updateTag).not.toHaveBeenCalled();
  });
});

const setupContactSpec = (): void => {
  contactMeta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
  contactTitle = jasmine.createSpyObj<Title>('Title', ['setTitle']);
  contactApi = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
  contactSeoHeadLinks = jasmine.createSpyObj<SeoHeadLinksService>('SeoHeadLinksService', ['setLocalizedCanonical']);
  contactSeoHeadLinks.setLocalizedCanonical.and.returnValue('http://localhost:4200/contact');
  contactApi.get.and.callFake(contactPageCallFake);
  const markdown = { render: (s: string) => s } as unknown as MarkdownService;
  contactAuth = jasmine.createSpyObj<AuthService>('AuthService', ['user']);
  contactAuth.user.and.returnValue(null);
  contactSupport = jasmine.createSpyObj<SupportService>('SupportService', ['submitContact']);
  contactSupport.submitContact.and.returnValue(of({} as any));
  contactSocial = jasmine.createSpyObj<SiteSocialService>('SiteSocialService', ['get']);
  contactSocial.get.and.returnValue(
    of({
      contact: { phone: '+40723204204', email: 'momentstudio.ro@gmail.com' },
      instagramPages: [],
      facebookPages: []
    })
  );

  TestBed.configureTestingModule({
    imports: [RouterTestingModule, ContactComponent, TranslateModule.forRoot()],
    providers: [
      { provide: Title, useValue: contactTitle },
      { provide: Meta, useValue: contactMeta },
      { provide: ApiService, useValue: contactApi },
      { provide: SeoHeadLinksService, useValue: contactSeoHeadLinks },
      { provide: MarkdownService, useValue: markdown },
      { provide: SiteSocialService, useValue: contactSocial },
      { provide: AuthService, useValue: contactAuth },
      { provide: SupportService, useValue: contactSupport }
    ]
  });

  contactTranslate = TestBed.inject(TranslateService);
  contactTranslate.setTranslation(
    'en',
    {
      contact: { metaTitle: 'Contact | momentstudio', metaDescription: 'Contact desc' }
    },
    true
  );
  contactTranslate.setTranslation(
    'ro',
    {
      contact: { metaTitle: 'Contact | momentstudio (RO)', metaDescription: 'Descriere contact' }
    },
    true
  );
  contactTranslate.use('en');
};

function contactPageCallFake(path: string, params?: Record<string, unknown>) {
  if (path !== '/content/pages/contact') throw new Error(`Unexpected path: ${path}`);
  if (params?.['lang'] === 'ro') {
    return of({ title: 'Contact RO', body_markdown: 'Salut', images: [] } as any);
  }
  return of({ title: 'Contact', body_markdown: 'Hello', images: [] } as any);
}

function contactPageBlocksCallFake(path: string, params?: Record<string, unknown>) {
  if (path !== '/content/pages/contact') throw new Error(`Unexpected path: ${path}`);
  if (params?.['lang'] === 'ro') {
    return of({
      title: 'Contact RO',
      body_markdown: 'Salut',
      meta: {
        blocks: [{ key: 'intro', type: 'text', enabled: true, title: { ro: 'Introducere' }, body_markdown: { ro: 'Bun venit' } }]
      }
    } as any);
  }
  return of({
    title: 'Contact',
    body_markdown: 'Hello',
    meta: {
      blocks: [{ key: 'intro', type: 'text', enabled: true, title: { en: 'Intro' }, body_markdown: { en: 'Welcome' } }]
    }
  } as any);
}
