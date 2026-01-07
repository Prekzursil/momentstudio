import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PasswordStrengthComponent, computePasswordStrength } from './password-strength.component';

describe('PasswordStrengthComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), PasswordStrengthComponent]
    });
  });

  it('computes password strength with basic heuristics', () => {
    expect(computePasswordStrength('')).toBe('weak');
    expect(computePasswordStrength('12345')).toBe('weak');
    expect(computePasswordStrength('123456')).toBe('weak');
    expect(computePasswordStrength('Password1')).toBe('moderate');
    expect(computePasswordStrength('CorrectHorseBatteryStaple!1')).toBe('strong');
  });

  it('renders strength meter only when password has content', () => {
    const fixture = TestBed.createComponent(PasswordStrengthComponent);
    const cmp = fixture.componentInstance;
    cmp.password = '';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="range"]')).toBeFalsy();

    cmp.password = 'Password1';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="range"]')).toBeTruthy();
  });
});
