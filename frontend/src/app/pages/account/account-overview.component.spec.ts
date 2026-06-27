import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AccountOverviewComponent } from './account-overview.component';
import { AccountComponent } from './account.component';

/**
 * Test double for the parent {@link AccountComponent}. The overview component
 * only reads loading flags + label/subcopy getters from the injected parent, so
 * the stub exposes exactly those members backed by writable signals/spies that
 * each test can drive to exercise both the loading-skeleton and loaded-card
 * branches of the template.
 */
interface AccountStub {
  ordersLoaded: WritableSignal<boolean>;
  addressesLoaded: WritableSignal<boolean>;
  loading: WritableSignal<boolean>;
  ticketsLoaded: WritableSignal<boolean>;
  wishlist: { isLoaded: WritableSignal<boolean> };
  lastOrderLabel: () => string;
  lastOrderSubcopy: () => string;
  defaultAddressLabel: () => string;
  defaultAddressSubcopy: () => string;
  wishlistCountLabel: () => string;
  notificationsLabel: () => string;
  securityLabel: () => string;
  supportTicketsLabel: () => string;
  supportTicketsSubcopy: () => string;
}

function createAccountStub(): AccountStub {
  return {
    ordersLoaded: signal(true),
    addressesLoaded: signal(true),
    loading: signal(false),
    ticketsLoaded: signal(true),
    wishlist: { isLoaded: signal(true) },
    lastOrderLabel: () => 'Order #REF123',
    lastOrderSubcopy: () => 'Shipped 2 days ago',
    defaultAddressLabel: () => 'Home address',
    defaultAddressSubcopy: () => 'Bucharest, RO',
    wishlistCountLabel: () => '2 saved items',
    notificationsLabel: () => '3 unread',
    securityLabel: () => 'Password set',
    supportTicketsLabel: () => '1 open ticket',
    supportTicketsSubcopy: () => 'Last reply yesterday',
  };
}

describe('AccountOverviewComponent', () => {
  let account: AccountStub;

  function setup(): { native: HTMLElement } {
    const fixture = TestBed.createComponent(AccountOverviewComponent);
    fixture.detectChanges();
    return { native: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    account = createAccountStub();

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountOverviewComponent],
      providers: [{ provide: AccountComponent, useValue: account }],
    });
  });

  it('injects the parent account component', () => {
    const fixture = TestBed.createComponent(AccountOverviewComponent);
    expect(
      (fixture.componentInstance as unknown as { account: AccountStub }).account,
    ).toBe(account);
  });

  it('renders the overview section with an aria label', () => {
    const { native } = setup();
    const section = native.querySelector('section');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-label')).toBe('account.overview.aria.overview');
  });

  it('renders every quick-link card with its label and subcopy when all data is loaded', () => {
    const { native } = setup();

    const links = Array.from(native.querySelectorAll('a')).map((a) => a.getAttribute('routerLink'));
    expect(links).toEqual([
      '/account/orders',
      '/account/addresses',
      '/account/wishlist',
      '/account/notifications',
      '/account/security',
      '/tickets',
    ]);

    const text = native.textContent ?? '';
    expect(text).toContain('Order #REF123');
    expect(text).toContain('Shipped 2 days ago');
    expect(text).toContain('Home address');
    expect(text).toContain('Bucharest, RO');
    expect(text).toContain('2 saved items');
    expect(text).toContain('3 unread');
    expect(text).toContain('Password set');
    expect(text).toContain('1 open ticket');
    expect(text).toContain('Last reply yesterday');

    // No skeleton placeholders should be present once everything is loaded.
    expect(native.querySelectorAll('app-skeleton').length).toBe(0);
  });

  it('shows the orders skeleton while orders are loading', () => {
    account.ordersLoaded.set(false);
    const { native } = setup();

    const loadingCard = native.querySelector(
      '[aria-label="account.overview.aria.ordersLoading"]',
    );
    expect(loadingCard).not.toBeNull();
    expect(loadingCard?.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
    expect(native.querySelector('a[routerLink="/account/orders"]')).toBeNull();
  });

  it('shows the addresses skeleton while addresses are loading', () => {
    account.addressesLoaded.set(false);
    const { native } = setup();

    expect(
      native.querySelector('[aria-label="account.overview.aria.addressesLoading"]'),
    ).not.toBeNull();
    expect(native.querySelector('a[routerLink="/account/addresses"]')).toBeNull();
  });

  it('shows the wishlist skeleton while the wishlist is loading', () => {
    account.wishlist.isLoaded.set(false);
    const { native } = setup();

    expect(
      native.querySelector('[aria-label="account.overview.aria.wishlistLoading"]'),
    ).not.toBeNull();
    expect(native.querySelector('a[routerLink="/account/wishlist"]')).toBeNull();
  });

  it('shows the notifications and security skeletons while the account is loading', () => {
    account.loading.set(true);
    const { native } = setup();

    expect(
      native.querySelector('[aria-label="account.overview.aria.notificationsLoading"]'),
    ).not.toBeNull();
    expect(
      native.querySelector('[aria-label="account.overview.aria.securityLoading"]'),
    ).not.toBeNull();
    expect(native.querySelector('a[routerLink="/account/notifications"]')).toBeNull();
    expect(native.querySelector('a[routerLink="/account/security"]')).toBeNull();
  });

  it('shows the support skeleton while tickets are loading', () => {
    account.ticketsLoaded.set(false);
    const { native } = setup();

    expect(
      native.querySelector('[aria-label="account.overview.aria.supportLoading"]'),
    ).not.toBeNull();
    expect(native.querySelector('a[routerLink="/tickets"]')).toBeNull();
  });
});
