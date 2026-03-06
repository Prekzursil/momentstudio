import { of, throwError } from 'rxjs';

import { ProductImageManagerModalComponent } from './product-image-manager-modal.component';

function createHarness() {
  const admin = jasmine.createSpyObj('AdminService', [
    'reorderProductImage',
    'getProductImageTranslations',
    'upsertProductImageTranslation',
    'deleteProductImageTranslation'
  ]);
  admin.reorderProductImage.and.returnValue(of({}));
  admin.getProductImageTranslations.and.returnValue(
    of([
      { lang: 'ro', alt_text: 'Alt RO', caption: 'Cap RO' },
      { lang: 'en', alt_text: 'Alt EN', caption: 'Cap EN' }
    ] as any)
  );
  admin.upsertProductImageTranslation.and.returnValue(of({}));
  admin.deleteProductImageTranslation.and.returnValue(of({}));

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'action']);
  const translate = { instant: jasmine.createSpy('instant').and.callFake((key: string) => key) };

  const component = new ProductImageManagerModalComponent(admin as any, toast as any, translate as any);
  component.slug = 'product-a';
  component.open = true;
  component.images = [
    { id: 'img-1', url: '/a.jpg', sort_order: 1, alt_text: 'A' },
    { id: 'img-2', url: '/b.jpg', sort_order: 2, alt_text: 'B' }
  ] as any;

  return { component, admin, toast };
}

function dragEventStub(): DragEvent {
  return {
    preventDefault: jasmine.createSpy('preventDefault'),
    dataTransfer: {
      setData: jasmine.createSpy('setData'),
      effectAllowed: 'none',
      dropEffect: 'none'
    }
  } as unknown as DragEvent;
}

describe('ProductImageManagerModalComponent coverage wave', () => {
  it('covers open/close changes and reorder capability guards', () => {
    const { component } = createHarness();

    component.ngOnChanges({ open: { currentValue: true }, images: { currentValue: component.images } } as any);
    expect(component.draftImages.length).toBe(2);
    expect(component.canReorder()).toBeTrue();

    component.orderSaving = true;
    expect(component.canReorder()).toBeFalse();

    component.orderSaving = false;
    component.slug = '';
    expect(component.canReorder()).toBeFalse();

    component.open = false;
    component.ngOnChanges({ open: { currentValue: false } } as any);
    expect(component.draftImages.length).toBe(0);
  });

  it('covers drag and drop reorder success path plus undo action', () => {
    const { component, admin, toast } = createHarness();
    const evt = dragEventStub();
    spyOn(component.imagesChange, 'emit');

    component.ngOnChanges({ open: { currentValue: true }, images: { currentValue: component.images } } as any);

    component.onDragStart(evt, 'img-2');
    expect(component.draggingImageId).toBe('img-2');

    component.onDragOver(evt, 'img-1');
    expect(component.dragOverImageId).toBe('img-1');

    component.onDrop(evt, 'img-1');
    expect(admin.reorderProductImage).toHaveBeenCalled();
    expect(component.imagesChange.emit).toHaveBeenCalled();
    expect(toast.action).toHaveBeenCalled();

    const undo = toast.action.calls.mostRecent().args[2] as () => void;
    undo();
    expect(admin.reorderProductImage.calls.count()).toBeGreaterThan(2);

    component.onDragEnd();
    expect(component.draggingImageId).toBeNull();
    expect(component.dragOverImageId).toBeNull();
  });

  it('covers reorder error branch and makePrimary flow', () => {
    const { component, admin } = createHarness();
    const evt = dragEventStub();

    component.ngOnChanges({ open: { currentValue: true }, images: { currentValue: component.images } } as any);

    admin.reorderProductImage.and.returnValue(throwError(() => new Error('reorder failed')));
    component.onDragStart(evt, 'img-2');
    component.onDrop(evt, 'img-1');
    expect(component.orderError).toBe('adminUi.storefront.products.images.reorderError');

    admin.reorderProductImage.and.returnValue(of({}));
    component.makePrimary('img-2');
    expect(admin.reorderProductImage).toHaveBeenCalled();
  });

  it('covers metadata loading and save branches', () => {
    const { component, admin, toast } = createHarness();
    spyOn(component.imagesChange, 'emit');

    component.ngOnChanges({ open: { currentValue: true }, images: { currentValue: component.images } } as any);

    component.toggleMeta('img-1');
    expect(component.editingImageId).toBe('img-1');
    expect(component.metaBusy).toBeFalse();
    expect(component.imageMeta.ro.alt_text).toBe('Alt RO');

    component.imageMeta.ro.alt_text = 'Nou alt';
    component.imageMeta.en.alt_text = 'New alt';
    component.saveMeta();
    expect(admin.upsertProductImageTranslation).toHaveBeenCalled();
    expect(component.imagesChange.emit).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    admin.upsertProductImageTranslation.and.returnValue(throwError(() => new Error('meta save fail')));
    component.imageMeta.ro.alt_text = 'Again';
    component.saveMeta();
    expect(component.metaError).toBe('adminUi.products.form.imageMetaSaveError');
  });

  it('covers metadata delete and close handlers', () => {
    const { component, admin } = createHarness();
    spyOn(component.closed, 'emit');

    component.ngOnChanges({ open: { currentValue: true }, images: { currentValue: component.images } } as any);
    component.toggleMeta('img-1');

    component.imageMeta.ro.alt_text = '';
    component.imageMeta.ro.caption = '';
    component.imageMeta.en.alt_text = '';
    component.imageMeta.en.caption = '';
    component.saveMeta();
    expect(admin.deleteProductImageTranslation).toHaveBeenCalled();

    admin.getProductImageTranslations.and.returnValue(throwError(() => new Error('meta load fail')));
    component.toggleMeta('img-2');
    expect(component.metaError).toBe('adminUi.storefront.products.images.metaLoadError');

    component.handleClosed();
    expect(component.closed.emit).toHaveBeenCalled();
    expect(component.draftImages.length).toBe(0);
  });
});
