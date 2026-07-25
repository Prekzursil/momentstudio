import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

import { AdminLegalPagesComponent, LegalPageKey } from './admin-legal-pages.component';
import { AdminService } from '../../../core/admin.service';
import { CmsEditorPrefsService } from '../shared/cms-editor-prefs.service';
import { RichEditorComponent } from '../../../shared/rich-editor.component';

/**
 * Behavioural spec for the extracted Pages > Legal pages editor. Mirrors the
 * scenarios that previously lived against AdminComponent so behaviour and branch
 * coverage move with the code.
 */

// Lightweight stand-in for the toast-ui rich editor so the suite never boots the
// heavy third-party editor when the template is rendered.
@Component({
  selector: 'app-rich-editor',
  standalone: true,
  template: `<textarea [value]="value"></textarea>`,
})
class StubRichEditorComponent {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
  @Input() height = '';
  @Input() ariaLabel = '';
}

describe('AdminLegalPagesComponent', () => {
  let fixture: ComponentFixture<AdminLegalPagesComponent>;
  let c: AdminLegalPagesComponent;
  let admin: jasmine.SpyObj<
    Pick<AdminService, 'getContent' | 'updateContentBlock' | 'createContent'>
  >;
  let cmsPrefs: jasmine.SpyObj<Pick<CmsEditorPrefsService, 'translationLayout'>>;
  let remember: jasmine.Spy;
  let withExpected: jasmine.Spy;
  let conflict: jasmine.Spy;
  let applyPageBlockSaved: jasmine.Spy;

  beforeEach(async () => {
    admin = jasmine.createSpyObj('AdminService', [
      'getContent',
      'updateContentBlock',
      'createContent',
    ]);
    admin.getContent.and.returnValue(of({ body_markdown: '', meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ version: 1, meta: {} } as any));
    admin.createContent.and.returnValue(of({ version: 1 } as any));

    cmsPrefs = jasmine.createSpyObj('CmsEditorPrefsService', ['translationLayout']);
    cmsPrefs.translationLayout.and.returnValue('single');

    await TestBed.configureTestingModule({
      imports: [AdminLegalPagesComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: CmsEditorPrefsService, useValue: cmsPrefs },
      ],
    })
      .overrideComponent(AdminLegalPagesComponent, {
        remove: { imports: [RichEditorComponent] },
        add: { imports: [StubRichEditorComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AdminLegalPagesComponent);
    c = fixture.componentInstance;
    remember = jasmine.createSpy('rememberContentVersion');
    withExpected = jasmine.createSpy('withExpectedVersion').and.callFake((_k: string, p: any) => p);
    conflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    applyPageBlockSaved = jasmine.createSpy('applyPageBlockSaved');
    c.rememberContentVersion = remember;
    c.withExpectedVersion = withExpected as any;
    c.handleContentConflict = conflict as any;
    c.applyPageBlockSaved = applyPageBlockSaved;
  });

  it('creates and self-loads the default legal document on init', () => {
    fixture.detectChanges();
    expect(c).toBeTruthy();
    expect(admin.getContent).toHaveBeenCalledWith('page.terms', 'en');
    expect(admin.getContent).toHaveBeenCalledWith('page.terms', 'ro');
  });

  it('pagePublicUrlForKey maps slugs', () => {
    expect(c.pagePublicUrlForKey('page.about')).toBe('/about');
    expect(c.pagePublicUrlForKey('page.contact')).toBe('/contact');
    expect(c.pagePublicUrlForKey('page.faq')).toBe('/pages/faq');
    expect(c.pagePublicUrlForKey('page.')).toBe('/pages');
  });

  it('onLegalPageKeyChange guards, emits, and reloads on a real change', () => {
    spyOn(c, 'loadLegalPage');
    const emitted: LegalPageKey[] = [];
    c.legalPageKeyChange.subscribe((v) => emitted.push(v));
    c.legalPageKey = 'page.terms';

    c.onLegalPageKeyChange('page.terms'); // unchanged → guard
    expect(c.loadLegalPage).not.toHaveBeenCalled();
    c.onLegalPageKeyChange('' as any); // empty → guard
    expect(c.loadLegalPage).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);

    c.onLegalPageKeyChange('page.privacy-policy');
    expect(c.legalPageKey).toBe('page.privacy-policy');
    expect(emitted).toEqual(['page.privacy-policy']);
    expect(c.loadLegalPage).toHaveBeenCalledWith('page.privacy-policy');
  });

  it('loadLegalPage requires a key', () => {
    c.loadLegalPage('' as any);
    expect(c.legalPageError).toBeTruthy();
    expect(admin.getContent).not.toHaveBeenCalled();
  });

  it('loadLegalPage merges en/ro content and remembers the en version', () => {
    admin.getContent.and.callFake((_key: string, lang?: string) =>
      of({
        body_markdown: lang === 'en' ? 'EN body' : 'RO body',
        meta: { last_updated: '2030' },
      } as any),
    );
    c.loadLegalPage('page.terms');
    expect(c.legalPageForm.en).toBe('EN body');
    expect(c.legalPageForm.ro).toBe('RO body');
    expect(c.legalPageLastUpdated).toBe('2030');
    expect(remember).toHaveBeenCalledWith('page.terms', jasmine.anything());
  });

  it('loadLegalPage remembers the ro version and meta when en is absent', () => {
    admin.getContent.and.callFake((_key: string, lang?: string) =>
      lang === 'en'
        ? of(null as any)
        : of({ body_markdown: 'RO only', meta: { last_updated: '2031' } } as any),
    );
    c.loadLegalPage('page.terms');
    expect(c.legalPageForm.en).toBe('');
    expect(c.legalPageForm.ro).toBe('RO only');
    expect(c.legalPageLastUpdated).toBe('2031');
    expect(remember).toHaveBeenCalledWith('page.terms', jasmine.anything());
  });

  it('loadLegalPage 404 on both yields an empty form with no error', () => {
    admin.getContent.and.returnValue(throwError(() => ({ status: 404 })));
    c.loadLegalPage('page.terms');
    expect(c.legalPageForm.en).toBe('');
    expect(c.legalPageForm.ro).toBe('');
    expect(c.legalPageError).toBeNull();
  });

  it('loadLegalPage surfaces a non-404 error', () => {
    admin.getContent.and.returnValue(of({ status: 500 } as any));
    c.loadLegalPage('page.terms');
    expect(c.legalPageError).toBeTruthy();
  });

  it('saveLegalPageUi guards a missing key', () => {
    const single = spyOn<any>(c, 'saveLegalPage');
    const both = spyOn<any>(c, 'saveLegalPageBoth');
    c.legalPageKey = null as any;
    c.saveLegalPageUi();
    expect(single).not.toHaveBeenCalled();
    expect(both).not.toHaveBeenCalled();
  });

  it('saveLegalPageUi routes by translation layout', () => {
    const single = spyOn<any>(c, 'saveLegalPage');
    const both = spyOn<any>(c, 'saveLegalPageBoth');
    c.legalPageKey = 'page.terms';
    c.legalPageForm = { en: 'E', ro: 'R' };

    cmsPrefs.translationLayout.and.returnValue('sideBySide');
    c.saveLegalPageUi();
    expect(both).toHaveBeenCalledWith('page.terms', { en: 'E', ro: 'R' });

    cmsPrefs.translationLayout.and.returnValue('single');
    c.infoLang = 'ro';
    c.saveLegalPageUi();
    expect(single).toHaveBeenCalledWith('page.terms', 'R', 'ro');
  });

  it('saveLegalPage syncs meta then saves markdown (success and create fallback)', () => {
    (c as any).legalPageMeta = {};
    c.legalPageLastUpdated = '2030-01-01';
    (c as any).legalPageLastUpdatedOriginal = '';
    admin.updateContentBlock.and.returnValue(
      of({ version: 2, meta: { last_updated: '2030-01-01' } } as any),
    );
    (c as any).saveLegalPage('page.terms', 'Body', 'en');
    expect(c.legalPageMessage).toBeTruthy();
    expect(applyPageBlockSaved).toHaveBeenCalledWith('page.terms', jasmine.anything());

    // markdown save 404 (meta unchanged) → create fallback
    c.legalPageLastUpdated = '';
    (c as any).legalPageLastUpdatedOriginal = '';
    let calls = 0;
    admin.updateContentBlock.and.callFake(() => {
      calls += 1;
      return throwError(() => ({ status: 404 }));
    });
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    (c as any).saveLegalPage('page.terms', 'Body', 'en');
    expect(calls).toBe(1);
    expect(admin.createContent).toHaveBeenCalled();
    expect(c.legalPageMessage).toBeTruthy();
  });

  it('saveLegalPageBoth persists both languages then reports success', () => {
    (c as any).legalPageMeta = {};
    c.legalPageLastUpdated = '';
    (c as any).legalPageLastUpdatedOriginal = '';
    admin.updateContentBlock.and.returnValue(of({ version: 2, meta: {} } as any));
    (c as any).saveLegalPageBoth('page.terms', { en: 'E', ro: 'R' });
    // one update per language (meta unchanged → no meta save)
    expect(admin.updateContentBlock).toHaveBeenCalledTimes(2);
    expect(c.legalPageMessage).toBeTruthy();
  });

  it('saveLegalMetaIfNeeded short-circuits when the date is unchanged', () => {
    (c as any).legalPageLastUpdatedOriginal = '2030';
    c.legalPageLastUpdated = '2030';
    const onSuccess = jasmine.createSpy('onSuccess');
    (c as any).saveLegalMetaIfNeeded('page.terms', onSuccess, () => {});
    expect(onSuccess).toHaveBeenCalled();
    expect(admin.updateContentBlock).not.toHaveBeenCalled();
  });

  it('saveLegalMetaIfNeeded persists a changed date and clears it when emptied', () => {
    (c as any).legalPageMeta = { last_updated: 'old', extra: 1 };
    (c as any).legalPageLastUpdatedOriginal = 'old';
    c.legalPageLastUpdated = '2030-05-05';
    admin.updateContentBlock.and.returnValue(of({ meta: { last_updated: '2030-05-05' } } as any));
    const onSuccess = jasmine.createSpy('onSuccess');
    (c as any).saveLegalMetaIfNeeded('page.terms', onSuccess, () => {});
    expect(onSuccess).toHaveBeenCalled();
    expect((c as any).legalPageLastUpdatedOriginal).toBe('2030-05-05');

    // clearing the date deletes last_updated from the meta payload
    (c as any).legalPageLastUpdatedOriginal = '2030-05-05';
    c.legalPageLastUpdated = '';
    admin.updateContentBlock.and.returnValue(of({ meta: {} } as any));
    (c as any).saveLegalMetaIfNeeded(
      'page.terms',
      () => {},
      () => {},
    );
    const lastPayload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    expect(lastPayload.meta.last_updated).toBeUndefined();
  });

  it('saveLegalMetaIfNeeded reports a conflict error', () => {
    (c as any).legalPageMeta = {};
    c.legalPageLastUpdated = 'new';
    (c as any).legalPageLastUpdatedOriginal = 'old';
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    const onErr = jasmine.createSpy('onErr');
    (c as any).saveLegalMetaIfNeeded('page.terms', () => {}, onErr);
    expect(conflict).toHaveBeenCalled();
    expect(onErr).toHaveBeenCalled();
  });

  it('savePageMarkdown short-circuits the create fallback on a conflict', () => {
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    const onErr = jasmine.createSpy('onErr');
    (c as any).savePageMarkdown('page.terms', 'Body', 'en', () => {}, onErr);
    expect(onErr).toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
  });
});
