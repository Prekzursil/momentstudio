import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { LazyStylesService } from '../core/lazy-styles.service';
import { ShippingService } from '../core/shipping.service';
import { LockerPickerComponent } from './locker-picker.component';


let lockerPickerFixture: ComponentFixture<LockerPickerComponent>;
let lockerPickerComponent: LockerPickerComponent;
let lockerPickerShipping: jasmine.SpyObj<ShippingService>;

describe('LockerPickerComponent', () => {
  beforeEach(async () => {
    lockerPickerShipping = jasmine.createSpyObj<ShippingService>('ShippingService', ['listLockers', 'listLockerCities']);
    lockerPickerShipping.listLockers.and.returnValue(of([]));
    lockerPickerShipping.listLockerCities.and.returnValue(
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
          stale_age_seconds: 86400 * 35,
          challenge_failure_streak: 3,
          schema_drift_detected: true,
          canary_alert_codes: ['schema_drift', 'challenge_failure_streak'],
          canary_alert_messages: ['schema changed', 'challenge streak']
        }
      } as any)
    );

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), LockerPickerComponent],
      providers: [
        { provide: ShippingService, useValue: lockerPickerShipping },
        { provide: LazyStylesService, useValue: { ensure: () => Promise.resolve() } }
      ]
    }).compileComponents();

    lockerPickerFixture = TestBed.createComponent(LockerPickerComponent);
    lockerPickerComponent = lockerPickerFixture.componentInstance;
    spyOn(lockerPickerComponent as any, 'initMap').and.returnValue(Promise.resolve());
    lockerPickerFixture.detectChanges();
  });

  defineCitySuggestionSpec();
  defineMirrorUnavailableSpec();
});

function defineCitySuggestionSpec(): void {
  it('loads city suggestions from backend for sameday and stores stale snapshot metadata', async () => {
    lockerPickerComponent.provider = 'sameday';
    await (lockerPickerComponent as any).fetchLocations('Bucu');
    lockerPickerFixture.detectChanges();

    expect(lockerPickerShipping.listLockerCities).toHaveBeenCalled();
    expect(lockerPickerComponent.searchResults.length).toBe(1);
    expect(lockerPickerComponent.searchResults[0].display_name).toContain('Bucuresti');
    expect(lockerPickerComponent.mirrorSnapshot?.stale).toBeTrue();
    expect(lockerPickerComponent.mirrorSnapshot?.canary_alert_messages?.length).toBeGreaterThan(0);
    expect(lockerPickerComponent.staleDays()).toBeGreaterThanOrEqual(30);
    expect((lockerPickerFixture.nativeElement.textContent || '').replaceAll(/\s+/g, ' ')).toContain(
      'checkout.lockers.snapshotCanaryTitle'
    );
  });
};

function defineMirrorUnavailableSpec(): void {
  it('shows mirror unavailable message when backend returns 503 locker mirror error', async () => {
    lockerPickerShipping.listLockers.and.returnValue(
      throwError(() => ({ error: { detail: 'Sameday locker mirror is not initialized' } }))
    );
    lockerPickerComponent.provider = 'sameday';

    await (lockerPickerComponent as any).loadLockers(44.4, 26.1);
    expect(lockerPickerComponent.error).toContain('checkout.lockers.mirrorUnavailable');
  });
};
