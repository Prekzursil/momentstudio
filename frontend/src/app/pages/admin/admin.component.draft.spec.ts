import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';

import { AdminComponent } from './admin.component';

/**
 * Behavioural coverage for the self-contained CmsDraftManager (undo/redo +
 * autosave engine) reached through AdminComponent, plus the small pure helper
 * surface. Every test asserts real observable behaviour (state transitions,
 * localStorage side-effects, debounce timing), not mere invocation.
 */
describe('AdminComponent CmsDraftManager + pure helpers', () => {
  const HOME_KEY = 'adrianaart.cms.autosave.home.sections';

  type RouteStub = {
    snapshot: { data: Record<string, unknown>; queryParams: Record<string, unknown> };
    data: Subject<Record<string, unknown>>;
    queryParams: Subject<Record<string, unknown>>;
  };

  function createComponent(): {
    component: AdminComponent;
    cmsPrefs: { mode: jasmine.Spy; previewDevice: jasmine.Spy; previewLayout: jasmine.Spy };
    translateInstant: jasmine.Spy;
  } {
    const routeStub: RouteStub = {
      snapshot: { data: { section: 'home' }, queryParams: {} },
      data: new Subject(),
      queryParams: new Subject(),
    };
    const cmsPrefs = {
      mode: jasmine.createSpy('mode').and.returnValue('basic'),
      previewDevice: jasmine.createSpy('previewDevice').and.returnValue('desktop'),
      previewLayout: jasmine.createSpy('previewLayout').and.returnValue('stacked'),
    };
    const translateInstant = jasmine
      .createSpy('instant')
      .and.callFake((key: string) => key);
    const component = new AdminComponent(
      {
        snapshot: routeStub.snapshot,
        data: routeStub.data.asObservable(),
        queryParams: routeStub.queryParams.asObservable(),
      } as unknown as ActivatedRoute,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      cmsPrefs as any,
      jasmine.createSpyObj('ToastService', ['success', 'error']) as any,
      { instant: translateInstant } as any,
      { render: (value: string) => value } as any,
      { bypassSecurityTrustHtml: (value: string) => value } as unknown as DomSanitizer,
    );
    return { component, cmsPrefs, translateInstant };
  }

  // CmsDraftManager is module-private; reach a fresh instance via ensurePageDraft
  // (keyed on the page) and the home draft field. Generic <T> is erased at runtime.
  function freshManager(component: AdminComponent): any {
    return (component as any).ensurePageDraft('cms-draft-test');
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('lifecycle / init', () => {
    it('is not ready before init and reports no restorable autosave', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      expect(mgr.isReady()).toBe(false);
      expect(mgr.hasRestorableAutosave).toBe(false);
      expect(mgr.restorableAutosaveAt).toBeNull();
    });

    it('initFromServer marks ready and seeds server snapshot with no restore candidate', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      expect(mgr.isReady()).toBe(true);
      expect(mgr.dirty).toBe(false);
      expect(mgr.hasRestorableAutosave).toBe(false);
      expect(mgr.lastAutosavedAt).toBeNull();
    });

    it('initFromServer surfaces a divergent localStorage autosave as a restore candidate', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      const storageKey = 'adrianaart.cms.autosave.cms-draft-test';
      localStorage.setItem(
        storageKey,
        JSON.stringify({ v: 1, ts: '2024-01-01T00:00:00.000Z', state_json: JSON.stringify({ a: 99 }) }),
      );
      mgr.initFromServer({ a: 1 });
      expect(mgr.hasRestorableAutosave).toBe(true);
      expect(mgr.restorableAutosaveAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('initFromServer drops an autosave equal to the server snapshot (and clears storage)', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      const storageKey = 'adrianaart.cms.autosave.cms-draft-test';
      localStorage.setItem(
        storageKey,
        JSON.stringify({ v: 1, ts: '2024-01-01T00:00:00.000Z', state_json: JSON.stringify({ a: 1 }) }),
      );
      mgr.initFromServer({ a: 1 });
      expect(mgr.hasRestorableAutosave).toBe(false);
      expect(localStorage.getItem(storageKey)).toBeNull();
    });
  });

  describe('readAutosaveCandidate guards', () => {
    const storageKey = 'adrianaart.cms.autosave.cms-draft-test';

    it('ignores wrong-version envelopes', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      localStorage.setItem(storageKey, JSON.stringify({ v: 2, ts: 't', state_json: 's' }));
      mgr.initFromServer({ a: 1 });
      expect(mgr.hasRestorableAutosave).toBe(false);
    });

    it('ignores envelopes missing ts or state_json', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      localStorage.setItem(storageKey, JSON.stringify({ v: 1, ts: '', state_json: '' }));
      mgr.initFromServer({ a: 1 });
      expect(mgr.hasRestorableAutosave).toBe(false);
    });

    it('ignores corrupt (non-JSON) storage payloads', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      localStorage.setItem(storageKey, '{not json');
      mgr.initFromServer({ a: 1 });
      expect(mgr.hasRestorableAutosave).toBe(false);
    });

    it('ignores a literal null payload', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      localStorage.setItem(storageKey, 'null');
      mgr.initFromServer({ a: 1 });
      expect(mgr.hasRestorableAutosave).toBe(false);
    });
  });

  describe('observe + debounced commit', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('does nothing when not initialised', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.observe({ a: 2 });
      expect(mgr.autosavePending).toBe(false);
      expect(mgr.dirty).toBe(false);
    });

    it('flags dirty + pending on a divergent change then commits to history after debounce', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      mgr.observe({ a: 2 });
      expect(mgr.dirty).toBe(true);
      expect(mgr.autosavePending).toBe(true);
      expect(mgr.canUndo({ a: 2 })).toBe(true);

      jasmine.clock().tick(700);
      expect(mgr.autosavePending).toBe(false);
      const stored = JSON.parse(localStorage.getItem('adrianaart.cms.autosave.cms-draft-test')!);
      expect(JSON.parse(stored.state_json)).toEqual({ a: 2 });
    });

    it('is a no-op when the observed state already matches present', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      mgr.observe({ a: 1 });
      expect(mgr.autosavePending).toBe(false);
    });

    it('commitPending with no queued change just clears the pending flag', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      mgr.observe({ a: 2 });
      mgr.autosavePending = true;
      (mgr as any).pending = null;
      (mgr as any).commitPending();
      expect(mgr.autosavePending).toBe(false);
    });

    it('commitPending ignores a queued value identical to present', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      (mgr as any).pending = JSON.stringify({ a: 1 });
      (mgr as any).commitPending();
      expect((mgr as any).past.length).toBe(0);
    });
  });

  describe('undo / redo', () => {
    it('returns null when undo/redo invoked before init', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      expect(mgr.undo({ a: 1 })).toBeNull();
      expect(mgr.redo({ a: 1 })).toBeNull();
      expect(mgr.canUndo({ a: 1 })).toBe(false);
      expect(mgr.canRedo({ a: 1 })).toBe(false);
    });

    it('undo restores the prior committed state and redo re-applies it', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ step: 0 });
      mgr.markServerSaved({ step: 1 }, false);
      const undone = mgr.undo({ step: 1 });
      expect(undone).toEqual({ step: 0 });
      expect(mgr.canRedo({ step: 0 })).toBe(true);
      const redone = mgr.redo({ step: 0 });
      expect(redone).toEqual({ step: 1 });
    });

    it('undo returns null when there is no history to pop', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ step: 0 });
      expect(mgr.undo({ step: 0 })).toBeNull();
    });

    it('redo returns null when the future stack is empty', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ step: 0 });
      mgr.markServerSaved({ step: 1 }, false);
      mgr.undo({ step: 1 });
      mgr.redo({ step: 0 });
      expect(mgr.redo({ step: 1 })).toBeNull();
    });

    it('canRedo is false while the current state diverges from present', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ step: 0 });
      mgr.markServerSaved({ step: 1 }, false);
      mgr.undo({ step: 1 });
      expect(mgr.canRedo({ step: 9 })).toBe(false);
    });

    it('trims history beyond the configured limit', () => {
      const { component } = createComponent();
      const mgr = (component as any).ensurePageDraft('trim-test');
      // tiny limit via direct opts override on the private instance
      (mgr as any).opts = { debounceMs: 0, limit: 2 };
      mgr.initFromServer({ n: 0 });
      for (let n = 1; n <= 5; n++) mgr.markServerSaved({ n }, false);
      expect((mgr as any).past.length).toBe(2);
    });
  });

  describe('autosave restore / discard / save', () => {
    const storageKey = 'adrianaart.cms.autosave.cms-draft-test';

    it('restoreAutosave returns null before init', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      expect(mgr.restoreAutosave({ a: 1 })).toBeNull();
    });

    it('restoreAutosave returns null when there is no candidate', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      expect(mgr.restoreAutosave({ a: 1 })).toBeNull();
    });

    it('restoreAutosave applies a divergent candidate and clears it', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      localStorage.setItem(
        storageKey,
        JSON.stringify({ v: 1, ts: '2024-02-02T00:00:00.000Z', state_json: JSON.stringify({ a: 42 }) }),
      );
      mgr.initFromServer({ a: 1 });
      const restored = mgr.restoreAutosave({ a: 1 });
      expect(restored).toEqual({ a: 42 });
      expect(mgr.hasRestorableAutosave).toBe(false);
      expect(mgr.lastAutosavedAt).toBe('2024-02-02T00:00:00.000Z');
    });

    it('restoreAutosave returns null when the candidate equals the current edited state', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      localStorage.setItem(
        storageKey,
        JSON.stringify({ v: 1, ts: '2024-02-02T00:00:00.000Z', state_json: JSON.stringify({ a: 7 }) }),
      );
      mgr.initFromServer({ a: 1 });
      expect(mgr.restoreAutosave({ a: 7 })).toBeNull();
      expect(mgr.hasRestorableAutosave).toBe(false);
    });

    it('discardAutosave removes storage and the restore candidate', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      localStorage.setItem(
        storageKey,
        JSON.stringify({ v: 1, ts: 't', state_json: JSON.stringify({ a: 5 }) }),
      );
      mgr.initFromServer({ a: 1 });
      mgr.discardAutosave();
      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(mgr.hasRestorableAutosave).toBe(false);
    });

    it('markServerSaved before init is a no-op', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.markServerSaved({ a: 1 });
      expect(mgr.isReady()).toBe(false);
    });

    it('markServerSaved clears the autosave by default', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      mgr.observe({ a: 2 });
      mgr.markServerSaved({ a: 2 });
      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(mgr.dirty).toBe(false);
    });

    it('writeAutosave swallows localStorage failures', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      const setItem = spyOn(Storage.prototype, 'setItem').and.throwError('quota');
      expect(() => mgr.initFromServer({ a: 1 })).not.toThrow();
      mgr.markServerSaved({ a: 2 }, false);
      expect(setItem).toHaveBeenCalled();
    });

    it('clearAutosave swallows localStorage failures', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      spyOn(Storage.prototype, 'removeItem').and.throwError('boom');
      expect(() => mgr.discardAutosave()).not.toThrow();
    });

    it('dispose clears any pending commit timer', () => {
      const { component } = createComponent();
      const mgr = freshManager(component);
      mgr.initFromServer({ a: 1 });
      mgr.observe({ a: 2 });
      expect(() => mgr.dispose()).not.toThrow();
    });
  });

  describe('component-level draft wiring', () => {
    it('hasUnsavedChanges reflects a dirty home draft', () => {
      const { component } = createComponent();
      expect(component.hasUnsavedChanges()).toBe(false);
      const home = (component as any).cmsHomeDraft;
      home.initFromServer([]);
      home.observe([{ id: 'x' }]);
      expect(component.hasUnsavedChanges()).toBe(true);
    });

    it('hasUnsavedChanges reflects a dirty page draft', () => {
      const { component } = createComponent();
      const page = (component as any).ensurePageDraft('home');
      page.initFromServer({ blocks: [] });
      page.observe({ blocks: [{ id: 'p' }] });
      expect(component.hasUnsavedChanges()).toBe(true);
    });

    it('hasUnsavedChanges reflects a dirty blog draft', () => {
      const { component } = createComponent();
      const blog = (component as any).ensureBlogDraft('blog.post', 'en');
      blog.initFromServer({ title: '' });
      blog.observe({ title: 'changed' });
      expect(component.hasUnsavedChanges()).toBe(true);
    });

    it('discardUnsavedChanges discards every ready draft', () => {
      const { component } = createComponent();
      const home = (component as any).cmsHomeDraft;
      home.initFromServer([]);
      home.observe([{ id: 'x' }]);
      const page = (component as any).ensurePageDraft('home');
      page.initFromServer({ blocks: [] });
      const blog = (component as any).ensureBlogDraft('blog.post', 'en');
      blog.initFromServer({ title: '' });
      component.discardUnsavedChanges();
      expect(localStorage.getItem(HOME_KEY)).toBeNull();
    });

    it('ensurePageDraft is idempotent for a given key', () => {
      const { component } = createComponent();
      const first = (component as any).ensurePageDraft('about');
      const second = (component as any).ensurePageDraft('about');
      expect(first).toBe(second);
    });

    it('ensureBlogDraft is idempotent for a given key + lang', () => {
      const { component } = createComponent();
      const first = (component as any).ensureBlogDraft('blog.post', 'ro');
      const second = (component as any).ensureBlogDraft('blog.post', 'ro');
      expect(first).toBe(second);
    });

    it('home draft accessor methods proxy the underlying manager', () => {
      const { component } = createComponent();
      expect(component.homeDraftReady()).toBe(false);
      expect(component.homeDraftDirty()).toBe(false);
      expect(component.homeDraftAutosaving()).toBe(false);
      expect(component.homeDraftLastAutosavedAt()).toBeNull();
      expect(component.homeDraftHasRestore()).toBe(false);
      expect(component.homeDraftRestoreAt()).toBeNull();
      expect(component.homeDraftCanUndo()).toBe(false);
      expect(component.homeDraftCanRedo()).toBe(false);
      const home = (component as any).cmsHomeDraft;
      home.initFromServer([]);
      expect(component.homeDraftReady()).toBe(true);
    });

    it('blogDraftId composes key and language', () => {
      const { component } = createComponent();
      expect((component as any).blogDraftId('blog.post', 'en')).toBe('blog.post.en');
    });

    it('ngOnDestroy disposes drafts and clears version map without throwing', () => {
      const { component } = createComponent();
      (component as any).ensurePageDraft('home').initFromServer({ blocks: [] });
      (component as any).ensureBlogDraft('blog.post', 'en').initFromServer({ title: '' });
      (component as any).contentVersions = { 'home.hero': 3 };
      expect(() => component.ngOnDestroy()).not.toThrow();
      expect((component as any).contentVersions).toEqual({});
    });
  });

  describe('pure helpers', () => {
    it('normalizeSection passes valid sections through and defaults to home', () => {
      const { component } = createComponent();
      const norm = (v: unknown) => (component as any).normalizeSection(v);
      expect(norm('home')).toBe('home');
      expect(norm('pages')).toBe('pages');
      expect(norm('blog')).toBe('blog');
      expect(norm('settings')).toBe('settings');
      expect(norm('bogus')).toBe('home');
      expect(norm(undefined)).toBe('home');
    });

    it('cmsAdvanced reflects the prefs mode', () => {
      const { component, cmsPrefs } = createComponent();
      expect(component.cmsAdvanced()).toBe(false);
      cmsPrefs.mode.and.returnValue('advanced');
      expect(component.cmsAdvanced()).toBe(true);
    });

    it('cmsPreviewMaxWidthClass maps each device to a width class', () => {
      const { component, cmsPrefs } = createComponent();
      cmsPrefs.previewDevice.and.returnValue('mobile');
      expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[390px]');
      cmsPrefs.previewDevice.and.returnValue('tablet');
      expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[768px]');
      cmsPrefs.previewDevice.and.returnValue('desktop');
      expect(component.cmsPreviewMaxWidthClass()).toBe('max-w-[1024px]');
    });

    it('cmsPreviewViewportWidth maps each device to a pixel width', () => {
      const { component, cmsPrefs } = createComponent();
      cmsPrefs.previewDevice.and.returnValue('mobile');
      expect(component.cmsPreviewViewportWidth()).toBe(390);
      cmsPrefs.previewDevice.and.returnValue('tablet');
      expect(component.cmsPreviewViewportWidth()).toBe(768);
      cmsPrefs.previewDevice.and.returnValue('desktop');
      expect(component.cmsPreviewViewportWidth()).toBe(1024);
    });

    it('fxAuditActionLabel returns the raw action when no translation exists', () => {
      const { component } = createComponent();
      expect(component.fxAuditActionLabel('OVERRIDE')).toBe('OVERRIDE');
    });

    it('fxAuditActionLabel returns the translation when one is registered', () => {
      const { component, translateInstant } = createComponent();
      translateInstant.and.callFake((key: string) =>
        key === 'adminUi.fx.audit.actions.override' ? 'Overridden' : key,
      );
      expect(component.fxAuditActionLabel('Override')).toBe('Overridden');
    });

    it('loadAll / retryLoadAll delegate to loadForSection for the active section', () => {
      const { component } = createComponent();
      const loadForSection = spyOn<any>(component, 'loadForSection').and.stub();
      component.retryLoadAll();
      expect(loadForSection).toHaveBeenCalledWith('home');
    });

    it('syncSplitScroll bails out when the preview layout is not split', () => {
      const { component, cmsPrefs } = createComponent();
      cmsPrefs.previewLayout.and.returnValue('stacked');
      const src = { scrollHeight: 200, clientHeight: 100, scrollTop: 50 } as HTMLElement;
      const tgt = { scrollHeight: 200, clientHeight: 100, scrollTop: 0 } as HTMLElement;
      component.syncSplitScroll(src, tgt);
      expect(tgt.scrollTop).toBe(0);
    });

    it('syncSplitScroll mirrors scroll ratio when layout is split', () => {
      const { component, cmsPrefs } = createComponent();
      cmsPrefs.previewLayout.and.returnValue('split');
      const src = { scrollHeight: 300, clientHeight: 100, scrollTop: 100 } as HTMLElement;
      const tgt = { scrollHeight: 500, clientHeight: 100, scrollTop: 0 } as HTMLElement;
      component.syncSplitScroll(src, tgt);
      // ratio = 100 / (300-100) = 0.5 -> target scrollable 400 -> 200
      expect(tgt.scrollTop).toBe(200);
    });

    it('syncSplitScroll bails out when either pane is not scrollable', () => {
      const { component, cmsPrefs } = createComponent();
      cmsPrefs.previewLayout.and.returnValue('split');
      const src = { scrollHeight: 100, clientHeight: 100, scrollTop: 0 } as HTMLElement;
      const tgt = { scrollHeight: 500, clientHeight: 100, scrollTop: 0 } as HTMLElement;
      component.syncSplitScroll(src, tgt);
      expect(tgt.scrollTop).toBe(0);
    });
  });
});
