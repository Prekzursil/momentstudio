import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';

import { AdminComponent } from './admin.component';

type RouteStub = {
  snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
  data: Subject<Record<string, unknown>>;
  queryParams: Subject<Record<string, unknown>>;
};

function createRouteStub(section: string): RouteStub {
  return {
    snapshot: { data: { section }, queryParams: {} },
    data: new Subject<Record<string, unknown>>(),
    queryParams: new Subject<Record<string, unknown>>(),
  };
}

function createComponent(): AdminComponent {
  const routeStub = createRouteStub('content');
  const admin = jasmine.createSpyObj('AdminService', ['content']);

  const component = new AdminComponent(
    {
      snapshot: routeStub.snapshot,
      data: routeStub.data.asObservable(),
      queryParams: routeStub.queryParams.asObservable(),
    } as unknown as ActivatedRoute,
    admin as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    jasmine.createSpyObj('ToastService', ['success', 'error']) as any,
    { instant: (key: string) => key } as any,
    { render: (value: string) => value } as any,
    { bypassSecurityTrustHtml: (value: string) => value } as unknown as DomSanitizer
  );

  return component;
}

describe('AdminComponent coverage wave 6', () => {
  it('exercises home draft manager observe/undo/redo lifecycle', () => {
    const component = createComponent() as any;
    const storageKey = 'adrianaart.cms.autosave.home.sections';
    const draft = component.cmsHomeDraft;
    globalThis.localStorage.removeItem(storageKey);

    draft.initFromServer([]);
    draft.observe([{ key: 'hero', type: 'hero' }]);
    draft['commitPending']();

    expect(draft.isReady()).toBeTrue();
    expect(draft.canUndo([{ key: 'hero', type: 'hero' }])).toBeTrue();
    expect(Array.isArray(draft.undo([{ key: 'hero', type: 'hero' }]))).toBeTrue();
    expect(Array.isArray(draft.redo([]))).toBeTrue();

    draft.markServerSaved([], true);
    draft.discardAutosave();
    draft.dispose();
  });

  it('restores autosave payloads and clears invalid persisted entries', () => {
    const component = createComponent() as any;
    const storageKey = 'adrianaart.cms.autosave.home.sections';
    const autosaveState = JSON.stringify([{ key: 'restored', type: 'text' }]);

    globalThis.localStorage.setItem(
      storageKey,
      JSON.stringify({ v: 1, ts: '2026-03-03T00:00:00.000Z', state_json: autosaveState })
    );
    component.cmsHomeDraft.initFromServer([]);

    expect(component.cmsHomeDraft.hasRestorableAutosave).toBeTrue();
    expect(component.homeDraftHasRestore()).toBeTrue();
    const restored = component.cmsHomeDraft.restoreAutosave([]);
    expect((restored as any[])[0].key).toBe('restored');

    globalThis.localStorage.setItem(storageKey, '{invalid-json');
    component.cmsHomeDraft.initFromServer([]);
    expect(component.cmsHomeDraft.hasRestorableAutosave).toBeFalse();
  });

  it('updates cms announcements and page draft snapshots', () => {
    const component = createComponent() as any;
    spyOn(globalThis, 'setTimeout').and.callFake(((fn: unknown) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    }) as any);

    component.announceCms('cms.ready');
    expect(component.cmsAriaAnnouncement).toBe('cms.ready');

    component.pageBlocks = {};
    component.pageBlocksStatus = {};
    component.pageBlocksPublishedAt = {};
    component.pageBlocksPublishedUntil = {};
    component.pageBlocksRequiresAuth = {};
    component.pageBlocksKey = 'home';
    component.applyPageDraftState('home', {
      blocks: [{ key: 'b1', type: 'text', layout: 'content' }],
      status: 'review',
      publishedAt: '2026-03-03T00:00:00.000Z',
      publishedUntil: '',
      requiresAuth: true,
    });
    const pageDraft = component.currentPageDraftState('home');
    expect(pageDraft.status).toBe('review');
    expect(pageDraft.requiresAuth).toBeTrue();
  });

  it('exposes blog draft restore wrappers', () => {
    const component = createComponent() as any;
    component.selectedBlogKey = 'blog.sample';
    component.blogEditLang = 'en';
    component.blogForm = {
      title: 'Sample',
      body_markdown: 'Body',
      status: 'draft',
      published_at: '',
      published_until: '',
      summary: '',
      tags: '',
      series: '',
      cover_image_url: '',
      cover_fit: 'cover',
      reading_time_minutes: '',
      pinned: false,
      pin_order: '',
    };

    const blogStorageKey = 'adrianaart.cms.autosave.blog.sample.en';
    const autosaveBlogState = JSON.stringify({
      ...component.currentBlogDraftState(),
      title: 'Restored sample title',
    });
    globalThis.localStorage.setItem(
      blogStorageKey,
      JSON.stringify({ v: 1, ts: '2026-03-03T00:00:00.000Z', state_json: autosaveBlogState })
    );

    const manager = component.ensureBlogDraft('blog.sample', 'en');
    manager.initFromServer(component.currentBlogDraftState());
    component.observeCmsDrafts();

    expect(component.blogDraftReady()).toBeTrue();
    expect(component.blogDraftAutosaving()).toBeFalse();
    expect(component.blogDraftLastAutosavedAt()).toBeNull();
    expect(component.blogDraftHasRestore()).toBeTrue();
    expect(component.blogDraftRestoreAt()).toBe('2026-03-03T00:00:00.000Z');

    component.restoreBlogDraftAutosave();
    component.dismissBlogDraftAutosave();
  });
});
