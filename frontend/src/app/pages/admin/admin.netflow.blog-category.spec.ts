/**
 * E2E / behavioral SAFETY-NET for the admin "blog moderation" + "category CRUD" flows.
 *
 * These tests drive the AdminComponent through its RENDERED template (real DOM events on the
 * buttons / inputs / modal a human would use) and assert OBSERVABLE behavior only:
 *   - the concrete service call (method + arguments) the flow triggers,
 *   - the resulting toast (success / error) side-effect,
 *   - the resulting DOM state (rows added / removed, panels opening).
 *
 * They deliberately do NOT call component methods by name and do NOT inspect private state, so
 * they keep passing unchanged after the blog-moderation / category code is extracted from this
 * monolith into child components (the buttons still render under <app-admin> for the same route
 * section, and the same injected services are still invoked).
 *
 * Regression gate for the refactor/admin-decompose work.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminComponent } from './admin.component';
import { AdminCategory, AdminService } from '../../core/admin.service';
import { AdminProductsService } from '../../core/admin-products.service';
import { AdminBlogComment, BlogService } from '../../core/blog.service';
import { FxAdminService } from '../../core/fx-admin.service';
import { TaxesAdminService } from '../../core/taxes-admin.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { MarkdownService } from '../../core/markdown.service';
import { CmsEditorPrefsService } from './shared/cms-editor-prefs.service';

type AnySpy = jasmine.SpyObj<any>;
type Section = 'home' | 'pages' | 'blog' | 'settings';

// A permissive default payload so the monolith's section-load + all sibling sub-panels render
// without throwing. The individual flows under test override the specific calls they exercise.
const ANY: any = {
  items: [],
  meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 },
  products: [],
  content: [],
  security: [],
  enabled: false,
  rates: {},
  base: 'RON',
  value: null,
  sections: [],
  collections: [],
  data: [],
  override_active: false,
};

function autoSpy(name: string, ctor: { prototype: object }): AnySpy {
  const proto = ctor.prototype;
  const names = Object.getOwnPropertyNames(proto).filter((m) => {
    if (m === 'constructor') return false;
    const d = Object.getOwnPropertyDescriptor(proto, m);
    return !!d && typeof d.value === 'function';
  });
  const spy = jasmine.createSpyObj(name, names.length ? names : ['__noop']);
  for (const m of names) (spy[m] as jasmine.Spy).and.returnValue(of(ANY));
  return spy;
}

interface Env {
  fixture: ComponentFixture<AdminComponent>;
  host: HTMLElement;
  admin: AnySpy;
  blog: AnySpy;
  toast: AnySpy;
  render: () => void;
}

function makeEnv(section: Section): Env {
  const admin = autoSpy('AdminService', AdminService);
  for (const m of ['products', 'coupons', 'lowStock', 'getCategories', 'listFeaturedCollections']) {
    (admin[m] as jasmine.Spy).and.returnValue(of([]));
  }
  admin.audit.and.returnValue(of({ products: [], content: [], security: [] }));
  admin.getMaintenance.and.returnValue(of({ enabled: false, message: '', allow_admins: true }));

  const adminProducts = autoSpy('AdminProductsService', AdminProductsService);
  const blog = autoSpy('BlogService', BlogService);
  const fxAdmin = autoSpy('FxAdminService', FxAdminService);
  fxAdmin.getStatus.and.returnValue(
    of({ effective: { eur_per_ron: 0, usd_per_ron: 0, as_of: '' }, override: null, last_known: null }),
  );
  fxAdmin.listOverrideAudit.and.returnValue(of([]));
  const taxesAdmin = autoSpy('TaxesAdminService', TaxesAdminService);
  taxesAdmin.listGroups.and.returnValue(of([]));

  const auth = autoSpy('AuthService', AuthService);
  auth.role.and.returnValue('owner');

  const cmsPrefs = jasmine.createSpyObj('CmsEditorPrefsService', [
    'mode',
    'previewDevice',
    'previewLang',
    'previewLayout',
    'previewTheme',
    'translationLayout',
  ]);
  cmsPrefs.mode.and.returnValue('basic');
  cmsPrefs.previewDevice.and.returnValue('desktop');
  cmsPrefs.previewLang.and.returnValue('en');
  cmsPrefs.previewLayout.and.returnValue('stacked');
  cmsPrefs.previewTheme.and.returnValue('light');
  cmsPrefs.translationLayout.and.returnValue('tabs');

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const markdown = jasmine.createSpyObj('MarkdownService', ['render']);
  markdown.render.and.callFake((v: string) => `R:${v}`);
  const sanitizer = jasmine.createSpyObj('DomSanitizer', ['bypassSecurityTrustResourceUrl']);
  sanitizer.bypassSecurityTrustResourceUrl.and.callFake((v: string) => ({ safe: v }));

  const route = {
    snapshot: { data: { section }, queryParams: {} },
    data: of({ section }),
    queryParams: of({}),
  };

  TestBed.configureTestingModule({
    imports: [AdminComponent, TranslateModule.forRoot()],
    providers: [
      { provide: ActivatedRoute, useValue: route },
      { provide: AdminService, useValue: admin },
      { provide: AdminProductsService, useValue: adminProducts },
      { provide: BlogService, useValue: blog },
      { provide: FxAdminService, useValue: fxAdmin },
      { provide: TaxesAdminService, useValue: taxesAdmin },
      { provide: AuthService, useValue: auth },
      { provide: CmsEditorPrefsService, useValue: cmsPrefs },
      { provide: ToastService, useValue: toast },
      { provide: MarkdownService, useValue: markdown },
      { provide: DomSanitizer, useValue: sanitizer },
    ],
  });
  const tr = TestBed.inject(TranslateService);
  tr.setDefaultLang('en');
  tr.use('en');

  const fixture = TestBed.createComponent(AdminComponent);
  const env: Env = {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    admin,
    blog,
    toast,
    render: () => fixture.detectChanges(),
  };
  return env;
}

// ---- DOM helpers (text-based; resilient to markup/structure refactors) -------------------

function sectionByHeading(host: HTMLElement, headingKey: string): HTMLElement {
  const headings = Array.from(host.querySelectorAll('h2'));
  const h = headings.find((el) => (el.textContent || '').trim() === headingKey);
  if (!h) throw new Error(`section heading "${headingKey}" not found`);
  const section = h.closest('section');
  if (!section) throw new Error(`<section> for "${headingKey}" not found`);
  return section as HTMLElement;
}

function buttons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll('button'));
}

function clickButton(root: HTMLElement, text: string, index = 0): void {
  const matches = buttons(root).filter((b) => (b.textContent || '').trim() === text);
  if (!matches.length) {
    const seen = buttons(root)
      .map((b) => (b.textContent || '').trim())
      .filter(Boolean)
      .join(' | ');
    throw new Error(`button "${text}" not found. saw: ${seen}`);
  }
  matches[index].click();
}

function setAppInput(scope: HTMLElement, labelKey: string, value: string): void {
  const wrappers = Array.from(scope.querySelectorAll('app-input'));
  const wrapper = wrappers.find((w) => {
    const span = w.querySelector('span');
    return span && (span.textContent || '').trim() === labelKey;
  });
  if (!wrapper) throw new Error(`app-input "${labelKey}" not found`);
  const input = wrapper.querySelector('input') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function categoryRow(host: HTMLElement, name: string): HTMLElement {
  const drag = Array.from(host.querySelectorAll('div[draggable="true"]')).find(
    (d) => (d.querySelector('p')?.textContent || '').trim() === name,
  );
  if (!drag || !drag.parentElement) throw new Error(`category row "${name}" not found`);
  return drag.parentElement as HTMLElement; // outer row also contains the translations panel
}

function commentRowByBody(host: HTMLElement, body: string): HTMLElement {
  const ps = Array.from(host.querySelectorAll('p'));
  const p = ps.find((el) => (el.textContent || '').trim() === body);
  const row = p?.closest('div.rounded-lg');
  if (!row) throw new Error(`comment row "${body}" not found`);
  return row as HTMLElement;
}

function translationsPanel(host: HTMLElement, name: string): HTMLElement {
  const row = categoryRow(host, name);
  const panel = (Array.from(row.children) as HTMLElement[]).find(
    (el) =>
      el.tagName === 'DIV' &&
      (el.textContent || '').includes('adminUi.categories.translations.title'),
  );
  if (!panel) throw new Error(`translations panel for "${name}" not open`);
  return panel;
}

function dialog(host: HTMLElement): HTMLElement {
  const d = host.querySelector('[role="dialog"]');
  if (!d) throw new Error('modal dialog not open');
  return d as HTMLElement;
}

function makeComment(over: Partial<AdminBlogComment> = {}): AdminBlogComment {
  return {
    id: 'cm-1',
    content_block_id: 'cb-1',
    post_slug: 'studio-journal-1',
    parent_id: null,
    body: 'spammy link here',
    is_deleted: false,
    is_hidden: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    author: { id: 'u-9', name: 'Troll', username: 'troll' } as any,
    flag_count: 3,
    flags: [],
    ...over,
  };
}

function makeCategory(over: Partial<AdminCategory> = {}): AdminCategory {
  return {
    id: 'cat-1',
    name: 'Vases',
    slug: 'vases',
    parent_id: null,
    sort_order: 0,
    low_stock_threshold: null,
    tax_group_id: null,
    ...over,
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
});

// =========================================================================================
// FLOW GROUP 1 — Blog moderation (flagged comments: resolve / hide / delete)
// =========================================================================================
describe('admin net :: blog moderation flow', () => {
  const MOD = 'adminUi.blog.moderation.title';

  function renderWith(comments: AdminBlogComment[]): Env {
    const env = makeEnv('blog');
    env.blog.listFlaggedComments.and.returnValue(of({ items: comments, meta: ANY.meta }));
    env.render();
    return env;
  }

  it('renders one card per flagged comment returned by the service', () => {
    const env = renderWith([makeComment({ body: 'first bad' }), makeComment({ id: 'cm-2', body: 'second bad' })]);
    const section = sectionByHeading(env.host, MOD);
    expect(section.textContent).toContain('first bad');
    expect(section.textContent).toContain('second bad');
    expect(env.blog.listFlaggedComments).toHaveBeenCalled();
  });

  it('Resolve calls resolveCommentFlagsAdmin(id), toasts success and reloads the list', () => {
    const env = renderWith([makeComment()]);
    env.blog.listFlaggedComments.calls.reset();

    const row = commentRowByBody(env.host, 'spammy link here');
    clickButton(row, 'adminUi.blog.moderation.actions.resolve');
    env.render();

    expect(env.blog.resolveCommentFlagsAdmin).toHaveBeenCalledWith('cm-1');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.blog.moderation.success.flagsResolved');
    expect(env.blog.listFlaggedComments).toHaveBeenCalled(); // reloaded after resolve
  });

  it('Resolve failure surfaces an error toast and does NOT claim success', () => {
    const env = renderWith([makeComment()]);
    env.blog.resolveCommentFlagsAdmin.and.returnValue(throwError(() => new Error('boom')));

    clickButton(commentRowByBody(env.host, 'spammy link here'), 'adminUi.blog.moderation.actions.resolve');
    env.render();

    expect(env.toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.resolveFlags');
    expect(env.toast.success).not.toHaveBeenCalled();
  });

  it('Hide prompts for a reason and calls hideCommentAdmin(id, { reason }) + success toast', () => {
    spyOn(window, 'prompt').and.returnValue('spam links');
    const env = renderWith([makeComment({ is_hidden: false })]);

    clickButton(commentRowByBody(env.host, 'spammy link here'), 'adminUi.blog.moderation.actions.hide');
    env.render();

    expect(window.prompt).toHaveBeenCalled();
    expect(env.blog.hideCommentAdmin).toHaveBeenCalledWith('cm-1', { reason: 'spam links' });
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.blog.moderation.success.commentHidden');
  });

  it('Hide is aborted (no service call) when the reason prompt is cancelled', () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const env = renderWith([makeComment({ is_hidden: false })]);

    clickButton(commentRowByBody(env.host, 'spammy link here'), 'adminUi.blog.moderation.actions.hide');
    env.render();

    expect(env.blog.hideCommentAdmin).not.toHaveBeenCalled();
  });

  it('Unhide (already-hidden comment) calls unhideCommentAdmin(id) without prompting', () => {
    const promptSpy = spyOn(window, 'prompt');
    const env = renderWith([makeComment({ is_hidden: true })]);

    clickButton(commentRowByBody(env.host, 'spammy link here'), 'adminUi.blog.moderation.actions.unhide');
    env.render();

    expect(promptSpy).not.toHaveBeenCalled();
    expect(env.blog.unhideCommentAdmin).toHaveBeenCalledWith('cm-1');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.blog.moderation.success.commentUnhidden');
  });

  it('Delete asks for confirmation; confirmed -> deleteComment(id) + success toast', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const env = renderWith([makeComment()]);

    clickButton(commentRowByBody(env.host, 'spammy link here'), 'adminUi.actions.delete');
    env.render();

    expect(env.blog.deleteComment).toHaveBeenCalledWith('cm-1');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.blog.moderation.success.commentDeleted');
  });

  it('Delete is aborted (no service call) when the confirm is dismissed', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const env = renderWith([makeComment()]);

    clickButton(commentRowByBody(env.host, 'spammy link here'), 'adminUi.actions.delete');
    env.render();

    expect(env.blog.deleteComment).not.toHaveBeenCalled();
  });

  it('empty list renders the empty-state message and no comment cards', () => {
    const env = renderWith([]);
    const section = sectionByHeading(env.host, MOD);
    expect(section.textContent).toContain('adminUi.blog.moderation.empty');
  });
});

// =========================================================================================
// FLOW GROUP 2 — Category CRUD (create / update parent / delete) + translations upsert/delete
// =========================================================================================
describe('admin net :: category CRUD flow', () => {
  const CAT = 'adminUi.categories.title';

  function renderWith(categories: AdminCategory[]): Env {
    const env = makeEnv('settings');
    env.admin.getCategories.and.returnValue(of(categories));
    env.render();
    return env;
  }

  it('Create: typing a name + clicking Add calls createCategory and renders the new row', () => {
    const env = renderWith([]);
    env.admin.createCategory.and.returnValue(of(makeCategory({ id: 'cat-new', name: 'Necklaces', slug: 'necklaces' })));

    const section = sectionByHeading(env.host, CAT);
    setAppInput(section, 'adminUi.products.table.name', 'Necklaces');
    env.render();
    clickButton(section, 'adminUi.categories.add');
    env.render();

    expect(env.admin.createCategory).toHaveBeenCalledWith({ name: 'Necklaces', parent_id: null });
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.categories.success.add');
    expect(sectionByHeading(env.host, CAT).textContent).toContain('Necklaces');
  });

  it('Create with empty name short-circuits to an error toast and never calls the service', () => {
    const env = renderWith([]);
    const section = sectionByHeading(env.host, CAT);

    clickButton(section, 'adminUi.categories.add');
    env.render();

    expect(env.admin.createCategory).not.toHaveBeenCalled();
    expect(env.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.required');
  });

  it('Delete: row Delete opens the confirm modal; confirming calls deleteCategory and removes the row', () => {
    const env = renderWith([makeCategory({ name: 'Vases', slug: 'vases' })]);
    env.admin.deleteCategory.and.returnValue(of(undefined));

    const row = categoryRow(env.host, 'Vases');
    clickButton(row, 'adminUi.actions.delete');
    env.render();

    // confirm modal is open with the Delete confirm action
    const modal = dialog(env.host);
    clickButton(modal, 'adminUi.actions.delete');
    env.render();

    expect(env.admin.deleteCategory).toHaveBeenCalledWith('vases');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.categories.success.delete');
    expect(() => categoryRow(env.host, 'Vases')).toThrowError(/category row/);
  });

  it('Delete failure keeps the row and surfaces an error toast', () => {
    const env = renderWith([makeCategory({ name: 'Vases', slug: 'vases' })]);
    env.admin.deleteCategory.and.returnValue(throwError(() => new Error('in use')));

    clickButton(categoryRow(env.host, 'Vases'), 'adminUi.actions.delete');
    env.render();
    clickButton(dialog(env.host), 'adminUi.actions.delete');
    env.render();

    expect(env.toast.error).toHaveBeenCalledWith('adminUi.categories.errors.delete');
    expect(categoryRow(env.host, 'Vases')).toBeTruthy();
  });

  it('Update parent: changing the row parent <select> calls updateCategory(slug, { parent_id })', () => {
    const env = renderWith([
      makeCategory({ id: 'cat-1', name: 'Vases', slug: 'vases' }),
      makeCategory({ id: 'cat-2', name: 'Wall Art', slug: 'wall-art' }),
    ]);
    env.admin.updateCategory.and.returnValue(of(makeCategory({ id: 'cat-1', name: 'Vases', slug: 'vases', parent_id: 'cat-2' })));

    const row = categoryRow(env.host, 'Vases');
    const select = row.querySelector('select') as HTMLSelectElement;
    select.value = 'cat-2';
    select.dispatchEvent(new Event('change'));
    env.render();

    expect(env.admin.updateCategory).toHaveBeenCalledWith('vases', { parent_id: 'cat-2' });
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.categories.success.updateParent');
  });

  it('Translations: opening the panel loads existing translations from getCategoryTranslations', () => {
    const env = renderWith([makeCategory({ name: 'Vases', slug: 'vases' })]);
    env.admin.getCategoryTranslations.and.returnValue(
      of([{ lang: 'ro', name: 'Vaze', description: 'desc ro' }] as any),
    );

    clickButton(categoryRow(env.host, 'Vases'), 'adminUi.categories.translations.button');
    env.render();

    expect(env.admin.getCategoryTranslations).toHaveBeenCalledWith('vases');
    const panel = categoryRow(env.host, 'Vases');
    expect(panel.textContent).toContain('adminUi.categories.translations.title');
  });

  it('Translations upsert: editing RO name + Save calls upsertCategoryTranslation(slug, "ro", payload)', () => {
    const env = renderWith([makeCategory({ name: 'Vases', slug: 'vases' })]);
    env.admin.getCategoryTranslations.and.returnValue(of([] as any));
    env.admin.upsertCategoryTranslation.and.returnValue(of({ lang: 'ro', name: 'Vaze', description: null } as any));

    clickButton(categoryRow(env.host, 'Vases'), 'adminUi.categories.translations.button');
    env.render();

    const panel = translationsPanel(env.host, 'Vases');
    setAppInput(panel, 'adminUi.products.table.name', 'Vaze'); // RO card name input (first one in the panel)
    env.render();
    clickButton(panel, 'adminUi.actions.save', 0); // RO Save
    env.render();

    expect(env.admin.upsertCategoryTranslation).toHaveBeenCalledWith('vases', 'ro', {
      name: 'Vaze',
      description: null,
    });
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.categories.translations.success.save');
  });

  it('Translations delete: Delete on an existing RO translation calls deleteCategoryTranslation(slug, "ro")', () => {
    const env = renderWith([makeCategory({ name: 'Vases', slug: 'vases' })]);
    env.admin.getCategoryTranslations.and.returnValue(
      of([{ lang: 'ro', name: 'Vaze', description: null }] as any),
    );
    env.admin.deleteCategoryTranslation.and.returnValue(of(undefined));

    clickButton(categoryRow(env.host, 'Vases'), 'adminUi.categories.translations.button');
    env.render();

    // Within the RO card the Delete button only renders because the translation exists.
    const panel = translationsPanel(env.host, 'Vases');
    clickButton(panel, 'adminUi.actions.delete', 0);
    env.render();

    expect(env.admin.deleteCategoryTranslation).toHaveBeenCalledWith('vases', 'ro');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.categories.translations.success.delete');
  });
});
