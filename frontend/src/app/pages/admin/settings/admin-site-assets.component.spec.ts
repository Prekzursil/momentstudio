import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminSiteAssetsComponent } from './admin-site-assets.component';
import { AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';

/**
 * Behavioural spec for the extracted Settings > Site assets panel. Mirrors the
 * scenarios that previously lived against AdminComponent so behaviour and branch
 * coverage move with the code. Provides the AdminService/ToastService surface the
 * embedded <app-asset-library> touches on init so detectChanges renders cleanly.
 */
describe('AdminSiteAssetsComponent', () => {
  let fixture: ComponentFixture<AdminSiteAssetsComponent>;
  let c: AdminSiteAssetsComponent;
  let admin: jasmine.SpyObj<
    Pick<
      AdminService,
      'getContent' | 'updateContentBlock' | 'createContent' | 'listContentImages'
    >
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
      'listContentImages',
    ]);
    admin.getContent.and.returnValue(of({ meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ version: 1 } as any));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    admin.listContentImages.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 24 } } as any),
    );
    const toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [AdminSiteAssetsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminSiteAssetsComponent);
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

  it('creates and loads assets on init', () => {
    fixture.detectChanges();
    expect(c).toBeTruthy();
    expect(admin.getContent).toHaveBeenCalledWith('site.assets');
    expect(remember).toHaveBeenCalledWith('site.assets', jasmine.anything());
  });

  it('loadAssets hydrates the form and clears + forgets version on error', () => {
    admin.getContent.and.returnValue(
      of({ meta: { logo_url: 'L', favicon_url: 'F', social_image_url: 'S' }, version: 1 } as any),
    );
    c.loadAssets();
    expect(c.assetsForm.logo_url).toBe('L');
    expect(c.assetsForm.favicon_url).toBe('F');
    expect(c.assetsForm.social_image_url).toBe('S');

    admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.loadAssets();
    expect(forget).toHaveBeenCalledWith('site.assets');
    expect(c.assetsForm.logo_url).toBe('');
  });

  it('saveAssets updates then reports success', () => {
    admin.updateContentBlock.and.returnValue(of({ version: 2 } as any));
    c.saveAssets();
    expect(withExpected).toHaveBeenCalledWith('site.assets', jasmine.anything());
    expect(remember).toHaveBeenCalledWith('site.assets', jasmine.objectContaining({ version: 2 }));
    expect(c.assetsMessage).toBe('adminUi.site.assets.success.save');
  });

  it('saveAssets falls back to createContent when update fails', () => {
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    c.saveAssets();
    expect(admin.createContent).toHaveBeenCalledWith('site.assets', jasmine.anything());
    expect(c.assetsMessage).toBe('adminUi.site.assets.success.save');
  });

  it('saveAssets reports error on a 409 conflict (handled)', () => {
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    admin.getContent.and.returnValue(of({ meta: {}, version: 1 } as any));
    c.saveAssets();
    expect(conflict).toHaveBeenCalled();
    expect(c.assetsError).toBe('adminUi.site.assets.errors.save');
    expect(c.assetsMessage).toBeNull();
  });

  it('saveAssets reports error when create also fails', () => {
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(throwError(() => new Error('x')));
    c.saveAssets();
    expect(c.assetsError).toBe('adminUi.site.assets.errors.save');
    expect(c.assetsMessage).toBeNull();
  });
});
