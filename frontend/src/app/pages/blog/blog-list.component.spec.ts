import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { BlogListComponent } from './blog-list.component';
import { BlogService } from '../../core/blog.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';

describe('BlogListComponent SEO', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let blog: jasmine.SpyObj<BlogService>;
  let router: jasmine.SpyObj<Router>;
  let doc: Document;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);
    blog = jasmine.createSpyObj<BlogService>('BlogService', ['listPosts']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    doc = document.implementation.createHTMLDocument('blog-list-test');

    blog.listPosts.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 9 }
      })
    );

    TestBed.configureTestingModule({
      imports: [BlogListComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta },
        { provide: BlogService, useValue: blog },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: Router, useValue: router },
        { provide: StorefrontAdminModeService, useValue: { enabled: () => false } },
        { provide: DOCUMENT, useValue: doc }
      ]
    });
  });

  it('sets canonical and meta tags based on language', () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { blog: { metaTitle: 'Blog | Test', metaDescription: 'Desc', title: 'Blog' } }, true);
    translate.use('en');

    const fixture = TestBed.createComponent(BlogListComponent);
    const cmp = fixture.componentInstance as any;
    cmp.load(1);

    expect(title.setTitle).toHaveBeenCalledWith('Blog | Test');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Desc' });

    const canonical = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical).toBeTruthy();
    expect(canonical?.getAttribute('href')).toContain('/blog?lang=en');
  });
});
