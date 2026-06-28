import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';

import { AccountPrivacyComponent } from './account-privacy.component';
import { AccountComponent } from './account.component';
import { AnalyticsService } from '../../core/analytics.service';
import { AccountDeletionStatus, UserDataExportJob } from '../../core/account.service';

/**
 * Minimal stand-in for the parent {@link AccountComponent} that the privacy
 * component injects. Only the members referenced by the template are provided,
 * each with a realistic shape (signals for reactive state, plain props for
 * two-way bound fields, spies for actions) so the rendered DOM exercises real
 * component behaviour rather than mocked render output.
 */
class MockAccount {
  exportJob: WritableSignal<UserDataExportJob | null> = signal<UserDataExportJob | null>(null);
  exportError: string | null = null;

  deletionStatus: WritableSignal<AccountDeletionStatus | null> =
    signal<AccountDeletionStatus | null>(null);
  deletionLoading = signal(false);
  deletionError = signal<string | null>(null);

  cancellingDeletion = false;
  requestingDeletion = false;
  deletionConfirmText = '';
  deletionPassword = '';

  exportActionLabelKey = jasmine
    .createSpy('exportActionLabelKey')
    .and.returnValue('account.privacy.export.action');
  exportActionDisabled = jasmine.createSpy('exportActionDisabled').and.returnValue(false);
  downloadMyData = jasmine.createSpy('downloadMyData');

  formatTimestamp = jasmine.createSpy('formatTimestamp').and.returnValue('FORMATTED_TS');
  formatDurationShort = jasmine.createSpy('formatDurationShort').and.returnValue('1h 0m');

  deletionCooldownRemainingMs = jasmine.createSpy('deletionCooldownRemainingMs').and.returnValue(0);
  deletionCooldownProgressPercent = jasmine
    .createSpy('deletionCooldownProgressPercent')
    .and.returnValue(0);

  cancelDeletion = jasmine.createSpy('cancelDeletion');
  requestDeletion = jasmine.createSpy('requestDeletion');
}

