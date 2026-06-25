import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { LanguageService } from './language.service';

interface AuthStub {
  user: jasmine.Spy;
  isAuthenticated: jasmine.Spy;
  updatePreferredLanguage: jasmine.Spy;
}

describe('LanguageService', () => {
  let translate: {
    addLangs: jasmine.Spy;
    setDefaultLang: jasmine.Spy;
    use: jasmine.Spy;
    getBrowserLang: jasmine.Spy;
    instant: jasmine.Spy;
  };
  let auth: AuthStub;
  let toast: { error: jasmine.Spy };

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        LanguageService,
        { provide: TranslateService, useValue: translate },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });
  }

  beforeEach(() => {
    localStorage.clear();
    translate = {
      addLangs: jasmine.createSpy('addLangs'),
      setDefaultLang: jasmine.createSpy('setDefaultLang'),
      use: jasmine.createSpy('use'),
      getBrowserLang: jasmine.createSpy('getBrowserLang').and.returnValue('en'),
      instant: jasmine.createSpy('instant').and.callFake((k: string) => k),
    };
    auth = {
      user: jasmine.createSpy('user').and.returnValue(null),
      isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(false),
      updatePreferredLanguage: jasmine
        .createSpy('updatePreferredLanguage')
        .and.returnValue(of(null)),
    };
    toast = { error: jasmine.createSpy('error') };
  });

  afterEach(() => localStorage.clear());

  it('prefers the user preferred language', () => {
    auth.user.and.returnValue({ preferred_language: 'ro' });
    configure();
    TestBed.inject(LanguageService);
    expect(translate.use).toHaveBeenCalledWith('ro');
    expect(document.documentElement.lang).toBe('ro');
  });

  it('falls back to the saved language', () => {
    localStorage.setItem('lang', 'ro');
    configure();
    expect(TestBed.inject(LanguageService).language()).toBe('ro');
  });

  it('normalizes an explicit english saved language', () => {
    localStorage.setItem('lang', 'en');
    translate.getBrowserLang.and.returnValue('ro');
    configure();
    expect(TestBed.inject(LanguageService).language()).toBe('en');
  });

  it('ignores localStorage when it is unavailable (SSR guard)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => undefined });
    try {
      configure();
      expect(TestBed.inject(LanguageService).language()).toBe('en');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('falls back to the romanian browser language', () => {
    translate.getBrowserLang.and.returnValue('ro');
    configure();
    expect(TestBed.inject(LanguageService).language()).toBe('ro');
  });

  it('defaults to english when nothing matches', () => {
    translate.getBrowserLang.and.returnValue('fr');
    configure();
    expect(TestBed.inject(LanguageService).language()).toBe('en');
  });

  it('persists and syncs the backend when authenticated', () => {
    auth.isAuthenticated.and.returnValue(true);
    configure();
    const service = TestBed.inject(LanguageService);
    service.setLanguage('ro');
    expect(localStorage.getItem('lang')).toBe('ro');
    expect(auth.updatePreferredLanguage).toHaveBeenCalledWith('ro');
  });

  it('does not persist or sync when opted out', () => {
    auth.isAuthenticated.and.returnValue(true);
    configure();
    const service = TestBed.inject(LanguageService);
    auth.updatePreferredLanguage.calls.reset();
    service.setLanguage('ro', { persist: false, syncBackend: false });
    expect(localStorage.getItem('lang')).toBeNull();
    expect(auth.updatePreferredLanguage).not.toHaveBeenCalled();
  });

  it('swallows errors when the document language cannot be set', () => {
    configure();
    const service = TestBed.inject(LanguageService);
    const original = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(document.documentElement),
      'lang',
    );
    Object.defineProperty(document.documentElement, 'lang', {
      configurable: true,
      set: () => {
        throw new Error('frozen');
      },
    });
    try {
      expect(() => service.setLanguage('ro')).not.toThrow();
    } finally {
      delete (document.documentElement as unknown as Record<string, unknown>)['lang'];
      if (original)
        Object.defineProperty(Object.getPrototypeOf(document.documentElement), 'lang', original);
    }
  });

  it('toasts an error when the backend sync fails', () => {
    auth.isAuthenticated.and.returnValue(true);
    auth.updatePreferredLanguage.and.returnValue(throwError(() => new Error('nope')));
    configure();
    TestBed.inject(LanguageService).setLanguage('ro');
    expect(toast.error).toHaveBeenCalledWith(
      'auth.languageNotSaved',
      'auth.languageNotSavedDetail',
    );
  });
});
