/**
 * Unit + light behavioural coverage for the extracted AdminBlogEditorComponent.
 *
 * The blog authoring + moderation UI was carved (behaviour-preserving) out of the
 * monolithic AdminComponent. The end-to-end "click the rendered buttons" safety
 * net lives in admin.netflow.blog-category.spec.ts (which drives <app-admin> and
 * keeps passing after the extraction); this spec exercises the child directly:
 * the flagged-comment moderation flows, the derived post lists, the slug + draft
 * helpers, and the `?edit=` deep-link.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';

import { AdminBlogEditorComponent } from './admin-blog-editor.component';
import { AdminContent, AdminService } from '../../../core/admin.service';
import { AdminBlogComment, BlogService } from '../../../core/blog.service';
import { ToastService } from '../../../core/toast.service';
import { MarkdownService } from '../../../core/markdown.service';
import { CmsEditorPrefsService } from '../shared/cms-editor-prefs.service';
import { AdminCmsStateService } from './admin-cms-state.service';

type AnySpy = jasmine.SpyObj<any>;

const ANY: any = {
  items: [],
  meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 },
  version: 1,
  title: '',
  body_markdown: '',
  status: 'draft',
  lang: 'en',
  meta_json: {},
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
  } as AdminBlogComment;
}

function blogBlock(over: Partial<AdminContent> = {}): AdminContent {
  return {
    key: 'blog.welcome',
    title: 'Welcome',
    body_markdown: 'hi',
    status: 'published',
    version: 1,
    meta: {},
    author: { id: 'a', name: 'A', username: 'a' },
    ...over,
  } as unknown as AdminContent;
}

interface Env {
  fixture: ComponentFixture<AdminBlogEditorComponent>;
  c: AdminBlogEditorComponent;
  host: HTMLElement;
  admin: AnySpy;
  blog: AnySpy;
  toast: AnySpy;
  queryParams: Subject<any>;
  render: () => void;
}

function makeEnv(editParam?: string): Env {
  const admin = autoSpy('AdminService', AdminService);
  admin.content.and.returnValue(of([]));
  const blog = autoSpy('BlogService', BlogService);
  blog.listFlaggedComments.and.returnValue(of({ items: [], meta: ANY.meta }));

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const markdown = jasmine.createSpyObj('MarkdownService', ['render']);
  markdown.render.and.callFake((v: string) => `R:${v}`);

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

  const queryParams = new Subject<any>();
  const route = {
    snapshot: { queryParams: editParam ? { edit: editParam } : {} },
    queryParams: queryParams.asObservable(),
  };

  TestBed.configureTestingModule({
    imports: [AdminBlogEditorComponent, TranslateModule.forRoot()],
    providers: [
      { provide: ActivatedRoute, useValue: route },
      { provide: AdminService, useValue: admin },
      { provide: BlogService, useValue: blog },
      { provide: ToastService, useValue: toast },
      { provide: MarkdownService, useValue: markdown },
      { provide: CmsEditorPrefsService, useValue: cmsPrefs },
      AdminCmsStateService,
    ],
  });
  const tr = TestBed.inject(TranslateService);
  tr.setDefaultLang('en');
  tr.use('en');

  const fixture = TestBed.createComponent(AdminBlogEditorComponent);
  const c = fixture.componentInstance;
  c.withExpectedVersion = (_k, p) => p as any;
  c.rememberContentVersion = () => {};
  c.handleContentConflict = () => false;
  c.reloadContentBlocks = () => {};

  return {
    fixture,
    c,
    host: fixture.nativeElement as HTMLElement,
    admin,
    blog,
    toast,
    queryParams,
    render: () => fixture.detectChanges(),
  };
}

afterEach(() => TestBed.resetTestingModule());

describe('AdminBlogEditorComponent', () => {
  it('renders the blog + moderation section headings', () => {
    const env = makeEnv();
    env.render();
    expect(env.host.textContent).toContain('adminUi.blog.title');
    expect(env.host.textContent).toContain('adminUi.blog.moderation.title');
  });

  it('loads flagged comments on init and renders a card per comment', () => {
    const env = makeEnv();
    env.blog.listFlaggedComments.and.returnValue(
      of({ items: [makeComment({ body: 'first bad' })], meta: ANY.meta }),
    );
    env.render();
    expect(env.blog.listFlaggedComments).toHaveBeenCalled();
    expect(env.c.flaggedComments().length).toBe(1);
    expect(env.host.textContent).toContain('first bad');
  });

  it('resolveFlags calls the service, toasts success and reloads', () => {
    const env = makeEnv();
    env.blog.listFlaggedComments.and.returnValue(of({ items: [makeComment()], meta: ANY.meta }));
    env.render();
    env.blog.listFlaggedComments.calls.reset();

    env.c.resolveFlags(makeComment());
    expect(env.blog.resolveCommentFlagsAdmin).toHaveBeenCalledWith('cm-1');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.blog.moderation.success.flagsResolved');
    expect(env.blog.listFlaggedComments).toHaveBeenCalled();
  });

  it('resolveFlags failure surfaces an error toast and does not claim success', () => {
    const env = makeEnv();
    env.render();
    env.blog.resolveCommentFlagsAdmin.and.returnValue(throwError(() => new Error('boom')));
    env.c.resolveFlags(makeComment());
    expect(env.toast.error).toHaveBeenCalledWith('adminUi.blog.moderation.errors.resolveFlags');
    expect(env.toast.success).not.toHaveBeenCalled();
  });

  it('hide prompts for a reason and calls hideCommentAdmin(id, { reason })', () => {
    spyOn(window, 'prompt').and.returnValue('spam links');
    const env = makeEnv();
    env.render();
    env.c.toggleHide(makeComment({ is_hidden: false }));
    expect(env.blog.hideCommentAdmin).toHaveBeenCalledWith('cm-1', { reason: 'spam links' });
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.blog.moderation.success.commentHidden');
  });

  it('hide is aborted when the reason prompt is cancelled', () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const env = makeEnv();
    env.render();
    env.c.toggleHide(makeComment({ is_hidden: false }));
    expect(env.blog.hideCommentAdmin).not.toHaveBeenCalled();
  });

  it('unhide (already-hidden) calls unhideCommentAdmin(id) without prompting', () => {
    const promptSpy = spyOn(window, 'prompt');
    const env = makeEnv();
    env.render();
    env.c.toggleHide(makeComment({ is_hidden: true }));
    expect(promptSpy).not.toHaveBeenCalled();
    expect(env.blog.unhideCommentAdmin).toHaveBeenCalledWith('cm-1');
    expect(env.toast.success).toHaveBeenCalledWith(
      'adminUi.blog.moderation.success.commentUnhidden',
    );
  });

  it('delete confirms then calls deleteComment(id)', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const env = makeEnv();
    env.render();
    env.c.adminDeleteComment(makeComment());
    expect(env.blog.deleteComment).toHaveBeenCalledWith('cm-1');
    expect(env.toast.success).toHaveBeenCalledWith('adminUi.blog.moderation.success.commentDeleted');
  });

  it('delete is aborted when the confirm is dismissed', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const env = makeEnv();
    env.render();
    env.c.adminDeleteComment(makeComment());
    expect(env.blog.deleteComment).not.toHaveBeenCalled();
  });

  it('blogPosts() derives the blog.* subset from the shared content blocks', () => {
    const env = makeEnv();
    env.c.contentBlocks = [
      blogBlock({ key: 'blog.a' }),
      blogBlock({ key: 'page.about' }),
      blogBlock({ key: 'blog.b' }),
    ];
    env.render();
    const keys = env.c.blogPosts().map((p) => p.key);
    expect(keys).toEqual(['blog.a', 'blog.b']);
  });

  it('blogCreateSlug normalizes diacritics + punctuation', () => {
    const env = makeEnv();
    env.c.blogCreate.title = '  Ănță Test Post!  ';
    expect(env.c.blogCreateSlug()).toBe('anta-test-post');
  });

  it('blog draft helpers gate on a selected key', () => {
    const env = makeEnv();
    env.render();
    expect(env.c.blogDraftReady()).toBeFalse();
    expect(env.c.blogDraftDirty()).toBeFalse();
    env.c.restoreBlogDraftAutosave();
    env.c.dismissBlogDraftAutosave();

    env.c.selectedBlogKey = 'blog.x';
    const mgr = (env.c as any).ensureBlogDraft('blog.x', 'en');
    mgr.initFromServer((env.c as any).currentBlogDraftState());
    expect(env.c.blogDraftReady()).toBeTrue();
  });

  it('applies the ?edit= deep-link on init via loadBlogEditor', () => {
    const env = makeEnv('welcome');
    const load = spyOn<any>(env.c, 'loadBlogEditor').and.stub();
    env.render();
    expect(load).toHaveBeenCalledWith('blog.welcome');
  });

  it('reactive queryParams re-apply a fully-qualified blog edit key', () => {
    const env = makeEnv();
    const load = spyOn<any>(env.c, 'loadBlogEditor').and.stub();
    env.render();
    env.queryParams.next({ edit: 'blog.story' });
    expect(load).toHaveBeenCalledWith('blog.story');
  });
});
