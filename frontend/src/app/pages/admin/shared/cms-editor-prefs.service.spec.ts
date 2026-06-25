import { TestBed } from '@angular/core/testing';

import { AuthService } from '../../../core/auth.service';
import { CmsEditorPrefsService } from './cms-editor-prefs.service';

describe('CmsEditorPrefsService', () => {
  let user: jasmine.Spy;

  function configure(): CmsEditorPrefsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [CmsEditorPrefsService, { provide: AuthService, useValue: { user } }],
    });
    return TestBed.inject(CmsEditorPrefsService);
  }

  function keyFor(id: string): string {
    return `admin.content.editorMode.v1:${id}`;
  }

  beforeEach(() => {
    localStorage.clear();
    user = jasmine.createSpy('user').and.returnValue({ id: 'u1' });
  });

  afterEach(() => localStorage.clear());

  it('defaults to simple/desktop/stacked/en/light/single', () => {
    const s = configure();
    expect(s.mode()).toBe('simple');
    expect(s.previewDevice()).toBe('desktop');
    expect(s.previewLayout()).toBe('stacked');
    expect(s.previewLang()).toBe('en');
    expect(s.previewTheme()).toBe('light');
    expect(s.translationLayout()).toBe('single');
  });

  it('persists each setter and reloads them', () => {
    const s = configure();
    s.setMode('advanced');
    s.setPreviewDevice('mobile');
    s.setPreviewLayout('split');
    s.setPreviewLang('ro');
    s.setPreviewTheme('dark');
    s.setTranslationLayout('sideBySide');

    const reloaded = configure();
    expect(reloaded.mode()).toBe('advanced');
    expect(reloaded.previewDevice()).toBe('mobile');
    expect(reloaded.previewLayout()).toBe('split');
    expect(reloaded.previewLang()).toBe('ro');
    expect(reloaded.previewTheme()).toBe('dark');
    expect(reloaded.translationLayout()).toBe('sideBySide');
  });

  it('toggles between simple and advanced', () => {
    const s = configure();
    s.toggleMode();
    expect(s.mode()).toBe('advanced');
    s.toggleMode();
    expect(s.mode()).toBe('simple');
  });

  it('keys storage per user and falls back to anonymous', () => {
    user.and.returnValue({ id: 'u1' });
    configure().setMode('advanced');
    expect(localStorage.getItem(keyFor('u1'))).toContain('advanced');

    localStorage.clear();
    user.and.returnValue(null);
    configure().setMode('advanced');
    expect(localStorage.getItem(keyFor('anonymous'))).toContain('advanced');
  });

  it('ignores an empty stored payload', () => {
    localStorage.setItem(keyFor('u1'), '');
    expect(configure().mode()).toBe('simple');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(
      keyFor('u1'),
      JSON.stringify({
        mode: 'nope',
        previewDevice: 'nope',
        previewLayout: 'nope',
        previewLang: 'nope',
        previewTheme: 'nope',
        translationLayout: 'nope',
      }),
    );
    const s = configure();
    expect(s.mode()).toBe('simple');
    expect(s.previewDevice()).toBe('desktop');
    expect(s.translationLayout()).toBe('single');
  });

  it('swallows malformed JSON', () => {
    localStorage.setItem(keyFor('u1'), '{not json');
    expect(() => configure()).not.toThrow();
  });

  it('swallows persistence failures', () => {
    const s = configure();
    spyOn(localStorage, 'setItem').and.throwError('blocked');
    expect(() => s.setMode('advanced')).not.toThrow();
  });

  it('skips storage when localStorage is unavailable (SSR guard)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => undefined });
    try {
      const s = configure();
      expect(s.mode()).toBe('simple');
      expect(() => s.setMode('advanced')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
