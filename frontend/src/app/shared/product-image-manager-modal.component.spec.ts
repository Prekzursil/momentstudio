import { SimpleChanges } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminService } from '../core/admin.service';
import { ToastService } from '../core/toast.service';
import { ProductImageManagerModalComponent } from './product-image-manager-modal.component';

type Img = {
  id?: string;
  url: string;
  alt_text?: string | null;
  caption?: string | null;
  sort_order?: number | null;
};

describe('ProductImageManagerModalComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'reorderProductImage',
      'getProductImageTranslations',
      'upsertProductImageTranslation',
      'deleteProductImageTranslation',
    ]);
    admin.reorderProductImage.and.returnValue(of({}) as never);
    admin.getProductImageTranslations.and.returnValue(of([]) as never);
    admin.upsertProductImageTranslation.and.returnValue(of({}) as never);
    admin.deleteProductImageTranslation.and.returnValue(of({}) as never);

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'action']);

    TestBed.configureTestingModule({
      imports: [ProductImageManagerModalComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
      ],
    }).overrideComponent(ProductImageManagerModalComponent, {
      set: { template: '', imports: [] },
    });
  });

  function make(): ProductImageManagerModalComponent {
    return TestBed.createComponent(ProductImageManagerModalComponent).componentInstance;
  }

  function seed(cmp: ProductImageManagerModalComponent, images: Img[], slug = 'tee'): void {
    cmp.slug = slug;
    cmp.images = images as never;
    cmp.open = true;
    cmp.ngOnChanges({ open: { currentValue: true } } as unknown as SimpleChanges);
  }

  const twoImages: Img[] = [
    { id: 'a', url: 'http://x/a.png', sort_order: 1 },
    { id: 'b', url: 'http://x/b.png', sort_order: 2 },
  ];

  it('creates', () => {
    expect(make()).toBeTruthy();
  });

  describe('ngOnChanges + seeding', () => {
    it('ignores changes without open or images', () => {
      const cmp = make();
      cmp.draftImages = [{ url: 'keep' }] as never;
      cmp.ngOnChanges({ slug: {} } as unknown as SimpleChanges);
      expect(cmp.draftImages.length).toBe(1);
    });

    it('resets when closed', () => {
      const cmp = make();
      cmp.draftImages = [{ url: 'x' }] as never;
      cmp.open = false;
      cmp.ngOnChanges({ open: { currentValue: false } } as unknown as SimpleChanges);
      expect(cmp.draftImages).toEqual([]);
    });

    it('normalizes, filters blank urls and sorts by sort_order', () => {
      const cmp = make();
      seed(cmp, [
        { id: 'b', url: 'http://x/b.png', sort_order: 2, alt_text: 'B', caption: 'cap' },
        { url: '   ', sort_order: 0 },
        { id: 'a', url: 'http://x/a.png', sort_order: 1, alt_text: null, caption: null },
        { url: 'http://x/c.png', sort_order: undefined as never },
      ]);
      expect(cmp.draftImages.map((i) => i.url)).toEqual([
        'http://x/c.png',
        'http://x/a.png',
        'http://x/b.png',
      ]);
    });

    it('handles a non-array images input', () => {
      const cmp = make();
      cmp.slug = 'tee';
      cmp.images = null as never;
      cmp.open = true;
      cmp.ngOnChanges({ images: { currentValue: null } } as unknown as SimpleChanges);
      expect(cmp.draftImages).toEqual([]);
    });
  });

  describe('canReorder', () => {
    it('is false while saving order', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.orderSaving = true;
      expect(cmp.canReorder()).toBeFalse();
    });

    it('is false without a slug', () => {
      const cmp = make();
      seed(cmp, twoImages, '   ');
      expect(cmp.canReorder()).toBeFalse();
    });

    it('is false when some images lack ids', () => {
      const cmp = make();
      seed(cmp, [{ id: 'a', url: 'http://x/a.png' }, { url: 'http://x/b.png' }]);
      expect(cmp.canReorder()).toBeFalse();
    });

    it('is false with a single image', () => {
      const cmp = make();
      seed(cmp, [{ id: 'a', url: 'http://x/a.png' }]);
      expect(cmp.canReorder()).toBeFalse();
    });

    it('is true with multiple identified images', () => {
      const cmp = make();
      seed(cmp, twoImages);
      expect(cmp.canReorder()).toBeTrue();
    });
  });

  describe('drag handlers', () => {
    function dt(): DataTransfer {
      return { setData: jasmine.createSpy('setData'), effectAllowed: '', dropEffect: '' } as never;
    }

    it('onDragStart ignores when reorder is not allowed', () => {
      const cmp = make();
      seed(cmp, [{ id: 'a', url: 'http://x/a.png' }]);
      cmp.onDragStart({ dataTransfer: dt() } as never, 'a');
      expect(cmp.draggingImageId).toBeNull();
    });

    it('onDragStart ignores a blank id', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.onDragStart({ dataTransfer: dt() } as never, '   ');
      expect(cmp.draggingImageId).toBeNull();
    });

    it('onDragStart records the dragged id and sets transfer data', () => {
      const cmp = make();
      seed(cmp, twoImages);
      const transfer = dt();
      cmp.onDragStart({ dataTransfer: transfer } as never, 'a');
      expect(cmp.draggingImageId).toBe('a');
      expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'a');
      expect(transfer.effectAllowed).toBe('move');
    });

    it('onDragStart swallows transfer errors', () => {
      const cmp = make();
      seed(cmp, twoImages);
      expect(() => cmp.onDragStart({ dataTransfer: undefined } as never, 'a')).not.toThrow();
      expect(cmp.draggingImageId).toBe('a');
    });

    it('onDragOver ignores when reorder not allowed', () => {
      const cmp = make();
      seed(cmp, [{ id: 'a', url: 'http://x/a.png' }]);
      const event = { preventDefault: jasmine.createSpy('pd'), dataTransfer: dt() } as never;
      cmp.onDragOver(event, 'a');
      expect((event as { preventDefault: jasmine.Spy }).preventDefault).not.toHaveBeenCalled();
    });

    it('onDragOver ignores when nothing is being dragged', () => {
      const cmp = make();
      seed(cmp, twoImages);
      const event = { preventDefault: jasmine.createSpy('pd') } as never;
      cmp.onDragOver(event, 'b');
      expect((event as { preventDefault: jasmine.Spy }).preventDefault).not.toHaveBeenCalled();
    });

    it('onDragOver ignores hovering the dragged item or a blank id', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draggingImageId = 'a';
      const event = { preventDefault: jasmine.createSpy('pd') } as never;
      cmp.onDragOver(event, 'a');
      cmp.onDragOver(event, '  ');
      expect((event as { preventDefault: jasmine.Spy }).preventDefault).not.toHaveBeenCalled();
    });

    it('onDragOver marks the hovered target and sets dropEffect', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draggingImageId = 'a';
      const transfer = dt();
      const event = { preventDefault: jasmine.createSpy('pd'), dataTransfer: transfer } as never;
      cmp.onDragOver(event, 'b');
      expect(cmp.dragOverImageId).toBe('b');
      expect(transfer.dropEffect).toBe('move');
    });

    it('onDragOver works without a dataTransfer', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draggingImageId = 'a';
      const event = { preventDefault: jasmine.createSpy('pd'), dataTransfer: null } as never;
      cmp.onDragOver(event, 'b');
      expect(cmp.dragOverImageId).toBe('b');
    });

    it('onDrop reorders and persists', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draggingImageId = 'a';
      const event = { preventDefault: jasmine.createSpy('pd') } as never;
      cmp.onDrop(event, 'b');
      expect(cmp.draftImages.map((i) => i.id)).toEqual(['b', 'a']);
      expect(admin.reorderProductImage).toHaveBeenCalled();
    });

    it('onDrop ignores when nothing dragged, blank/same target, or move fails', () => {
      const cmp = make();
      seed(cmp, twoImages);
      const event = { preventDefault: jasmine.createSpy('pd') } as never;
      cmp.onDrop(event, 'b'); // no dragging
      cmp.draggingImageId = 'a';
      cmp.onDrop(event, '  '); // blank target
      cmp.onDrop(event, 'a'); // same target
      cmp.draggingImageId = 'missing';
      cmp.onDrop(event, 'b'); // reorder returns false (from id not found)
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('onDragEnd clears drag state', () => {
      const cmp = make();
      cmp.draggingImageId = 'a';
      cmp.dragOverImageId = 'b';
      cmp.onDragEnd();
      expect(cmp.draggingImageId).toBeNull();
      expect(cmp.dragOverImageId).toBeNull();
    });
  });

  describe('makePrimary', () => {
    it('ignores when reorder not allowed', () => {
      const cmp = make();
      seed(cmp, [{ id: 'a', url: 'http://x/a.png' }]);
      cmp.makePrimary('a');
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('ignores a blank id, the current primary, or a missing id', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.makePrimary('  ');
      cmp.makePrimary('a'); // already first
      cmp.makePrimary('zzz'); // not found
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('moves an image to the front and persists', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.makePrimary('b');
      expect(cmp.draftImages.map((i) => i.id)).toEqual(['b', 'a']);
      expect(admin.reorderProductImage).toHaveBeenCalled();
    });
  });

  describe('persistOrder', () => {
    it('emits change and offers an undo on success', () => {
      const cmp = make();
      seed(cmp, twoImages);
      const changes: unknown[] = [];
      cmp.imagesChange.subscribe((v) => changes.push(v));
      cmp.makePrimary('b');
      expect(changes.length).toBe(1);
      expect(toast.action).toHaveBeenCalled();
      // Invoke the undo callback to drive undoImageOrder back to original order.
      const undo = toast.action.calls.mostRecent().args[2] as () => void;
      admin.reorderProductImage.calls.reset();
      undo();
      expect(cmp.draftImages.map((i) => i.id)).toEqual(['a', 'b']);
      expect(toast.success).toHaveBeenCalled();
    });

    it('restores order and reports an error when persistence fails', () => {
      const cmp = make();
      seed(cmp, twoImages);
      admin.reorderProductImage.and.returnValue(throwError(() => new Error('boom')) as never);
      cmp.makePrimary('b');
      expect(cmp.orderError).toBeTruthy();
      expect(cmp.draftImages.map((i) => i.id)).toEqual(['a', 'b']);
    });

    it('does nothing without a slug or while already saving', () => {
      const cmp = make();
      seed(cmp, twoImages);
      const previous = ['a', 'b'];
      cmp.slug = '';
      (cmp as unknown as { persistOrder(p: string[]): void }).persistOrder(previous);
      cmp.slug = 'tee';
      cmp.orderSaving = true;
      (cmp as unknown as { persistOrder(p: string[]): void }).persistOrder(previous);
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('does nothing when some images lack ids', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draftImages = [{ id: 'a', url: 'x' }, { url: 'y' }] as never;
      (cmp as unknown as { persistOrder(p: string[]): void }).persistOrder(['a', 'b']);
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });
  });

  describe('undoImageOrder guards', () => {
    function undo(cmp: ProductImageManagerModalComponent, prev: string[], cur: string[]): void {
      (cmp as unknown as { undoImageOrder(p: string[], c: string[]): void }).undoImageOrder(
        prev,
        cur,
      );
    }

    it('bails on missing slug, while saving, or length mismatch', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.slug = '';
      undo(cmp, ['a', 'b'], ['b', 'a']);
      cmp.slug = 'tee';
      cmp.orderSaving = true;
      undo(cmp, ['a', 'b'], ['b', 'a']);
      cmp.orderSaving = false;
      undo(cmp, ['a'], ['b', 'a']); // length mismatch
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('reports an error and restores when the undo request fails', () => {
      const cmp = make();
      seed(cmp, twoImages);
      admin.reorderProductImage.and.returnValue(throwError(() => new Error('boom')) as never);
      undo(cmp, ['b', 'a'], ['a', 'b']);
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('meta editing', () => {
    it('toggleMeta ignores a blank id', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.toggleMeta('  ');
      expect(cmp.editingImageId).toBeNull();
    });

    it('toggleMeta loads metadata then clears on a second toggle', () => {
      const cmp = make();
      seed(cmp, twoImages);
      admin.getProductImageTranslations.and.returnValue(
        of([
          { lang: 'ro', alt_text: 'ROtext', caption: 'ROcap' },
          { lang: 'en', alt_text: 'ENtext', caption: '' },
          { lang: 'fr', alt_text: 'x', caption: 'y' },
          { alt_text: 'no-lang' },
        ]) as never,
      );
      cmp.toggleMeta('a');
      expect(cmp.editingImageId).toBe('a');
      expect(cmp.imageMeta.ro.alt_text).toBe('ROtext');
      expect(cmp.imageMeta.en.alt_text).toBe('ENtext');
      expect(cmp.metaExists).toEqual({ en: true, ro: true });
      cmp.toggleMeta('a');
      expect(cmp.editingImageId).toBeNull();
    });

    it('loadMeta handles a non-array response and an error', () => {
      const cmp = make();
      seed(cmp, twoImages);
      admin.getProductImageTranslations.and.returnValue(of(null) as never);
      cmp.toggleMeta('a');
      expect(cmp.imageMeta.ro.alt_text).toBe('');
      cmp.toggleMeta('a'); // clear
      admin.getProductImageTranslations.and.returnValue(
        throwError(() => new Error('nope')) as never,
      );
      cmp.toggleMeta('a');
      expect(cmp.metaError).toBeTruthy();
      expect(cmp.metaBusy).toBeFalse();
    });

    it('loadMeta bails without a slug', () => {
      const cmp = make();
      seed(cmp, twoImages);
      admin.getProductImageTranslations.calls.reset();
      cmp.slug = '';
      cmp.toggleMeta('a');
      expect(admin.getProductImageTranslations).not.toHaveBeenCalled();
    });

    it('saveMeta bails without slug, image, or while saving', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.editingImageId = 'a';
      cmp.slug = ''; // empty slug -> bails
      cmp.saveMeta();
      cmp.slug = 'tee';
      cmp.editingImageId = null;
      cmp.saveMeta(); // no editing image
      cmp.editingImageId = 'a';
      cmp.metaSaving = true;
      cmp.saveMeta();
      expect(admin.upsertProductImageTranslation).not.toHaveBeenCalled();
    });

    it('saveMeta returns early when there are no operations to run', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.editingImageId = 'a';
      cmp.metaExists = { en: false, ro: false };
      cmp.imageMeta = { ro: { alt_text: '', caption: '' }, en: { alt_text: '', caption: '' } };
      cmp.saveMeta();
      expect(admin.upsertProductImageTranslation).not.toHaveBeenCalled();
      expect(cmp.metaSaving).toBeFalse();
    });

    it('saveMeta upserts, deletes, applies local meta and toasts on success', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.currentLang = 'ro';
      cmp.editingImageId = 'a';
      cmp.metaExists = { en: true, ro: false };
      cmp.imageMeta = {
        ro: { alt_text: 'Alt RO', caption: 'Cap RO' },
        en: { alt_text: '', caption: '' },
      };
      const changes: unknown[] = [];
      cmp.imagesChange.subscribe((v) => changes.push(v));
      cmp.saveMeta();
      expect(admin.upsertProductImageTranslation).toHaveBeenCalled();
      expect(admin.deleteProductImageTranslation).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
      const target = cmp.draftImages.find((i) => i.id === 'a');
      expect(target?.alt_text).toBe('Alt RO');
      expect(changes.length).toBe(1);
    });

    it('saveMeta sets an error message on failure', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.editingImageId = 'a';
      cmp.metaExists = { en: false, ro: false };
      cmp.imageMeta = {
        ro: { alt_text: 'Alt', caption: '' },
        en: { alt_text: '', caption: 'Cap' },
      };
      admin.upsertProductImageTranslation.and.returnValue(
        throwError(() => new Error('nope')) as never,
      );
      cmp.saveMeta();
      expect(cmp.metaError).toBeTruthy();
      expect(cmp.metaSaving).toBeFalse();
    });

    it('applyLocalMetaToDraftImage still emits when the image is gone', () => {
      const cmp = make();
      seed(cmp, twoImages);
      const changes: unknown[] = [];
      cmp.imagesChange.subscribe((v) => changes.push(v));
      (
        cmp as unknown as { applyLocalMetaToDraftImage(id: string): void }
      ).applyLocalMetaToDraftImage('missing');
      expect(changes.length).toBe(1);
    });
  });

  it('handleClosed resets and emits closed', () => {
    const cmp = make();
    seed(cmp, twoImages);
    const closed = jasmine.createSpy('closed');
    cmp.closed.subscribe(closed);
    cmp.handleClosed();
    expect(cmp.draftImages).toEqual([]);
    expect(closed).toHaveBeenCalled();
  });

  describe('defensive id/url fallbacks', () => {
    it('drag handlers ignore an undefined image id', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.onDragStart({ dataTransfer: undefined } as never, undefined);
      expect(cmp.draggingImageId).toBeNull();
      cmp.draggingImageId = 'b';
      const event = { preventDefault: jasmine.createSpy('pd') } as never;
      cmp.onDragOver(event, undefined);
      cmp.onDrop(event, undefined);
      expect((event as { preventDefault: jasmine.Spy }).preventDefault).not.toHaveBeenCalled();
    });

    it('onDrop returns when reordering is not allowed', () => {
      const cmp = make();
      seed(cmp, [{ id: 'a', url: 'http://x/a.png' }]);
      cmp.draggingImageId = 'a';
      const event = { preventDefault: jasmine.createSpy('pd') } as never;
      cmp.onDrop(event, 'b');
      expect((event as { preventDefault: jasmine.Spy }).preventDefault).not.toHaveBeenCalled();
    });

    it('toggleMeta and makePrimary ignore an undefined image id', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.toggleMeta(undefined);
      expect(cmp.editingImageId).toBeNull();
      cmp.makePrimary(undefined);
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('makePrimary returns when there is no current primary image', () => {
      const cmp = make();
      seed(cmp, twoImages);
      spyOn(cmp, 'canReorder').and.returnValue(true);
      cmp.draftImages = [];
      cmp.makePrimary('x');
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('onDrop tolerates id-less drafts when reordering fails', () => {
      const cmp = make();
      seed(cmp, twoImages);
      spyOn(cmp, 'canReorder').and.returnValue(true);
      cmp.draftImages = [{ url: 'x' }, { id: 'b', url: 'y' }] as never;
      cmp.draggingImageId = 'b';
      const event = { preventDefault: jasmine.createSpy('pd') } as never;
      cmp.onDrop(event, 'missing');
      expect(admin.reorderProductImage).not.toHaveBeenCalled();
    });

    it('makePrimary tolerates id-less drafts while computing the new order', () => {
      const cmp = make();
      seed(cmp, twoImages);
      spyOn(cmp, 'canReorder').and.returnValue(true);
      cmp.draftImages = [{ id: 'a', url: 'x' }, { url: 'y' }, { id: 'c', url: 'z' }] as never;
      cmp.makePrimary('c');
      expect(cmp.draftImages[0].id).toBe('c');
    });

    it('reorderDraftImages tolerates id-less drafts', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draftImages = [{ url: 'x' }, { id: 'b', url: 'y' }] as never;
      const moved = (
        cmp as unknown as { reorderDraftImages(f: string, t: string): boolean }
      ).reorderDraftImages('', 'b');
      expect(moved).toBeTrue();
    });

    it('restoreDraftOrder tolerates id-less and unknown drafts', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draftImages = [{ url: 'x' }, { url: 'y' }] as never;
      expect(() =>
        (cmp as unknown as { restoreDraftOrder(ids: string[]): void }).restoreDraftOrder([]),
      ).not.toThrow();
    });

    it('seedDraftImages tolerates an entry without a url', () => {
      const cmp = make();
      seed(cmp, [{ id: 'z' } as never, { id: 'a', url: 'http://x/a.png', sort_order: 1 }]);
      expect(cmp.draftImages.map((i) => i.id)).toEqual(['a']);
    });

    it('loadMeta stores empty strings for blank translation fields', () => {
      const cmp = make();
      seed(cmp, twoImages);
      admin.getProductImageTranslations.and.returnValue(
        of([{ lang: 'ro', alt_text: '', caption: '' }]) as never,
      );
      cmp.toggleMeta('a');
      expect(cmp.imageMeta.ro.alt_text).toBe('');
      expect(cmp.imageMeta.ro.caption).toBe('');
      expect(cmp.metaExists.ro).toBeTrue();
    });

    it('applyLocalMetaToDraftImage clears empty meta on a matching id-less list', () => {
      const cmp = make();
      seed(cmp, twoImages);
      cmp.draftImages = [{ url: 'x' }, { id: 'a', url: 'y' }] as never;
      cmp.currentLang = 'en';
      cmp.imageMeta = { ro: { alt_text: '', caption: '' }, en: { alt_text: '', caption: '' } };
      (
        cmp as unknown as { applyLocalMetaToDraftImage(id: string): void }
      ).applyLocalMetaToDraftImage('a');
      const match = cmp.draftImages.find((i) => i.id === 'a');
      expect(match?.alt_text).toBeNull();
      expect(match?.caption).toBeNull();
    });

    it('undoImageOrder tolerates blank previous ids and id-less drafts', () => {
      const cmp = make();
      seed(cmp, twoImages);
      // blank id filtered out -> length mismatch -> early bail
      (cmp as unknown as { undoImageOrder(p: string[], c: string[]): void }).undoImageOrder(
        ['', 'b'],
        ['x'],
      );
      // id-less draft exercised in the success callback's lookup
      cmp.draftImages = [{ id: 'a', url: 'x' }, { url: 'y' }] as never;
      (cmp as unknown as { undoImageOrder(p: string[], c: string[]): void }).undoImageOrder(
        ['a', 'x'],
        ['x', 'a'],
      );
      expect(admin.reorderProductImage).toHaveBeenCalled();
    });
  });
});
