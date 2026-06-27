import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AccountSecurityComponent } from './account-security.component';
import { AccountComponent } from './account.component';

/**
 * AccountSecurityComponent is a thin presentational shell: it injects the host
 * AccountComponent and owns eight boolean "show password" flags. The real
 * behaviour lives in the template's (click) handlers that flip those flags
 * (toggling the bound <input type> between "password" and "text"). These tests
 * provide a fully-shaped AccountComponent stub, render the template in the two
 * mutually-exclusive 2FA states, and exercise every visibility toggle through
 * the DOM so the assertions reflect what a user actually sees.
 */

type AccountStub = Record<string, unknown>;

function createAccountStub(overrides: AccountStub = {}): AccountComponent {
  const base: AccountStub = {
    // --- signals (read as functions in the template) ---
    loading: () => false,
    passkeys: () => [],
    passkeysSupported: () => true,
    passkeysLoading: () => false,
    passkeysError: () => null,
    twoFactorStatus: () => null,
    twoFactorLoading: () => false,
    twoFactorError: () => null,
    googleEmail: () => null,
    googlePicture: () => null,
    sessionsLoading: () => false,
    sessionsError: () => null,
    sessions: () => [],
    otherSessionsCount: () => 0,
    securityEventsLoading: () => false,
    securityEventsError: () => null,
    securityEvents: () => [],
    emailCooldownSeconds: () => 0,
    emailVerified: () => true,
    idleWarning: () => null,
    secondaryEmailsError: () => null,
    secondaryEmailsLoading: () => false,
    secondaryEmails: () => [],
    profile: () => ({ email: 'primary@example.com' }),

    // --- methods ---
    secondaryEmailResendRemainingSeconds: () => 0,
    formatCooldown: (seconds: number) => `${seconds}s`,
    copyTwoFactorRecoveryCodes: jasmine.createSpy('copyTwoFactorRecoveryCodes'),
    regenerateTwoFactorRecoveryCodes: jasmine.createSpy('regenerateTwoFactorRecoveryCodes'),
    disableTwoFactor: jasmine.createSpy('disableTwoFactor'),
    copyTwoFactorSecret: jasmine.createSpy('copyTwoFactorSecret'),
    copyTwoFactorSetupUrl: jasmine.createSpy('copyTwoFactorSetupUrl'),
    enableTwoFactor: jasmine.createSpy('enableTwoFactor'),
    startTwoFactorSetup: jasmine.createSpy('startTwoFactorSetup'),
    startRemovePasskey: jasmine.createSpy('startRemovePasskey'),
    confirmRemovePasskey: jasmine.createSpy('confirmRemovePasskey'),
    cancelRemovePasskey: jasmine.createSpy('cancelRemovePasskey'),
    registerPasskey: jasmine.createSpy('registerPasskey'),
    addSecondaryEmail: jasmine.createSpy('addSecondaryEmail'),
    resendSecondaryEmailVerification: jasmine.createSpy('resendSecondaryEmailVerification'),
    startSecondaryEmailVerification: jasmine.createSpy('startSecondaryEmailVerification'),
    confirmSecondaryEmailVerification: jasmine.createSpy('confirmSecondaryEmailVerification'),
    cancelSecondaryEmailVerification: jasmine.createSpy('cancelSecondaryEmailVerification'),
    startMakePrimary: jasmine.createSpy('startMakePrimary'),
    confirmMakePrimary: jasmine.createSpy('confirmMakePrimary'),
    cancelMakePrimary: jasmine.createSpy('cancelMakePrimary'),
    startDeleteSecondaryEmail: jasmine.createSpy('startDeleteSecondaryEmail'),
    confirmDeleteSecondaryEmail: jasmine.createSpy('confirmDeleteSecondaryEmail'),
    cancelDeleteSecondaryEmail: jasmine.createSpy('cancelDeleteSecondaryEmail'),
    startRevokeOtherSessions: jasmine.createSpy('startRevokeOtherSessions'),
    confirmRevokeOtherSessions: jasmine.createSpy('confirmRevokeOtherSessions'),
    cancelRevokeOtherSessions: jasmine.createSpy('cancelRevokeOtherSessions'),
    refreshSecurityEvents: jasmine.createSpy('refreshSecurityEvents'),
    refreshSession: jasmine.createSpy('refreshSession'),
    signOut: jasmine.createSpy('signOut'),
    linkGoogle: jasmine.createSpy('linkGoogle'),
    unlinkGoogle: jasmine.createSpy('unlinkGoogle'),

    // --- plain (ngModel / direct read) properties ---
    twoFactorRecoveryCodes: [] as string[],
    twoFactorManagePassword: '',
    twoFactorManageCode: '',
    regeneratingTwoFactorCodes: false,
    disablingTwoFactor: false,
    twoFactorSetupSecret: null,
    twoFactorSetupUrl: null,
    twoFactorSetupQrDataUrl: null,
    twoFactorEnableCode: '',
    enablingTwoFactor: false,
    twoFactorSetupPassword: '',
    startingTwoFactor: false,
    removePasskeyConfirmId: null,
    removingPasskeyId: null,
    removePasskeyPassword: '',
    registeringPasskey: false,
    passkeyRegisterName: '',
    passkeyRegisterPassword: '',
    secondaryEmailToAdd: '',
    addingSecondaryEmail: false,
    secondaryEmailMessage: null,
    removeSecondaryEmailId: null,
    removingSecondaryEmail: false,
    removeSecondaryEmailPassword: '',
    secondaryVerificationEmailId: null,
    verifyingSecondaryEmail: false,
    secondaryVerificationToken: '',
    secondaryVerificationStatus: null,
    makePrimarySecondaryEmailId: null,
    makingPrimaryEmail: false,
    makePrimaryPassword: '',
    makePrimaryError: null,
    googlePassword: '',
    googleError: null,
    googleBusy: false,
    googleLinkPending: false,
    revokeOtherSessionsConfirming: false,
    revokingOtherSessions: false,
    revokeOtherSessionsPassword: '',
  };
  return { ...base, ...overrides } as unknown as AccountComponent;
}

