import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';

import { ErrorHandlerService } from './error-handler.service';
import { ToastService } from '../core/toast.service';

describe('ErrorHandlerService', () => {
  let toastError: jasmine.Spy;
  let service: ErrorHandlerService;

  beforeEach(() => {
    toastError = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      providers: [
        ErrorHandlerService,
        { provide: ToastService, useValue: { error: toastError } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
    service = TestBed.inject(ErrorHandlerService);
  });

  function httpError(status: number): HttpErrorResponse {
    return new HttpErrorResponse({ status, statusText: 'x' });
  }

  it('is created', () => {
    expect(service).toBeTruthy();
  });

  it('shows a network toast for status 0', () => {
    service.handle(httpError(0));
    expect(toastError).toHaveBeenCalledWith('errors.network.title', 'errors.network.body');
  });

  it('shows an unauthorized toast for 401 and 403', () => {
    service.handle(httpError(401));
    service.handle(httpError(403));
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledWith(
      'errors.unauthorized.title',
      'errors.unauthorized.body',
    );
  });

  it('stays silent for 404', () => {
    service.handle(httpError(404));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('captures and toasts for 5xx errors', () => {
    service.handle(httpError(503));
    expect(toastError).toHaveBeenCalledWith('errors.server.title', 'errors.server.body');
  });

  it('stays silent for other 4xx errors', () => {
    service.handle(httpError(422));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('captures and toasts for non-http errors', () => {
    service.handle(new Error('boom'));
    expect(toastError).toHaveBeenCalledWith('errors.unexpected.title', 'errors.unexpected.body');
  });
});
