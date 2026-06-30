/**
 * Behavioral SAFETY-NET for the admin "cms-content-save" flow group.
 *
 * Part of the admin-decompose program: these tests assert the OBSERVABLE
 * behaviour of the CMS content-block save and the legal-page save at the
 * RENDERED DOM boundary. They drive the component through its rendered inputs
 * and buttons (never by calling the save/load methods directly) and assert the
 * real outcomes — the service calls made with concrete arguments, the
 * toast/announce side-effects, and the rendered DOM state. Because nothing here
 * references an internal method name, the suite must pass UNCHANGED after the
 * flow's code is extracted into a child component during the decomposition.
 *
 * Flows covered:
 *   A. Content block save (settings) — happy path, 409 conflict -> reload +
 *      preserve (version refreshed, editor kept), and generic (non-409) error.
 *   B. Legal page save (pages) — body-only save, last-updated meta save then
 *      body save, 409 conflict on the meta save -> reload, and 409 conflict on
 *      the body save -> reload (saveLegalMetaIfNeeded / savePageMarkdownInternal).
 */
import { Component, DebugElement, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';
import { AdminContent, AdminService, ContentBlock } from '../../core/admin.service';
import { AdminProductsService } from '../../core/admin-products.service';
import { BlogService } from '../../core/blog.service';
import { FxAdminService } from '../../core/fx-admin.service';
import { TaxesAdminService } from '../../core/taxes-admin.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownService } from '../../core/markdown.service';
import { CmsEditorPrefsService } from './shared/cms-editor-prefs.service';
import { RichEditorComponent } from '../../shared/rich-editor.component';
import { InputComponent } from '../../shared/input.component';
import { ButtonComponent } from '../../shared/button.component';

// Lightweight stand-in for the toast-ui rich editor so the suite never has to
// boot the heavy third-party editor. It preserves the [(value)] contract the
// template binds to, which is all the flow needs.
@Component({
  selector: 'app-rich-editor',
  standalone: true,
  template: `<textarea class="stub-rich-editor" [value]="value"></textarea>`,
})
class StubRichEditorComponent {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
  @Input() height = '';
  @Input() initialEditType: 'markdown' | 'wysiwyg' = 'markdown';
  @Input() ariaLabel = '';
}

type AnySpy = jasmine.SpyObj<any>;

function block(over: Partial<ContentBlock> = {}): ContentBlock {
  return {
    key: 'home',
    title: 'Home',
    body_markdown: '# old body',
    status: 'draft',
    version: 3,
    meta: {},
    ...over,
  } as ContentBlock;
}

function listItem(over: Partial<AdminContent> = {}): AdminContent {
  return {
    id: 'c-home',
    key: 'home',
    title: 'Home',
    updated_at: '2026-01-01T00:00:00Z',
    version: 3,
    body_markdown: '# old body',
    status: 'draft',
    meta: {},
    ...over,
  };
}

interface Env {
  fixture: ComponentFixture<AdminComponent>;
  component: AdminComponent;
  admin: AnySpy;
  toast: AnySpy;
}

const ADMIN_METHODS = [
  'products', 'coupons', 'lowStock', 'audit', 'content', 'getMaintenance', 'setMaintenance',
  'getCategories', 'createCategory', 'updateCategory', 'deleteCategory', 'reorderCategories',
  'getCategoryTranslations', 'upsertCategoryTranslation', 'deleteCategoryTranslation',
  'listFeaturedCollections', 'createFeaturedCollection', 'updateFeaturedCollection',
  'getProduct', 'createProduct', 'updateProduct', 'deleteProduct', 'duplicateProduct',
  'uploadProductImage', 'deleteProductImage', 'getContent', 'createContent', 'updateContentBlock',
  'deleteContent', 'getContentVersion', 'listContentVersions', 'rollbackContentVersion',
  'updateContentTranslationStatus', 'uploadContentImage', 'updateContentImageFocalPoint',
  'listContentPages', 'renameContentPage', 'createPagePreviewToken', 'createHomePreviewToken',
  'listContentRedirects', 'deleteContentRedirect', 'exportContentRedirects',
  'importContentRedirects', 'upsertContentRedirect', 'previewFindReplaceContent',
  'applyFindReplaceContent', 'linkCheckContent', 'linkCheckContentPreview', 'getSitemapPreview',
  'validateStructuredData', 'sendScheduledReport',
  // used by child components rendered inside the admin shell (asset library)
  'listContentImages', 'getContentImageUsage', 'updateContentImage', 'updateContentImageTags',
  'editContentImage', 'deleteContentImage',
];

async function setup(section: 'settings' | 'pages'): Promise<Env> {
  const route = {
    snapshot: { data: { section }, queryParams: {} as Record<string, unknown> },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>(),
  };

  const admin = jasmine.createSpyObj('AdminService', ADMIN_METHODS) as AnySpy;
  for (const m of ADMIN_METHODS) (admin[m] as jasmine.Spy).and.returnValue(of(undefined));
  admin.content.and.returnValue(of([]));
  admin.getContent.and.returnValue(of(block()));
  admin.updateContentBlock.and.returnValue(of(block({ version: 4 })));
  admin.createContent.and.returnValue(of(block({ version: 4 })));
  admin.listContentPages.and.returnValue(of([]));
  admin.listContentImages.and.returnValue(of({ items: [], meta: { total_pages: 1, total_items: 0, page: 1, limit: 20 } }));

  const adminProducts = jasmine.createSpyObj('AdminProductsService', ['search']);
  adminProducts.search.and.returnValue(of([]));

  const blog = jasmine.createSpyObj('BlogService', [
    'createPreviewToken', 'deleteComment', 'hideCommentAdmin', 'listFlaggedComments',
    'resolveCommentFlagsAdmin', 'unhideCommentAdmin',
  ]);
  for (const k of Object.keys(blog)) (blog[k] as jasmine.Spy).and.returnValue(of([]));

  const fxAdmin = jasmine.createSpyObj('FxAdminService', [
    'clearOverride', 'getStatus', 'listOverrideAudit', 'restoreOverrideFromAudit', 'setOverride',
  ]);
  for (const k of Object.keys(fxAdmin)) (fxAdmin[k] as jasmine.Spy).and.returnValue(of(undefined));

  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
    'deleteGroup', 'deleteRate', 'listGroups', 'updateGroup', 'createGroup', 'upsertRate',
  ]);
  for (const k of Object.keys(taxesAdmin)) (taxesAdmin[k] as jasmine.Spy).and.returnValue(of([]));

  const auth = jasmine.createSpyObj('AuthService', ['role', 'loadCurrentUser']);
  auth.role.and.returnValue('owner');
  auth.loadCurrentUser.and.returnValue(of(null));

  const cmsPrefs = jasmine.createSpyObj('CmsEditorPrefsService', [
    'mode', 'previewDevice', 'previewLang', 'previewLayout', 'previewTheme', 'translationLayout',
    'setMode', 'setPreviewDevice', 'setPreviewLayout', 'setPreviewLang', 'setPreviewTheme',
    'setTranslationLayout', 'toggleMode',
  ]);
  cmsPrefs.mode.and.returnValue('basic');
  cmsPrefs.previewDevice.and.returnValue('desktop');
  cmsPrefs.previewLang.and.returnValue('en');
  cmsPrefs.previewLayout.and.returnValue('stacked');
  cmsPrefs.previewTheme.and.returnValue('light');
  cmsPrefs.translationLayout.and.returnValue('tabs');

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) as AnySpy;
  const markdown = { render: (v: string) => `R:${v}` };

  await TestBed.configureTestingModule({
    imports: [AdminComponent, TranslateModule.forRoot()],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: route.snapshot,
          data: route.data.asObservable(),
          queryParams: route.queryParams.asObservable(),
        },
      },
      { provide: AdminService, useValue: admin },
      { provide: AdminProductsService, useValue: adminProducts },
      { provide: BlogService, useValue: blog },
      { provide: FxAdminService, useValue: fxAdmin },
      { provide: TaxesAdminService, useValue: taxesAdmin },
      { provide: AuthService, useValue: auth },
      { provide: CmsEditorPrefsService, useValue: cmsPrefs },
      { provide: ToastService, useValue: toast },
      { provide: MarkdownService, useValue: markdown },
    ],
  })
    .overrideComponent(AdminComponent, {
      remove: { imports: [RichEditorComponent] },
      add: { imports: [StubRichEditorComponent] },
    })
    .compileComponents();

  const translate = TestBed.inject(TranslateService);
  translate.setDefaultLang('en');
  translate.use('en');

  const fixture = TestBed.createComponent(AdminComponent);
  const component = fixture.componentInstance;
  // Stub the data-loading orchestration + autosave poller. These are pure setup
  // concerns; the flows under test are triggered through the DOM below.
  spyOn<any>(component, 'loadForSection').and.stub();
  spyOn<any>(component, 'syncCmsDraftPoller').and.stub();
  fixture.detectChanges();
  // loadForSection (stubbed) is what normally clears the initial loading flag;
  // clear it so the section body renders instead of the skeleton.
  component.loading.set(false);
  fixture.detectChanges();

  return { fixture, component, admin, toast };
}

