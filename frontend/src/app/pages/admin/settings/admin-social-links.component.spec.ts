import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminSocialLinksComponent } from './admin-social-links.component';
import { AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';

/**
 * Behavioural spec for the extracted Settings > Social links panel. Mirrors the
 * scenarios that previously lived against AdminComponent so behaviour and branch
 * coverage move with the code.
 */
describe('AdminSocialLinksComponent', () => {
  let fixture: ComponentFixture<AdminSocialLinksComponent>;
  let c: AdminSocialLinksComponent;
  let admin: jasmine.SpyObj<
    Pick<
      AdminService,
      'getContent' | 'updateContentBlock' | 'createContent' | 'fetchSocialThumbnail'
    >
  >;
  let toast: jasmine.SpyObj<ToastService>;
  let remember: jasmine.Spy;
  let withExpected: jasmine.Spy;
  let conflict: jasmine.Spy;
  let forget: jasmine.Spy;

  beforeEach(async () => {
    admin = jasmine.createSpyObj('AdminService', [
      'getContent',
      'updateContentBlock',
      'createContent',
      'fetchSocialThumbnail',
    ]);
    admin.getContent.and.returnValue(of({ meta: {}, version: 1 } as any));
    admin.updateContentBlock.and.returnValue(of({ version: 1 } as any));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: '' } as any));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    await TestBed.configureTestingModule({
      imports: [AdminSocialLinksComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminSocialLinksComponent);
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

  it('creates and loads social on init', () => {
    fixture.detectChanges();
    expect(c).toBeTruthy();
    expect(admin.getContent).toHaveBeenCalledWith('site.social');
    expect(remember).toHaveBeenCalledWith('site.social', jasmine.anything());
  });

  it('loadSocial hydrates contact + pages and parses arrays', () => {
    admin.getContent.and.returnValue(
      of({
        meta: {
          contact: { phone: '+40 111', email: 'x@y.z' },
          instagram_pages: [{ label: 'IG', url: 'https://ig', thumbnail_url: 't' }],
          facebook_pages: [{ label: 'FB', url: 'https://fb' }],
        },
        version: 1,
      } as any),
    );
    c.loadSocial();
    expect(c.socialForm.phone).toBe('+40 111');
    expect(c.socialForm.email).toBe('x@y.z');
    expect(c.socialForm.instagram_pages).toEqual([
      { label: 'IG', url: 'https://ig', thumbnail_url: 't' },
    ]);
    expect(c.socialForm.facebook_pages).toEqual([
      { label: 'FB', url: 'https://fb', thumbnail_url: '' },
    ]);
  });

  it('loadSocial forgets version and keeps defaults on error', () => {
    const before = c.socialForm.instagram_pages.length;
    admin.getContent.and.returnValue(throwError(() => new Error('x')));
    c.loadSocial();
    expect(forget).toHaveBeenCalledWith('site.social');
    expect(c.socialForm.instagram_pages.length).toBe(before);
  });

  it('addSocialLink / removeSocialLink mutate the right list', () => {
    const igLen = c.socialForm.instagram_pages.length;
    c.addSocialLink('instagram');
    expect(c.socialForm.instagram_pages.length).toBe(igLen + 1);
    c.removeSocialLink('instagram', c.socialForm.instagram_pages.length - 1);
    expect(c.socialForm.instagram_pages.length).toBe(igLen);

    const fbLen = c.socialForm.facebook_pages.length;
    c.addSocialLink('facebook');
    expect(c.socialForm.facebook_pages.length).toBe(fbLen + 1);
    c.removeSocialLink('facebook', c.socialForm.facebook_pages.length - 1);
    expect(c.socialForm.facebook_pages.length).toBe(fbLen);
  });

  it('socialThumbKey is platform+index', () => {
    expect(c.socialThumbKey('instagram', 2)).toBe('instagram-2');
    expect(c.socialThumbKey('facebook', 0)).toBe('facebook-0');
  });

  it('fetchSocialThumbnail requires a url', () => {
    c.socialForm.instagram_pages = [{ label: '', url: '  ', thumbnail_url: '' }];
    c.fetchSocialThumbnail('instagram', 0);
    expect(c.socialThumbErrors['instagram-0']).toBe('adminUi.site.social.errors.urlRequired');
    expect(admin.fetchSocialThumbnail).not.toHaveBeenCalled();
  });

  it('fetchSocialThumbnail sets thumbnail and toasts on success', () => {
    c.socialForm.facebook_pages = [{ label: 'FB', url: 'https://fb', thumbnail_url: '' }];
    admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: 'https://thumb' } as any));
    c.fetchSocialThumbnail('facebook', 0);
    expect(c.socialForm.facebook_pages[0].thumbnail_url).toBe('https://thumb');
    expect(c.socialThumbLoading['facebook-0']).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('fetchSocialThumbnail reports empty-thumbnail response', () => {
    c.socialForm.instagram_pages = [{ label: 'IG', url: 'https://ig', thumbnail_url: '' }];
    admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: '' } as any));
    c.fetchSocialThumbnail('instagram', 0);
    expect(c.socialThumbErrors['instagram-0']).toBe('adminUi.site.social.errors.noThumbnail');
  });

  it('fetchSocialThumbnail surfaces server detail then generic error', () => {
    c.socialForm.instagram_pages = [{ label: 'IG', url: 'https://ig', thumbnail_url: '' }];
    admin.fetchSocialThumbnail.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    c.fetchSocialThumbnail('instagram', 0);
    expect(c.socialThumbErrors['instagram-0']).toBe('boom');

    admin.fetchSocialThumbnail.and.returnValue(throwError(() => new Error('x')));
    c.fetchSocialThumbnail('instagram', 0);
    expect(c.socialThumbErrors['instagram-0']).toBe('adminUi.site.social.errors.fetchFailed');
  });

  it('saveSocial sanitizes pages, updates then reports success', () => {
    c.socialForm.instagram_pages = [
      { label: 'IG', url: 'https://ig', thumbnail_url: 't' },
      { label: '', url: 'https://drop', thumbnail_url: '' },
    ];
    admin.updateContentBlock.and.returnValue(of({ version: 2 } as any));
    c.saveSocial();
    const payload = (admin.updateContentBlock.calls.mostRecent().args[1] as any).meta;
    expect(payload.instagram_pages).toEqual([
      { label: 'IG', url: 'https://ig', thumbnail_url: 't' },
    ]);
    expect(withExpected).toHaveBeenCalledWith('site.social', jasmine.anything());
    expect(remember).toHaveBeenCalledWith('site.social', jasmine.objectContaining({ version: 2 }));
    expect(c.socialMessage).toBe('adminUi.site.social.success.save');
  });

  it('saveSocial falls back to createContent when update fails', () => {
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 404 })));
    admin.createContent.and.returnValue(of({ version: 1 } as any));
    c.saveSocial();
    expect(admin.createContent).toHaveBeenCalledWith('site.social', jasmine.anything());
    expect(c.socialMessage).toBe('adminUi.site.social.success.save');
  });

  it('saveSocial reports error on a 409 conflict (handled)', () => {
    conflict.and.returnValue(true);
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 409 })));
    c.saveSocial();
    expect(conflict).toHaveBeenCalled();
    expect(c.socialError).toBe('adminUi.site.social.errors.save');
    expect(c.socialMessage).toBeNull();
  });

  it('saveSocial reports error when create also fails', () => {
    admin.updateContentBlock.and.returnValue(throwError(() => ({ status: 500 })));
    admin.createContent.and.returnValue(throwError(() => new Error('x')));
    c.saveSocial();
    expect(c.socialError).toBe('adminUi.site.social.errors.save');
    expect(c.socialMessage).toBeNull();
  });
});
