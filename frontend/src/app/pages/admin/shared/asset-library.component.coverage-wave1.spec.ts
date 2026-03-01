import { of, throwError } from 'rxjs';

import { AssetLibraryComponent } from './asset-library.component';

function createImage(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    url: `/media/${id}.jpg`,
    alt_text: 'alt',
    sort_order: 0,
    focal_x: 50,
    focal_y: 50,
    created_at: '2026-02-16T00:00:00Z',
    content_key: 'site.hero',
    tags: ['hero'],
    ...overrides,
  };
}

function createComponent() {
  const admin = jasmine.createSpyObj('AdminService', [
    'listContentImages',
    'uploadContentImage',
    'updateContentImage',
    'updateContentImageTags',
    'getContentImageUsage',
    'deleteContentImage',
    'updateContentImageFocalPoint',
    'editContentImage',
  ]);
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  const translate = { instant: (key: string) => key };

  admin.listContentImages.and.returnValue(
    of({ items: [createImage('img-a')], meta: { total_items: 1, total_pages: 2, page: 1, limit: 24 } } as any)
  );
  admin.uploadContentImage.and.returnValue(of({}));
  admin.updateContentImage.and.returnValue(of({ alt_text: 'renamed' } as any));
  admin.updateContentImageTags.and.returnValue(of({ tags: ['new'] } as any));
  admin.getContentImageUsage.and.returnValue(of({ keys: [], stored_in_key: null } as any));
  admin.deleteContentImage.and.returnValue(of({}));
  admin.updateContentImageFocalPoint.and.returnValue(of({ focal_x: 25, focal_y: 75 } as any));
  admin.editContentImage.and.returnValue(of({}));

  const component = new AssetLibraryComponent(admin as any, toast as any, translate as any);
  return { component, admin, toast };
}

