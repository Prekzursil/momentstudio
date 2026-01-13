import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MarkdownService } from '../../core/markdown.service';
import { SiteSocialService } from '../../core/site-social.service';
import { SupportService } from '../../core/support.service';
import { ContactComponent } from './contact.component';

describe('ContactComponent', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;
  let support: jasmine.SpyObj<SupportService>;
  let translate: TranslateService;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
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
          facebookPages: []
        })
    } as unknown as SiteSocialService;

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, ContactComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: ApiService, useValue: api },
        { provide: MarkdownService, useValue: markdown },
        { provide: SiteSocialService, useValue: social },
        { provide: AuthService, useValue: auth },
        { provide: SupportService, useValue: support }
      ]
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        contact: { metaTitle: 'Contact | momentstudio', metaDescription: 'Contact desc' }
      },
      true
    );
    translate.setTranslation(
      'ro',
      {
        contact: { metaTitle: 'Contact | momentstudio (RO)', metaDescription: 'Descriere contact' }
      },
      true
    );
    translate.use('en');
  });

  it('sets meta tags on init', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    expect(title.setTitle).toHaveBeenCalledWith('Contact | momentstudio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'og:description', content: 'Hello' });
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'og:title', content: 'Contact | momentstudio' });
  });

  it('updates meta tags when language changes', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();

    translate.use('ro');

    expect(title.setTitle).toHaveBeenCalledWith('Contact RO | momentstudio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Salut' });
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'og:description', content: 'Salut' });
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'og:title', content: 'Contact RO | momentstudio' });
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
              { key: 'intro', type: 'text', enabled: true, title: { ro: 'Introducere' }, body_markdown: { ro: 'Bun venit' } }
            ]
          }
        } as any);
      }
      return of({
        title: 'Contact',
        body_markdown: 'Hello',
        meta: {
          blocks: [
            { key: 'intro', type: 'text', enabled: true, title: { en: 'Intro' }, body_markdown: { en: 'Welcome' } }
          ]
        }
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
});
