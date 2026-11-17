import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { CartStore } from '../../core/cart.store';
import { SuccessComponent } from './success.component';

describe('SuccessComponent delivery labels (golden WU)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SuccessComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        {
          provide: CartStore,
          useValue: { loadFromBackend: jasmine.createSpy('loadFromBackend') },
        },
        {
          provide: AnalyticsService,
          useValue: { track: jasmine.createSpy('track') },
        },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(SuccessComponent);
    const cmp = fixture.componentInstance as SuccessComponent & { summary: any };
    return { fixture, cmp };
  }

  it('courierLabel maps fan_courier/sameday and falls back to trimmed courier', () => {
    const { fixture, cmp } = create();
    cmp.summary = null;
    expect(cmp.courierLabel()).toBeNull();

    cmp.summary = { order_id: '1', courier: ' Fan_Courier ', delivery_type: 'home' };
    expect(cmp.courierLabel()).toBe('Fan Courier');

    cmp.summary = { order_id: '1', courier: 'SAMEDAY', delivery_type: 'home' };
    expect(cmp.courierLabel()).toBe('Sameday');

    cmp.summary = { order_id: '1', courier: '  DPD  ', delivery_type: 'home' };
    expect(cmp.courierLabel()).toBe('DPD');

    cmp.summary = { order_id: '1', courier: '   ', delivery_type: 'home' };
    expect(cmp.courierLabel()).toBeNull();
    fixture.destroy();
  });

  it('deliveryTypeKey returns home/locker i18n keys and null otherwise', () => {
    const { fixture, cmp } = create();
    cmp.summary = null;
    expect(cmp.deliveryTypeKey()).toBeNull();

    cmp.summary = { order_id: '1', delivery_type: 'home' };
    expect(cmp.deliveryTypeKey()).toBe('checkout.deliveryHome');

    cmp.summary = { order_id: '1', delivery_type: 'locker' };
    expect(cmp.deliveryTypeKey()).toBe('checkout.deliveryLocker');

    cmp.summary = { order_id: '1', delivery_type: 'pickup' };
    expect(cmp.deliveryTypeKey()).toBeNull();
    fixture.destroy();
  });

  it('lockerLabel joins name/address only for locker deliveries', () => {
    const { fixture, cmp } = create();
    cmp.summary = {
      order_id: '1',
      delivery_type: 'home',
      locker_name: 'A',
      locker_address: 'B',
    };
    expect(cmp.lockerLabel()).toBeNull();

    cmp.summary = {
      order_id: '1',
      delivery_type: 'locker',
      locker_name: 'Box 12',
      locker_address: 'Main St',
    };
    expect(cmp.lockerLabel()).toBe('Box 12 — Main St');

    cmp.summary = {
      order_id: '1',
      delivery_type: 'locker',
      locker_name: '  ',
      locker_address: 'Only addr',
    };
    expect(cmp.lockerLabel()).toBe('Only addr');

    cmp.summary = {
      order_id: '1',
      delivery_type: 'locker',
      locker_name: null,
      locker_address: null,
    };
    expect(cmp.lockerLabel()).toBeNull();
    fixture.destroy();
  });
});
