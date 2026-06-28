import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';

import { FormMessagesService } from './form-messages.service';

describe('FormMessagesService', () => {
  let service: FormMessagesService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FormMessagesService] });
    service = TestBed.inject(FormMessagesService);
  });

  function controlWithErrors(errors: Record<string, unknown>): FormControl {
    const control = new FormControl('');
    control.setErrors(errors);
    return control;
  }

  it('is created', () => {
    expect(service).toBeTruthy();
  });

  it('returns null when the control is null', () => {
    expect(service.getError(null)).toBeNull();
  });

  it('returns null when the control has no errors', () => {
    const control = new FormControl('value');
    expect(control.errors).toBeNull();
    expect(service.getError(control)).toBeNull();
  });

  it('returns the required message for a required error', () => {
    expect(service.getError(controlWithErrors({ required: true }))).toBe('This field is required.');
  });

  it('returns the email message for an email error', () => {
    expect(service.getError(controlWithErrors({ email: true }))).toBe('Enter a valid email.');
  });

  it('returns the minlength message including the required length', () => {
    const control = controlWithErrors({ minlength: { requiredLength: 8, actualLength: 3 } });
    expect(service.getError(control)).toBe('Minimum length is 8.');
  });

  it('returns the maxlength message including the required length', () => {
    const control = controlWithErrors({ maxlength: { requiredLength: 20, actualLength: 25 } });
    expect(service.getError(control)).toBe('Maximum length is 20.');
  });

  it('returns the pattern message for a pattern error', () => {
    const control = controlWithErrors({ pattern: { requiredPattern: '\\d+', actualValue: 'abc' } });
    expect(service.getError(control)).toBe('Value does not match the expected format.');
  });

  it('returns the generic fallback for an unrecognized error key', () => {
    expect(service.getError(controlWithErrors({ someCustomError: true }))).toBe('Invalid value.');
  });

  it('prefers required over other simultaneous errors', () => {
    const control = controlWithErrors({ required: true, email: true });
    expect(service.getError(control)).toBe('This field is required.');
  });
});
