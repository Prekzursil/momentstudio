import { inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

export type UnsavedChangesAware = {
  hasUnsavedChanges?: () => boolean;
  discardUnsavedChanges?: () => void;
};

export const unsavedChangesGuard: CanDeactivateFn<UnsavedChangesAware> = (component) => {
  const hasUnsavedChanges = component?.hasUnsavedChanges?.() ?? false;
  if (!hasUnsavedChanges) return true;
  const translate = inject(TranslateService);
  const ok = confirm(translate.instant('account.unsaved.confirmDiscard'));
  if (ok) {
    component?.discardUnsavedChanges?.();
  }
  return ok;
};
