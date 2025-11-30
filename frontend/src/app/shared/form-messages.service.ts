import { Injectable } from '@angular/core';
import { AbstractControl } from '@angular/forms';

@Injectable({ providedIn: 'root' })
export class FormMessagesService {
  getError(control: AbstractControl | null): string | null {
    if (!control || !control.errors) return null;
    const errors = control.errors;
    if (errors['required']) return 'This field is required.';
    if (errors['email']) return 'Enter a valid email.';
    if (errors['minlength']) return `Minimum length is ${errors['minlength'].requiredLength}.`;
    if (errors['maxlength']) return `Maximum length is ${errors['maxlength'].requiredLength}.`;
    if (errors['pattern']) return 'Value does not match the expected format.';
    return 'Invalid value.';
  }
}
