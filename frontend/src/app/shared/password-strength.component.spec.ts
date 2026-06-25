import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PasswordStrengthComponent, computePasswordStrength } from './password-strength.component';

describe('PasswordStrengthComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), PasswordStrengthComponent],
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
    const emptyFixture = TestBed.createComponent(PasswordStrengthComponent);
    emptyFixture.componentInstance.password = '';
    emptyFixture.detectChanges();
    expect(emptyFixture.nativeElement.querySelector('input[type="range"]')).toBeFalsy();

    const filledFixture = TestBed.createComponent(PasswordStrengthComponent);
    filledFixture.componentInstance.password = 'Password1';
    filledFixture.detectChanges();
    expect(filledFixture.nativeElement.querySelector('input[type="range"]')).toBeTruthy();
  });

  it('treats a null/undefined password as empty', () => {
    expect(computePasswordStrength(null as unknown as string)).toBe('weak');
    expect(computePasswordStrength(undefined as unknown as string)).toBe('weak');
  });

  it('penalizes repeated-character passwords', () => {
    expect(computePasswordStrength('aaaaaaaaaaaaaaaa')).toBe('weak');
  });

  it('penalizes sequential-prefix passwords', () => {
    // Long + varied but starts with a known sequence -> -1 penalty.
    expect(computePasswordStrength('1234Abcd!xyz')).toBe('moderate');
  });

  it('exposes strong-tier value, label, and accent classes', () => {
    const fixture = TestBed.createComponent(PasswordStrengthComponent);
    const c = fixture.componentInstance;
    c.password = 'CorrectHorseBatteryStaple!1';
    expect(c.strengthValue()).toBe(2);
    expect(c.labelKey()).toBe('auth.strengthStrong');
    expect(c.labelClass()).toContain('emerald');
    expect(c.rangeClass()).toContain('emerald');
  });

  it('exposes moderate-tier value, label, and accent classes', () => {
    const fixture = TestBed.createComponent(PasswordStrengthComponent);
    const c = fixture.componentInstance;
    c.password = 'Password1';
    expect(c.strengthValue()).toBe(1);
    expect(c.labelKey()).toBe('auth.strengthModerate');
    expect(c.labelClass()).toContain('amber');
    expect(c.rangeClass()).toContain('amber');
  });

  it('exposes weak-tier value, label, and accent classes', () => {
    const fixture = TestBed.createComponent(PasswordStrengthComponent);
    const c = fixture.componentInstance;
    c.password = 'abc';
    expect(c.strengthValue()).toBe(0);
    expect(c.labelKey()).toBe('auth.strengthWeak');
    expect(c.labelClass()).toContain('rose');
    expect(c.rangeClass()).toContain('rose');
  });
});
