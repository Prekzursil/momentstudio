import { ThemeService, ThemePreference } from './theme.service';

function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  spyOn(window, 'matchMedia').and.callFake(
    () =>
      ({
        matches: prefersDark,
        media: '(prefers-color-scheme: dark)',
        addEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) =>
          listeners.push(cb),
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  return {
    emit(matches: boolean) {
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
    },
  };
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to system preference and applies dark class when system is dark', () => {
    const media = mockMatchMedia(true);
    const service = new ThemeService();
    expect(service.preference()()).toBe('system');
    expect(service.mode()()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBeTrue();
    media.emit(false);
    expect(service.mode()()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBeFalse();
  });

  it('honors saved preference from localStorage', () => {
    localStorage.setItem('theme', 'light');
    mockMatchMedia(true);
    const service = new ThemeService();
    expect(service.preference()()).toBe('light');
    expect(service.mode()()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBeFalse();
    service.setPreference('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(service.mode()()).toBe('dark');
  });

  it('cycles through system -> light -> dark with toggle', () => {
    mockMatchMedia(false);
    const service = new ThemeService();
    const seen: ThemePreference[] = [];
    ['system', 'light', 'dark'].forEach(() => {
      service.toggle();
      seen.push(service.preference()());
    });
    expect(seen).toEqual(['light', 'dark', 'system']);
  });

  it('creates, reuses, and removes the theme-color override meta', () => {
    document.getElementById('theme-color-override')?.remove();
    mockMatchMedia(false);
    const service = new ThemeService();

    // light -> creates a new meta tag with the light color
    service.setPreference('light');
    const meta = document.getElementById('theme-color-override') as HTMLMetaElement;
    expect(meta).not.toBeNull();
    expect(meta.content).toBe('#f8fafc');

    // dark -> reuses the existing meta tag and updates the color
    service.setPreference('dark');
    const reused = document.getElementById('theme-color-override') as HTMLMetaElement;
    expect(reused).toBe(meta);
    expect(reused.content).toBe('#0f172a');

    // system -> removes the override meta tag
    service.setPreference('system');
    expect(document.getElementById('theme-color-override')).toBeNull();
  });

  it('handles system preference with no existing override meta gracefully', () => {
    document.getElementById('theme-color-override')?.remove();
    mockMatchMedia(false);
    const service = new ThemeService();
    service.setPreference('system');
    expect(document.getElementById('theme-color-override')).toBeNull();
  });

  it('falls back to system when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    try {
      const service = new ThemeService();
      expect(service.preference()()).toBe('system');
      expect(service.mode()()).toBe('light');
    } finally {
      window.matchMedia = original;
    }
  });

  it('does not react to system changes once a fixed preference is set', () => {
    const media = mockMatchMedia(false);
    const service = new ThemeService();
    service.setPreference('light');
    media.emit(true);
    expect(service.mode()()).toBe('light');
  });

  it('reacts to a system change to dark while on system preference', () => {
    const media = mockMatchMedia(false);
    const service = new ThemeService();
    expect(service.mode()()).toBe('light');
    media.emit(true);
    expect(service.mode()()).toBe('dark');
  });

  it('defaults to system when localStorage is unavailable (SSR-style guard)', () => {
    mockMatchMedia(false);
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    try {
      const service = new ThemeService();
      expect(service.preference()()).toBe('system');
      expect(service.mode()()).toBe('light');
      // setPreference must also no-op its persistence branch when storage is gone.
      service.setPreference('dark');
      expect(service.mode()()).toBe('dark');
    } finally {
      if (original) {
        Object.defineProperty(window, 'localStorage', original);
      }
    }
  });

  it('ignores an unrecognized saved preference value', () => {
    localStorage.setItem('theme', 'not-a-real-theme');
    mockMatchMedia(false);
    const service = new ThemeService();
    expect(service.preference()()).toBe('system');
  });
});