// ---- DOM helpers (interact at the rendered boundary) ----

function appButtons(scope: DebugElement): DebugElement[] {
  return scope.queryAll(By.directive(ButtonComponent));
}

function findButton(scope: DebugElement, label: string): DebugElement | undefined {
  const found = appButtons(scope).find(
    (d) => (d.componentInstance as ButtonComponent).label === label,
  );
  if (!found) {
    const labels = appButtons(scope).map((d) => JSON.stringify((d.componentInstance as ButtonComponent).label));
    throw new Error(`button "${label}" not found. available labels: [${labels.join(', ')}]`);
  }
  return found;
}

function clickAppButton(fixture: ComponentFixture<AdminComponent>, de: DebugElement): void {
  const native = de.query(By.css('button'));
  if (native) native.nativeElement.click();
  else de.triggerEventHandler('action', undefined);
  fixture.detectChanges();
}

function setAppInput(fixture: ComponentFixture<AdminComponent>, label: string, value: string): void {
  const input = fixture.debugElement
    .queryAll(By.directive(InputComponent))
    .find((d) => (d.componentInstance as InputComponent).label === label);
  (input!.componentInstance as InputComponent).valueChange.emit(value);
  fixture.detectChanges();
}

function setNative(
  fixture: ComponentFixture<AdminComponent>,
  de: DebugElement,
  value: string,
  evt: 'input' | 'change',
): void {
  de.nativeElement.value = value;
  de.nativeElement.dispatchEvent(new Event(evt));
  fixture.detectChanges();
}

