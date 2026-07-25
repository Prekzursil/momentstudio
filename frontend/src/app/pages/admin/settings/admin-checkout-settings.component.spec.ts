import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminCheckoutSettingsComponent } from './admin-checkout-settings.component';
import { AdminService } from '../../../core/admin.service';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Behavioural spec for the extracted Settings > Checkout settings panel. Mirrors
 * the scenarios that previously lived against AdminComponent so behaviour and
 * branch coverage move with the code.
 */

describe('AdminCheckoutSettingsComponent', () => {
  let fixture: ComponentFixture<AdminCheckoutSettingsComponent>;
  let c: AdminCheckoutSettingsComponent;
  let admin: jasmine.SpyObj<
    Pick<AdminService, 'getContent' | 'updateContentBlock' | 'createContent'>
  >;
  let remember: jasmine.Spy;
  let withExpected: jasmine.Spy;
  let conflict: jasmine.Spy;
  let forget: jasmine.Spy;

  beforeEach(async () => {
    admin = jasmine.createSpyObj('AdminService', [
      'getContent',
      'updateContentBlock',
      'createContent',
    ]);
    admin.getContent.and.returnValue(of({ meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ version: 1 } as any));
    admin.createContent.and.returnValue(of({ version: 1 } as any));

    await TestBed.configureTestingModule({
      imports: [AdminCheckoutSettingsComponent, TranslateModule.forRoot()],
      providers: [{ provide: AdminService, useValue: admin }],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCheckoutSettingsComponent);
    c = fixture.componentInstance;
    remember = jasmine.createSpy('rememberContentVersion');
    withExpected = jasmine.createSpy('withExpectedVersion').and.callFake((_k: string, p: any) => p);
    conflict = jasmine.createSpy('handleContentConflict').and.returnValue(false);
    forget = jasmine.createSpy('forgetContentVersion');
    c.rememberContentVersion = remember;
    c.withExpectedVersion = withExpected as any;
    c.handleContentConflict = conflict as any;
    c.forgetContentVersion = forget;
  });

  it('creates and loads checkout settings on init', () => {
    fixture.detectChanges();
    expect(c).toBeTruthy();
    expect(admin.getContent).toHaveBeenCalledWith('site.checkout');
    expect(remember).toHaveBeenCalledWith('site.checkout', jasmine.anything());
  });

  it('loadCheckoutSettings parses meta + falls back + forgets version on error', () => {
    admin.getContent.and.returnValue(
      of({
        version: 1,
        meta: {
          shipping_fee_ron: 15,
          free_shipping_threshold_ron: 250,
          phone_required_home: 'no',
          fee_enabled: 1,
          fee_type: 'percent',
          fee_value: 5,
          vat_enabled: false,
          vat_rate_percent: 19,
          receipt_share_days: 30,
          money_rounding: 'down',
        },
      } as any),
    );
    c.loadCheckoutSettings();
    expect(c.checkoutSettingsForm.shipping_fee_ron).toBe(15);
    expect(c.checkoutSettingsForm.free_shipping_threshold_ron).toBe(250);
    expect(c.checkoutSettingsForm.phone_required_home).toBe(false);
    expect(c.checkoutSettingsForm.fee_type).toBe('percent');
    expect(c.checkoutSettingsForm.money_rounding).toBe('down');

    admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.loadCheckoutSettings();
    expect(forget).toHaveBeenCalledWith('site.checkout');
    expect(c.checkoutSettingsForm.shipping_fee_ron).toBe(20);
  });

  it('loadCheckoutSettings clamps out-of-range numbers to defaults', () => {
    admin.getContent.and.returnValue(
      of({
        version: 2,
        meta: {
          shipping_fee_ron: 12,
          fee_type: 'percent',
          fee_value: 3,
          vat_rate_percent: 200,
          money_rounding: 'up',
          receipt_share_days: 5000,
        },
      } as any),
    );
    c.loadCheckoutSettings();
    expect(c.checkoutSettingsForm.shipping_fee_ron).toBe(12);
    expect(c.checkoutSettingsForm.vat_rate_percent).toBe(10); // out of range → default
    expect(c.checkoutSettingsForm.receipt_share_days).toBe(365); // out of range → default
    expect(c.checkoutSettingsForm.money_rounding).toBe('up');
  });

  it('saveCheckoutSettings normalises values and persists', () => {
    c.checkoutSettingsForm = {
      shipping_fee_ron: '15.5',
      free_shipping_threshold_ron: '-1',
      fee_type: 'percent',
      fee_value: '5',
      vat_enabled: true,
      vat_rate_percent: '200',
      money_rounding: 'down',
      receipt_share_days: '5000',
    } as any;
    admin.updateContentBlock.and.returnValue(of({ version: 2 } as any));
    c.saveCheckoutSettings();
    expect(withExpected).toHaveBeenCalledWith('site.checkout', jasmine.anything());
    const payload = admin.updateContentBlock.calls.mostRecent().args[1] as any;
    expect(payload.meta.shipping_fee_ron).toBe(15.5);
    expect(payload.meta.free_shipping_threshold_ron).toBe(300); // negative → default
    expect(payload.meta.fee_type).toBe('percent');
    expect(payload.meta.vat_rate_percent).toBe(10); // out of range → default
    expect(payload.meta.money_rounding).toBe('down');
    expect(payload.meta.receipt_share_days).toBe(365); // out of range → default
    expect(c.checkoutSettingsMessage).toBe('adminUi.site.checkout.success.save');
  });

  it('saveCheckoutSettings handles a version conflict', () => {
    c.checkoutSettingsForm = {} as any;
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveCheckoutSettings();
    expect(conflict).toHaveBeenCalled();
    expect(c.checkoutSettingsError).toBe('adminUi.site.checkout.errors.save');
    expect(c.checkoutSettingsMessage).toBeNull();
    expect(admin.createContent).not.toHaveBeenCalled();
  });

  it('saveCheckoutSettings falls back to create then reports errors', () => {
    c.checkoutSettingsForm = {} as any;
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    c.saveCheckoutSettings();
    expect(admin.createContent).toHaveBeenCalledWith('site.checkout', jasmine.anything());
    expect(c.checkoutSettingsMessage).toBe('adminUi.site.checkout.success.save');

    admin.createContent.and.returnValue(throwError(() => new Error('x')));
    c.saveCheckoutSettings();
    expect(c.checkoutSettingsError).toBe('adminUi.site.checkout.errors.save');
    expect(c.checkoutSettingsMessage).toBeNull();
  });
});
