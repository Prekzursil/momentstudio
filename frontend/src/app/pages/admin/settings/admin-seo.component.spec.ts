import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminSeoComponent } from './admin-seo.component';
import { AdminService } from '../../../core/admin.service';

/**
 * Behavioural spec for the extracted Settings > SEO panel (meta editor + sitemap
 * preview + structured-data validation). Mirrors the scenarios that previously
 * lived against AdminComponent so behaviour and branch coverage move with the
 * code.
 */
describe('AdminSeoComponent', () => {
  let fixture: ComponentFixture<AdminSeoComponent>;
  let c: AdminSeoComponent;
  let admin: jasmine.SpyObj<
    Pick<
      AdminService,
      | 'getContent'
      | 'updateContentBlock'
      | 'createContent'
      | 'getSitemapPreview'
      | 'validateStructuredData'
    >
  >;
  let remember: jasmine.Spy;
  let withExpected: jasmine.Spy;
  let conflict: jasmine.Spy;
  let forget: jasmine.Spy;

  beforeEach(async () => {
    admin = jasmine.createSpyObj('AdminService', [
      'getContent',
      'updateContentBlock',
      'createContent',
      'getSitemapPreview',
      'validateStructuredData',
    ]);
    admin.getContent.and.returnValue(of({ meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ version: 1 } as any));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    admin.getSitemapPreview.and.returnValue(of({ by_lang: {} } as any));
    admin.validateStructuredData.and.returnValue(
      of({ checked_products: 0, checked_pages: 0, errors: 0, warnings: 0, issues: [] } as any),
    );

    await TestBed.configureTestingModule({
      imports: [AdminSeoComponent, TranslateModule.forRoot()],
      providers: [{ provide: AdminService, useValue: admin }],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminSeoComponent);
    c = fixture.componentInstance;
    remember = jasmine.createSpy('rememberContentVersion');
    withExpected = jasmine.createSpy('withExpectedVersion').and.callFake((_k: string, p: any) => p);
    conflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    forget = jasmine.createSpy('forgetContentVersion');
    c.rememberContentVersion = remember;
    c.withExpectedVersion = withExpected as any;
    c.handleContentConflict = conflict as any;
    c.forgetContentVersion = forget;
  });

  it('creates and loads seo on init for the active page/lang', () => {
    fixture.detectChanges();
    expect(c).toBeTruthy();
    expect(admin.getContent).toHaveBeenCalledWith('seo.home', 'en');
    expect(remember).toHaveBeenCalledWith('seo.home', jasmine.anything());
  });

  it('selectSeoLang switches language and reloads', () => {
    admin.getContent.and.returnValue(of({ title: 'T', meta: { description: 'D' }, version: 1 } as any));
    c.selectSeoLang('ro');
    expect(c.seoLang).toBe('ro');
    expect(admin.getContent).toHaveBeenCalledWith('seo.home', 'ro');
    expect(c.seoForm.title).toBe('T');
    expect(c.seoForm.description).toBe('D');
  });

  it('onSeoPageChange emits the new page and reloads', () => {
    const emitted: string[] = [];
    c.seoPageChange.subscribe((p) => emitted.push(p));
    c.seoPage = 'about';
    c.onSeoPageChange();
    expect(emitted).toEqual(['about']);
    expect(admin.getContent).toHaveBeenCalledWith('seo.about', 'en');
  });

  it('loadSeo maps title/description and resets + forgets version on error', () => {
    admin.getContent.and.returnValue(
      of({ version: 2, title: 'SEO', meta: { description: 'desc' } } as any),
    );
    c.loadSeo();
    expect(c.seoForm.title).toBe('SEO');
    expect(c.seoForm.description).toBe('desc');

    admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.loadSeo();
    expect(c.seoForm.title).toBe('');
    expect(c.seoForm.description).toBe('');
    expect(forget).toHaveBeenCalledWith('seo.home');
  });

  it('saveSeo persists with expected version then reports success', () => {
    c.seoForm = { title: 'T', description: 'D' };
    admin.updateContentBlock.and.returnValue(of({ version: 2 } as any));
    c.saveSeo();
    expect(withExpected).toHaveBeenCalledWith('seo.home', jasmine.anything());
    expect(remember).toHaveBeenCalledWith('seo.home', jasmine.objectContaining({ version: 2 }));
    expect(c.seoMessage).toBe('adminUi.site.seo.success.save');
    expect(c.seoError).toBeNull();
  });

  it('saveSeo falls back to createContent when update fails', () => {
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    c.saveSeo();
    expect(admin.createContent).toHaveBeenCalledWith('seo.home', jasmine.anything());
    expect(c.seoMessage).toBe('adminUi.site.seo.success.save');
  });

  it('saveSeo reports error on a handled conflict', () => {
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveSeo();
    expect(conflict).toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
    expect(c.seoError).toBe('adminUi.site.seo.errors.save');
    expect(c.seoMessage).toBeNull();
  });

  it('saveSeo reports error when the create fallback also fails', () => {
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(throwError(() => new Error('x')));
    c.saveSeo();
    expect(c.seoError).toBe('adminUi.site.seo.errors.save');
    expect(c.seoMessage).toBeNull();
  });

  it('loadSitemapPreview stores by-lang data and surfaces detail errors', () => {
    admin.getSitemapPreview.and.returnValue(of({ by_lang: { en: ['/'] } } as any));
    c.loadSitemapPreview();
    expect(c.sitemapPreviewByLang).toEqual({ en: ['/'] });
    expect(c.sitemapPreviewLoading).toBeFalse();

    admin.getSitemapPreview.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    c.loadSitemapPreview();
    expect(c.sitemapPreviewByLang).toBeNull();
    expect(c.sitemapPreviewError).toBe('boom');
  });

  it('loadSitemapPreview uses a generic error when no detail is provided', () => {
    admin.getSitemapPreview.and.returnValue(throwError(() => new Error('x')));
    c.loadSitemapPreview();
    expect(c.sitemapPreviewError).toBe('adminUi.site.seo.sitemapPreview.errors.load');
  });

  it('structuredDataIssueUrl builds entity URLs across branches', () => {
    expect(c.structuredDataIssueUrl({ entity_type: 'product', entity_key: 'p1' })).toBe(
      '/products/p1',
    );
    expect(c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.about' })).toBe(
      '/about',
    );
    expect(c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.contact' })).toBe(
      '/contact',
    );
    expect(c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.faq' })).toBe(
      '/pages/faq',
    );
    expect(c.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.' })).toBe('/pages');
    expect(c.structuredDataIssueUrl({ entity_type: 'other', entity_key: 'x' })).toBe('/');
  });

  it('runStructuredDataValidation stores results and surfaces errors', () => {
    admin.validateStructuredData.and.returnValue(of({ issues: [] } as any));
    c.runStructuredDataValidation();
    expect(c.structuredDataResult).toEqual({ issues: [] } as any);
    expect(c.structuredDataLoading).toBeFalse();

    admin.validateStructuredData.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
    c.runStructuredDataValidation();
    expect(c.structuredDataResult).toBeNull();
    expect(c.structuredDataError).toBe('bad');
  });

  it('runStructuredDataValidation uses a generic error when no detail is provided', () => {
    admin.validateStructuredData.and.returnValue(throwError(() => new Error('x')));
    c.runStructuredDataValidation();
    expect(c.structuredDataError).toBe('adminUi.site.seo.structuredData.errors.load');
  });
});
