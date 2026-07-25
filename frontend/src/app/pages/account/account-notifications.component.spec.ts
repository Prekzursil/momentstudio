import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AccountNotificationsComponent } from './account-notifications.component';
import { AccountComponent } from './account.component';

/**
 * Minimal stand-in for the parent {@link AccountComponent} that the
 * notifications panel injects. It exposes exactly the surface the component
 * template + class touch, with writable fields so the two-way `ngModel`
 * checkboxes and DOM-driven branches can be exercised.
 */
class AccountStub {
  loading: WritableSignal<boolean> = signal(false);
  notificationLastUpdated: string | null = null;
  savingNotifications = false;
  notifyBlogCommentReplies = false;
  notifyBlogComments = false;
  notifyMarketing = false;
  notificationsMessage: string | null = null;
  notificationsError: string | null = null;

  formatTimestamp = jasmine
    .createSpy('formatTimestamp')
    .and.callFake((value: string) => `formatted:${value}`);
  saveNotifications = jasmine.createSpy('saveNotifications');
  isAdmin = jasmine.createSpy('isAdmin').and.returnValue(false);
  notificationsHasUnsavedChanges = jasmine
    .createSpy('notificationsHasUnsavedChanges')
    .and.returnValue(false);
  discardNotificationChanges = jasmine.createSpy('discardNotificationChanges');
}

