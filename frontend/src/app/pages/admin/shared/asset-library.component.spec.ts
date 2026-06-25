import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminService, ContentImageAssetRead } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { AssetLibraryComponent } from './asset-library.component';

function makeImage(overrides: Partial<ContentImageAssetRead> = {}): ContentImageAssetRead {
  return {
    id: 'img-1',
    url: '/media/test.jpg',
    alt_text: 'Old name',
    sort_order: 0,
    focal_x: 50,
    focal_y: 50,
    created_at: '2026-02-16T00:00:00Z',
    content_key: 'site.assets',
    tags: ['hero'],
    ...overrides,
  } as ContentImageAssetRead;
}

describe('AssetLibraryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;

  function create(): AssetLibraryComponent {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'listContentImages',
      'updateContentImage',
      'uploadContentImage',
      'updateContentImageTags',
      'deleteContentImage',
      'getContentImageUsage',
      'updateContentImageFocalPoint',
      'editContentImage',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    admin.listContentImages.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 24 } }),
    );
    admin.updateContentImage.and.returnValue(of(makeImage({ alt_text: 'Renamed' })) as never);
    admin.uploadContentImage.and.returnValue(of(makeImage()) as never);
    admin.updateContentImageTags.and.returnValue(of(makeImage({ tags: ['a', 'b'] })) as never);
    admin.deleteContentImage.and.returnValue(of(undefined) as never);
    admin.getContentImageUsage.and.returnValue(of({ keys: [], stored_in_key: '' }) as never);
    admin.updateContentImageFocalPoint.and.returnValue(
      of(makeImage({ focal_x: 10, focal_y: 20 })) as never,
    );
    admin.editContentImage.and.returnValue(of(makeImage()) as never);

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AssetLibraryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.inject(TranslateService).use('en');
    return TestBed.createComponent(AssetLibraryComponent).componentInstance;
  }

  it('initializes the key from initialKey and reloads on init', () => {
    const component = create();
    component.initialKey = '  home.hero  ';
    component.ngOnInit();
    expect(component.key).toBe('home.hero');
    expect(admin.listContentImages).toHaveBeenCalled();
  });

  it('resets the page and reloads when initialKey changes', () => {
    const component = create();
    component.page = 5;
    component.initialKey = 'page.about';
    component.ngOnChanges({ initialKey: new SimpleChange('', 'page.about', false) });
    expect(component.key).toBe('page.about');
    expect(component.page).toBe(1);
  });

  it('ignores ngOnChanges without an initialKey change', () => {
    const component = create();
    component.page = 3;
    component.ngOnChanges({});
    expect(component.page).toBe(3);
  });

  it('metaTotalPages exposes the total pages', () => {
    const component = create();
    admin.listContentImages.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 4, page: 1, limit: 24 } }),
    );
    component.reload();
    expect(component.metaTotalPages()).toBe(4);
  });

  it('reload populates images and tolerates a missing meta', () => {
    const component = create();
    admin.listContentImages.and.returnValue(of({ items: [makeImage()], meta: undefined }) as never);
    component.reload(true);
    expect(component.images().length).toBe(1);
    expect(component.metaTotalPages()).toBe(1);
    expect(component.loading()).toBeFalse();
  });

  it('reload surfaces an error with a request id', () => {
    const component = create();
    admin.listContentImages.and.returnValue(throwError(() => ({ error: { request_id: 'r-9' } })));
    component.reload();
    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBeFalse();
  });

  it('reload short-circuits on an invalid date range', () => {
    const component = create();
    component.createdFrom = '2026-03-02';
    component.createdTo = '2026-03-01';
    admin.listContentImages.calls.reset();
    component.reload(true);
    expect(admin.listContentImages).not.toHaveBeenCalled();
    expect(component.error()).toBeTruthy();
  });

  it('prev and next respect page bounds', () => {
    const component = create();
    admin.listContentImages.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 3, page: 1, limit: 24 } }),
    );
    component.reload();
    component.prev();
    expect(component.page).toBe(1);
    component.next();
    expect(component.page).toBe(2);
    component.next();
    expect(component.page).toBe(3);
    component.next();
    expect(component.page).toBe(3);
    component.prev();
    expect(component.page).toBe(2);
  });

  describe('upload', () => {
    it('does nothing without a selected file', () => {
      const component = create();
      component.upload({ target: { files: [] } } as unknown as Event);
      expect(admin.uploadContentImage).not.toHaveBeenCalled();
    });

    it('uploads a file, resets paging and clears the input', () => {
      const component = create();
      const file = new File(['x'], 'x.png');
      const input = { files: [file], value: 'x.png' } as unknown as HTMLInputElement;
      component.page = 3;
      component.upload({ target: input } as unknown as Event);
      expect(admin.uploadContentImage).toHaveBeenCalledWith('site.assets', file);
      expect(toast.success).toHaveBeenCalled();
      expect(component.page).toBe(1);
      expect(input.value).toBe('');
    });

    it('toasts on an upload error', () => {
      const component = create();
      admin.uploadContentImage.and.returnValue(throwError(() => new Error('nope')));
      const file = new File(['x'], 'x.png');
      component.upload({ target: { files: [file], value: '' } } as unknown as Event);
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('copy', () => {
    it('does nothing for a blank url', () => {
      const component = create();
      component.copy('   ');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('errors when the clipboard API is unavailable', () => {
      const component = create();
      const desc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      component.copy('/media/a.jpg');
      expect(toast.error).toHaveBeenCalled();
      if (desc) Object.defineProperty(navigator, 'clipboard', desc);
    });

    it('copies and toasts success', async () => {
      const component = create();
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      component.copy('/media/a.jpg');
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('/media/a.jpg');
      expect(toast.success).toHaveBeenCalled();
    });

    it('toasts an error when the clipboard write rejects', async () => {
      const component = create();
      const writeText = jasmine.createSpy('writeText').and.rejectWith(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      component.copy('/media/a.jpg');
      await Promise.resolve();
      await Promise.resolve();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('applyTagFilter sets the tag and reloads, ignoring blanks', () => {
    const component = create();
    component.applyTagFilter('   ');
    expect(component.tag).toBe('');
    component.applyTagFilter(' hero ');
    expect(component.tag).toBe('hero');
    expect(component.page).toBe(1);
  });

  describe('editAltText', () => {
    it('does nothing without an id', () => {
      const component = create();
      component.editAltText(makeImage({ id: '' }));
      expect(admin.updateContentImage).not.toHaveBeenCalled();
    });

    it('cancels when the prompt is dismissed', () => {
      const component = create();
      spyOn(window, 'prompt').and.returnValue(null);
      component.editAltText(makeImage());
      expect(admin.updateContentImage).not.toHaveBeenCalled();
    });

    it('renames and syncs images and the open details modal', () => {
      const component = create();
      component.images.set([makeImage()]);
      component.detailsImage = makeImage();
      admin.updateContentImage.and.returnValue(of(makeImage({ alt_text: 'New' })) as never);
      spyOn(window, 'prompt').and.returnValue('New');
      component.editAltText(makeImage());
      expect(admin.updateContentImage).toHaveBeenCalledWith('img-1', { alt_text: 'New' });
      expect(component.images()[0].alt_text).toBe('New');
      expect(component.detailsImage?.alt_text).toBe('New');
      expect(toast.success).toHaveBeenCalled();
    });

    it('sends null for a cleared alt text and toasts on error', () => {
      const component = create();
      component.images.set([makeImage()]);
      admin.updateContentImage.and.returnValue(throwError(() => new Error('x')));
      spyOn(window, 'prompt').and.returnValue('   ');
      component.editAltText(makeImage());
      expect(admin.updateContentImage).toHaveBeenCalledWith('img-1', { alt_text: null });
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('openDetails and closeDetails toggle the details modal', () => {
    const component = create();
    component.openDetails(makeImage({ id: '' }));
    expect(component.detailsImage).toBeNull();
    component.openDetails(makeImage());
    expect(component.detailsImage).not.toBeNull();
    component.closeDetails();
    expect(component.detailsImage).toBeNull();
  });

  describe('editTags', () => {
    it('does nothing without an id or when cancelled', () => {
      const component = create();
      component.editTags(makeImage({ id: '' }));
      expect(admin.updateContentImageTags).not.toHaveBeenCalled();
      spyOn(window, 'prompt').and.returnValue(null);
      component.editTags(makeImage());
      expect(admin.updateContentImageTags).not.toHaveBeenCalled();
    });

    it('parses tags, updates images and toasts', () => {
      const component = create();
      component.images.set([makeImage()]);
      spyOn(window, 'prompt').and.returnValue('a, , b');
      component.editTags(makeImage());
      expect(admin.updateContentImageTags).toHaveBeenCalledWith('img-1', ['a', 'b']);
      expect(component.images()[0].tags).toEqual(['a', 'b']);
      expect(toast.success).toHaveBeenCalled();
    });

    it('toasts on a tag save error', () => {
      const component = create();
      admin.updateContentImageTags.and.returnValue(throwError(() => new Error('x')));
      spyOn(window, 'prompt').and.returnValue('a');
      component.editTags(makeImage());
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('openUsage opens the usage modal and loads usage', () => {
    const component = create();
    component.openUsage(makeImage({ id: '' }));
    expect(component.usageImage).toBeNull();
    admin.getContentImageUsage.and.returnValue(
      of({ keys: ['home.hero'], stored_in_key: 'site.assets' }) as never,
    );
    component.openUsage(makeImage());
    expect(component.usageImage).not.toBeNull();
    expect(component.usageKeys()).toEqual(['home.hero']);
    expect(component.usageStoredInKey()).toBe('site.assets');
  });

  describe('loadUsage', () => {
    it('does nothing without a current usage image', () => {
      const component = create();
      component.usageImage = null;
      component.loadUsage();
      expect(component.usageLoading()).toBeFalse();
    });

    it('toasts via error state on failure', () => {
      const component = create();
      component.usageImage = makeImage();
      admin.getContentImageUsage.and.returnValue(throwError(() => ({ error: {} })));
      component.loadUsage();
      expect(component.usageError()).toBeTruthy();
      expect(component.usageLoading()).toBeFalse();
    });
  });

  it('closeUsage resets all usage state', () => {
    const component = create();
    component.usageImage = makeImage();
    component.usageKeys.set(['x']);
    component.closeUsage();
    expect(component.usageImage).toBeNull();
    expect(component.usageKeys()).toEqual([]);
  });

  it('jumpToKey sets the key, closes usage and reloads', () => {
    const component = create();
    component.jumpToKey('   ');
    expect(component.key).toBe('');
    component.usageImage = makeImage();
    component.jumpToKey(' page.about ');
    expect(component.key).toBe('page.about');
    expect(component.usageImage).toBeNull();
  });

  describe('focal editor', () => {
    it('opens with clamped draft coordinates and guards a missing id', () => {
      const component = create();
      component.openFocalEditor(makeImage({ id: '' }));
      expect(component.focalImage).toBeNull();

      component.openFocalEditor(makeImage({ focal_x: 150, focal_y: -20 }));
      expect(component.focalDraftX).toBe(100);
      expect(component.focalDraftY).toBe(0);
    });

    it('falls back to the centre for non-finite focal points', () => {
      const component = create();
      component.openFocalEditor(makeImage({ focal_x: NaN as never, focal_y: NaN as never }));
      expect(component.focalDraftX).toBe(50);
      expect(component.focalDraftY).toBe(50);
    });

    it('closeFocalEditor is blocked while saving', () => {
      const component = create();
      component.focalImage = makeImage();
      component.focalSaving.set(true);
      component.closeFocalEditor();
      expect(component.focalImage).not.toBeNull();
      component.focalSaving.set(false);
      component.closeFocalEditor();
      expect(component.focalImage).toBeNull();
    });

    it('pickFocal computes draft coordinates and guards bad targets', () => {
      const component = create();
      component.pickFocal({ currentTarget: null } as unknown as MouseEvent);
      const zeroTarget = {
        getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
      };
      component.pickFocal({
        currentTarget: zeroTarget,
        clientX: 5,
        clientY: 5,
      } as unknown as MouseEvent);
      const target = {
        getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, top: 0 }),
      };
      component.pickFocal({
        currentTarget: target,
        clientX: 100,
        clientY: 50,
      } as unknown as MouseEvent);
      expect(component.focalDraftX).toBe(50);
      expect(component.focalDraftY).toBe(50);
      expect(component.focalObjectPosition()).toBe('50% 50%');
    });

    it('saveFocalEditor guards, saves and handles errors', () => {
      const component = create();
      component.focalImage = makeImage({ id: '' });
      component.saveFocalEditor();
      expect(admin.updateContentImageFocalPoint).not.toHaveBeenCalled();

      component.images.set([makeImage()]);
      component.focalImage = makeImage();
      component.focalDraftX = 30;
      component.focalDraftY = 40;
      component.saveFocalEditor();
      expect(admin.updateContentImageFocalPoint).toHaveBeenCalledWith('img-1', 30, 40);
      expect(component.focalImage).toBeNull();
      expect(toast.success).toHaveBeenCalled();

      component.focalImage = makeImage();
      admin.updateContentImageFocalPoint.and.returnValue(throwError(() => new Error('x')));
      component.saveFocalEditor();
      expect(toast.error).toHaveBeenCalled();
      expect(component.focalSaving()).toBeFalse();
    });
  });

  describe('image editor', () => {
    it('opens with reset fields and guards a missing id', () => {
      const component = create();
      component.openImageEditor(makeImage({ id: '' }));
      expect(component.editImage).toBeNull();

      component.editRotateCw = 90;
      component.openImageEditor(makeImage());
      expect(component.editImage).not.toBeNull();
      expect(component.editRotateCw as number).toBe(0);
      expect(component.editCropPreset).toBe('none');
    });

    it('closeImageEditor is blocked while saving', () => {
      const component = create();
      component.editImage = makeImage();
      component.editSaving.set(true);
      component.closeImageEditor();
      expect(component.editImage).not.toBeNull();
      component.editSaving.set(false);
      component.closeImageEditor();
      expect(component.editImage).toBeNull();
    });

    it('editPreviewAspectClass maps every crop preset', () => {
      const component = create();
      const cases: Array<[typeof component.editCropPreset, string]> = [
        ['square', 'aspect-[1/1]'],
        ['hero', 'aspect-[16/7]'],
        ['card', 'aspect-[4/3]'],
        ['mobile', 'aspect-[9/16]'],
        ['none', 'aspect-[16/9]'],
      ];
      for (const [preset, expected] of cases) {
        component.editCropPreset = preset;
        expect(component.editPreviewAspectClass()).toBe(expected);
      }
    });

    it('createEditedCopy guards, validates a no-op and submits edits', () => {
      const component = create();
      component.editImage = makeImage({ id: '' });
      component.createEditedCopy();
      expect(admin.editContentImage).not.toHaveBeenCalled();

      component.editImage = makeImage();
      component.editRotateCw = 0;
      component.editCropPreset = 'none';
      component.editMaxWidth = null;
      component.editMaxHeight = null;
      component.createEditedCopy();
      expect(toast.error).toHaveBeenCalled();
      expect(admin.editContentImage).not.toHaveBeenCalled();

      component.editImage = makeImage();
      component.editRotateCw = 90;
      component.editCropPreset = 'hero';
      component.editMaxWidth = 1600;
      component.editMaxHeight = 1200;
      component.createEditedCopy();
      expect(admin.editContentImage).toHaveBeenCalledWith('img-1', {
        rotate_cw: 90,
        crop_aspect_w: 16,
        crop_aspect_h: 7,
        resize_max_width: 1600,
        resize_max_height: 1200,
      });
      expect(component.editImage).toBeNull();
      expect(toast.success).toHaveBeenCalled();
    });

    it('createEditedCopy ignores an unknown crop preset and toasts on error', () => {
      const component = create();
      admin.editContentImage.and.returnValue(throwError(() => new Error('x')));
      component.editImage = makeImage();
      component.editCropPreset = 'bogus' as never;
      component.editMaxWidth = 800;
      component.createEditedCopy();
      expect(admin.editContentImage).toHaveBeenCalledWith('img-1', { resize_max_width: 800 });
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('deleteAsset', () => {
    it('does nothing without an id', () => {
      const component = create();
      component.deleteAsset(makeImage({ id: '' }));
      expect(admin.getContentImageUsage).not.toHaveBeenCalled();
    });

    it('blocks deletion and opens usage when the asset is in use', () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(of({ keys: ['home.hero'] }) as never);
      component.deleteAsset(makeImage());
      expect(toast.error).toHaveBeenCalled();
      expect(component.usageImage).not.toBeNull();
      expect(admin.deleteContentImage).not.toHaveBeenCalled();
    });

    it('aborts when the confirm dialog is dismissed', () => {
      const component = create();
      spyOn(window, 'confirm').and.returnValue(false);
      component.deleteAsset(makeImage());
      expect(admin.deleteContentImage).not.toHaveBeenCalled();
    });

    it('deletes when confirmed and reloads', () => {
      const component = create();
      spyOn(window, 'confirm').and.returnValue(true);
      component.deleteAsset(makeImage());
      expect(admin.deleteContentImage).toHaveBeenCalledWith('img-1');
      expect(toast.success).toHaveBeenCalled();
    });

    it('toasts when the delete request fails', () => {
      const component = create();
      spyOn(window, 'confirm').and.returnValue(true);
      admin.deleteContentImage.and.returnValue(throwError(() => new Error('x')));
      component.deleteAsset(makeImage());
      expect(toast.error).toHaveBeenCalled();
    });

    it('toasts when the usage lookup fails', () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(throwError(() => new Error('x')));
      component.deleteAsset(makeImage());
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('deleteAssetGroup', () => {
    const original = makeImage({ id: 'orig', root_image_id: undefined });
    const edit = makeImage({ id: 'edit', root_image_id: 'orig' });

    it('falls back to deleteAsset when there are no edits', async () => {
      const component = create();
      const spy = spyOn(component, 'deleteAsset');
      await component.deleteAssetGroup({
        primary: original,
        original,
        edits: [],
        latestAt: 0,
      });
      expect(spy).toHaveBeenCalledWith(original);
    });

    it('blocks deletion when any image in the group is in use', async () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(of({ keys: ['home.hero'] }) as never);
      await component.deleteAssetGroup({
        primary: original,
        original,
        edits: [edit],
        latestAt: 0,
      });
      expect(toast.error).toHaveBeenCalled();
      expect(component.usageImage).not.toBeNull();
    });

    it('toasts when a usage lookup throws', async () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(throwError(() => new Error('x')));
      await component.deleteAssetGroup({
        primary: original,
        original,
        edits: [edit],
        latestAt: 0,
      });
      expect(toast.error).toHaveBeenCalled();
    });

    it('aborts when the confirm dialog is dismissed', async () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(of({ keys: [] }) as never);
      spyOn(window, 'confirm').and.returnValue(false);
      await component.deleteAssetGroup({
        primary: original,
        original,
        edits: [edit],
        latestAt: 0,
      });
      expect(admin.deleteContentImage).not.toHaveBeenCalled();
    });

    it('deletes all versions when confirmed', async () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(of({ keys: [] }) as never);
      spyOn(window, 'confirm').and.returnValue(true);
      await component.deleteAssetGroup({
        primary: original,
        original,
        edits: [edit],
        latestAt: 0,
      });
      expect(admin.deleteContentImage).toHaveBeenCalledWith('orig', { delete_versions: true });
      expect(toast.success).toHaveBeenCalled();
    });

    it('toasts when the group delete fails', async () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(of({ keys: [] }) as never);
      spyOn(window, 'confirm').and.returnValue(true);
      admin.deleteContentImage.and.returnValue(throwError(() => new Error('x')));
      await component.deleteAssetGroup({
        primary: original,
        original,
        edits: [edit],
        latestAt: 0,
      });
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('assetGroups', () => {
    it('groups originals with their edits, newest version first', () => {
      const component = create();
      component.images.set([
        makeImage({ id: 'orig', root_image_id: undefined, created_at: '2026-01-01T00:00:00Z' }),
        makeImage({ id: 'e1', root_image_id: 'orig', created_at: '2026-01-02T00:00:00Z' }),
        makeImage({ id: 'e2', root_image_id: 'orig', created_at: '2026-01-03T00:00:00Z' }),
      ]);
      const groups = component.assetGroups();
      expect(groups.length).toBe(1);
      expect(groups[0].primary.id).toBe('orig');
      expect(groups[0].edits.map((e) => e.id)).toEqual(['e2', 'e1']);
    });

    it('promotes the newest edit to primary when no original is present', () => {
      const component = create();
      component.images.set([
        makeImage({ id: 'e1', root_image_id: 'ghost', created_at: '2026-01-02T00:00:00Z' }),
        makeImage({ id: 'e2', root_image_id: 'ghost', created_at: '2026-01-03T00:00:00Z' }),
      ]);
      const groups = component.assetGroups();
      expect(groups[0].primary.id).toBe('e2');
      expect(groups[0].original).toBeNull();
    });

    it('skips entries without a group id and handles invalid dates', () => {
      const component = create();
      component.images.set([
        makeImage({ id: '', root_image_id: undefined }),
        makeImage({ id: 'ok', root_image_id: undefined, created_at: 'not-a-date' }),
      ]);
      const groups = component.assetGroups();
      expect(groups.length).toBe(1);
      expect(groups[0].primary.id).toBe('ok');
    });

    it('orders groups by most-recent activity first', () => {
      const component = create();
      component.images.set([
        makeImage({ id: 'older', root_image_id: undefined, created_at: '2026-01-01T00:00:00Z' }),
        makeImage({ id: 'newer', root_image_id: undefined, created_at: '2026-05-01T00:00:00Z' }),
      ]);
      const groups = component.assetGroups();
      expect(groups.length).toBe(2);
      expect(groups[0].primary.id).toBe('newer');
      expect(groups[1].primary.id).toBe('older');
    });
  });

  it('useAsset emits the url and the asset, ignoring blanks', () => {
    const component = create();
    const urls: string[] = [];
    const assets: ContentImageAssetRead[] = [];
    component.select.subscribe((u) => urls.push(u));
    component.selectAsset.subscribe((a) => assets.push(a));

    component.useAsset(makeImage({ url: '   ' }));
    expect(urls).toEqual([]);

    component.useAsset(makeImage({ url: '/media/x.jpg' }));
    expect(urls).toEqual(['/media/x.jpg']);
    expect(assets.length).toBe(1);
  });

  describe('branch coverage top-offs', () => {
    it('handles an empty initialKey on init and change', () => {
      const component = create();
      component.initialKey = '';
      component.ngOnInit();
      expect(component.key).toBe('');
      component.ngOnChanges({ initialKey: new SimpleChange('x', '', false) });
      expect(component.key).toBe('');
    });

    it('treats a null items payload as an empty list', () => {
      const component = create();
      admin.listContentImages.and.returnValue(
        of({ items: null, meta: { total_items: 0, total_pages: 1, page: 1, limit: 24 } }) as never,
      );
      component.reload();
      expect(component.images()).toEqual([]);
    });

    it('drops an unparseable created date boundary', () => {
      const component = create();
      component.createdFrom = 'not-a-date';
      admin.listContentImages.calls.reset();
      component.reload();
      expect(admin.listContentImages).toHaveBeenCalledWith(
        jasmine.objectContaining({ created_from: undefined }),
      );
    });

    it('copy and applyTagFilter and jumpToKey ignore empty (falsy) values', () => {
      const component = create();
      component.copy('');
      expect(toast.success).not.toHaveBeenCalled();
      component.applyTagFilter('');
      expect(component.tag).toBe('');
      component.jumpToKey('');
      expect(component.key).toBe('');
    });

    it('useAsset ignores an empty url', () => {
      const component = create();
      const urls: string[] = [];
      component.select.subscribe((u) => urls.push(u));
      component.useAsset(makeImage({ url: '' }));
      expect(urls).toEqual([]);
    });

    it('editAltText defaults a missing alt text and leaves other images untouched', () => {
      const component = create();
      component.images.set([makeImage({ id: 'other' }), makeImage({ id: 'img-1' })]);
      admin.updateContentImage.and.returnValue(of(makeImage({ alt_text: 'New' })) as never);
      spyOn(window, 'prompt').and.returnValue('New');
      component.editAltText(makeImage({ alt_text: null as never }));
      expect(component.images().find((i) => i.id === 'other')?.id).toBe('other');
      expect(component.images().find((i) => i.id === 'img-1')?.alt_text).toBe('New');
    });

    it('editTags defaults missing tags and leaves other images untouched', () => {
      const component = create();
      component.images.set([makeImage({ id: 'other' }), makeImage({ id: 'img-1' })]);
      admin.updateContentImageTags.and.returnValue(
        of(makeImage({ tags: undefined as never })) as never,
      );
      spyOn(window, 'prompt').and.returnValue('a');
      component.editTags(makeImage({ tags: undefined as never }));
      expect(component.images().find((i) => i.id === 'other')).toBeTruthy();
      expect(component.images().find((i) => i.id === 'img-1')?.tags).toEqual([]);
    });

    it('deleteAsset treats a usage response without keys as not in use', () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(of({}) as never);
      spyOn(window, 'confirm').and.returnValue(true);
      component.deleteAsset(makeImage());
      expect(admin.deleteContentImage).toHaveBeenCalled();
    });

    it('loadUsage tolerates a usage response without keys', () => {
      const component = create();
      component.usageImage = makeImage();
      admin.getContentImageUsage.and.returnValue(of({ stored_in_key: '' }) as never);
      component.loadUsage();
      expect(component.usageKeys()).toEqual([]);
      expect(component.usageStoredInKey()).toBeNull();
    });

    it('saveFocalEditor leaves non-matching images untouched', () => {
      const component = create();
      component.images.set([makeImage({ id: 'other' }), makeImage({ id: 'img-1' })]);
      component.focalImage = makeImage();
      component.saveFocalEditor();
      expect(component.images().find((i) => i.id === 'other')).toBeTruthy();
    });

    it('buildAssetGroups tolerates a null images signal and a missing created_at', () => {
      const component = create();
      component.images.set(null as never);
      expect(component.assetGroups()).toEqual([]);
      component.images.set([
        makeImage({ id: 'o', root_image_id: undefined, created_at: undefined as never }),
      ]);
      expect(component.assetGroups().length).toBe(1);
    });

    it('deleteAssetGroup tolerates a missing edits array', async () => {
      const component = create();
      const spy = spyOn(component, 'deleteAsset');
      await component.deleteAssetGroup({
        primary: makeImage(),
        original: makeImage(),
        edits: undefined as never,
        latestAt: 0,
      });
      expect(spy).toHaveBeenCalled();
    });

    it('deleteAssetGroup skips id-less images and aborts when the original has no id', async () => {
      const component = create();
      admin.getContentImageUsage.and.returnValue(of({}) as never);
      spyOn(window, 'confirm').and.returnValue(true);
      await component.deleteAssetGroup({
        primary: makeImage(),
        original: makeImage({ id: '' }),
        edits: [makeImage({ id: 'edit', root_image_id: 'orig' })],
        latestAt: 0,
      });
      expect(admin.deleteContentImage).not.toHaveBeenCalled();
    });
  });
});
