import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminPaginationMeta } from '../../../core/admin-orders.service';
import { AdminUserSegmentListItem, AdminUsersService } from '../../../core/admin-users.service';
import { AdminSegmentsComponent } from './admin-segments.component';

function meta(overrides: Partial<AdminPaginationMeta> = {}): AdminPaginationMeta {
  return { total_items: 1, total_pages: 3, page: 1, limit: 25, ...overrides };
}

function segmentRow(id: string, email: string): AdminUserSegmentListItem {
  return {
    user: { id, email, username: `${email}-name` } as any,
    orders_count: 4,
    total_spent: 250.5,
    avg_order_value: 62.625,
  };
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

    usersApi.listRepeatBuyersSegment.and.returnValue(
      of({ items: [segmentRow('u1', 'repeat@x.com')], meta: meta() }),
    );
    usersApi.listHighAovSegment.and.returnValue(
      of({ items: [segmentRow('u2', 'aov@x.com')], meta: meta() }),
    );

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminSegmentsComponent],
      providers: [{ provide: AdminUsersService, useValue: usersApi }, provideRouter([])],
    }).compileComponents();

    router = TestBed.inject(Router);
    navigateSpy = spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
  });

  function create(): AdminSegmentsComponent {
    const fixture = TestBed.createComponent(AdminSegmentsComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('loads both segments on init and renders their rows', () => {
    const fixture = TestBed.createComponent(AdminSegmentsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(usersApi.listRepeatBuyersSegment).toHaveBeenCalledWith(
      jasmine.objectContaining({ min_orders: 2, page: 1, limit: 25, q: undefined }),
    );
    expect(usersApi.listHighAovSegment).toHaveBeenCalledWith(
      jasmine.objectContaining({ min_orders: 1, min_aov: 0, page: 1, limit: 25, q: undefined }),
    );
    expect(cmp.repeatItems().length).toBe(1);
    expect(cmp.aovItems().length).toBe(1);
    expect(cmp.repeatLoading()).toBeFalse();
    expect(cmp.aovLoading()).toBeFalse();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('repeat@x.com');
    expect(text).toContain('aov@x.com');
    expect(text).toContain('250.50 RON');
  });

  it('trims a search query and resets pages when applying filters', () => {
    const cmp = create();
    cmp.q = '  alice  ';
    cmp.repeatPage = 4;
    cmp.aovPage = 7;
    usersApi.listRepeatBuyersSegment.calls.reset();
    usersApi.listHighAovSegment.calls.reset();

    cmp.applyFilters();

    expect(cmp.repeatPage).toBe(1);
    expect(cmp.aovPage).toBe(1);
    expect(usersApi.listRepeatBuyersSegment).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'alice', page: 1 }),
    );
    expect(usersApi.listHighAovSegment).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'alice', page: 1 }),
    );
  });

  it('restores defaults and reloads when resetting filters', () => {
    const cmp = create();
    cmp.q = 'something';
    cmp.repeatMinOrders = 9;
    cmp.aovMinOrders = 8;
    cmp.aovMinAov = 500;
    usersApi.listRepeatBuyersSegment.calls.reset();

    cmp.resetFilters();

    expect(cmp.q).toBe('');
    expect(cmp.repeatMinOrders).toBe(2);
    expect(cmp.aovMinOrders).toBe(1);
    expect(cmp.aovMinAov).toBe(0);
    expect(usersApi.listRepeatBuyersSegment).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: undefined }),
    );
  });

  it('clamps the repeat page at 1 going back and increments going forward', () => {
    const cmp = create();
    cmp.repeatPage = 1;
    usersApi.listRepeatBuyersSegment.calls.reset();

    cmp.repeatPrev();
    expect(cmp.repeatPage).toBe(1);

    cmp.repeatNext();
    expect(cmp.repeatPage).toBe(2);

    cmp.repeatPage = 5;
    cmp.repeatPrev();
    expect(cmp.repeatPage).toBe(4);
    expect(usersApi.listRepeatBuyersSegment).toHaveBeenCalledTimes(3);
  });

  it('clamps the AOV page at 1 going back and increments going forward', () => {
    const cmp = create();
    cmp.aovPage = 1;
    usersApi.listHighAovSegment.calls.reset();

    cmp.aovPrev();
    expect(cmp.aovPage).toBe(1);

    cmp.aovNext();
    expect(cmp.aovPage).toBe(2);

    cmp.aovPage = 5;
    cmp.aovPrev();
    expect(cmp.aovPage).toBe(4);
    expect(usersApi.listHighAovSegment).toHaveBeenCalledTimes(3);
  });

  it('renders pagination text only when meta is present', () => {
    const cmp = create();
    cmp.repeatMeta.set(null);
    cmp.aovMeta.set(null);
    expect(cmp.repeatMetaText()).toBe('');
    expect(cmp.aovMetaText()).toBe('');

    cmp.repeatMeta.set(meta({ page: 2 }));
    cmp.aovMeta.set(meta({ page: 3 }));
    expect(cmp.repeatMetaText()).toContain('adminUi.segments.pagination');
    expect(cmp.aovMetaText()).toContain('adminUi.segments.pagination');
  });

  it('formats money from numbers, numeric strings, and non-finite values', () => {
    const cmp = create();
    expect(cmp.formatMoney(12.5)).toBe('12.50 RON');
    expect(cmp.formatMoney('30.2')).toBe('30.20 RON');
    expect(cmp.formatMoney('not-a-number')).toBe('0.00 RON');
    expect(cmp.formatMoney(null)).toBe('0.00 RON');
  });

  it('navigates to the users page with prefill state for a non-empty email', () => {
    const cmp = create();
    cmp.openUser('  buyer@x.com  ');
    expect(navigateSpy).toHaveBeenCalledWith('/admin/users', {
      state: { prefillUserSearch: 'buyer@x.com', autoSelectFirst: true },
    });
  });

  it('does not navigate when the prefill is blank or missing', () => {
    const cmp = create();
    cmp.openUser('   ');
    cmp.openUser(undefined as any);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('tracks rows by their user id', () => {
    const cmp = create();
    expect(cmp.trackRow(0, segmentRow('user-99', 'z@x.com'))).toBe('user-99');
  });

  it('defaults null repeat payloads to empty collections', () => {
    usersApi.listRepeatBuyersSegment.and.returnValue(of({ items: null, meta: null } as any));
    const cmp = create();
    expect(cmp.repeatItems()).toEqual([]);
    expect(cmp.repeatMeta()).toBeNull();
    expect(cmp.repeatLoading()).toBeFalse();
    expect(cmp.repeatError()).toBeNull();
  });

  it('defaults null AOV payloads to empty collections', () => {
    usersApi.listHighAovSegment.and.returnValue(of({ items: null, meta: null } as any));
    const cmp = create();
    expect(cmp.aovItems()).toEqual([]);
    expect(cmp.aovMeta()).toBeNull();
    expect(cmp.aovLoading()).toBeFalse();
    expect(cmp.aovError()).toBeNull();
  });

  it('surfaces a translated error when the repeat segment fails to load', () => {
    usersApi.listRepeatBuyersSegment.and.returnValue(throwError(() => new Error('boom')));
    const cmp = create();
    expect(cmp.repeatError()).toBe('adminUi.segments.errors.repeatLoad');
    expect(cmp.repeatLoading()).toBeFalse();
  });

  it('surfaces a translated error when the AOV segment fails to load', () => {
    usersApi.listHighAovSegment.and.returnValue(throwError(() => new Error('boom')));
    const cmp = create();
    expect(cmp.aovError()).toBe('adminUi.segments.errors.aovLoad');
    expect(cmp.aovLoading()).toBeFalse();
  });

  it('exposes the breadcrumb trail', () => {
    const cmp = create();
    expect(cmp.crumbs.length).toBe(4);
    expect(cmp.crumbs[cmp.crumbs.length - 1]).toEqual({ label: 'adminUi.segments.title' });
  });
});
