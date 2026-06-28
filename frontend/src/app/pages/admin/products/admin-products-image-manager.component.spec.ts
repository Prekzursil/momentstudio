import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';

import type {
  AdminDeletedProductImage,
  AdminProductImageOptimizationStats,
} from '../../../core/admin.service';
import {
  AdminProductsImageManagerComponent,
  type AdminProductImageUploadItem,
  type AdminProductImageUploadStatus,
} from './admin-products-image-manager.component';

type ImageItem = { id: string; url: string; alt_text?: string | null };

type ImageMetaByLang = Record<'en' | 'ro', { alt_text: string; caption: string }>;

function makeUpload(overrides: Partial<AdminProductImageUploadItem> = {}): AdminProductImageUploadItem {
  return {
    id: 'u1',
    fileName: 'photo.png',
    bytes: 2048,
    status: 'queued',
    progress: 0,
    error: null,
    ...overrides,
  };
}

function makeMeta(): ImageMetaByLang {
  return {
    en: { alt_text: '', caption: '' },
    ro: { alt_text: '', caption: '' },
  };
}

describe('AdminProductsImageManagerComponent', () => {
  let fixture: ComponentFixture<AdminProductsImageManagerComponent>;
  let component: AdminProductsImageManagerComponent;

  // Writable signals backing the component's Signal-typed inputs.
  let images: WritableSignal<ImageItem[]>;
  let editingImageId: WritableSignal<string | null>;
  let imageOrderBusy: WritableSignal<boolean>;
  let imageOrderError: WritableSignal<string | null>;
  let imageMetaBusy: WritableSignal<boolean>;
  let imageMetaError: WritableSignal<string | null>;
  let deleteImageConfirmBusy: WritableSignal<boolean>;
  let deletedImagesOpen: WritableSignal<boolean>;
  let deletedImagesBusy: WritableSignal<boolean>;
  let deletedImagesError: WritableSignal<string | null>;
  let deletedImages: WritableSignal<AdminDeletedProductImage[]>;
  let restoringDeletedImage: WritableSignal<string | null>;
  let uploads: WritableSignal<AdminProductImageUploadItem[]>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminProductsImageManagerComponent, TranslateModule.forRoot()],
    });

    fixture = TestBed.createComponent(AdminProductsImageManagerComponent);
    component = fixture.componentInstance;

    images = signal<ImageItem[]>([]);
    editingImageId = signal<string | null>(null);
    imageOrderBusy = signal(false);
    imageOrderError = signal<string | null>(null);
    imageMetaBusy = signal(false);
    imageMetaError = signal<string | null>(null);
    deleteImageConfirmBusy = signal(false);
    deletedImagesOpen = signal(false);
    deletedImagesBusy = signal(false);
    deletedImagesError = signal<string | null>(null);
    deletedImages = signal<AdminDeletedProductImage[]>([]);
    restoringDeletedImage = signal<string | null>(null);
    uploads = signal<AdminProductImageUploadItem[]>([]);

    component.hasEditingSlug = true;
    component.images = images;
    component.editingImageId = editingImageId;
    component.imageOrderBusy = imageOrderBusy;
    component.imageOrderError = imageOrderError;
    component.imageMetaBusy = imageMetaBusy;
    component.imageMetaError = imageMetaError;
    component.deleteImageConfirmBusy = deleteImageConfirmBusy;
    component.deletedImagesOpen = deletedImagesOpen;
    component.deletedImagesBusy = deletedImagesBusy;
    component.deletedImagesError = deletedImagesError;
    component.deletedImages = deletedImages;
    component.restoringDeletedImage = restoringDeletedImage;
    component.imageMeta = makeMeta();
    component.uploads = uploads;
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  describe('formatBytes', () => {
    it('returns an em dash for null', () => {
      expect(component.formatBytes(null)).toBe('—');
    });

    it('returns an em dash for undefined', () => {
      expect(component.formatBytes(undefined)).toBe('—');
    });

    it('returns an em dash for non-finite numbers', () => {
      expect(component.formatBytes(Number.NaN)).toBe('—');
      expect(component.formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
    });

    it('rounds raw bytes with no decimals (idx === 0 branch)', () => {
      expect(component.formatBytes(0)).toBe('0 B');
      expect(component.formatBytes(512)).toBe('512 B');
      expect(component.formatBytes(1023)).toBe('1023 B');
    });

    it('converts to KB with one decimal (idx !== 0 branch)', () => {
      expect(component.formatBytes(1024)).toBe('1 KB');
      expect(component.formatBytes(1536)).toBe('1.5 KB');
    });

    it('converts to MB', () => {
      expect(component.formatBytes(1024 * 1024)).toBe('1 MB');
    });

    it('caps at GB when value exceeds the largest unit (idx limit branch)', () => {
      // A petabyte-scale value keeps dividing until idx hits the GB cap and
      // the `idx < units.length - 1` guard stops the loop while size >= 1024.
      expect(component.formatBytes(1024 ** 5)).toBe('1048576 GB');
    });
  });

  describe('uploadStatusLabelKey', () => {
    it('maps each known status to its translation key', () => {
      expect(component.uploadStatusLabelKey('queued')).toBe(
        'adminUi.products.form.uploadStatus.queued',
      );
      expect(component.uploadStatusLabelKey('uploading')).toBe(
        'adminUi.products.form.uploadStatus.uploading',
      );
      expect(component.uploadStatusLabelKey('success')).toBe(
        'adminUi.products.form.uploadStatus.success',
      );
      expect(component.uploadStatusLabelKey('error')).toBe(
        'adminUi.products.form.uploadStatus.error',
      );
    });

    it('falls back to the queued key for an unknown status (default branch)', () => {
      expect(
        component.uploadStatusLabelKey('weird' as AdminProductImageUploadStatus),
      ).toBe('adminUi.products.form.uploadStatus.queued');
    });
  });

  describe('altHelperImages / altTextNeedsAttention', () => {
    it('flags missing, empty and whitespace-only alt text', () => {
      images.set([
        { id: 'a', url: '/a.png' }, // alt_text undefined
        { id: 'b', url: '/b.png', alt_text: null },
        { id: 'c', url: '/c.png', alt_text: '   ' },
      ]);
      const flagged = component.altHelperImages().map((i) => i.id);
      expect(flagged).toEqual(['a', 'b', 'c']);
    });

    it('flags alt text that looks like a path (forward and back slash)', () => {
      images.set([
        { id: 'fwd', url: '/x.png', alt_text: 'folder/photo' },
        { id: 'back', url: '/y.png', alt_text: 'folder\\photo' },
      ]);
      const flagged = component.altHelperImages().map((i) => i.id);
      expect(flagged).toEqual(['fwd', 'back']);
    });

    it('flags alt text that ends in an image file extension', () => {
      images.set([
        { id: 'png', url: '/1', alt_text: 'hero.png' },
        { id: 'jpg', url: '/2', alt_text: 'hero.jpg' },
        { id: 'jpeg', url: '/3', alt_text: 'hero.jpeg' },
        { id: 'webp', url: '/4', alt_text: 'hero.webp' },
        { id: 'gif', url: '/5', alt_text: 'hero.gif' },
        { id: 'svg', url: '/6', alt_text: 'hero.svg' },
      ]);
      const flagged = component.altHelperImages().map((i) => i.id);
      expect(flagged).toEqual(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
    });

    it('does not flag descriptive, human-friendly alt text', () => {
      images.set([
        { id: 'good', url: '/g.png', alt_text: 'A red ceramic mug on a wooden table' },
      ]);
      expect(component.altHelperImages()).toEqual([]);
    });
  });

  describe('template rendering', () => {
    it('shows the empty state when there are no images', () => {
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('adminUi.products.form.noImages');
    });

    it('renders the upload queue with formatted size and progress', () => {
      uploads.set([makeUpload({ bytes: 1536, progress: 42, status: 'uploading' })]);
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('photo.png');
      expect(text).toContain('1.5 KB');
      expect(text).toContain('42%');
    });

    it('disables the file input until a slug is being edited', () => {
      component.hasEditingSlug = false;
      fixture.detectChanges();
      const input = fixture.debugElement.query(By.css('input[type="file"]'))
        .nativeElement as HTMLInputElement;
      expect(input.disabled).toBeTrue();
    });

    it('marks the first image as primary and lists the rest', () => {
      images.set([
        { id: 'first', url: '/first.png', alt_text: 'First' },
        { id: 'second', url: '/second.png', alt_text: 'Second' },
      ]);
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('adminUi.storefront.products.images.primaryBadge');
    });

    it('renders the meta editor for the image being edited', () => {
      images.set([{ id: 'first', url: '/first.png', alt_text: 'First' }]);
      editingImageId.set('first');
      component.imageStats = {
        original_bytes: 2048,
        thumb_sm_bytes: 100,
        thumb_md_bytes: 200,
        thumb_lg_bytes: 300,
        width: 800,
        height: 600,
      } as AdminProductImageOptimizationStats;
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('800×600');
      expect(text).toContain('adminUi.products.form.imageMeta');
    });

    it('shows deleted images with a deleted timestamp when the panel is open', () => {
      deletedImagesOpen.set(true);
      deletedImages.set([
        {
          id: 'd1',
          url: '/deleted.png',
          alt_text: 'Gone',
          deleted_at: '2030-01-01T00:00:00+00:00',
        },
      ]);
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('adminUi.products.form.deletedAt');
    });
  });

  describe('output emitters', () => {
    function clickButtonWithLabel(label: string): void {
      const buttons = fixture.debugElement.queryAll(By.css('button'));
      const match = buttons.find((b) =>
        (b.nativeElement as HTMLButtonElement).textContent?.includes(label),
      );
      expect(match).withContext(`button with label "${label}"`).toBeTruthy();
      (match!.nativeElement as HTMLButtonElement).click();
    }

    it('emits uploadRequested when a file is chosen', () => {
      const spy = jasmine.createSpy('upload');
      component.uploadRequested.subscribe(spy);
      fixture.detectChanges();
      const input = fixture.debugElement.query(By.css('input[type="file"]'));
      input.triggerEventHandler('change', { target: input.nativeElement });
      expect(spy).toHaveBeenCalled();
    });

    it('emits toggleDeletedImagesRequested when the toggle button is clicked', () => {
      const spy = jasmine.createSpy('toggle');
      component.toggleDeletedImagesRequested.subscribe(spy);
      fixture.detectChanges();
      clickButtonWithLabel('adminUi.products.form.showDeletedImages');
      expect(spy).toHaveBeenCalled();
    });

    it('emits retry and remove for an errored upload', () => {
      const retry = jasmine.createSpy('retry');
      const remove = jasmine.createSpy('remove');
      component.retryUploadRequested.subscribe(retry);
      component.removeUploadRequested.subscribe(remove);
      uploads.set([makeUpload({ id: 'err1', status: 'error', error: 'boom' })]);
      fixture.detectChanges();
      clickButtonWithLabel('adminUi.actions.retry');
      clickButtonWithLabel('adminUi.actions.remove');
      expect(retry).toHaveBeenCalledWith('err1');
      expect(remove).toHaveBeenCalledWith('err1');
    });

    it('emits makePrimary, toggleMeta and delete for a non-primary image', () => {
      const primary = jasmine.createSpy('primary');
      const toggleMeta = jasmine.createSpy('toggleMeta');
      const del = jasmine.createSpy('delete');
      component.makePrimaryRequested.subscribe(primary);
      component.toggleMetaRequested.subscribe(toggleMeta);
      component.deleteRequested.subscribe(del);
      images.set([
        { id: 'first', url: '/first.png', alt_text: 'First' },
        { id: 'second', url: '/second.png', alt_text: 'Second' },
      ]);
      fixture.detectChanges();
      clickButtonWithLabel('adminUi.storefront.products.images.makePrimary');
      clickButtonWithLabel('adminUi.actions.delete');
      expect(primary).toHaveBeenCalledWith('second');
      expect(del).toHaveBeenCalledWith('first');
    });

    it('emits reprocess and saveMeta from the meta editor', () => {
      const reprocess = jasmine.createSpy('reprocess');
      const saveMeta = jasmine.createSpy('saveMeta');
      component.reprocessRequested.subscribe(reprocess);
      component.saveMetaRequested.subscribe(saveMeta);
      images.set([{ id: 'first', url: '/first.png', alt_text: 'First' }]);
      editingImageId.set('first');
      fixture.detectChanges();
      clickButtonWithLabel('adminUi.products.form.imageReprocess');
      clickButtonWithLabel('adminUi.actions.save');
      expect(reprocess).toHaveBeenCalled();
      expect(saveMeta).toHaveBeenCalled();
    });

    it('emits restoreRequested for a deleted image', () => {
      const restore = jasmine.createSpy('restore');
      component.restoreRequested.subscribe(restore);
      deletedImagesOpen.set(true);
      deletedImages.set([{ id: 'd1', url: '/deleted.png', alt_text: 'Gone' }]);
      fixture.detectChanges();
      clickButtonWithLabel('adminUi.actions.restore');
      expect(restore).toHaveBeenCalledWith('d1');
    });
  });
});
