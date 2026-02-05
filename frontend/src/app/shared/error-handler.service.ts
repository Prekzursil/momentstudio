import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ToastService } from '../core/toast.service';
import { captureException } from '../core/sentry';

@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {
  constructor(private toast: ToastService) {}

  handle(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        this.toast.error('Network error', 'Please check your connection and try again.');
        return;
      }
      if (error.status === 401 || error.status === 403) {
        this.toast.error('Unauthorized', 'Please sign in to continue.');
        return;
      }
      if (error.status === 404) {
        return;
      }
      if (error.status >= 500 && error.status < 600) {
        captureException(error);
        this.toast.error('Server error', 'Something went wrong. Please try again.');
        return;
      }
      // 4xx errors are typically handled by the calling page (form validation, etc.).
      // Avoid noisy duplicate global toasts that obscure the real, contextual error message.
      return;
    } else {
      captureException(error);
      this.toast.error('Unexpected error', 'Please try again.');
    }
  }
}
