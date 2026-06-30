import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';

import { unsavedChangesGuard, UnsavedChangesAware } from './unsaved-changes.guard';

describe('unsavedChangesGuard', () => {
  const translate = {
    instant: jasmine.createSpy('instant').and.callFake((key: string) => `translated:${key}`),
  };

  beforeEach(() => {
    translate.instant.calls.reset();
    TestBed.configureTestingModule({
      providers: [{ provide: TranslateService, useValue: translate }],
    });
  });

  function run(component: UnsavedChangesAware | null): boolean {
    return TestBed.runInInjectionContext(
      () =>
        unsavedChangesGuard(
          component as UnsavedChangesAware,
          {} as never,
          {} as never,
          {} as never,
        ) as boolean,
    );
  }

  it('allows navigation when the component is null (optional chaining short-circuits)', () => {
    const confirmSpy = spyOn(window, 'confirm');
    expect(run(null)).toBeTrue();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(translate.instant).not.toHaveBeenCalled();
  });

  it('allows navigation when the component has no hasUnsavedChanges method', () => {
    const confirmSpy = spyOn(window, 'confirm');
    expect(run({})).toBeTrue();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('allows navigation when hasUnsavedChanges returns false', () => {
    const confirmSpy = spyOn(window, 'confirm');
    const component: UnsavedChangesAware = {
      hasUnsavedChanges: () => false,
      discardUnsavedChanges: jasmine.createSpy('discard'),
    };

    expect(run(component)).toBeTrue();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(component.discardUnsavedChanges).not.toHaveBeenCalled();
  });

  it('discards changes and allows navigation when the user confirms', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const discard = jasmine.createSpy('discard');
    const component: UnsavedChangesAware = {
      hasUnsavedChanges: () => true,
      discardUnsavedChanges: discard,
    };

    expect(run(component)).toBeTrue();
    expect(translate.instant).toHaveBeenCalledWith('account.unsaved.confirmDiscard');
    expect(window.confirm).toHaveBeenCalledWith('translated:account.unsaved.confirmDiscard');
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('confirms without crashing when discardUnsavedChanges is absent', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const component: UnsavedChangesAware = {
      hasUnsavedChanges: () => true,
    };

    expect(run(component)).toBeTrue();
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('blocks navigation and does not discard when the user cancels', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const discard = jasmine.createSpy('discard');
    const component: UnsavedChangesAware = {
      hasUnsavedChanges: () => true,
      discardUnsavedChanges: discard,
    };

    expect(run(component)).toBeFalse();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });
});