describe('AccountNotificationsComponent', () => {
  let account: AccountStub;

  /**
   * Create + render a component instance after an optional pre-render setup
   * step, so every fixture reaches change detection exactly once in a known
   * state (avoids ExpressionChanged churn from mutate-then-re-render).
   */
  function render(
    setup?: (cmp: AccountNotificationsComponent) => void,
  ): ComponentFixture<AccountNotificationsComponent> {
    const fixture = TestBed.createComponent(AccountNotificationsComponent);
    if (setup) {
      setup(fixture.componentInstance);
    }
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    account = new AccountStub();

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountNotificationsComponent],
      providers: [{ provide: AccountComponent, useValue: account }],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        account: {
          notifications: {
            title: 'Notifications',
            lastUpdated: 'Updated {{date}}',
            save: 'Save',
            transactionalTitle: 'Transactional',
            transactionalCopy: 'Always on',
            communityHeading: 'Community',
            replyLabel: 'Reply notifications',
            adminHeading: 'Admin',
            adminLabel: 'Admin notifications',
            marketingHeading: 'Marketing',
            marketingLabel: 'Marketing notifications',
            previewTitle: 'Preview',
            previewReply: 'Reply preview body',
            previewAdmin: 'Admin preview body',
            previewMarketing: 'Marketing preview body',
            showPreview: 'Show preview',
            hidePreview: 'Hide preview',
          },
          viewAll: 'View all',
        },
        notifications: { viewAll: 'View all notifications' },
      },
      true,
    );
    translate.setDefaultLang('en');
    void translate.use('en');
  });

  it('shows skeletons while the account is loading and hides the body', () => {
    const fixture = render(() => account.loading.set(true));

    expect(fixture.nativeElement.querySelectorAll('app-skeleton').length).toBe(2);
    expect(fixture.nativeElement.textContent).not.toContain('Notifications');
  });

  it('renders the notifications body with no preview open by default', () => {
    const fixture = render();
    const cmp = fixture.componentInstance;

    expect(cmp.preview).toBeNull();
    expect(fixture.nativeElement.querySelector('app-skeleton')).toBeNull();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Notifications');
    expect(text).toContain('Community');
    expect(text).toContain('Marketing');
    // No preview body rendered when preview is null.
    expect(text).not.toContain('Reply preview body');
  });

  it('renders the last-updated stamp using the parent formatter when available', () => {
    account.notificationLastUpdated = '2024-05-01T00:00:00Z';
    const fixture = render();

    expect(account.formatTimestamp).toHaveBeenCalledWith('2024-05-01T00:00:00Z');
    expect(fixture.nativeElement.textContent).toContain('Updated formatted:2024-05-01T00:00:00Z');
  });

  it('omits the last-updated stamp when no timestamp is present', () => {
    const fixture = render();

    expect(account.formatTimestamp).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Updated');
  });

  it('hides the admin section for non-admins', () => {
    const fixture = render();
    expect(account.isAdmin).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Admin notifications');
  });

  it('shows the admin section for admins', () => {
    account.isAdmin.and.returnValue(true);
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('Admin notifications');
  });

  it('invokes saveNotifications when the save button emits its action', () => {
    const fixture = render();
    const saveButton = fixture.nativeElement.querySelectorAll('app-button')[1] as HTMLElement;
    saveButton.dispatchEvent(new Event('action'));
    expect(account.saveNotifications).toHaveBeenCalled();
  });

  it('togglePreview opens a preview when none is shown', () => {
    const fixture = render();
    fixture.componentInstance.togglePreview('reply');
    expect(fixture.componentInstance.preview).toBe('reply');
  });

  it('togglePreview switches to a different preview key', () => {
    const fixture = render();
    const cmp = fixture.componentInstance;
    cmp.preview = 'reply';
    cmp.togglePreview('marketing');
    expect(cmp.preview).toBe('marketing');
  });

  it('togglePreview closes the preview when the same key is toggled again', () => {
    const fixture = render();
    const cmp = fixture.componentInstance;
    cmp.preview = 'marketing';
    cmp.togglePreview('marketing');
    expect(cmp.preview).toBeNull();
  });

  it('renders the reply preview body and a "Hide preview" toggle when open', () => {
    const fixture = render((cmp) => (cmp.preview = 'reply'));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Reply preview body');
    expect(text).toContain('Hide preview');
    expect(text).not.toContain('Marketing preview body');
  });

  it('renders the marketing preview body when the marketing preview is open', () => {
    const fixture = render((cmp) => (cmp.preview = 'marketing'));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Marketing preview body');
    expect(text).not.toContain('Reply preview body');
  });

  it('renders the admin preview body for admins when the admin preview is open', () => {
    account.isAdmin.and.returnValue(true);
    const fixture = render((cmp) => (cmp.preview = 'admin'));
    expect(fixture.nativeElement.textContent).toContain('Admin preview body');
  });

  it('clicking the reply preview toggle button opens the preview via the template', () => {
    const fixture = render();
    const toggleButton = fixture.nativeElement.querySelector(
      'button.text-indigo-600',
    ) as HTMLButtonElement;
    toggleButton.click();
    expect(fixture.componentInstance.preview).toBe('reply');
  });

  it('updates the model when the reply checkbox is toggled', () => {
    const fixture = render();
    const replyCheckbox = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    replyCheckbox.checked = true;
    replyCheckbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(account.notifyBlogCommentReplies).toBeTrue();
  });

  it('renders the success message and error message bindings', () => {
    account.notificationsMessage = 'account.notifications.saved';
    account.notificationsError = 'account.notifications.error';
    const fixture = render();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('account.notifications.saved');
    expect(text).toContain('account.notifications.error');
  });

  it('delegates unsaved-change queries to the parent account component', () => {
    const fixture = render();
    const cmp = fixture.componentInstance;

    account.notificationsHasUnsavedChanges.and.returnValue(true);
    expect(cmp.hasUnsavedChanges()).toBeTrue();
    expect(account.notificationsHasUnsavedChanges).toHaveBeenCalled();

    account.notificationsHasUnsavedChanges.and.returnValue(false);
    expect(cmp.hasUnsavedChanges()).toBeFalse();
  });

  it('delegates discarding unsaved changes to the parent account component', () => {
    const fixture = render();
    fixture.componentInstance.discardUnsavedChanges();
    expect(account.discardNotificationChanges).toHaveBeenCalled();
  });
});
