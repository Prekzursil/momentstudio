import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';
import { ButtonComponent } from '../../shared/button.component';
import { InputComponent } from '../../shared/input.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { CmsEditorPrefsService } from './shared/cms-editor-prefs.service';
import { AdminService } from '../../core/admin.service';
import { AdminProductsService } from '../../core/admin-products.service';
import { AuthService } from '../../core/auth.service';
import { BlogService } from '../../core/blog.service';
import { FxAdminService } from '../../core/fx-admin.service';
import { MarkdownService } from '../../core/markdown.service';
import { TaxesAdminService } from '../../core/taxes-admin.service';
import { ToastService } from '../../core/toast.service';

/**
 * E2E / behavioural SAFETY NET for the admin "redirect / SEO / featured" flows.
 *
 * These tests render the REAL AdminComponent and drive it through its RENDERED
 * DOM (clicking the rendered buttons, typing into the rendered inputs, dispatching
 * the file-input change event) and assert OBSERVABLE behaviour only:
 *   - the admin service called with the concrete arguments the flow must send,
 *   - the DOM state the user actually sees (rows, summary text, issue links),
 *   - toast success/error side-effects.
 *
 * They deliberately never call AdminComponent's internal methods by name, so they
 * pass UNCHANGED after the flow's template + handlers are extracted into a child
 * component during the admin decomposition. The flows covered are:
 *   1. Content redirects: list/search, create (upsert), delete, export, import, paginate.
 *   2. SEO: sitemap preview, structured-data validation + issue-url mapping.
 *   3. Featured collections: create, edit -> update, reset, validation.
 *
 * Heavy descendant components are schema-ignored so the suite stays focused on the
 * flows under test; the lightweight ButtonComponent / InputComponent stay REAL so
 * the interactions go through the genuine rendered controls.
 */

type AnySpy = jasmine.SpyObj<any>;

interface SetupOptions {
  section: 'home' | 'pages' | 'settings' | 'blog';
  mode?: 'basic' | 'advanced';
  admin?: (admin: AnySpy) => void;
}

interface SetupResult {
  fixture: ReturnType<typeof TestBed.createComponent<AdminComponent>>;
  root: HTMLElement;
  admin: AnySpy;
  toast: AnySpy;
}

const GENERIC_BLOCK = {
  key: 'x',
  title: '',
  body_markdown: '',
  status: 'published',
  version: 1,
  meta: {},
  lang: 'en',
  published_at: null,
  published_until: null,
  needs_translation_en: false,
  needs_translation_ro: false,
  images: [],
};

const EMPTY_REDIRECTS = {
  items: [],
  meta: { total_items: 0, total_pages: 1, page: 1, limit: 25 },
};

