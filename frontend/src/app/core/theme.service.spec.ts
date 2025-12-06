import { ThemeService, ThemePreference } from './theme.service';

function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  spyOn(window, 'matchMedia').and.callFake(() => ({
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => listeners.push(cb),
    removeEventListener: () => {}
  } as unknown as MediaQueryList));
  return {
    emit(matches: boolean) {
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
    }
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
});