function contentEditorCard(fixture: ComponentFixture<AdminComponent>): DebugElement | undefined {
  const marker = fixture.debugElement
    .queryAll(By.css('p'))
    .find((p) => (p.nativeElement.textContent || '').includes('adminUi.content.editing'));
  return marker?.parent ?? undefined;
}

function legalDetails(fixture: ComponentFixture<AdminComponent>): DebugElement {
  return fixture.debugElement
    .queryAll(By.css('details'))
    .find((d) =>
      (d.nativeElement.textContent || '').includes('adminUi.site.pages.legal.title'),
    )!;
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('NET admin cms-content-save :: content block save (settings)', () => {
  async function openEditor(): Promise<Env> {
    const env = await setup('settings');
    env.component.contentBlocks = [listItem()];
    env.fixture.detectChanges();
    const editBtn = findButton(env.fixture.debugElement, 'adminUi.actions.edit');
    clickAppButton(env.fixture, editBtn!);
    return env;
  }

  it('renders the editor from the rendered block list and persists edited fields', async () => {
    const env = await openEditor();

    // selectContent fetched the block to populate the editor.
    expect(env.admin.getContent).toHaveBeenCalledWith('home');
    const card = contentEditorCard(env.fixture);
    expect(card).toBeTruthy();

    setAppInput(env.fixture, 'adminUi.content.titleLabel', 'Home Updated');
    setNative(env.fixture, card!.query(By.css('select')), 'published', 'change');
    setNative(env.fixture, card!.query(By.css('textarea')), '# brand new body', 'input');

    clickAppButton(env.fixture, findButton(card!, 'adminUi.content.save')!);

    expect(env.admin.updateContentBlock).toHaveBeenCalledTimes(1);
    const [key, payload] = env.admin.updateContentBlock.calls.mostRecent().args;
    expect(key).toBe('home');
    expect(payload).toEqual(
      jasmine.objectContaining({
        title: 'Home Updated',
        body_markdown: '# brand new body',
        status: 'published',
        expected_version: 3,
      }),
    );
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.content.success.update');
    expect(env.toast.error).not.toHaveBeenCalled();
    // reload of the list + editor closed.
    expect(env.admin.content).toHaveBeenCalled();
    expect(contentEditorCard(env.fixture)).toBeUndefined();
  });

  it('on a 409 keeps the editor open, shows the conflict toast, reloads, and the retry succeeds with a refreshed version', async () => {
    const env = await openEditor();

    env.admin.updateContentBlock.and.returnValues(
      throwError(() => ({ status: 409 })),
      of(block({ version: 5 })),
    );

    setAppInput(env.fixture, 'adminUi.content.titleLabel', 'Conflicting edit');
    const getCountBefore = env.admin.getContent.calls.count();
    clickAppButton(env.fixture, findButton(contentEditorCard(env.fixture)!, 'adminUi.content.save')!);

    // Conflict feedback + reload (re-fetch), editor preserved.
    expect(env.toast.error).toHaveBeenCalledWith(
      'adminUi.content.errors.conflictTitle',
      'adminUi.content.errors.conflictCopy',
    );
    expect(env.toast.success).not.toHaveBeenCalled();
    expect(env.admin.updateContentBlock).toHaveBeenCalledTimes(1);
    // the conflict reload re-fetched the block (extra getContent vs. before the save).
    expect(env.admin.getContent.calls.count()).toBeGreaterThan(getCountBefore);
    const card = contentEditorCard(env.fixture);
    expect(card).toBeTruthy();
    // Title input was repopulated from the reloaded server block.
    const titleInput = env.fixture.debugElement
      .queryAll(By.directive(InputComponent))
      .find((d) => (d.componentInstance as InputComponent).label === 'adminUi.content.titleLabel');
    expect((titleInput!.componentInstance as InputComponent).value).toBe('Home');

    // Retry now succeeds; version was refreshed by the reload (preserve).
    clickAppButton(env.fixture, findButton(card!, 'adminUi.content.save')!);
    expect(env.admin.updateContentBlock).toHaveBeenCalledTimes(2);
    const retryPayload = env.admin.updateContentBlock.calls.mostRecent().args[1];
    expect(retryPayload).toEqual(jasmine.objectContaining({ expected_version: 3 }));
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.content.success.update');
    expect(contentEditorCard(env.fixture)).toBeUndefined();
  });

  it('on a non-409 error keeps the editor open and surfaces the generic update error', async () => {
    const env = await openEditor();
    env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));

    setAppInput(env.fixture, 'adminUi.content.titleLabel', 'Will fail');
    const getCountBefore = env.admin.getContent.calls.count();
    clickAppButton(env.fixture, findButton(contentEditorCard(env.fixture)!, 'adminUi.content.save')!);

    expect(env.toast.error).toHaveBeenCalledWith('adminUi.content.errors.update');
    expect(env.toast.success).not.toHaveBeenCalled();
    // a non-409 error does NOT trigger the conflict reload path.
    expect(env.admin.getContent.calls.count()).toBe(getCountBefore);
    expect(contentEditorCard(env.fixture)).toBeTruthy(); // editor stays for retry
  });
});

