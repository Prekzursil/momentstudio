import { AdminCmsStateService, CmsDraftManager } from './admin-cms-state.service';

/**
 * Behavioural coverage for the extracted AdminCmsStateService: the shared CMS
 * draft/autosave state that AdminComponent delegates to. Every test asserts
 * real behaviour (identity of cached managers, per-key/per-lang isolation,
 * storage side-effects, undo/redo/autosave transitions) rather than mere
 * invocation.
 */
describe('AdminCmsStateService', () => {
  let service: AdminCmsStateService;

  beforeEach(() => {
    localStorage.clear();
    service = new AdminCmsStateService();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('exposes a ready-to-init home draft manager', () => {
    expect(service.cmsHomeDraft).toBeInstanceOf(CmsDraftManager);
    expect(service.cmsHomeDraft.isReady()).toBe(false);
    service.cmsHomeDraft.initFromServer([]);
    expect(service.cmsHomeDraft.isReady()).toBe(true);
  });

  it('starts with empty page + blog draft registries', () => {
    expect(service.cmsPageDrafts.size).toBe(0);
    expect(service.cmsBlogDrafts.size).toBe(0);
  });

  describe('ensurePageDraft', () => {
    it('creates and caches a manager for a page key', () => {
      const mgr = service.ensurePageDraft('page.about');
      expect(mgr).toBeInstanceOf(CmsDraftManager);
      expect(service.cmsPageDrafts.get('page.about')).toBe(mgr);
      expect(service.cmsPageDrafts.size).toBe(1);
    });

    it('is idempotent for the same key (returns the cached instance)', () => {
      const first = service.ensurePageDraft('page.about');
      const second = service.ensurePageDraft('page.about');
      expect(second).toBe(first);
      expect(service.cmsPageDrafts.size).toBe(1);
    });

    it('returns distinct managers for distinct keys', () => {
      const a = service.ensurePageDraft('page.about');
      const b = service.ensurePageDraft('page.faq');
      expect(b).not.toBe(a);
      expect(service.cmsPageDrafts.size).toBe(2);
    });

    it('persists autosave under a page-scoped storage key', () => {
      const mgr = service.ensurePageDraft('page.about');
      mgr.initFromServer({
        blocks: [],
        status: 'draft',
        publishedAt: '',
        publishedUntil: '',
        requiresAuth: false,
      });
      mgr.markServerSaved(
        {
          blocks: [],
          status: 'published',
          publishedAt: '',
          publishedUntil: '',
          requiresAuth: false,
        },
        false,
      );
      expect(localStorage.getItem('adrianaart.cms.autosave.page.about')).toBeTruthy();
    });
  });

  describe('ensureBlogDraft', () => {
    it('creates and caches a manager per key + lang', () => {
      const mgr = service.ensureBlogDraft('blog.post', 'en');
      expect(mgr).toBeInstanceOf(CmsDraftManager);
      expect(service.cmsBlogDrafts.get('blog.post.en')).toBe(mgr);
    });

    it('is idempotent for the same key + lang', () => {
      const first = service.ensureBlogDraft('blog.post', 'ro');
      const second = service.ensureBlogDraft('blog.post', 'ro');
      expect(second).toBe(first);
      expect(service.cmsBlogDrafts.size).toBe(1);
    });

    it('isolates managers by language for the same key', () => {
      const en = service.ensureBlogDraft('blog.post', 'en');
      const ro = service.ensureBlogDraft('blog.post', 'ro');
      expect(ro).not.toBe(en);
      expect(service.cmsBlogDrafts.size).toBe(2);
      expect(service.cmsBlogDrafts.has('blog.post.en')).toBe(true);
      expect(service.cmsBlogDrafts.has('blog.post.ro')).toBe(true);
    });
  });

  describe('moved CmsDraftManager engine (via the service registries)', () => {
    function initBlog(): CmsDraftManager<{ title: string }> {
      const mgr = service.ensureBlogDraft('blog.engine', 'en') as unknown as CmsDraftManager<{
        title: string;
      }>;
      mgr.initFromServer({ title: 'server' });
      return mgr;
    }

    it('tracks dirty state and supports undo back to a prior present', () => {
      const mgr = initBlog();
      expect(mgr.dirty).toBe(false);
      // commit a change synchronously through undo's internal commit path
      const undone = mgr.undo({ title: 'edited' });
      expect(undone).toEqual({ title: 'server' });
      expect(mgr.dirty).toBe(false);
    });

    it('redoes a previously undone edit', () => {
      const mgr = initBlog();
      mgr.undo({ title: 'edited' });
      const redone = mgr.redo({ title: 'server' });
      expect(redone).toEqual({ title: 'edited' });
    });

    it('surfaces a restorable autosave candidate written by a prior session', () => {
      localStorage.setItem(
        'adrianaart.cms.autosave.blog.restore.en',
        JSON.stringify({ v: 1, ts: '2026-01-01T00:00:00.000Z', state_json: JSON.stringify({ title: 'auto' }) }),
      );
      const mgr = service.ensureBlogDraft('blog.restore', 'en') as unknown as CmsDraftManager<{
        title: string;
      }>;
      mgr.initFromServer({ title: 'server' });
      expect(mgr.hasRestorableAutosave).toBe(true);
      expect(mgr.restorableAutosaveAt).toBe('2026-01-01T00:00:00.000Z');
      const restored = mgr.restoreAutosave({ title: 'server' });
      expect(restored).toEqual({ title: 'auto' });
      expect(mgr.hasRestorableAutosave).toBe(false);
    });

    it('discards a restorable autosave and clears its storage entry', () => {
      const key = 'adrianaart.cms.autosave.blog.discard.en';
      localStorage.setItem(
        key,
        JSON.stringify({ v: 1, ts: '2026-01-01T00:00:00.000Z', state_json: JSON.stringify({ title: 'auto' }) }),
      );
      const mgr = service.ensureBlogDraft('blog.discard', 'en') as unknown as CmsDraftManager<{
        title: string;
      }>;
      mgr.initFromServer({ title: 'server' });
      expect(mgr.hasRestorableAutosave).toBe(true);
      mgr.discardAutosave();
      expect(mgr.hasRestorableAutosave).toBe(false);
      expect(localStorage.getItem(key)).toBeNull();
    });

    it('debounced observe commits pending state after the debounce window', (done) => {
      const mgr = initBlog();
      mgr.observe({ title: 'typing' });
      expect(mgr.autosavePending).toBe(true);
      setTimeout(() => {
        expect(mgr.autosavePending).toBe(false);
        expect(mgr.dirty).toBe(true);
        mgr.dispose();
        done();
      }, 750);
    });
  });
});
