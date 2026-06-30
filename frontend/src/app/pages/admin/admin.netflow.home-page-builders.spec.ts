import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';

import { AdminComponent } from './admin.component';
import { AdminService } from '../../core/admin.service';
import { AdminProductsService } from '../../core/admin-products.service';
import { BlogService } from '../../core/blog.service';
import { FxAdminService } from '../../core/fx-admin.service';
import { TaxesAdminService } from '../../core/taxes-admin.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownService } from '../../core/markdown.service';
import { CmsEditorPrefsService } from './shared/cms-editor-prefs.service';
import { ButtonComponent } from '../../shared/button.component';
import { CmsBlockLibraryComponent } from './shared/cms-block-library.component';

/**
 * BEHAVIORAL SAFETY NET — Home builder + Page builder admin flows.
 *
 * These tests drive the AdminComponent through its RENDERED DOM and child-component
 * @Output boundaries (drag/drop DOM events, the CMS block-library `add` output, the
 * delete / save <app-button> `action` outputs) and assert OBSERVABLE behavior only:
 *   - the rendered block list (each row prints `{{block.type}} · {{block.key}}`)
 *   - the concrete service call made on persist (AdminService.updateContentBlock args)
 *   - the upload service call + toast side-effect on media drop
 *
 * Nothing here references an AdminComponent builder method by name, so the suite must
 * pass UNCHANGED after the home/page builder logic is extracted into a child component
 * (the rendered DOM tree and the wired @Outputs are identical either way).
 *
 * The only internal hook is stubbing the private `loadForSection` initial-data loader,
 * which is orthogonal to the builder flow and stays in the parent after decomposition;
 * this is the same isolation convention used by the existing admin.component specs.
 */