function makeAdminSpy(): AnySpy {
  const admin = jasmine.createSpyObj('AdminService', [
    'products',
    'content',
    'coupons',
    'lowStock',
    'audit',
    'getMaintenance',
    'getCategories',
    'listFeaturedCollections',
    'createFeaturedCollection',
    'updateFeaturedCollection',
    'getContent',
    'createContent',
    'updateContentBlock',
    'listContentPages',
    'listContentRedirects',
    'deleteContentRedirect',
    'exportContentRedirects',
    'importContentRedirects',
    'upsertContentRedirect',
    'getSitemapPreview',
    'validateStructuredData',
  ]);
  admin.products.and.returnValue(of([]));
  admin.content.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  admin.getMaintenance.and.returnValue(of({ enabled: false }));
  admin.getCategories.and.returnValue(of([]));
  admin.listFeaturedCollections.and.returnValue(of([]));
  admin.createFeaturedCollection.and.returnValue(
    of({ id: 'fc-new', slug: 'new-collection', name: '', created_at: '2026-01-01T00:00:00Z' }),
  );
  admin.updateFeaturedCollection.and.returnValue(
    of({ id: 'fc-1', slug: 'spring', name: 'Spring', created_at: '2026-01-01T00:00:00Z' }),
  );
  admin.getContent.and.returnValue(of({ ...GENERIC_BLOCK }));
  admin.createContent.and.returnValue(of({ ...GENERIC_BLOCK }));
  admin.updateContentBlock.and.returnValue(of({ ...GENERIC_BLOCK }));
  admin.listContentPages.and.returnValue(of([]));
  admin.listContentRedirects.and.returnValue(of({ ...EMPTY_REDIRECTS }));
  admin.deleteContentRedirect.and.returnValue(of({}));
  admin.exportContentRedirects.and.returnValue(
    of(new Blob(['from_key,to_key'], { type: 'text/csv' })),
  );
  admin.importContentRedirects.and.returnValue(of({ created: 0, updated: 0, skipped: 0 }));
  admin.upsertContentRedirect.and.returnValue(of({ id: 'rr', from_key: '', to_key: '' }));
  admin.getSitemapPreview.and.returnValue(of({ by_lang: {} }));
  admin.validateStructuredData.and.returnValue(
    of({ checked_products: 0, checked_pages: 0, errors: 0, warnings: 0, issues: [] }),
  );
  return admin;
}

async function setup(options: SetupOptions): Promise<SetupResult> {
  const admin = makeAdminSpy();
  if (options.admin) options.admin(admin);

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

  const adminProducts = jasmine.createSpyObj('AdminProductsService', ['search']);
  adminProducts.search.and.returnValue(of([]));

  const blog = jasmine.createSpyObj('BlogService', [
    'listFlaggedComments',
    'resolveCommentFlagsAdmin',
    'hideCommentAdmin',
    'unhideCommentAdmin',
    'deleteComment',
    'createPreviewToken',
  ]);
  for (const m of Object.keys(blog)) (blog[m] as jasmine.Spy).and.returnValue(of([]));

  const fxAdmin = jasmine.createSpyObj('FxAdminService', [
    'getStatus',
    'listOverrideAudit',
    'clearOverride',
    'restoreOverrideFromAudit',
    'setOverride',
  ]);
  fxAdmin.getStatus.and.returnValue(
    of({ effective: { eur_per_ron: 1, usd_per_ron: 1, as_of: '' }, override: null, last_known: null }),
  );
  fxAdmin.listOverrideAudit.and.returnValue(of([]));
  fxAdmin.clearOverride.and.returnValue(of({}));
  fxAdmin.restoreOverrideFromAudit.and.returnValue(of({}));
  fxAdmin.setOverride.and.returnValue(of({}));

  const taxesAdmin = jasmine.createSpyObj('TaxesAdminService', [
    'listGroups',
    'createGroup',
    'updateGroup',
    'deleteGroup',
    'upsertRate',
    'deleteRate',
  ]);
  for (const m of Object.keys(taxesAdmin)) (taxesAdmin[m] as jasmine.Spy).and.returnValue(of([]));

  const auth = jasmine.createSpyObj('AuthService', ['role', 'loadCurrentUser']);
  auth.role.and.returnValue('owner');
  auth.loadCurrentUser.and.returnValue(of(null));

  const mode = options.mode ?? 'advanced';
  const cmsPrefs = jasmine.createSpyObj('CmsEditorPrefsService', [
    'mode',
    'previewDevice',
    'previewLang',
    'previewLayout',
    'previewTheme',
    'translationLayout',
  ]);
  cmsPrefs.mode.and.returnValue(mode);
  cmsPrefs.previewDevice.and.returnValue('desktop');
  cmsPrefs.previewLang.and.returnValue('en');
  cmsPrefs.previewLayout.and.returnValue('stacked');
  cmsPrefs.previewTheme.and.returnValue('light');
  cmsPrefs.translationLayout.and.returnValue('tabs');

  const route = {
    snapshot: { data: { section: options.section }, queryParams: {} },
    data: of({ section: options.section }),
    queryParams: of({}),
  };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TranslateModule.forRoot(), AdminComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: route },
      { provide: AdminService, useValue: admin },
      { provide: AdminProductsService, useValue: adminProducts },
      { provide: BlogService, useValue: blog },
      { provide: FxAdminService, useValue: fxAdmin },
      { provide: TaxesAdminService, useValue: taxesAdmin },
      { provide: AuthService, useValue: auth },
      { provide: CmsEditorPrefsService, useValue: cmsPrefs },
      { provide: ToastService, useValue: toast },
      { provide: MarkdownService, useValue: { render: (v: string) => v } },
    ],
  })
    .overrideComponent(AdminComponent, {
      set: {
        imports: [
          CommonModule,
          FormsModule,
          ButtonComponent,
          InputComponent,
          LocalizedCurrencyPipe,
          TranslateModule,
        ],
        schemas: [NO_ERRORS_SCHEMA],
      },
    })
    .compileComponents();

  const fixture = TestBed.createComponent(AdminComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, root: fixture.nativeElement as HTMLElement, admin, toast };
}

