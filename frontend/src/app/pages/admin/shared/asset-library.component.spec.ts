import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AdminService, ContentImageAssetRead } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { AssetLibraryComponent } from './asset-library.component';

describe('AssetLibraryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;

  const baseImage: ContentImageAssetRead = {
    id: 'img-1',
    url: '/media/test.jpg',
    alt_text: 'Old name',
    sort_order: 0,
    focal_x: 50,
    focal_y: 50,
    created_at: '2026-02-16T00:00:00Z',
    content_key: 'site.assets',
    tags: ['hero']
  };

  beforeEach(() => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'listContentImages',
      'updateContentImage',
      'uploadContentImage',
      'updateContentImageTags',
      'deleteContentImage',
      'getContentImageUsage',
      'updateContentImageFocalPoint',
      'editContentImage'
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    admin.listContentImages.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 24 }
      })
    );
    admin.updateContentImage.and.returnValue(of({ ...baseImage, alt_text: 'Renamed image' }));

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AssetLibraryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast }
      ]
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        adminUi: {
          site: {
            assets: {
              library: {
                renamePrompt: 'Display name (alt text)',
                success: { renamed: 'Renamed.' },
                errors: {
                  rename: 'Rename failed.',
                  invalidDateRange: 'Invalid date range.'
                }
              }
            }
          }
        }
      },
      true
    );
    translate.use('en');
  });

  it('passes sort and created date filters when reloading assets', () => {
    const fixture = TestBed.createComponent(AssetLibraryComponent);
    const component = fixture.componentInstance;
    component.sort = 'key_desc';
    component.createdFrom = '2026-02-01';
    component.createdTo = '2026-02-02';

    component.reload(true);

    expect(admin.listContentImages).toHaveBeenCalledWith(
      jasmine.objectContaining({
        sort: 'key_desc',
        created_from: '2026-02-01T00:00:00.000Z',
        created_to: '2026-02-02T23:59:59.999Z',
        page: 1
      })
    );
  });

  it('short-circuits with validation error on invalid date ranges', () => {
    const fixture = TestBed.createComponent(AssetLibraryComponent);
    const component = fixture.componentInstance;
    component.createdFrom = '2026-03-02';
    component.createdTo = '2026-03-01';
    admin.listContentImages.calls.reset();

    component.reload(true);

    expect(admin.listContentImages).not.toHaveBeenCalled();
    expect(component.error()).toBe('Invalid date range.');
  });

  it('renames image alt text through the admin endpoint', () => {
    const fixture = TestBed.createComponent(AssetLibraryComponent);
    const component = fixture.componentInstance;
    component.images.set([{ ...baseImage }]);
    spyOn(window, 'prompt').and.returnValue('Renamed image');

    component.editAltText(baseImage);

    expect(admin.updateContentImage).toHaveBeenCalledWith('img-1', { alt_text: 'Renamed image' });
    expect(component.images()[0].alt_text).toBe('Renamed image');
    expect(toast.success).toHaveBeenCalledWith('Renamed.');
  });
});
