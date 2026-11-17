import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { AccountNotificationsComponent } from './account-notifications.component';
import { AccountComponent } from './account.component';

describe('AccountNotificationsComponent helpers (golden WU)', () => {
  let notificationsHasUnsavedChanges: jasmine.Spy;
  let discardNotificationChanges: jasmine.Spy;

  beforeEach(() => {
    notificationsHasUnsavedChanges = jasmine
      .createSpy('notificationsHasUnsavedChanges')
      .and.returnValue(false);
    discardNotificationChanges = jasmine.createSpy('discardNotificationChanges');
    TestBed.configureTestingModule({
      imports: [AccountNotificationsComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AccountComponent,
          useValue: {
            loading: () => false,
            notificationLastUpdated: null,
            formatTimestamp: () => '',
            notificationsHasUnsavedChanges,
            discardNotificationChanges,
          },
        },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(AccountNotificationsComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  it('togglePreview opens then closes the same key and switches between keys', () => {
    const { fixture, cmp } = create();
    expect(cmp.preview).toBeNull();
    cmp.togglePreview('reply');
    expect(cmp.preview).toBe('reply');
    cmp.togglePreview('reply');
    expect(cmp.preview).toBeNull();
    cmp.togglePreview('admin');
    expect(cmp.preview).toBe('admin');
    cmp.togglePreview('marketing');
    expect(cmp.preview).toBe('marketing');
    fixture.destroy();
  });

  it('hasUnsavedChanges delegates to account.notificationsHasUnsavedChanges', () => {
    const { fixture, cmp } = create();
    notificationsHasUnsavedChanges.and.returnValue(false);
    expect(cmp.hasUnsavedChanges()).toBe(false);
    notificationsHasUnsavedChanges.and.returnValue(true);
    expect(cmp.hasUnsavedChanges()).toBe(true);
    expect(notificationsHasUnsavedChanges).toHaveBeenCalled();
    fixture.destroy();
  });

  it('discardUnsavedChanges delegates to account.discardNotificationChanges', () => {
    const { fixture, cmp } = create();
    cmp.discardUnsavedChanges();
    expect(discardNotificationChanges).toHaveBeenCalled();
    fixture.destroy();
  });
});
