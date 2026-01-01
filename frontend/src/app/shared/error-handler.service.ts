import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ToastService } from '../core/toast.service';
import { captureException } from '../core/sentry';

@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {
  constructor(private toast: ToastService) {}

  handle(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401 || error.status === 403) {
        this.toast.error('Unauthorized', 'Please sign in to continue.');
        return;
      }
      if (error.status >= 500 && error.status < 600) {
        captureException(error);
        this.toast.error('Server error', 'Something went wrong. Please try again.');
        return;
      }
      this.toast.error('Request failed', error.message);
    } else {
      captureException(error);
      this.toast.error('Unexpected error', 'Please try again.');
    }
  }
}