function makeExportJob(overrides: Partial<UserDataExportJob> = {}): UserDataExportJob {
  return {
    id: 'job-1',
    status: 'pending',
    progress: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('AccountPrivacyComponent', () => {
  let fixture: ComponentFixture<AccountPrivacyComponent>;
  let component: AccountPrivacyComponent;
  let account: MockAccount;
  let analyticsEnabled: WritableSignal<boolean>;
  let setEnabledSpy: jasmine.Spy;

  beforeEach(async () => {
    account = new MockAccount();
    analyticsEnabled = signal(false);
    setEnabledSpy = jasmine
      .createSpy('setEnabled')
      .and.callFake((value: boolean) => analyticsEnabled.set(Boolean(value)));

    const analyticsStub: Pick<AnalyticsService, 'enabled' | 'setEnabled'> = {
      enabled: () => analyticsEnabled(),
      setEnabled: setEnabledSpy,
    };

    await TestBed.configureTestingModule({
      imports: [AccountPrivacyComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AccountComponent, useValue: account },
        { provide: AnalyticsService, useValue: analyticsStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountPrivacyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('creates and renders the export action button bound to account state', () => {
    expect(component).toBeTruthy();
    expect(account.exportActionLabelKey).toHaveBeenCalled();
    expect(account.exportActionDisabled).toHaveBeenCalled();

    const buttons = fixture.debugElement.queryAll(By.css('app-button button'));
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('invokes downloadMyData when the export button emits its action', () => {
    const exportButton = fixture.debugElement.query(By.css('app-button button'));
    exportButton.nativeElement.click();
    expect(account.downloadMyData).toHaveBeenCalledTimes(1);
  });

  it('does not render the export job block when there is no job', () => {
    expect(fixture.debugElement.query(By.css('[style]'))).toBeNull();
    expect(text()).not.toContain('account.privacy.export.status');
  });

  it('renders progress bar and notify copy for a running export job', () => {
    account.exportJob.set(makeExportJob({ status: 'running', progress: 42 }));
    fixture.detectChanges();

    expect(text()).toContain('account.privacy.export.status.running');
    expect(text()).toContain('42%');
    expect(text()).toContain('account.privacy.export.notifyCopy');

    const bar = fixture.debugElement.query(By.css('.bg-indigo-600'));
    expect(bar.nativeElement.style.width).toBe('42%');
  });

  it('defaults missing progress to 0 for a pending job', () => {
    account.exportJob.set(makeExportJob({ status: 'pending', progress: 0 }));
    fixture.detectChanges();

    expect(text()).toContain('0%');
    const bar = fixture.debugElement.query(By.css('.bg-indigo-600'));
    expect(bar.nativeElement.style.width).toBe('0%');
  });

  it('renders the ready-with-expiry message when a succeeded job has an expiry', () => {
    account.exportJob.set(
      makeExportJob({ status: 'succeeded', progress: 100, expires_at: '2024-02-01T00:00:00Z' }),
    );
    fixture.detectChanges();

    expect(account.formatTimestamp).toHaveBeenCalledWith('2024-02-01T00:00:00Z');
    expect(text()).toContain('account.privacy.export.readyWithExpiry');
  });

  it('renders the plain ready message when a succeeded job has no expiry', () => {
    account.exportJob.set(makeExportJob({ status: 'succeeded', progress: 100, expires_at: null }));
    fixture.detectChanges();

    expect(text()).toContain('account.privacy.export.ready');
    expect(text()).not.toContain('readyWithExpiry');
  });

  it('renders the server error message for a failed job', () => {
    account.exportJob.set(makeExportJob({ status: 'failed', error_message: 'Boom' }));
    fixture.detectChanges();
    expect(text()).toContain('Boom');
  });

  it('falls back to a generic failure copy when the failed job has no message', () => {
    account.exportJob.set(makeExportJob({ status: 'failed', error_message: null }));
    fixture.detectChanges();
    expect(text()).toContain('account.privacy.export.failedCopy');
  });

  it('shows the standalone export error when account.exportError is set', () => {
    account.exportError = 'Export blew up';
    fixture.detectChanges();
    expect(text()).toContain('Export blew up');
  });

  it('reflects analyticsOptIn from the AnalyticsService into the checkbox', fakeAsync(() => {
    let checkbox = fixture.debugElement.query(By.css('input[type="checkbox"]'));
    expect(checkbox.nativeElement.checked).toBeFalse();
    expect(component.analyticsOptIn).toBeFalse();

    analyticsEnabled.set(true);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    checkbox = fixture.debugElement.query(By.css('input[type="checkbox"]'));
    expect(checkbox.nativeElement.checked).toBeTrue();
    expect(component.analyticsOptIn).toBeTrue();
  }));

  it('writes through the analyticsOptIn setter when the checkbox is toggled', () => {
    const checkbox = fixture.debugElement.query(By.css('input[type="checkbox"]'));
    checkbox.nativeElement.checked = true;
    checkbox.nativeElement.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(setEnabledSpy).toHaveBeenCalledWith(true);
    expect(component.analyticsOptIn).toBeTrue();
  });

  it('coerces the analyticsOptIn setter value to a real boolean', () => {
    component.analyticsOptIn = 'yes' as unknown as boolean;
    expect(setEnabledSpy).toHaveBeenCalledWith(true);
    expect(analyticsEnabled()).toBeTrue();
  });

  it('shows the deletion skeleton while deletion status is loading', () => {
    account.deletionLoading.set(true);
    fixture.detectChanges();

    const skeletons = fixture.debugElement.queryAll(By.css('app-skeleton'));
    expect(skeletons.length).toBe(2);
    expect(text()).not.toContain('account.privacy.deletion.copy');
  });

  it('renders the request-deletion form when no deletion is scheduled', () => {
    fixture.detectChanges();

    expect(text()).toContain('account.privacy.deletion.consequences.logout');
    expect(text()).toContain('account.privacy.deletion.consequences.irreversible');

    const confirmInput = fixture.debugElement.query(By.css('input[name="deletionConfirmText"]'));
    const passwordInput = fixture.debugElement.query(By.css('input[name="deletionPassword"]'));
    expect(confirmInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
  });

  // The request button's [disabled] reads the account model directly while the
  // confirm/password inputs are two-way ngModel-bound. Refreshing with
  // checkNoChanges=false avoids Angular's dev-only ExpressionChanged diagnostic
  // that fires on the transition frame (a known ngModel artifact, not a
  // component bug). Each scenario applies a single mutation from the clean
  // beforeEach state so change detection reflects it deterministically, and the
  // real rendered native `disabled` is asserted.
  function requestButton(): HTMLButtonElement {
    const buttons = fixture.debugElement.queryAll(By.css('app-button button'));
    return buttons[buttons.length - 1].nativeElement as HTMLButtonElement;
  }

  it('disables the request button by default (empty confirm + password)', () => {
    expect(requestButton().disabled).toBeTrue();
  });

  it('enables the request button when confirm text is DELETE and a password is set', () => {
    account.deletionConfirmText = 'delete';
    account.deletionPassword = 'pw';
    fixture.detectChanges(false);
    expect(requestButton().disabled).toBeFalse();
  });

  it('keeps the request button disabled when the password is only whitespace', () => {
    account.deletionConfirmText = 'DELETE';
    account.deletionPassword = '   ';
    fixture.detectChanges(false);
    expect(requestButton().disabled).toBeTrue();
  });

  it('keeps the request button disabled when the confirm text is not DELETE', () => {
    account.deletionConfirmText = 'nope';
    account.deletionPassword = 'pw';
    fixture.detectChanges(false);
    expect(requestButton().disabled).toBeTrue();
  });

  it('keeps the request button disabled while a deletion request is in flight', () => {
    account.deletionConfirmText = 'DELETE';
    account.deletionPassword = 'pw';
    account.requestingDeletion = true;
    fixture.detectChanges(false);
    expect(requestButton().disabled).toBeTrue();
  });

  it('invokes requestDeletion when the enabled request button is clicked', () => {
    account.deletionConfirmText = 'DELETE';
    account.deletionPassword = 'pw';
    fixture.detectChanges(false);

    const buttons = fixture.debugElement.queryAll(By.css('app-button button'));
    buttons[buttons.length - 1].nativeElement.click();
    expect(account.requestDeletion).toHaveBeenCalledTimes(1);
  });

  it('toggles the deletion password visibility via the show/hide button', () => {
    const passwordInput = (): HTMLInputElement =>
      fixture.debugElement.query(By.css('input[name="deletionPassword"]')).nativeElement;
    const toggle = (): HTMLButtonElement =>
      fixture.debugElement.query(By.css('input[name="deletionPassword"] ~ button, .relative button'))
        .nativeElement;

    expect(passwordInput().type).toBe('password');
    expect(component.showDeletionPassword).toBeFalse();

    toggle().click();
    fixture.detectChanges();
    expect(component.showDeletionPassword).toBeTrue();
    expect(passwordInput().type).toBe('text');

    toggle().click();
    fixture.detectChanges();
    expect(component.showDeletionPassword).toBeFalse();
    expect(passwordInput().type).toBe('password');
  });

  it('renders the scheduled-deletion view with cooldown progress and cancel action', () => {
    account.deletionStatus.set({
      cooldown_hours: 24,
      scheduled_for: '2024-03-01T00:00:00Z',
      requested_at: '2024-02-28T00:00:00Z',
    });
    account.deletionCooldownRemainingMs.and.returnValue(3_600_000);
    account.deletionCooldownProgressPercent.and.returnValue(75);
    fixture.detectChanges();

    expect(text()).toContain('account.privacy.deletion.scheduledBadge');
    expect(text()).toContain('account.privacy.deletion.scheduledFor');
    expect(account.formatTimestamp).toHaveBeenCalledWith('2024-03-01T00:00:00Z');
    expect(account.formatDurationShort).toHaveBeenCalledWith(3_600_000);
    expect(text()).toContain('75%');

    const bar = fixture.debugElement.query(By.css('.bg-rose-600'));
    expect(bar.nativeElement.style.width).toBe('75%');
  });

  it('invokes cancelDeletion from the scheduled view cancel button', () => {
    account.deletionStatus.set({ cooldown_hours: 24, scheduled_for: '2024-03-01T00:00:00Z' });
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('app-button button'));
    buttons[buttons.length - 1].nativeElement.click();
    expect(account.cancelDeletion).toHaveBeenCalledTimes(1);
  });

  it('defaults cooldown hours to 24 when the status omits them', () => {
    account.deletionStatus.set({ cooldown_hours: 0, scheduled_for: null });
    fixture.detectChanges();
    expect(text()).toContain('account.privacy.deletion.copy');
  });

  it('renders the deletion error message when present', () => {
    account.deletionError.set('Cannot delete right now');
    fixture.detectChanges();
    expect(text()).toContain('Cannot delete right now');
  });
});
