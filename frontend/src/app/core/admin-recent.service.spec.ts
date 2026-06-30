import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { AdminRecentService, AdminRecentItem, AdminRecentItemType } from './admin-recent.service';
import { AuthService } from './auth.service';

class AuthServiceStub {
  readonly userSignal: WritableSignal<{ id: string } | null> = signal<{ id: string } | null>(null);
  user = () => this.userSignal();
}

const STORAGE_BASE = 'admin_recent_v1';

function storageKey(userId: string): string {
  return `${STORAGE_BASE}:${userId}`;
}

function newItem(
  overrides: Partial<Omit<AdminRecentItem, 'viewed_at'>> = {},
): Omit<AdminRecentItem, 'viewed_at'> {
  return {
    key: 'k1',
    type: 'page' as AdminRecentItemType,
    label: 'Label 1',
    subtitle: 'Subtitle 1',
    url: '/admin/page',
    state: null,
    ...overrides,
  };
}

function storedItem(overrides: Partial<AdminRecentItem> = {}): AdminRecentItem {
  return {
    key: 'stored',
    type: 'order' as AdminRecentItemType,
    label: 'Stored',
    subtitle: 'sub',
    url: '/admin/order',
    state: null,
    viewed_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AdminRecentService', () => {
  let auth: AuthServiceStub;

  function setup(): AdminRecentService {
    auth = new AuthServiceStub();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: auth }, AdminRecentService],
    });
    return TestBed.inject(AdminRecentService);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts empty for an anonymous user (effect early-returns on the initial null user)', () => {
    const service = setup();
    TestBed.tick();
    expect(service.list()).toEqual([]);
    expect(service.items()).toEqual([]);
  });

  it('loads stored items into the signal when a user signs in', () => {
    localStorage.setItem(
      storageKey('u1'),
      JSON.stringify([storedItem({ key: 'a' }), storedItem({ key: 'b' })]),
    );
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();

    expect(service.list().map((it) => it.key)).toEqual(['a', 'b']);
    // The effect rewrites the canonical payload back to storage.
    const written = JSON.parse(localStorage.getItem(storageKey('u1')) || '[]');
    expect(written.length).toBe(2);
  });

  it('merges pending anonymous items with stored items on sign-in, deduping and dropping keyless entries', () => {
    // Pre-seed storage with a duplicate key, an empty-key entry, and a unique key.
    localStorage.setItem(
      storageKey('u1'),
      JSON.stringify([
        storedItem({ key: 'a', label: 'stored-a' }),
        storedItem({ key: '', label: 'keyless' }),
        storedItem({ key: 'b', label: 'stored-b' }),
      ]),
    );
    const service = setup();
    // First tick with the anonymous user, then add while anonymous -> goes to pending.
    TestBed.tick();
    service.add(newItem({ key: 'a', label: 'pending-a' }));

    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();

    const keys = service.list().map((it) => it.key);
    // 'a' kept from pending (front), duplicate 'a' from storage dropped, '' dropped, 'b' kept.
    expect(keys).toEqual(['a', 'b']);
    expect(service.list()[0].label).toBe('pending-a');
  });

  it('uses stored items directly when there are no pending items (empty-pending merge branch)', () => {
    localStorage.setItem(storageKey('u1'), JSON.stringify([storedItem({ key: 'only' })]));
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    expect(service.list().map((it) => it.key)).toEqual(['only']);
  });

  it('clears state and pending when the user signs out', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    service.add(newItem({ key: 'x' }));
    expect(service.list().length).toBe(1);

    auth.userSignal.set(null);
    TestBed.tick();
    expect(service.list()).toEqual([]);
  });

  it('ignores effect re-runs when the user id is unchanged', () => {
    const service = setup();
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    service.add(newItem({ key: 'keep' }));
    // Re-set to an equivalent (same id) user object -> effect runs but early-returns.
    auth.userSignal.set({ id: 'u1' });
    TestBed.tick();
    expect(service.list().map((it) => it.key)).toEqual(['keep']);
  });

  describe('add', () => {
    it('persists for a signed-in user and prepends new items', () => {
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();

      service.add(newItem({ key: 'first' }));
      service.add(newItem({ key: 'second' }));

      expect(service.list().map((it) => it.key)).toEqual(['second', 'first']);
      const written = JSON.parse(localStorage.getItem(storageKey('u1')) || '[]');
      expect(written.map((it: AdminRecentItem) => it.key)).toEqual(['second', 'first']);
    });

    it('buffers items in memory for anonymous users without writing storage', () => {
      const service = setup();
      TestBed.tick();
      service.add(newItem({ key: 'anon' }));
      expect(service.list().map((it) => it.key)).toEqual(['anon']);
      // Nothing written under any user key.
      expect(localStorage.length).toBe(0);
    });

    it('ignores items whose key is empty', () => {
      const service = setup();
      TestBed.tick();
      service.add(newItem({ key: '' }));
      expect(service.list()).toEqual([]);
    });

    it('falls back to the url for the label and to "/" for the url', () => {
      const service = setup();
      TestBed.tick();
      service.add(newItem({ key: 'lbl', label: '', subtitle: '', url: '/fallback' }));
      service.add(newItem({ key: 'urlkey', label: 'has-label', url: '' }));
      const lbl = service.list().find((it) => it.key === 'lbl');
      const urlkey = service.list().find((it) => it.key === 'urlkey');
      expect(lbl?.label).toBe('/fallback');
      // Empty subtitle falls back to an empty string rather than being dropped.
      expect(lbl?.subtitle).toBe('');
      expect(urlkey?.label).toBe('has-label');
      expect(urlkey?.url).toBe('/');
    });

    it('keeps object state and nulls out non-object state', () => {
      const service = setup();
      TestBed.tick();
      service.add(newItem({ key: 'withState', state: { a: 1 } }));
      service.add(
        newItem({ key: 'badState', state: 'nope' as unknown as Record<string, unknown> }),
      );
      const withState = service.list().find((it) => it.key === 'withState');
      const badState = service.list().find((it) => it.key === 'badState');
      expect(withState?.state).toEqual({ a: 1 });
      expect(badState?.state).toBeNull();
    });

    it('deduplicates by key, moving the re-added entry to the front', () => {
      const service = setup();
      TestBed.tick();
      service.add(newItem({ key: 'a' }));
      service.add(newItem({ key: 'b' }));
      service.add(newItem({ key: 'a', label: 'again' }));
      const list = service.list();
      expect(list.map((it) => it.key)).toEqual(['a', 'b']);
      expect(list[0].label).toBe('again');
    });

    it('caps the list at the maximum number of items', () => {
      const service = setup();
      TestBed.tick();
      for (let i = 0; i < 15; i++) {
        service.add(newItem({ key: `k${i}` }));
      }
      expect(service.list().length).toBe(12);
    });

    it('truncates over-long fields', () => {
      const service = setup();
      TestBed.tick();
      service.add(
        newItem({
          key: 'x'.repeat(200),
          label: 'l'.repeat(300),
          subtitle: 's'.repeat(400),
          url: `/${'u'.repeat(600)}`,
        }),
      );
      const item = service.list()[0];
      expect(item.key.length).toBe(128);
      expect(item.label.length).toBe(180);
      expect(item.subtitle.length).toBe(240);
      expect(item.url.length).toBe(500);
    });
  });

  describe('clear', () => {
    it('clears and writes empty storage for a signed-in user', () => {
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      service.add(newItem({ key: 'x' }));
      service.clear();
      expect(service.list()).toEqual([]);
      expect(localStorage.getItem(storageKey('u1'))).toBe('[]');
    });

    it('clears in-memory pending for an anonymous user', () => {
      const service = setup();
      TestBed.tick();
      service.add(newItem({ key: 'x' }));
      service.clear();
      expect(service.list()).toEqual([]);
      expect(localStorage.length).toBe(0);
    });
  });

  describe('read', () => {
    it('returns an empty list when stored JSON is not an array', () => {
      localStorage.setItem(storageKey('u1'), JSON.stringify({ not: 'array' }));
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      expect(service.list()).toEqual([]);
    });

    it('returns an empty list when stored JSON is invalid', () => {
      localStorage.setItem(storageKey('u1'), 'not-json{');
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      expect(service.list()).toEqual([]);
    });

    it('filters out structurally invalid stored entries', () => {
      localStorage.setItem(
        storageKey('u1'),
        JSON.stringify([
          null,
          'a string',
          { key: 123, type: 'page', label: 'l', url: '/u' },
          { key: 'k', type: 1, label: 'l', url: '/u' },
          { key: 'k', type: 'page', label: 2, url: '/u' },
          { key: 'k', type: 'page', label: 'l', url: 3 },
          storedItem({ key: 'good' }),
        ]),
      );
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      expect(service.list().map((it) => it.key)).toEqual(['good']);
    });

    it('caps stored entries at the maximum on read', () => {
      const many = Array.from({ length: 20 }, (_, i) => storedItem({ key: `s${i}` }));
      localStorage.setItem(storageKey('u1'), JSON.stringify(many));
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      expect(service.list().length).toBe(12);
    });
  });

  describe('storage access guards', () => {
    it('treats missing localStorage as no data and never throws on write', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      const service = setup();
      TestBed.tick();
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
      try {
        auth.userSignal.set({ id: 'u1' });
        // Effect runs read (readRaw -> undefined -> null) then write (writeRaw -> no-op).
        expect(() => TestBed.tick()).not.toThrow();
        expect(service.list()).toEqual([]);
        // add() also routes through writeRaw, which must be a silent no-op.
        expect(() => service.add(newItem({ key: 'noLs' }))).not.toThrow();
        expect(service.list().map((it) => it.key)).toEqual(['noLs']);
      } finally {
        if (original) Object.defineProperty(window, 'localStorage', original);
      }
    });

    it('treats an empty stored string as no data', () => {
      localStorage.setItem(storageKey('u1'), '');
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      expect(service.list()).toEqual([]);
    });

    it('falls back to an empty list when reading storage throws', () => {
      const service = setup();
      TestBed.tick();
      spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      expect(service.list()).toEqual([]);
    });

    it('ignores write failures for a signed-in user', () => {
      const service = setup();
      auth.userSignal.set({ id: 'u1' });
      TestBed.tick();
      spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
      expect(() => service.add(newItem({ key: 'wfail' }))).not.toThrow();
      expect(service.list().map((it) => it.key)).toEqual(['wfail']);
    });
  });
});