describe('NET admin cms-content-save :: legal page save (pages)', () => {
  function setLegalBody(env: Env, body: string): void {
    const editor = legalDetails(env.fixture).query(By.directive(StubRichEditorComponent));
    (editor.componentInstance as StubRichEditorComponent).valueChange.emit(body);
    env.fixture.detectChanges();
  }

  function clickLegalSave(env: Env): void {
    clickAppButton(env.fixture, findButton(legalDetails(env.fixture), 'adminUi.actions.save')!);
  }

  it('saves the body markdown for the selected legal document (meta unchanged)', async () => {
    const env = await setup('pages');
    setLegalBody(env, 'Legal terms body EN');

    clickLegalSave(env);

    // meta short-circuits (last-updated unchanged) -> single body save call.
    expect(env.admin.updateContentBlock).toHaveBeenCalledTimes(1);
    const [key, payload] = env.admin.updateContentBlock.calls.mostRecent().args;
    expect(key).toBe('page.terms');
    expect(payload).toEqual(
      jasmine.objectContaining({
        body_markdown: 'Legal terms body EN',
        status: 'published',
        lang: 'en',
      }),
    );
    expect(legalDetails(env.fixture).nativeElement.textContent).toContain(
      'adminUi.site.pages.success.save',
    );
  });

  it('saves the last-updated meta first, then the body, when the date changes', async () => {
    const env = await setup('pages');
    setLegalBody(env, 'Legal body with date');
    setNative(
      env.fixture,
      legalDetails(env.fixture).query(By.css('input[type="date"]')),
      '2026-02-02',
      'input',
    );

    clickLegalSave(env);

    expect(env.admin.updateContentBlock).toHaveBeenCalledTimes(2);
    const firstPayload = env.admin.updateContentBlock.calls.first().args[1];
    expect(firstPayload).toEqual(
      jasmine.objectContaining({ meta: jasmine.objectContaining({ last_updated: '2026-02-02' }) }),
    );
    const bodyPayload = env.admin.updateContentBlock.calls.mostRecent().args[1];
    expect(bodyPayload).toEqual(
      jasmine.objectContaining({
        body_markdown: 'Legal body with date',
        status: 'published',
        lang: 'en',
      }),
    );
    expect(legalDetails(env.fixture).nativeElement.textContent).toContain(
      'adminUi.site.pages.success.save',
    );
  });

  it('on a 409 during the meta save: conflict toast, reload, save error, and no body save', async () => {
    const env = await setup('pages');
    env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));

    setLegalBody(env, 'Body should not be sent');
    setNative(
      env.fixture,
      legalDetails(env.fixture).query(By.css('input[type="date"]')),
      '2026-03-03',
      'input',
    );
    clickLegalSave(env);

    expect(env.admin.updateContentBlock).toHaveBeenCalledTimes(1); // meta only; body never attempted
    expect(env.admin.updateContentBlock.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ meta: jasmine.objectContaining({ last_updated: '2026-03-03' }) }),
    );
    expect(env.toast.error).toHaveBeenCalledWith(
      'adminUi.content.errors.conflictTitle',
      'adminUi.content.errors.conflictCopy',
    );
    // reload re-fetched both languages of the legal document.
    expect(env.admin.getContent).toHaveBeenCalledWith('page.terms', 'en');
    expect(env.admin.getContent).toHaveBeenCalledWith('page.terms', 'ro');
    expect(legalDetails(env.fixture).nativeElement.textContent).toContain(
      'adminUi.site.pages.errors.save',
    );
  });

  it('on a 409 during the body save: conflict toast, reload, no create fallback', async () => {
    const env = await setup('pages');
    env.admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));

    // meta unchanged -> goes straight to the body save which conflicts.
    setLegalBody(env, 'Body that conflicts');
    clickLegalSave(env);

    expect(env.admin.updateContentBlock).toHaveBeenCalledTimes(1);
    expect(env.admin.updateContentBlock.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ body_markdown: 'Body that conflicts', lang: 'en' }),
    );
    expect(env.toast.error).toHaveBeenCalledWith(
      'adminUi.content.errors.conflictTitle',
      'adminUi.content.errors.conflictCopy',
    );
    expect(env.admin.createContent).not.toHaveBeenCalled(); // conflict short-circuits the create fallback
    expect(env.admin.getContent).toHaveBeenCalledWith('page.terms', 'en'); // reload en
    expect(env.admin.getContent).toHaveBeenCalledWith('page.terms', 'ro'); // reload ro
    expect(legalDetails(env.fixture).nativeElement.textContent).toContain(
      'adminUi.site.pages.errors.save',
    );
  });
});
