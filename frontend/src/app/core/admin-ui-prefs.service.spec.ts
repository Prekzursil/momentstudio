import { TestBed } from '@angular/core/testing';

import { AdminUiPrefsService } from './admin-ui-prefs.service';
import { AuthService, AuthUser } from './auth.service';

describe('AdminUiPrefsService', () => {
  let currentUser: AuthUser | null;
  let authStub: { user: () => AuthUser | null };

  function makeUser(id: string): AuthUser {
    return { id, email: 'a@b.c', username: 'u', role: 'admin' };
  }

  function configure(): void {
    authStub = { user: () => currentUser };
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: authStub }, AdminUiPrefsService],
    });
  }

  function create(): AdminUiPrefsService {
    return TestBed.inject(AdminUiPrefsService);
  }

  beforeEach(() => {
    localStorage.clear();
    currentUser = null;
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('storageKey', () => {
    it('uses the user id when present', () => {
      currentUser = makeUser('user-42');
      configure();
      const service = create();

      service.setSidebarCompact(true);

      const raw = localStorage.getItem('admin.ui.mode.v1:user-42');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string).sidebarCompact).toBe(true);
    });

    it('falls back to anonymous when the user id is blank', () => {
      currentUser = makeUser('   ');
      configure();
      const service = create();

      service.setSidebarCompact(true);

      expect(localStorage.getItem('admin.ui.mode.v1:anonymous')).not.toBeNull();
    });

    it('falls back to anonymous when there is no user', () => {
      currentUser = null;
      configure();
      const service = create();

      service.setSidebarCompact(true);

      expect(localStorage.getItem('admin.ui.mode.v1:anonymous')).not.toBeNull();
    });
  });

  describe('load (constructor)', () => {
    it('keeps defaults when nothing is stored', () => {
      configure();
      const service = create();

      expect(service.mode()).toBe('simple');
      expect(service.preset()).toBe('custom');
      expect(service.sidebarCompact()).toBe(false);
    });

    it('restores advanced/custom/true values from storage', () => {
      localStorage.setItem(
        'admin.ui.mode.v1:anonymous',
        JSON.stringify({ mode: 'advanced', preset: 'custom', sidebarCompact: true }),
      );
      configure();
      const service = create();

      expect(service.mode()).toBe('advanced');
      expect(service.preset()).toBe('custom');
      expect(service.sidebarCompact()).toBe(true);
    });

    it('forces simple mode when the stored preset is owner_basic', () => {
      localStorage.setItem(
        'admin.ui.mode.v1:anonymous',
        JSON.stringify({ mode: 'advanced', preset: 'owner_basic', sidebarCompact: false }),
      );
      configure();
      const service = create();

      expect(service.preset()).toBe('owner_basic');
      expect(service.mode()).toBe('simple');
    });

    it('ignores invalid stored field values', () => {
      localStorage.setItem(
        'admin.ui.mode.v1:anonymous',
        JSON.stringify({ mode: 'nope', preset: 'nope', sidebarCompact: 'nope' }),
      );
      configure();
      const service = create();

      expect(service.mode()).toBe('simple');
      expect(service.preset()).toBe('custom');
      expect(service.sidebarCompact()).toBe(false);
    });

    it('ignores malformed JSON without throwing', () => {
      localStorage.setItem('admin.ui.mode.v1:anonymous', '{not json');
      configure();

      expect(() => create()).not.toThrow();
      const service = create();
      expect(service.mode()).toBe('simple');
    });

    it('returns early when localStorage is unavailable', () => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
      try {
        configure();
        const service = create();
        expect(service.mode()).toBe('simple');
        expect(service.preset()).toBe('custom');
      } finally {
        if (descriptor) {
          Object.defineProperty(window, 'localStorage', descriptor);
        } else {
          delete (window as { localStorage?: unknown }).localStorage;
        }
      }
    });
  });

  describe('setPreset', () => {
    it('switching to owner_basic forces simple mode and persists', () => {
      configure();
      const service = create();
      service.setMode('advanced');

      service.setPreset('owner_basic');

      expect(service.preset()).toBe('owner_basic');
      expect(service.mode()).toBe('simple');
      const raw = JSON.parse(localStorage.getItem('admin.ui.mode.v1:anonymous') as string);
      expect(raw.preset).toBe('owner_basic');
      expect(raw.mode).toBe('simple');
    });

    it('switching to custom keeps the current mode', () => {
      configure();
      const service = create();

      service.setPreset('custom');

      expect(service.preset()).toBe('custom');
      expect(service.mode()).toBe('simple');
    });
  });

  describe('setMode', () => {
    it('switching a non-custom preset to advanced resets the preset to custom', () => {
      configure();
      const service = create();
      service.setPreset('owner_basic');

      service.setMode('advanced');

      expect(service.preset()).toBe('custom');
      expect(service.mode()).toBe('advanced');
    });

    it('keeps a non-custom preset when switching to simple', () => {
      configure();
      const service = create();
      service.setPreset('owner_basic');

      service.setMode('simple');

      expect(service.preset()).toBe('owner_basic');
      expect(service.mode()).toBe('simple');
    });

    it('keeps a custom preset when switching to advanced', () => {
      configure();
      const service = create();

      service.setMode('advanced');

      expect(service.preset()).toBe('custom');
      expect(service.mode()).toBe('advanced');
    });
  });

  describe('sidebar compact', () => {
    it('sets and persists the sidebar compact value', () => {
      configure();
      const service = create();

      service.setSidebarCompact(true);
      expect(service.sidebarCompact()).toBe(true);

      service.setSidebarCompact(false);
      expect(service.sidebarCompact()).toBe(false);
    });

    it('toggles the sidebar compact value', () => {
      configure();
      const service = create();

      service.toggleSidebarCompact();
      expect(service.sidebarCompact()).toBe(true);

      service.toggleSidebarCompact();
      expect(service.sidebarCompact()).toBe(false);
    });
  });

  describe('toggleMode', () => {
    it('flips between simple and advanced', () => {
      configure();
      const service = create();

      service.toggleMode();
      expect(service.mode()).toBe('advanced');

      service.toggleMode();
      expect(service.mode()).toBe('simple');
    });
  });

  describe('persist', () => {
    it('does not throw when localStorage.setItem fails', () => {
      configure();
      const service = create();
      spyOn(localStorage, 'setItem').and.throwError('quota');

      expect(() => service.setMode('advanced')).not.toThrow();
      expect(service.mode()).toBe('advanced');
    });

    it('returns early when localStorage is unavailable', () => {
      configure();
      const service = create();

      const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
      try {
        expect(() => service.setMode('advanced')).not.toThrow();
        expect(service.mode()).toBe('advanced');
      } finally {
        if (descriptor) {
          Object.defineProperty(window, 'localStorage', descriptor);
        } else {
          delete (window as { localStorage?: unknown }).localStorage;
        }
      }
    });
  });
});
