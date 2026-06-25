import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { StorefrontAdminModeService } from './storefront-admin-mode.service';

const STORAGE_KEY = 'storefront_admin_edit_mode';

describe('StorefrontAdminModeService', () => {
  let auth: { isAdmin: jasmine.Spy; isImpersonating: jasmine.Spy };

  function configure(): StorefrontAdminModeService {
    TestBed.configureTestingModule({
      providers: [StorefrontAdminModeService, { provide: AuthService, useValue: auth }],
    });
    return TestBed.inject(StorefrontAdminModeService);
  }

  beforeEach(() => {
    localStorage.clear();
    auth = {
      isAdmin: jasmine.createSpy('isAdmin').and.returnValue(true),
      isImpersonating: jasmine.createSpy('isImpersonating').and.returnValue(false),
    };
  });

  afterEach(() => localStorage.clear());

  it('is available for a non-impersonating admin', () => {
    const service = configure();
    TestBed.flushEffects();
    expect(service.available()).toBeTrue();
  });

  it('is unavailable when impersonating', () => {
    auth.isImpersonating.and.returnValue(true);
    expect(configure().available()).toBeFalse();
  });

  it('restores a saved enabled state when available', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    expect(configure().enabled()).toBeTrue();
  });

  it('does not restore the saved state when unavailable', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    auth.isAdmin.and.returnValue(false);
    expect(configure().enabled()).toBeFalse();
  });

  it('enables and persists', () => {
    const service = configure();
    service.setEnabled(true);
    expect(service.enabled()).toBeTrue();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('disables and clears storage', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    const service = configure();
    service.setEnabled(false);
    expect(service.enabled()).toBeFalse();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores enable requests when unavailable', () => {
    auth.isAdmin.and.returnValue(false);
    const service = configure();
    service.setEnabled(true);
    expect(service.enabled()).toBeFalse();
  });

  it('toggles the current state', () => {
    const service = configure();
    service.toggle();
    expect(service.enabled()).toBeTrue();
    service.toggle();
    expect(service.enabled()).toBeFalse();
  });

  it('treats boolean auth flags (non-function) correctly', () => {
    auth = {
      isAdmin: true as unknown as jasmine.Spy,
      isImpersonating: false as unknown as jasmine.Spy,
    };
    expect(configure().available()).toBeTrue();
  });

  it('does not restore when the saved flag is not "1"', () => {
    localStorage.setItem(STORAGE_KEY, 'yes');
    expect(configure().enabled()).toBeFalse();
  });

  it('swallows errors thrown while reading saved state', () => {
    const getItem = spyOn(localStorage, 'getItem').and.throwError('blocked');
    expect(() => configure()).not.toThrow();
    expect(getItem).toHaveBeenCalled();
  });

  it('swallows errors thrown while persisting', () => {
    const service = configure();
    spyOn(localStorage, 'setItem').and.throwError('blocked');
    spyOn(localStorage, 'removeItem').and.throwError('blocked');
    expect(() => service.setEnabled(true)).not.toThrow();
    expect(() => service.setEnabled(false)).not.toThrow();
  });

  it('auto-disables via the effect when availability is lost', () => {
    const adminSig = signal(true);
    auth = {
      isAdmin: (() => adminSig()) as unknown as jasmine.Spy,
      isImpersonating: (() => false) as unknown as jasmine.Spy,
    };
    localStorage.setItem(STORAGE_KEY, '1');
    const service = configure();
    expect(service.enabled()).toBeTrue();

    adminSig.set(false);
    TestBed.flushEffects();

    expect(service.enabled()).toBeFalse();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('skips storage entirely when localStorage is unavailable (SSR guard)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => undefined });
    try {
      const service = configure();
      expect(service.enabled()).toBeFalse();
      expect(() => service.setEnabled(true)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