describe('AdminComponent net flow: home + page builders (DOM boundary)', () => {
  // Spies kept loosely typed: AdminService has 150+ members and the literal
  // return shapes below intentionally use partial fixtures.
  let admin: any;
  let toast: jasmine.SpyObj<ToastService>;
  let routeStub: {
    snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
    data: Subject<Record<string, unknown>>;
    queryParams: Subject<Record<string, unknown>>;
  };

  const SAVE_LABEL = 'adminUi.actions.save';
  const DELETE_LABEL = 'adminUi.actions.delete';

  // Universal benign envelope: satisfies list consumers (resp.items/meta) and the
  // few object/array shapes any rendered child (e.g. asset-library) reads on init.
  const benign = () => of({ items: [], meta: { total_pages: 1, total_items: 0, page: 1, limit: 20 }, blocks: [], images: [] } as any);

  const ADMIN_METHODS = [
    'products', 'coupons', 'lowStock', 'audit', 'content', 'getContent', 'createContent',
    'updateContentBlock', 'deleteContent', 'getContentVersion', 'listContentVersions',
    'rollbackContentVersion', 'updateContentTranslationStatus', 'uploadContentImage',
    'updateContentImage', 'updateContentImageTags', 'updateContentImageFocalPoint',
    'getContentImageUsage', 'deleteContentImage', 'editContentImage', 'listContentImages',
    'listContentPages', 'renameContentPage', 'createPagePreviewToken', 'createHomePreviewToken',
    'listContentRedirects', 'deleteContentRedirect', 'exportContentRedirects',
    'importContentRedirects', 'upsertContentRedirect', 'getCategories', 'createCategory',
    'updateCategory', 'deleteCategory', 'reorderCategories', 'getCategoryTranslations',
    'upsertCategoryTranslation', 'deleteCategoryTranslation', 'listFeaturedCollections',
    'createFeaturedCollection', 'updateFeaturedCollection', 'getMaintenance', 'setMaintenance',
    'getSitemapPreview', 'validateStructuredData', 'reloadContentBlocks',
  ];

  function makeAdminSpy(): any {
    const spy = jasmine.createSpyObj('AdminService', ADMIN_METHODS);
    for (const m of ADMIN_METHODS) {
      (spy[m] as jasmine.Spy).and.returnValue(benign());
    }
    return spy;
  }

  beforeEach(async () => {
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }

    admin = makeAdminSpy();
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    const adminProducts = jasmine.createSpyObj<AdminProductsService>('AdminProductsService', ['search']);
    adminProducts.search.and.returnValue(of([] as any));
    const blog = jasmine.createSpyObj<BlogService>('BlogService', [
      'createPreviewToken', 'deleteComment', 'hideCommentAdmin', 'listFlaggedComments',
      'resolveCommentFlagsAdmin', 'unhideCommentAdmin',
    ]);
    for (const k of Object.keys(blog)) (blog as any)[k]?.and?.returnValue?.(of([] as any));
    const fxAdmin = jasmine.createSpyObj<FxAdminService>('FxAdminService', [
      'clearOverride', 'getStatus', 'listOverrideAudit', 'restoreOverrideFromAudit', 'setOverride',
    ]);
    for (const k of Object.keys(fxAdmin)) (fxAdmin as any)[k]?.and?.returnValue?.(of({} as any));
    const taxesAdmin = jasmine.createSpyObj<TaxesAdminService>('TaxesAdminService', [
      'deleteGroup', 'deleteRate', 'listGroups', 'updateGroup', 'createGroup', 'upsertRate',
    ]);
    for (const k of Object.keys(taxesAdmin)) (taxesAdmin as any)[k]?.and?.returnValue?.(of([] as any));

    const auth = jasmine.createSpyObj<AuthService>('AuthService', ['role', 'loadCurrentUser']);
    auth.role.and.returnValue('owner');
    auth.loadCurrentUser.and.returnValue(of(null as any));

    const cmsPrefs: any = jasmine.createSpyObj('CmsEditorPrefsService', [
      'mode', 'previewDevice', 'previewLang', 'previewLayout', 'previewTheme', 'translationLayout',
    ]);
    cmsPrefs.mode.and.returnValue('basic');
    cmsPrefs.previewDevice.and.returnValue('desktop');
    cmsPrefs.previewLang.and.returnValue('en');
    cmsPrefs.previewLayout.and.returnValue('stacked');
    cmsPrefs.previewTheme.and.returnValue('light');
    cmsPrefs.translationLayout.and.returnValue('tabs');

    const markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    markdown.render.and.returnValue('');

    routeStub = {
      snapshot: { data: { section: 'home' }, queryParams: {} },
      data: new Subject(),
      queryParams: new Subject(),
    };

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: routeStub.snapshot,
            data: routeStub.data.asObservable(),
            queryParams: routeStub.queryParams.asObservable(),
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
    }).compileComponents();
  });

  // ---- render harness -------------------------------------------------------

  function render(section: 'home' | 'pages'): ComponentFixture<AdminComponent> {
    routeStub.snapshot.data = { section };
    const fixture = TestBed.createComponent(AdminComponent);
    const c = fixture.componentInstance;
    // Isolate the builder flow from the (unrelated) initial-data loaders.
    spyOn<any>(c, 'loadForSection').and.callFake(() => c.loading.set(false));
    fixture.detectChanges(); // ngOnInit -> applySection(section)
    c.loading.set(false);
    fixture.detectChanges();
    return fixture;
  }

  // ---- DOM helpers (no component-internal references) ------------------------

  interface Row {
    el: HTMLElement;
    de: import('@angular/core').DebugElement;
    type: string;
    key: string;
  }

  function rows(fixture: ComponentFixture<AdminComponent>): Row[] {
    return fixture.debugElement
      .queryAll(By.css('[draggable="true"]'))
      .map((de) => {
        const el = de.nativeElement as HTMLElement;
        const meta = Array.from(el.querySelectorAll('span')).find((s) =>
          (s.textContent || '').includes(' · '),
        );
        if (!meta) return null;
        const txt = (meta.textContent || '').trim();
        const [type, key] = txt.split(' · ').map((p) => p.trim());
        return { el, de, type, key } as Row;
      })
      .filter((r): r is Row => r !== null);
  }

  function library(fixture: ComponentFixture<AdminComponent>) {
    return fixture.debugElement.query(By.directive(CmsBlockLibraryComponent));
  }

  function addFromLibrary(
    fixture: ComponentFixture<AdminComponent>,
    type: string,
    template: 'blank' | 'starter' = 'blank',
  ): void {
    library(fixture).triggerEventHandler('add', { type, template });
    fixture.detectChanges();
  }

  function newRow(before: Row[], after: Row[]): Row | undefined {
    const seen = new Set(before.map((r) => r.key));
    return after.find((r) => !seen.has(r.key));
  }

  function blockPayloadEvent(scope: 'home' | 'page', type: string, template = 'blank'): DragEvent {
    const dt = new DataTransfer();
    dt.setData('text/plain', JSON.stringify({ kind: 'cms-block', scope, type, template }));
    return new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  }

  function emptyDrag(kind: 'dragstart' | 'drop'): DragEvent {
    return new DragEvent(kind, { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true });
  }

  function mediaDropEvent(filename: string): DragEvent {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], filename, { type: 'image/png' }));
    return new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  }

  function reorder(
    fixture: ComponentFixture<AdminComponent>,
    source: Row,
    target: Row,
  ): void {
    source.el.dispatchEvent(emptyDrag('dragstart'));
    target.el.dispatchEvent(emptyDrag('drop'));
    fixture.detectChanges();
  }

  function deleteRow(fixture: ComponentFixture<AdminComponent>, row: Row): void {
    const del = row.de
      .queryAll(By.directive(ButtonComponent))
      .find((b) => (b.componentInstance as ButtonComponent).label === DELETE_LABEL);
    expect(del).withContext('delete button present on row').toBeTruthy();
    del!.triggerEventHandler('action', undefined);
    fixture.detectChanges();
  }

  function clickSave(fixture: ComponentFixture<AdminComponent>, scope: 'home' | 'pages'): void {
    const saves = fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .filter((b) => (b.componentInstance as ButtonComponent).label === SAVE_LABEL);
    let target = saves[0];
    if (scope === 'pages') {
      const libEl = library(fixture).nativeElement as HTMLElement;
      target =
        saves.find(
          (s) =>
            (libEl.compareDocumentPosition(s.nativeElement) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
        ) || saves[saves.length - 1];
    }
    expect(target).withContext('builder save button present').toBeTruthy();
    target.triggerEventHandler('action', undefined);
    fixture.detectChanges();
  }

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  // ===========================================================================
  // HOME BUILDER
  // ===========================================================================

  describe('home builder', () => {
    it('adds a block from the library and renders it in the block list', () => {
      const fixture = render('home');
      const before = rows(fixture);

      addFromLibrary(fixture, 'text');

      const after = rows(fixture);
      expect(after.length).toBe(before.length + 1);
      const added = newRow(before, after);
      expect(added).withContext('new block row rendered').toBeTruthy();
      expect(added!.type).toBe('text');
      fixture.destroy();
    });

    it('drops a library block payload onto an existing block and renders the new block', () => {
      const fixture = render('home');
      addFromLibrary(fixture, 'text');
      const before = rows(fixture);
      const anchor = before[before.length - 1];

      anchor.el.dispatchEvent(blockPayloadEvent('home', 'cta'));
      fixture.detectChanges();

      const after = rows(fixture);
      expect(after.length).toBe(before.length + 1);
      expect(after.some((r) => r.type === 'cta')).toBeTrue();
      fixture.destroy();
    });

    it('reorders blocks via native drag/drop and the rendered order updates', () => {
      const fixture = render('home');
      addFromLibrary(fixture, 'text');
      addFromLibrary(fixture, 'cta');
      const list = rows(fixture);
      const textRow = list.find((r) => r.type === 'text')!;
      const ctaRow = list.find((r) => r.type === 'cta')!;
      const textKey = textRow.key;
      const ctaKey = ctaRow.key;
      // text currently precedes cta.
      expect(list.findIndex((r) => r.key === textKey)).toBeLessThan(
        list.findIndex((r) => r.key === ctaKey),
      );

      // Drag the later block (cta) onto the earlier one (text): cta moves ahead.
      reorder(fixture, ctaRow, textRow);

      const after = rows(fixture);
      expect(after.findIndex((r) => r.key === ctaKey)).toBeLessThan(
        after.findIndex((r) => r.key === textKey),
      );
      fixture.destroy();
    });

    it('drops image files onto a block and inserts an uploaded image block (service + toast)', async () => {
      admin.uploadContentImage.and.returnValue(
        of({ images: [{ url: 'https://cdn.example/studio.png', focal_x: 50, focal_y: 50 }] } as any),
      );
      const fixture = render('home');
      addFromLibrary(fixture, 'text');
      const before = rows(fixture);
      const anchor = before[before.length - 1];

      anchor.el.dispatchEvent(mediaDropEvent('studio-photo.png'));
      await flush();
      fixture.detectChanges();

      expect(admin.uploadContentImage).toHaveBeenCalled();
      const [uploadKey] = admin.uploadContentImage.calls.mostRecent().args as [string, File];
      expect(uploadKey).toBe('site.assets');
      const after = rows(fixture);
      expect(after.length).toBe(before.length + 1);
      expect(after.some((r) => r.type === 'image')).toBeTrue();
      expect(toast.success).toHaveBeenCalled();
      fixture.destroy();
    });

    it('ignores a reorder drop whose dragged key is unknown (no-op, list unchanged)', () => {
      const fixture = render('home');
      addFromLibrary(fixture, 'text');
      const before = rows(fixture).map((r) => r.key);
      const anchor = rows(fixture)[0];

      // A bare drop with no prior dragstart and no payload must not mutate the list.
      anchor.el.dispatchEvent(emptyDrag('drop'));
      fixture.detectChanges();

      expect(rows(fixture).map((r) => r.key)).toEqual(before);
      fixture.destroy();
    });

    it('removes a custom block when its delete control is activated', () => {
      const fixture = render('home');
      addFromLibrary(fixture, 'text');
      const added = newRow([], rows(fixture).filter((r) => r.type === 'text'))!;
      const target = rows(fixture).find((r) => r.key === added.key)!;

      deleteRow(fixture, target);

      expect(rows(fixture).some((r) => r.key === added.key)).toBeFalse();
      fixture.destroy();
    });

    it('persists the home layout via updateContentBlock("home.sections") with the current blocks', () => {
      admin.updateContentBlock.and.returnValue(of({ key: 'home.sections', version: 5, meta: {} } as any));
      const fixture = render('home');
      addFromLibrary(fixture, 'cta');
      const ctaRow = rows(fixture).find((r) => r.type === 'cta')!;

      clickSave(fixture, 'home');

      expect(admin.updateContentBlock).toHaveBeenCalled();
      const [key, payload] = admin.updateContentBlock.calls.mostRecent().args as [
        string,
        { meta?: { blocks?: Array<{ key: string; type: string }> } },
      ];
      expect(key).toBe('home.sections');
      const blocks = payload?.meta?.blocks || [];
      expect(blocks.some((b) => b.key === ctaRow.key && b.type === 'cta')).toBeTrue();
      fixture.destroy();
    });
  });

  // ===========================================================================
  // PAGE BUILDER  (default page key = 'page.about', all block types allowed)
  // ===========================================================================

  describe('page builder', () => {
    it('adds a block from the library and renders it in the page block list', () => {
      const fixture = render('pages');
      const before = rows(fixture);

      addFromLibrary(fixture, 'text');

      const after = rows(fixture);
      expect(after.length).toBe(before.length + 1);
      const added = newRow(before, after);
      expect(added!.type).toBe('text');
      fixture.destroy();
    });

    it('drops a library block payload onto an existing page block', () => {
      const fixture = render('pages');
      addFromLibrary(fixture, 'text');
      const before = rows(fixture);
      const anchor = before[before.length - 1];

      anchor.el.dispatchEvent(blockPayloadEvent('page', 'faq'));
      fixture.detectChanges();

      const after = rows(fixture);
      expect(after.length).toBe(before.length + 1);
      expect(after.some((r) => r.type === 'faq')).toBeTrue();
      fixture.destroy();
    });

    it('reorders page blocks via native drag/drop and the rendered order updates', () => {
      const fixture = render('pages');
      addFromLibrary(fixture, 'text');
      addFromLibrary(fixture, 'cta');
      const list = rows(fixture);
      const textRow = list.find((r) => r.type === 'text')!;
      const ctaRow = list.find((r) => r.type === 'cta')!;
      const textKey = textRow.key;
      const ctaKey = ctaRow.key;
      expect(list.findIndex((r) => r.key === textKey)).toBeLessThan(
        list.findIndex((r) => r.key === ctaKey),
      );

      // Drag the later block (cta) onto the earlier one (text): cta moves ahead.
      reorder(fixture, ctaRow, textRow);

      const after = rows(fixture);
      expect(after.findIndex((r) => r.key === ctaKey)).toBeLessThan(
        after.findIndex((r) => r.key === textKey),
      );
      fixture.destroy();
    });

    it('drops image files onto a page block and inserts an uploaded image block (service uses page key)', async () => {
      admin.uploadContentImage.and.returnValue(
        of({ images: [{ url: 'https://cdn.example/p.png', focal_x: 50, focal_y: 50 }] } as any),
      );
      const fixture = render('pages');
      addFromLibrary(fixture, 'text');
      const before = rows(fixture);
      const anchor = before[before.length - 1];

      anchor.el.dispatchEvent(mediaDropEvent('page-photo.png'));
      await flush();
      fixture.detectChanges();

      expect(admin.uploadContentImage).toHaveBeenCalled();
      const [uploadKey] = admin.uploadContentImage.calls.mostRecent().args as [string, File];
      expect(uploadKey).toBe('page.about');
      const after = rows(fixture);
      expect(after.some((r) => r.type === 'image')).toBeTrue();
      expect(toast.success).toHaveBeenCalled();
      fixture.destroy();
    });

    it('ignores a page reorder drop with an unknown dragged key (no-op, list unchanged)', () => {
      const fixture = render('pages');
      addFromLibrary(fixture, 'text');
      const before = rows(fixture).map((r) => r.key);
      const anchor = rows(fixture)[0];

      anchor.el.dispatchEvent(emptyDrag('drop'));
      fixture.detectChanges();

      expect(rows(fixture).map((r) => r.key)).toEqual(before);
      fixture.destroy();
    });

    it('removes a page block when its delete control is activated', () => {
      const fixture = render('pages');
      addFromLibrary(fixture, 'text');
      const added = newRow([], rows(fixture).filter((r) => r.type === 'text'))!;
      const target = rows(fixture).find((r) => r.key === added.key)!;

      deleteRow(fixture, target);

      expect(rows(fixture).some((r) => r.key === added.key)).toBeFalse();
      fixture.destroy();
    });

    it('persists the page via updateContentBlock("page.about") carrying the current blocks', () => {
      admin.updateContentBlock.and.returnValue(
        of({ key: 'page.about', version: 3, status: 'draft', meta: {} } as any),
      );
      const fixture = render('pages');
      addFromLibrary(fixture, 'cta');
      const ctaRow = rows(fixture).find((r) => r.type === 'cta')!;

      clickSave(fixture, 'pages');

      expect(admin.updateContentBlock).toHaveBeenCalled();
      const [key, payload] = admin.updateContentBlock.calls.mostRecent().args as [
        string,
        { meta?: { blocks?: Array<{ key: string; type: string }> } },
      ];
      expect(key).toBe('page.about');
      const blocks = payload?.meta?.blocks || [];
      expect(blocks.some((b) => b.key === ctaRow.key && b.type === 'cta')).toBeTrue();
      fixture.destroy();
    });
  });
});