describe('AssetLibraryComponent coverage wave 1', () => {
  it('initializes from initial key and reacts to key input changes', () => {
    const { component } = createComponent();
    const reload = spyOn(component, 'reload').and.stub();

    component.initialKey = '  site.hero  ';
    component.ngOnInit();
    expect(component.key).toBe('site.hero');
    expect(reload).toHaveBeenCalledTimes(1);

    component.page = 4;
    component.initialKey = '  site.banner ';
    component.ngOnChanges({
      initialKey: {
        currentValue: 'site.banner',
        previousValue: 'site.hero',
        firstChange: false,
        isFirstChange: () => false,
      },
    } as any);
    expect(component.key).toBe('site.banner');
    expect(component.page).toBe(1);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('handles reload validation and error request-id extraction', () => {
    const { component, admin } = createComponent();
    component.createdFrom = '2026-02-10';
    component.createdTo = '2026-02-09';

    component.reload(true);
    expect(component.error()).toBe('adminUi.site.assets.library.errors.invalidDateRange');
    expect(component.images()).toEqual([]);
    expect(component.loading()).toBeFalse();

    component.createdFrom = '2026-02-01';
    component.createdTo = '2026-02-02';
    admin.listContentImages.and.returnValue(
      throwError(() => ({ headers: { get: (name: string) => (name.toLowerCase() === 'x-request-id' ? 'RID-55' : null) } }))
    );
    component.reload(true);
    expect(component.error()).toBe('adminUi.site.assets.library.errors.load');
    expect(component.errorRequestId()).toBeNull();
  });

  it('navigates pages and applies total page constraints', () => {
    const { component } = createComponent();
    const reload = spyOn(component, 'reload').and.stub();
    component.page = 2;
    (component as any).totalPages.set(3);

    component.prev();
    expect(component.page).toBe(1);
    expect(reload).toHaveBeenCalled();

    component.next();
    expect(component.page).toBe(2);

    component.page = 3;
    reload.calls.reset();
    component.next();
    expect(component.page).toBe(3);
    expect(reload).not.toHaveBeenCalled();
  });

  it('uploads assets and handles both success and error branches', () => {
    const { component, admin, toast } = createComponent();
    const reload = spyOn(component, 'reload').and.stub();
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'asset.jpg')] });
    input.value = 'pending';

    component.upload({ target: input } as any);
    expect(admin.uploadContentImage).toHaveBeenCalled();
    expect(component.page).toBe(1);
    expect(reload).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('adminUi.site.assets.library.success.uploaded');
    expect(input.value).toBe('');

    admin.uploadContentImage.and.returnValue(throwError(() => new Error('upload-fail')));
    component.upload({ target: input } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.errors.upload');
  });

  it('copies URLs with clipboard success and failure fallbacks', async () => {
    const { component, toast } = createComponent();
    const originalClipboard = (navigator as any).clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    component.copy('https://example.test/a.jpg');
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.errors.copy');

    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    component.copy('https://example.test/b.jpg');
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://example.test/b.jpg');
    expect(toast.success).toHaveBeenCalledWith('adminUi.site.assets.library.success.copied');

    writeText.and.returnValue(Promise.reject(new Error('clipboard-fail')));
    component.copy('https://example.test/c.jpg');
    await Promise.resolve();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.errors.copy');

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
  });

  it('edits tags and opens/closes details panel', () => {
    const { component, admin, toast } = createComponent();
    component.images.set([createImage('img-a')]);
    spyOn(window, 'prompt').and.returnValue(' one, two ');
    component.editTags(createImage('img-a'));
    expect(admin.updateContentImageTags).toHaveBeenCalledWith('img-a', ['one', 'two']);
    expect(toast.success).toHaveBeenCalledWith('adminUi.site.assets.library.tagsSaved');

    component.openDetails(createImage('img-a'));
    expect(component.detailsImage?.id).toBe('img-a');
    component.closeDetails();
    expect(component.detailsImage).toBeNull();

    admin.updateContentImageTags.and.returnValue(throwError(() => new Error('tags-fail')));
    component.editTags(createImage('img-a'));
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.tagsErrorsSave');
  });

  it('deletes asset groups with usage/confirm/delete branches', async () => {
    const { component, admin, toast } = createComponent();
    const reload = spyOn(component, 'reload').and.stub();
    const openUsage = spyOn(component, 'openUsage').and.stub();

    const original = createImage('img-1');
    const edited = createImage('img-2', { root_image_id: 'img-1' });

    admin.getContentImageUsage.and.returnValue(of({ keys: ['home.hero'], stored_in_key: null } as any));
    await component.deleteAssetGroup({ primary: original, original, edits: [edited], latestAt: Date.now() } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.errors.deleteInUse');
    expect(openUsage).toHaveBeenCalled();

    admin.getContentImageUsage.and.returnValue(of({ keys: [], stored_in_key: null } as any));
    spyOn(window, 'confirm').and.returnValue(true);
    await component.deleteAssetGroup({ primary: original, original, edits: [edited], latestAt: Date.now() } as any);
    expect(admin.deleteContentImage).toHaveBeenCalledWith('img-1', { delete_versions: true });
    expect(component.page).toBe(1);
    expect(reload).toHaveBeenCalled();

    admin.deleteContentImage.and.returnValue(throwError(() => new Error('delete-fail')));
    await component.deleteAssetGroup({ primary: original, original, edits: [edited], latestAt: Date.now() } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.errors.delete');
  });

  it('loads and clears usage state with jump-to-key flow', () => {
    const { component, admin, toast } = createComponent();
    const reload = spyOn(component, 'reload').and.stub();
    component.usageImage = createImage('img-1');
    admin.getContentImageUsage.and.returnValue(of({ keys: ['home.hero'], stored_in_key: 'assets/img-1' } as any));
    component.loadUsage();
    expect(component.usageKeys()).toEqual(['home.hero']);
    expect(component.usageStoredInKey()).toBe('assets/img-1');

    admin.getContentImageUsage.and.returnValue(
      throwError(() => ({ headers: { get: (name: string) => (name.toLowerCase() === 'x-request-id' ? 'RID-77' : null) } }))
    );
    component.loadUsage();
    expect(component.usageError()).toBe('adminUi.site.assets.library.errors.usage');
    expect(component.usageRequestId()).toBeNull();
    expect(toast.error).not.toHaveBeenCalledWith('adminUi.site.assets.library.errors.usage');

    component.jumpToKey('  site.banner ');
    expect(component.key).toBe('site.banner');
    expect(component.usageImage).toBeNull();
    expect(reload).toHaveBeenCalledWith(true);
  });

  it('handles focal editor and image editor save/error branches', () => {
    const { component, admin, toast } = createComponent();
    const reload = spyOn(component, 'reload').and.stub();
    component.images.set([createImage('img-1')]);

    component.openFocalEditor(createImage('img-1', { focal_x: 120, focal_y: -10 }));
    expect(component.focalDraftX).toBe(100);
    expect(component.focalDraftY).toBe(0);
    component.pickFocal({
      currentTarget: {
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 200 }),
      },
      clientX: 60,
      clientY: 120,
    } as any);
    expect(component.focalObjectPosition()).toContain('%');
    component.saveFocalEditor();
    expect(admin.updateContentImageFocalPoint).toHaveBeenCalled();
    expect(component.focalImage).toBeNull();

    component.openImageEditor(createImage('img-1'));
    component.createEditedCopy();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.editorErrorsNoop');

    component.openImageEditor(createImage('img-1'));
    component.editRotateCw = 90;
    component.editCropPreset = 'hero';
    component.editMaxWidth = 1200;
    component.editMaxHeight = 900;
    component.createEditedCopy();
    expect(admin.editContentImage).toHaveBeenCalledWith(
      'img-1',
      jasmine.objectContaining({
        rotate_cw: 90,
        crop_aspect_w: 16,
        crop_aspect_h: 7,
        resize_max_width: 1200,
        resize_max_height: 900,
      })
    );
    expect(reload).toHaveBeenCalled();

    admin.editContentImage.and.returnValue(throwError(() => new Error('edit-fail')));
    component.openImageEditor(createImage('img-1'));
    component.editRotateCw = 90;
    component.createEditedCopy();
    expect(toast.error).toHaveBeenCalledWith('adminUi.site.assets.library.errors.edit');
  });

  it('builds grouped assets, date boundaries, and emits selected asset values', () => {
    const { component } = createComponent();
    const original = createImage('root-1', { created_at: '2026-02-10T00:00:00Z' });
    const editOne = createImage('edit-1', { root_image_id: 'root-1', created_at: '2026-02-11T00:00:00Z' });
    const editTwo = createImage('edit-2', { root_image_id: 'root-1', created_at: '2026-02-12T00:00:00Z' });
    const groups = (component as any).buildAssetGroups([editOne, original, editTwo]);

    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('root-1');
    expect(groups[0].edits.map((row: any) => row.id)).toEqual(['edit-2', 'edit-1']);
    expect((component as any).toIsoDateBoundary('2026-02-01', 'start')).toContain('T00:00:00.000Z');
    expect((component as any).toIsoDateBoundary('bad-date', 'end')).toBeUndefined();

    const emitUrl = spyOn(component.select, 'emit').and.stub();
    const emitAsset = spyOn(component.selectAsset, 'emit').and.stub();
    component.useAsset(createImage('root-1', { url: ' https://example.test/final.jpg ' }));
    expect(emitUrl).toHaveBeenCalledWith('https://example.test/final.jpg');
    expect(emitAsset).toHaveBeenCalled();
  });
});