// ---- DOM helpers (rendered-behaviour boundary) ------------------------------

function all(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)) as HTMLElement[];
}

function text(el: Element | null | undefined): string {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function detailsBySummary(root: HTMLElement, summaryKey: string): HTMLElement {
  const found = all(root, 'details').find((d) =>
    (d.querySelector('summary')?.textContent || '').includes(summaryKey),
  );
  if (!found) throw new Error(`<details> with summary "${summaryKey}" not found`);
  return found;
}

function sectionByHeading(root: HTMLElement, headingKey: string): HTMLElement {
  const found = all(root, 'section').find((s) =>
    (s.querySelector('h2')?.textContent || '').includes(headingKey),
  );
  if (!found) throw new Error(`<section> with heading "${headingKey}" not found`);
  return found;
}

function buttonByLabel(scope: HTMLElement, labelKey: string): HTMLButtonElement {
  const found = all(scope, 'button').find((b) => (b.textContent || '').includes(labelKey));
  if (!found) throw new Error(`<button> with label "${labelKey}" not found`);
  return found as HTMLButtonElement;
}

function inputByLabel(scope: HTMLElement, labelKey: string): HTMLInputElement {
  const host = all(scope, 'app-input').find((ai) =>
    (ai.querySelector('span')?.textContent || '').includes(labelKey),
  );
  if (!host) throw new Error(`<app-input> with label "${labelKey}" not found`);
  return host.querySelector('input') as HTMLInputElement;
}

function typeInto(fixture: SetupResult['fixture'], input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

async function clickEl(fixture: SetupResult['fixture'], el: HTMLElement): Promise<void> {
  el.click();
  fixture.detectChanges();
  // NgModel defers its model->view write to a microtask; flush it so any
  // programmatic form reset/populate is reflected in the rendered inputs.
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('AdminComponent net flow: content redirects (rendered DOM)', () => {
  const TITLE = 'adminUi.site.pages.redirects.title';

  function panel(s: SetupResult): HTMLElement {
    return detailsBySummary(s.root, TITLE);
  }

  it('renders redirect rows mapping keys to public URLs and flags a stale target', async () => {
    const s = await setup({
      section: 'pages',
      admin: (a) =>
        a.listContentRedirects.and.returnValue(
          of({
            items: [
              {
                id: 'red-1',
                from_key: 'page.old-vase',
                to_key: 'page.new-vase',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                target_exists: true,
                chain_error: null,
              },
              {
                id: 'red-2',
                from_key: 'page.gone',
                to_key: 'page.missing',
                created_at: '2026-01-02T00:00:00Z',
                updated_at: '2026-01-02T00:00:00Z',
                target_exists: false,
                chain_error: null,
              },
            ],
            meta: { total_items: 2, total_pages: 1, page: 1, limit: 25 },
          }),
        ),
    });

    const body = text(panel(s));
    expect(body).toContain('/pages/old-vase');
    expect(body).toContain('/pages/new-vase');
    expect(body).toContain('/pages/gone');
    // Only the row whose target is missing surfaces the "stale" warning.
    expect(body).toContain('adminUi.site.pages.redirects.stale');
  });

  it('search drives listContentRedirects with the typed query and page reset', async () => {
    const s = await setup({ section: 'pages' });
    s.admin.listContentRedirects.calls.reset();

    const p = panel(s);
    typeInto(s.fixture, inputByLabel(p, 'adminUi.site.pages.redirects.search'), '  vase  ');
    await clickEl(s.fixture, buttonByLabel(p, 'adminUi.actions.search'));

    expect(s.admin.listContentRedirects).toHaveBeenCalledTimes(1);
    const arg = s.admin.listContentRedirects.calls.mostRecent().args[0];
    expect(arg.q).toBe('vase');
    expect(arg.page).toBe(1);
  });

  it('create sends a trimmed upsert payload, toasts success, clears the form and reloads', async () => {
    const s = await setup({ section: 'pages' });
    s.admin.listContentRedirects.calls.reset();

    const p = panel(s);
    const fromInput = inputByLabel(p, 'adminUi.site.pages.redirects.createFrom');
    const toInput = inputByLabel(p, 'adminUi.site.pages.redirects.createTo');
    typeInto(s.fixture, fromInput, ' page.from ');
    typeInto(s.fixture, toInput, ' page.to ');

    const createBtn = buttonByLabel(p, 'adminUi.actions.create');
    expect(createBtn.disabled).toBe(false);
    await clickEl(s.fixture, createBtn);

    expect(s.admin.upsertContentRedirect).toHaveBeenCalledWith({
      from_key: 'page.from',
      to_key: 'page.to',
    });
    expect(s.toast.success).toHaveBeenCalled();
    // Form cleared (observable in the rendered inputs) and list reloaded.
    expect(inputByLabel(panel(s), 'adminUi.site.pages.redirects.createFrom').value).toBe('');
    expect(s.admin.listContentRedirects).toHaveBeenCalled();
  });

  it('create button stays disabled until both endpoints are present', async () => {
    const s = await setup({ section: 'pages' });
    const p = panel(s);
    expect(buttonByLabel(p, 'adminUi.actions.create').disabled).toBe(true);

    typeInto(s.fixture, inputByLabel(p, 'adminUi.site.pages.redirects.createFrom'), 'page.a');
    expect(buttonByLabel(panel(s), 'adminUi.actions.create').disabled).toBe(true);

    typeInto(s.fixture, inputByLabel(panel(s), 'adminUi.site.pages.redirects.createTo'), 'page.b');
    expect(buttonByLabel(panel(s), 'adminUi.actions.create').disabled).toBe(false);
  });

  it('create surfaces the backend error detail as a toast', async () => {
    const s = await setup({
      section: 'pages',
      admin: (a) =>
        a.upsertContentRedirect.and.returnValue(
          throwError(() => ({ error: { detail: 'redirect already exists' } })),
        ),
    });
    const p = panel(s);
    typeInto(s.fixture, inputByLabel(p, 'adminUi.site.pages.redirects.createFrom'), 'page.a');
    typeInto(s.fixture, inputByLabel(panel(s), 'adminUi.site.pages.redirects.createTo'), 'page.b');
    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.create'));

    expect(s.toast.error).toHaveBeenCalledWith('redirect already exists');
  });

  it('delete (confirmed) calls the service with the row id, toasts and reloads', async () => {
    const s = await setup({
      section: 'pages',
      admin: (a) =>
        a.listContentRedirects.and.returnValue(
          of({
            items: [
              {
                id: 'red-9',
                from_key: 'page.x',
                to_key: 'page.y',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                target_exists: true,
                chain_error: null,
              },
            ],
            meta: { total_items: 1, total_pages: 1, page: 1, limit: 25 },
          }),
        ),
    });
    spyOn(window, 'confirm').and.returnValue(true);
    s.admin.listContentRedirects.calls.reset();

    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.delete'));

    expect(s.admin.deleteContentRedirect).toHaveBeenCalledWith('red-9');
    expect(s.toast.success).toHaveBeenCalled();
    expect(s.admin.listContentRedirects).toHaveBeenCalled();
  });

  it('delete (declined) is a no-op', async () => {
    const s = await setup({
      section: 'pages',
      admin: (a) =>
        a.listContentRedirects.and.returnValue(
          of({
            items: [
              {
                id: 'red-9',
                from_key: 'page.x',
                to_key: 'page.y',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                target_exists: true,
                chain_error: null,
              },
            ],
            meta: { total_items: 1, total_pages: 1, page: 1, limit: 25 },
          }),
        ),
    });
    spyOn(window, 'confirm').and.returnValue(false);

    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.delete'));

    expect(s.admin.deleteContentRedirect).not.toHaveBeenCalled();
  });

  it('export calls the service with the current query and toasts success', async () => {
    const s = await setup({ section: 'pages' });
    spyOn(URL, 'createObjectURL').and.returnValue('blob:mock');
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');

    const p = panel(s);
    typeInto(s.fixture, inputByLabel(p, 'adminUi.site.pages.redirects.search'), 'wall');
    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.site.pages.redirects.export'));

    expect(s.admin.exportContentRedirects).toHaveBeenCalledWith({ q: 'wall' });
    expect(s.toast.success).toHaveBeenCalled();
  });

  it('import sends the chosen file, renders the result summary, toasts and reloads', async () => {
    const s = await setup({
      section: 'pages',
      admin: (a) =>
        a.importContentRedirects.and.returnValue(of({ created: 3, updated: 1, skipped: 2 })),
    });
    s.admin.listContentRedirects.calls.reset();

    const fileInput = panel(s).querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['from_key,to_key\npage.a,page.b'], 'redirects.csv', { type: 'text/csv' });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
    s.fixture.detectChanges();

    expect(s.admin.importContentRedirects).toHaveBeenCalledWith(file);
    expect(text(panel(s))).toContain('adminUi.site.pages.redirects.importResult');
    expect(s.toast.success).toHaveBeenCalled();
    expect(s.admin.listContentRedirects).toHaveBeenCalled();
  });

  it('paginates to the next page when more than one page exists', async () => {
    const s = await setup({
      section: 'pages',
      admin: (a) =>
        a.listContentRedirects.and.returnValue(
          of({
            items: [
              {
                id: 'red-1',
                from_key: 'page.a',
                to_key: 'page.b',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                target_exists: true,
                chain_error: null,
              },
            ],
            meta: { total_items: 60, total_pages: 3, page: 1, limit: 25 },
          }),
        ),
    });
    s.admin.listContentRedirects.calls.reset();

    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.next'));

    const arg = s.admin.listContentRedirects.calls.mostRecent().args[0];
    expect(arg.page).toBe(2);
  });
});

describe('AdminComponent net flow: SEO sitemap + structured data (rendered DOM)', () => {
  function sitemap(s: SetupResult): HTMLElement {
    return detailsBySummary(s.root, 'adminUi.site.seo.sitemapPreview.title');
  }
  function structured(s: SetupResult): HTMLElement {
    return detailsBySummary(s.root, 'adminUi.site.seo.structuredData.title');
  }

  it('sitemap preview loads and renders the per-language URL lists', async () => {
    const s = await setup({
      section: 'settings',
      admin: (a) =>
        a.getSitemapPreview.and.returnValue(
          of({
            by_lang: {
              en: ['https://momentstudio.ro/en/', 'https://momentstudio.ro/en/shop'],
              ro: ['https://momentstudio.ro/ro/'],
            },
          }),
        ),
    });

    await clickEl(s.fixture, buttonByLabel(sitemap(s), 'adminUi.site.seo.sitemapPreview.load'));

    const panel = sitemap(s);
    expect(s.admin.getSitemapPreview).toHaveBeenCalled();
    expect(text(panel)).toContain('EN (2)');
    expect(text(panel)).toContain('RO (1)');
    const hrefs = all(panel, 'a').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://momentstudio.ro/en/shop');
    expect(hrefs).toContain('https://momentstudio.ro/ro/');
  });

  it('sitemap preview surfaces the backend error detail in the DOM', async () => {
    const s = await setup({
      section: 'settings',
      admin: (a) =>
        a.getSitemapPreview.and.returnValue(
          throwError(() => ({ error: { detail: 'sitemap build failed' } })),
        ),
    });

    await clickEl(s.fixture, buttonByLabel(sitemap(s), 'adminUi.site.seo.sitemapPreview.load'));

    expect(text(sitemap(s))).toContain('sitemap build failed');
  });

  it('structured-data validation renders the summary and maps each issue to its public URL', async () => {
    const s = await setup({
      section: 'settings',
      admin: (a) =>
        a.validateStructuredData.and.returnValue(
          of({
            checked_products: 12,
            checked_pages: 5,
            errors: 1,
            warnings: 1,
            issues: [
              {
                entity_type: 'product',
                entity_key: 'hand-painted-vase',
                severity: 'error',
                message: 'Missing offers',
              },
              {
                entity_type: 'page',
                entity_key: 'page.about',
                severity: 'warning',
                message: 'Thin description',
              },
            ],
          }),
        ),
    });

    await clickEl(s.fixture, buttonByLabel(structured(s), 'adminUi.site.seo.structuredData.run'));

    const panel = structured(s);
    expect(s.admin.validateStructuredData).toHaveBeenCalled();
    expect(text(panel)).toContain('adminUi.site.seo.structuredData.summary');
    const hrefs = all(panel, 'a').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/products/hand-painted-vase');
    expect(hrefs).toContain('/about');
  });

  it('structured-data validation shows the clean state when there are no issues', async () => {
    const s = await setup({
      section: 'settings',
      admin: (a) =>
        a.validateStructuredData.and.returnValue(
          of({ checked_products: 3, checked_pages: 2, errors: 0, warnings: 0, issues: [] }),
        ),
    });

    await clickEl(s.fixture, buttonByLabel(structured(s), 'adminUi.site.seo.structuredData.run'));

    expect(text(structured(s))).toContain('adminUi.site.seo.structuredData.ok');
  });

  it('structured-data validation surfaces the backend error detail', async () => {
    const s = await setup({
      section: 'settings',
      admin: (a) =>
        a.validateStructuredData.and.returnValue(
          throwError(() => ({ error: { detail: 'validation crashed' } })),
        ),
    });

    await clickEl(s.fixture, buttonByLabel(structured(s), 'adminUi.site.seo.structuredData.run'));

    expect(text(structured(s))).toContain('validation crashed');
  });
});

describe('AdminComponent net flow: featured collections (rendered DOM)', () => {
  const HEADING = 'adminUi.home.collections.title';

  function panel(s: SetupResult): HTMLElement {
    return sectionByHeading(s.root, HEADING);
  }

  it('create sends the form payload, prepends the new collection and shows a success message', async () => {
    const s = await setup({
      section: 'home',
      admin: (a) =>
        a.createFeaturedCollection.and.returnValue(
          of({
            id: 'fc-new',
            slug: 'autumn-edit',
            name: 'Autumn Edit',
            description: '',
            created_at: '2026-01-01T00:00:00Z',
            product_ids: [],
          }),
        ),
    });

    const p = panel(s);
    typeInto(s.fixture, inputByLabel(p, 'adminUi.home.collections.name'), 'Autumn Edit');
    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.home.collections.create'));

    expect(s.admin.createFeaturedCollection).toHaveBeenCalledWith({
      name: 'Autumn Edit',
      description: '',
      product_ids: [],
    });
    const body = text(panel(s));
    expect(body).toContain('Autumn Edit');
    expect(body).toContain('adminUi.home.collections.success.saved');
  });

  it('create with a blank name is rejected with an error toast and no service call', async () => {
    const s = await setup({ section: 'home' });

    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.home.collections.create'));

    expect(s.admin.createFeaturedCollection).not.toHaveBeenCalled();
    expect(s.toast.error).toHaveBeenCalled();
  });

  it('editing an existing collection loads it into the form and saves via update', async () => {
    const s = await setup({
      section: 'home',
      admin: (a) => {
        a.listFeaturedCollections.and.returnValue(
          of([
            {
              id: 'fc-1',
              slug: 'spring',
              name: 'Spring Picks',
              description: 'Pastel pieces',
              created_at: '2026-01-01T00:00:00Z',
              product_ids: ['p-1'],
            },
          ]),
        );
        a.updateFeaturedCollection.and.returnValue(
          of({
            id: 'fc-1',
            slug: 'spring',
            name: 'Spring Picks',
            description: 'Pastel pieces',
            created_at: '2026-01-01T00:00:00Z',
            product_ids: ['p-1'],
          }),
        );
      },
    });

    // The collection row renders and exposes an edit control.
    expect(text(panel(s))).toContain('Spring Picks');
    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.edit'));

    // The form now reflects the edited collection (rendered input value).
    expect(inputByLabel(panel(s), 'adminUi.home.collections.name').value).toBe('Spring Picks');
    // And the primary button switches to the update affordance.
    const updateBtn = buttonByLabel(panel(s), 'adminUi.home.collections.update');
    await clickEl(s.fixture, updateBtn);

    expect(s.admin.updateFeaturedCollection).toHaveBeenCalled();
    const args = s.admin.updateFeaturedCollection.calls.mostRecent().args;
    expect(args[0]).toBe('spring');
    expect(args[1]).toEqual(
      jasmine.objectContaining({ name: 'Spring Picks', product_ids: ['p-1'] }),
    );
  });

  it('reset clears an in-progress edit back to the create affordance', async () => {
    const s = await setup({
      section: 'home',
      admin: (a) =>
        a.listFeaturedCollections.and.returnValue(
          of([
            {
              id: 'fc-1',
              slug: 'spring',
              name: 'Spring Picks',
              description: '',
              created_at: '2026-01-01T00:00:00Z',
              product_ids: [],
            },
          ]),
        ),
    });

    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.edit'));
    expect(inputByLabel(panel(s), 'adminUi.home.collections.name').value).toBe('Spring Picks');

    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.reset'));

    expect(inputByLabel(panel(s), 'adminUi.home.collections.name').value).toBe('');
    // Back to the create affordance (update affordance gone).
    expect(buttonByLabel(panel(s), 'adminUi.home.collections.create')).toBeTruthy();
  });

  it('update surfaces a save failure as an error toast', async () => {
    const s = await setup({
      section: 'home',
      admin: (a) => {
        a.listFeaturedCollections.and.returnValue(
          of([
            {
              id: 'fc-1',
              slug: 'spring',
              name: 'Spring Picks',
              description: '',
              created_at: '2026-01-01T00:00:00Z',
              product_ids: [],
            },
          ]),
        );
        a.updateFeaturedCollection.and.returnValue(throwError(() => new Error('boom')));
      },
    });

    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.actions.edit'));
    await clickEl(s.fixture, buttonByLabel(panel(s), 'adminUi.home.collections.update'));

    expect(s.toast.error).toHaveBeenCalled();
  });
});
