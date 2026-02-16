import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { LazyStylesService } from '../core/lazy-styles.service';
import { ShippingService } from '../core/shipping.service';
import { LockerPickerComponent } from './locker-picker.component';


describe('LockerPickerComponent', () => {
  let fixture: ComponentFixture<LockerPickerComponent>;
  let component: LockerPickerComponent;
  let shipping: jasmine.SpyObj<ShippingService>;

  beforeEach(async () => {
    shipping = jasmine.createSpyObj<ShippingService>('ShippingService', ['listLockers', 'listLockerCities']);
    shipping.listLockers.and.returnValue(of([]));
    shipping.listLockerCities.and.returnValue(
      of({
        items: [
          {
            provider: 'sameday',
            city: 'Bucuresti',
            county: 'Ilfov',
            display_name: 'Bucuresti, Ilfov',
            lat: 44.43,
            lng: 26.1,
            locker_count: 42
          }
        ],
        snapshot: {
          provider: 'sameday',
          total_lockers: 1200,
          last_success_at: '2026-01-01T00:00:00Z',
          last_error: null,
          stale: true,
          stale_age_seconds: 86400 * 35
        }
      } as any)
    );

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), LockerPickerComponent],
      providers: [
        { provide: ShippingService, useValue: shipping },
        { provide: LazyStylesService, useValue: { ensure: () => Promise.resolve() } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LockerPickerComponent);
    component = fixture.componentInstance;
    spyOn(component as any, 'initMap').and.returnValue(Promise.resolve());
    fixture.detectChanges();
  });

  it('loads city suggestions from backend for sameday and stores stale snapshot metadata', async () => {
    component.provider = 'sameday';
    await (component as any).fetchLocations('Bucu');

    expect(shipping.listLockerCities).toHaveBeenCalled();
    expect(component.searchResults.length).toBe(1);
    expect(component.searchResults[0].display_name).toContain('Bucuresti');
    expect(component.mirrorSnapshot?.stale).toBeTrue();
    expect(component.staleDays()).toBeGreaterThanOrEqual(30);
  });

  it('shows mirror unavailable message when backend returns 503 locker mirror error', async () => {
    shipping.listLockers.and.returnValue(
      throwError(() => ({ error: { detail: 'Sameday locker mirror is not initialized' } }))
    );
    component.provider = 'sameday';

    await (component as any).loadLockers(44.4, 26.1);

    expect(component.error).toContain('checkout.lockers.mirrorUnavailable');
  });
});
