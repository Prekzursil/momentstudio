import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ToastService } from '../core/toast.service';
import { captureException } from '../core/sentry';
import { TranslateService } from '@ngx-translate/core';

@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {
  constructor(private readonly toast: ToastService, private translate: TranslateService) {}

  handle(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        this.toast.error(
          this.translate.instant('errors.network.title'),
          this.translate.instant('errors.network.body')
        );
        return;
      }
      if (error.status === 401 || error.status === 403) {
        this.toast.error(
          this.translate.instant('errors.unauthorized.title'),
          this.translate.instant('errors.unauthorized.body')
        );
        return;
      }
      if (error.status === 404) {
        return;
      }
      if (error.status >= 500 && error.status < 600) {
        captureException(error);
        this.toast.error(
          this.translate.instant('errors.server.title'),
          this.translate.instant('errors.server.body')
        );
        return;
      }
      // 4xx errors are typically handled by the calling page (form validation, etc.).
      // Avoid noisy duplicate global toasts that obscure the real, contextual error message.
      return;
    } else {
      captureException(error);
      this.toast.error(
        this.translate.instant('errors.unexpected.title'),
        this.translate.instant('errors.unexpected.body')
      );
    }
  }
}

