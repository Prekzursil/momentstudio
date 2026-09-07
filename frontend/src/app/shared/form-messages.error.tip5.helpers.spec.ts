import { FormControl } from '@angular/forms';
import { FormMessagesService } from './form-messages.service';

/** Golden WU tip orphan — FormMessagesService.getError. */
describe('FormMessagesService getError (golden WU tip5)', () => {
  function bare(): FormMessagesService {
    return Object.create(FormMessagesService.prototype) as FormMessagesService;
  }

  it('maps common validation errors to messages', () => {
    const svc = bare();
    expect(FormMessagesService.prototype.getError.call(svc, null)).toBeNull();
    expect(FormMessagesService.prototype.getError.call(svc, new FormControl('', { validators: [] }))).toBeNull();

    const required = new FormControl('');
    required.setErrors({ required: true });
    expect(FormMessagesService.prototype.getError.call(svc, required)).toBe('This field is required.');

    const email = new FormControl('bad');
    email.setErrors({ email: true });
    expect(FormMessagesService.prototype.getError.call(svc, email)).toBe('Enter a valid email.');
  });
});
