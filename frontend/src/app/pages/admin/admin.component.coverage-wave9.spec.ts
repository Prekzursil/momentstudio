import { fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';

function createDynamicAdminHarness(): { component: any; admin: jasmine.SpyObj<any>; toast: jasmine.SpyObj<any> } {
  const component: any = Object.create(AdminComponent.prototype);
  const admin = jasmine.createSpyObj('AdminService', [
    'getContent',
    'updateContentBlock',
    'createContent',
    'updateContentTranslationStatus',
    'listContentPages'
  ]);
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

  admin.getContent.and.returnValue(of({ body_markdown: '', version: 1, meta: {} }));
  admin.updateContentBlock.and.returnValue(of({ version: 2, meta: {} }));
  admin.createContent.and.returnValue(of({ version: 3, meta: {} }));
  admin.updateContentTranslationStatus.and.returnValue(of({ needs_translation_en: true, needs_translation_ro: false }));
  admin.listContentPages.and.returnValue(of([]));

  component.admin = admin;
  component.toast = toast;
  component.t = (key: string) => key;
  component.cmsPrefs = { translationLayout: () => 'stacked' };

  component.contentVersions = {};
  component.infoLang = 'en';
  component.infoForm = {
    about: { en: '', ro: '' },
    faq: { en: '', ro: '' },
    shipping: { en: '', ro: '' },
    contact: { en: '', ro: '' }
  };

  component.pageBlocksNeedsTranslationEn = {};
  component.pageBlocksNeedsTranslationRo = {};
  component.pageBlocksTranslationSaving = {};
  component.pageVisibilitySaving = {};
  component.contentPages = [];
  component.pageBlocksKey = 'page.about';
  component.showHiddenPages = false;

  component.legalPageKey = 'page.terms';
  component.legalPageForm = { en: '', ro: '' };
  component.legalPageMeta = {};
  component.legalPageLastUpdated = '';
  component.legalPageLastUpdatedOriginal = '';

  component.reportsSettingsForm = { weekly_enabled: false, monthly_enabled: false, recipients: '' };

  component.rememberContentVersion = jasmine.createSpy('rememberContentVersion').and.callFake((key: string, block: any) => {
    if (key && block) component.contentVersions[key] = block;
  });
  component.handleContentConflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
  component.withExpectedVersion = (_key: string, payload: any) => payload;
  component.safePageRecordKey = (key: string) => key;
  component.toRecord = (value: any) => (value && typeof value === 'object' ? { ...value } : {});
  component.setRecordValue = (record: Record<string, any>, key: string, value: any) => {
    record[key] = value;
  };
  component.setPageRecordValue = (record: Record<string, any>, key: string, value: any) => {
    if (key) record[key] = value;
  };
  component.ensureSelectedPageIsVisible = jasmine.createSpy('ensureSelectedPageIsVisible');
  component.loadPageBlocks = jasmine.createSpy('loadPageBlocks');

  return { component, admin, toast };
}

describe('AdminComponent coverage wave 9 legal/info/page visibility branches', () => {
  it('covers loadInfo content-version cleanup on english fetch failure', fakeAsync(() => {
    const { component, admin } = createDynamicAdminHarness();
    component.contentVersions['page.about'] = { version: 999 };

    admin.getContent.and.callFake((key: string, lang?: string) => {
      if (key === 'page.about' && lang === 'en') {
        return throwError(() => new Error('en-fail'));
      }
      return of({ body_markdown: `${lang || 'x'}-${key}`, version: 7, meta: {} });
    });

    component.loadInfo();
    tick();

    expect(component.contentVersions['page.about']).toBeUndefined();
    expect(component.infoForm.about.ro).toBe('ro-page.about');
  }));

  it('covers saveInfo create fallback error path', () => {
    const { component, admin } = createDynamicAdminHarness();
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(throwError(() => ({ status: 500 })));

    component.saveInfo('page.about', 'Body', 'en');

    expect(component.infoError).toBe('adminUi.site.pages.errors.save');
    expect(component.infoMessage).toBeNull();
  });

  it('covers page hidden rollback when content load fails', () => {
    const { component, admin, toast } = createDynamicAdminHarness();
    component.contentPages = [{ key: 'page.custom', hidden: false, slug: 'custom' } as any];
    admin.getContent.and.returnValue(throwError(() => new Error('load-fail')));

    (component as any).setPageHidden('page.custom', true);

    expect(component.pageVisibilitySaving['page.custom']).toBeFalse();
    expect(component.contentPages[0].hidden).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.pages.visibility.errors.load');
  });

  it('covers loadLegalPage missing-key and status-object error branch', () => {
    const { component, admin } = createDynamicAdminHarness();

    component.loadLegalPage('' as any);
    expect(component.legalPageLoading).toBeFalse();
    expect(component.legalPageError).toBe('Missing page key.');

    admin.getContent.and.callFake((_key: string, lang?: string) => {
      if (lang === 'en') return of({ status: 500 });
      return of(null);
    });
    component.loadLegalPage('page.terms' as any);

    expect(component.legalPageError).toBe('adminUi.site.pages.errors.load');
    expect(component.legalPageLoading).toBeFalse();
  });

  it('covers saveLegalMetaIfNeeded conflict and generic error callbacks', () => {
    const { component, admin } = createDynamicAdminHarness();
    component.legalPageLastUpdated = '2026-03-05';
    component.legalPageLastUpdatedOriginal = '2026-03-01';

    const conflictError = jasmine.createSpy('conflictError');
    const genericError = jasmine.createSpy('genericError');

    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    component.handleContentConflict.and.returnValue(true);
    (component as any).saveLegalMetaIfNeeded('page.terms', jasmine.createSpy('ok1'), conflictError);
    expect(conflictError).toHaveBeenCalled();

    component.handleContentConflict.and.returnValue(false);
    (component as any).saveLegalMetaIfNeeded('page.terms', jasmine.createSpy('ok2'), genericError);
    expect(genericError).toHaveBeenCalled();
  });

  it('covers saveLegalPageUi side-by-side dispatch and saveLegalPage/saveLegalPageBoth error branches', () => {
    const { component } = createDynamicAdminHarness();

    component.cmsPrefs.translationLayout = () => 'sideBySide';
    const bothSpy = spyOn(component as any, 'saveLegalPageBoth').and.stub();
    component.saveLegalPageUi();
    expect(bothSpy).toHaveBeenCalled();

    (component as any).saveLegalMetaIfNeeded = (_key: string, _ok: () => void, onError: () => void) => onError();
    (component as any).saveLegalPage('page.terms', 'Body', 'en');
    expect(component.legalPageSaving).toBeFalse();
    expect(component.legalPageError).toBe('adminUi.site.pages.errors.save');

    (component as any).saveLegalMetaIfNeeded = (_key: string, onSuccess: () => void) => onSuccess();
    let calls = 0;
    (component as any).savePageMarkdownInternal = (
      _key: string,
      _body: string,
      _lang: 'en' | 'ro',
      onSuccess: () => void,
      onError: () => void
    ) => {
      calls += 1;
      if (calls === 1) onSuccess();
      else onError();
    };
    (component as any).saveLegalPageBoth('page.terms', { en: 'EN', ro: 'RO' });
    expect(component.legalPageSaving).toBeFalse();
    expect(component.legalPageError).toBe('adminUi.site.pages.errors.save');
  });

  it('covers savePageMarkdownInternal fallback and saveInfoBoth nested error branches', () => {
    const { component, admin } = createDynamicAdminHarness();
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(throwError(() => ({ status: 500 })));

    const onError = jasmine.createSpy('onError');
    (component as any).savePageMarkdownInternal('page.terms', 'Body', 'en', jasmine.createSpy('onSuccess'), onError);
    expect(onError).toHaveBeenCalled();

    let step = 0;
    (component as any).saveInfoInternal = (
      _key: string,
      _body: string,
      _lang: 'en' | 'ro',
      onSuccess: () => void,
      onErrorInner: () => void
    ) => {
      step += 1;
      if (step === 1) onSuccess();
      else onErrorInner();
    };

    component.saveInfoBoth('page.about', { en: 'EN', ro: 'RO' } as any);
    expect(component.infoError).toBe('adminUi.site.pages.errors.save');

    (component as any).saveInfoInternal = (
      _key: string,
      _body: string,
      _lang: 'en' | 'ro',
      _onSuccess: () => void,
      onErrorInner: () => void
    ) => onErrorInner();
    component.saveInfoBoth('page.about', { en: 'EN', ro: 'RO' } as any);
    expect(component.infoError).toBe('adminUi.site.pages.errors.save');
  });

  it('covers translation toggle error detail and content-pages success+error branches', () => {
    const { component, admin, toast } = createDynamicAdminHarness();

    admin.updateContentTranslationStatus.and.returnValue(throwError(() => ({ error: { detail: 'cannot-save' } })));
    const checkbox = document.createElement('input');
    checkbox.checked = true;
    component.togglePageNeedsTranslation('page.about' as any, 'en', { target: checkbox } as any);
    expect(toast.error).toHaveBeenCalledWith('cannot-save');

    admin.listContentPages.and.returnValue(
      of([
        { key: 'page.contact', slug: 'contact', needs_translation_en: false, needs_translation_ro: true },
        { key: 'page.about', slug: 'about', needs_translation_en: true, needs_translation_ro: false }
      ] as any)
    );
    component.loadContentPages();
    expect(component.contentPages.map((row: any) => row.slug)).toEqual(['about', 'contact']);
    expect(component.pageBlocksNeedsTranslationEn['page.about']).toBeTrue();

    admin.listContentPages.and.returnValue(throwError(() => new Error('pages-fail')));
    component.loadContentPages();
    expect(component.contentPages).toEqual([]);
    expect(component.contentPagesError).toBe('adminUi.site.pages.errors.load');
  });
});