import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminPaginationMeta } from '../../../core/admin-orders.service';
import {
  AdminUserSegmentListItem,
  AdminUserSegmentResponse,
  AdminUsersService,
} from '../../../core/admin-users.service';
import { AdminSegmentsComponent } from './admin-segments.component';

function makeItem(overrides: Partial<AdminUserSegmentListItem> = {}): AdminUserSegmentListItem {
  return {
    user: {
      id: 'u1',
      email: 'buyer@example.com',
      username: 'buyer',
      name: 'Buyer One',
      name_tag: 1,
      role: 'customer',
      email_verified: true,
      created_at: '2026-01-01T00:00:00Z',
    },
    orders_count: 5,
    total_spent: 250,
    avg_order_value: 50,
    ...overrides,
  };
}

function makeMeta(overrides: Partial<AdminPaginationMeta> = {}): AdminPaginationMeta {
  return { total_items: 1, total_pages: 3, page: 1, limit: 25, ...overrides };
}

function makeResponse(
  overrides: Partial<AdminUserSegmentResponse> = {},
): AdminUserSegmentResponse {
  return { items: [makeItem()], meta: makeMeta(), ...overrides };
}

describe('AdminSegmentsComponent', () => {
  let usersApi: jasmine.SpyObj<AdminUsersService>;
  let router: Router;
  let navigateSpy: jasmine.Spy;

  beforeEach(async () => {
    usersApi = jasmine.createSpyObj<AdminUsersService>('AdminUsersService', [
      'listRepeatBuyersSegment',
      'listHighAovSegment',
    ]);

    usersApi.listRepeatBuyersSegment.and.returnValue(of(makeResponse()));
    usersApi.listHighAovSegment.and.returnValue(of(makeResponse()));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), RouterTestingModule, AdminSegmentsComponent],
      providers: [{ provide: AdminUsersService, useValue: usersApi }],
    }).compileComponents();

    router = TestBed.inject(Router);
    navigateSpy = spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
  });

  function create(): AdminSegmentsComponent {
    return TestBed.createComponent(AdminSegmentsComponent).componentInstance;
  }

  it('loads both segments on init and populates signals', () => {
    const fixture = TestBed.createComponent(AdminSegmentsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(usersApi.listRepeatBuyersSegment).toHaveBeenCalledWith({
      q: undefined,
      min_orders: 2,
      page: 1,
      limit: 25,
    });
    expect(usersApi.listHighAovSegment).toHaveBeenCalledWith({
      q: undefined,
      min_orders: 1,
      min_aov: 0,
      page: 1,
      limit: 25,
    });
    expect(cmp.repeatItems().length).toBe(1);
    expect(cmp.aovItems().length).toBe(1);
    expect(cmp.repeatLoading()).toBeFalse();
    expect(cmp.aovLoading()).toBeFalse();
    expect(cmp.repeatMeta()).not.toBeNull();
    expect(cmp.aovMeta()).not.toBeNull();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('buyer@example.com');
    expect(text).toContain('250.00 RON');
  });

  it('sends the trimmed query to both segment APIs when set', () => {
    const cmp = create();
    cmp.q = '  alice  ';
    cmp.applyFilters();

    expect(cmp.repeatPage).toBe(1);
    expect(cmp.aovPage).toBe(1);
    expect(usersApi.listRepeatBuyersSegment).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'alice' }),
    );
    expect(usersApi.listHighAovSegment).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'alice' }),
    );
  });

  it('resets filters back to defaults and reloads', () => {
    const cmp = create();
    cmp.q = 'something';
    cmp.repeatMinOrders = 9;
    cmp.aovMinOrders = 9;
    cmp.aovMinAov = 99;

    cmp.resetFilters();

    expect(cmp.q).toBe('');
    expect(cmp.repeatMinOrders).toBe(2);
    expect(cmp.aovMinOrders).toBe(1);
    expect(cmp.aovMinAov).toBe(0);
    expect(cmp.repeatPage).toBe(1);
    expect(cmp.aovPage).toBe(1);
  });

  it('coerces empty/falsy collections from the repeat-buyers response', () => {
    usersApi.listRepeatBuyersSegment.and.returnValue(
      of({ items: undefined, meta: undefined } as unknown as AdminUserSegmentResponse),
    );
    const cmp = create();
    cmp.ngOnInit();

    expect(cmp.repeatItems()).toEqual([]);
    expect(cmp.repeatMeta()).toBeNull();
    expect(cmp.repeatLoading()).toBeFalse();
  });

  it('coerces empty/falsy collections from the high-aov response', () => {
    usersApi.listHighAovSegment.and.returnValue(
      of({ items: undefined, meta: undefined } as unknown as AdminUserSegmentResponse),
    );
    const cmp = create();
    cmp.ngOnInit();

    expect(cmp.aovItems()).toEqual([]);
    expect(cmp.aovMeta()).toBeNull();
    expect(cmp.aovLoading()).toBeFalse();
  });

  it('surfaces an error message when the repeat-buyers segment fails', () => {
    usersApi.listRepeatBuyersSegment.and.returnValue(throwError(() => new Error('boom')));
    const cmp = create();
    cmp.ngOnInit();

    expect(cmp.repeatError()).toBe('adminUi.segments.errors.repeatLoad');
    expect(cmp.repeatLoading()).toBeFalse();
  });

  it('surfaces an error message when the high-aov segment fails', () => {
    usersApi.listHighAovSegment.and.returnValue(throwError(() => new Error('boom')));
    const cmp = create();
    cmp.ngOnInit();

    expect(cmp.aovError()).toBe('adminUi.segments.errors.aovLoad');
    expect(cmp.aovLoading()).toBeFalse();
  });

  it('paginates the repeat-buyers segment without dropping below page 1', () => {
    const cmp = create();
    usersApi.listRepeatBuyersSegment.calls.reset();

    cmp.repeatNext();
    expect(cmp.repeatPage).toBe(2);
    cmp.repeatPrev();
    expect(cmp.repeatPage).toBe(1);
    // Already at page 1 -> Math.max clamp keeps it at 1.
    cmp.repeatPrev();
    expect(cmp.repeatPage).toBe(1);
    expect(usersApi.listRepeatBuyersSegment).toHaveBeenCalledTimes(3);
  });

  it('paginates the high-aov segment without dropping below page 1', () => {
    const cmp = create();
    usersApi.listHighAovSegment.calls.reset();

    cmp.aovNext();
    expect(cmp.aovPage).toBe(2);
    cmp.aovPrev();
    expect(cmp.aovPage).toBe(1);
    cmp.aovPrev();
    expect(cmp.aovPage).toBe(1);
    expect(usersApi.listHighAovSegment).toHaveBeenCalledTimes(3);
  });

  it('returns empty meta text when no meta is present and translated text when it is', () => {
    const cmp = create();

    cmp.repeatMeta.set(null);
    cmp.aovMeta.set(null);
    expect(cmp.repeatMetaText()).toBe('');
    expect(cmp.aovMetaText()).toBe('');

    cmp.repeatMeta.set(makeMeta());
    cmp.aovMeta.set(makeMeta());
    expect(cmp.repeatMetaText()).toBe('adminUi.segments.pagination');
    expect(cmp.aovMetaText()).toBe('adminUi.segments.pagination');
  });

  it('formats money across numeric, string and non-finite inputs', () => {
    const cmp = create();

    expect(cmp.formatMoney(12.5)).toBe('12.50 RON');
    expect(cmp.formatMoney('30')).toBe('30.00 RON');
    expect(cmp.formatMoney('not-a-number')).toBe('0.00 RON');
    expect(cmp.formatMoney(null)).toBe('0.00 RON');
  });

  it('navigates to the users page when opening a valid user, and no-ops otherwise', () => {
    const cmp = create();

    cmp.openUser('  buyer@example.com  ');
    expect(navigateSpy).toHaveBeenCalledWith('/admin/users', {
      state: { prefillUserSearch: 'buyer@example.com', autoSelectFirst: true },
    });

    navigateSpy.calls.reset();
    cmp.openUser('   ');
    expect(navigateSpy).not.toHaveBeenCalled();

    // Falsy prefill exercises the `(prefill || '')` fallback branch.
    cmp.openUser('' as unknown as string);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('tracks rows by user id', () => {
    const cmp = create();
    expect(cmp.trackRow(0, makeItem({ user: { ...makeItem().user, id: 'abc' } }))).toBe('abc');
  });
});