function render(stub: AccountComponent) {
  TestBed.configureTestingModule({
    imports: [RouterTestingModule, TranslateModule.forRoot(), AccountSecurityComponent],
    providers: [{ provide: AccountComponent, useValue: stub }],
  });
  const fixture = TestBed.createComponent(AccountSecurityComponent);
  fixture.detectChanges();
  return fixture;
}

/** Click the eye toggle that sits next to the named password input. */
function toggleByName(fixture: ReturnType<typeof render>, inputName: string): HTMLInputElement {
  const input = fixture.nativeElement.querySelector(
    `input[name="${inputName}"]`,
  ) as HTMLInputElement | null;
  if (!input) {
    throw new Error(`expected an input named "${inputName}" to be rendered`);
  }
  const toggle = input.closest('.relative')?.querySelector('button[type="button"]') as
    | HTMLButtonElement
    | null
    | undefined;
  if (!toggle) {
    throw new Error(`expected a visibility toggle next to "${inputName}"`);
  }
  toggle.click();
  fixture.detectChanges();
  return input;
}

describe('AccountSecurityComponent', () => {
  it('injects the host account and defaults every visibility flag to false', () => {
    const stub = createAccountStub();
    const fixture = render(stub);
    const cmp = fixture.componentInstance as unknown as {
      account: AccountComponent;
      showTwoFactorManagePassword: boolean;
      showTwoFactorSetupPassword: boolean;
      showPasskeyPassword: boolean;
      showRemovePasskeyPassword: boolean;
      showMakePrimaryPassword: boolean;
      showRemoveSecondaryEmailPassword: boolean;
      showGooglePassword: boolean;
      showRevokeOtherSessionsPassword: boolean;
    };

    expect(cmp.account).toBe(stub);
    expect(cmp.showTwoFactorManagePassword).toBeFalse();
    expect(cmp.showTwoFactorSetupPassword).toBeFalse();
    expect(cmp.showPasskeyPassword).toBeFalse();
    expect(cmp.showRemovePasskeyPassword).toBeFalse();
    expect(cmp.showMakePrimaryPassword).toBeFalse();
    expect(cmp.showRemoveSecondaryEmailPassword).toBeFalse();
    expect(cmp.showGooglePassword).toBeFalse();
    expect(cmp.showRevokeOtherSessionsPassword).toBeFalse();
  });

  it('renders skeleton placeholders while the account is loading', () => {
    const fixture = render(createAccountStub({ loading: () => true }));
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('app-skeleton').length).toBe(3);
    expect(host.querySelector('h2')).toBeNull();
  });

  it('reveals every password field and wires the sign-out action (2FA enabled state)', () => {
    // Stable references so *ngFor (identity trackBy) keeps the same DOM rows
    // across change detection instead of recreating them.
    const passkeyList = [
      {
        id: 'pk1',
        name: 'Laptop key',
        created_at: '2020-01-01T00:00:00.000Z',
        last_used_at: '2020-02-01T00:00:00.000Z',
        device_type: 'platform',
        backed_up: true,
      },
    ];
    const emailList = [{ id: 'e1', email: 'alt@example.com', verified: true }];
    const sessionList = [
      {
        id: 's1',
        user_agent: 'Firefox',
        is_current: true,
        created_at: '2020-01-01T00:00:00.000Z',
        expires_at: '2030-01-01T00:00:00.000Z',
        ip_address: '10.0.0.1',
        persistent: true,
      },
    ];
    const eventList = [
      {
        id: 'ev1',
        event_type: 'login',
        created_at: '2020-01-01T00:00:00.000Z',
        ip_address: '10.0.0.2',
        user_agent: 'Firefox',
      },
    ];
    const stub = createAccountStub({
      twoFactorStatus: () => ({ enabled: true, recovery_codes_remaining: 3 }),
      twoFactorRecoveryCodes: ['CODE-1', 'CODE-2'],
      passkeysSupported: () => true,
      passkeys: () => passkeyList,
      removePasskeyConfirmId: 'pk1',
      secondaryEmails: () => emailList,
      makePrimarySecondaryEmailId: 'e1',
      removeSecondaryEmailId: 'e1',
      revokeOtherSessionsConfirming: true,
      googleEmail: () => 'me@gmail.com',
      googlePicture: () => 'https://pic.example/me.png',
      sessions: () => sessionList,
      otherSessionsCount: () => 1,
      securityEvents: () => eventList,
    });
    const fixture = render(stub);
    const host = fixture.nativeElement as HTMLElement;
    const cmp = fixture.componentInstance;

    // All seven toggles that can co-exist in the 2FA-enabled layout are present.
    expect(host.querySelectorAll('button.inset-y-0').length).toBe(7);

    const cases: ReadonlyArray<[string, keyof AccountSecurityComponent]> = [
      ['twoFactorManagePassword', 'showTwoFactorManagePassword'],
      ['removePasskeyPassword-pk1', 'showRemovePasskeyPassword'],
      ['passkeyPassword', 'showPasskeyPassword'],
      ['makePrimaryPassword', 'showMakePrimaryPassword'],
      ['removeSecondaryEmailPassword-e1', 'showRemoveSecondaryEmailPassword'],
      ['googlePassword', 'showGooglePassword'],
      ['revokeOtherSessionsPassword', 'showRevokeOtherSessionsPassword'],
    ];

    const typeFailures: string[] = [];
    for (const [inputName, flag] of cases) {
      const input = fixture.nativeElement.querySelector(
        `input[name="${inputName}"]`,
      ) as HTMLInputElement;
      expect(input.type).toBe('password');
      expect(cmp[flag]).toBeFalse();

      const revealed = toggleByName(fixture, inputName);
      expect(cmp[flag]).toBeTrue();
      if (revealed.type !== 'text') {
        typeFailures.push(`${inputName}=>${revealed.type}`);
      }
    }
    expect(typeFailures).toEqual([]);

    // The host action links/buttons are wired to the injected account.
    const logoutLink = host.querySelector('a.cursor-pointer') as HTMLAnchorElement;
    logoutLink.click();
    expect(stub.signOut).toHaveBeenCalled();
  });

  it('reveals the setup password field in the 2FA start state (2FA disabled)', () => {
    const stub = createAccountStub({
      twoFactorStatus: () => ({ enabled: false, recovery_codes_remaining: 0 }),
      twoFactorSetupSecret: null,
      twoFactorSetupUrl: null,
      passkeysSupported: () => false,
      googleEmail: () => null,
    });
    const fixture = render(stub);
    const cmp = fixture.componentInstance;

    const input = fixture.nativeElement.querySelector(
      'input[name="twoFactorSetupPassword"]',
    ) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(cmp.showTwoFactorSetupPassword).toBeFalse();

    const revealed = toggleByName(fixture, 'twoFactorSetupPassword');
    expect(cmp.showTwoFactorSetupPassword).toBeTrue();
    expect(revealed.type).toBe('text');
  });
});
