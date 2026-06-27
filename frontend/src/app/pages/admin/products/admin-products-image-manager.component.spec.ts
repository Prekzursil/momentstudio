import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import {
  AdminProductsImageManagerComponent,
  type AdminProductImageUploadItem,
  type AdminProductImageUploadStatus,
} from './admin-products-image-manager.component';
import type {
  AdminDeletedProductImage,
  AdminProductImageOptimizationStats,
} from '../../../core/admin.service';

// Lightweight stubs so we can render the real component template without pulling
// in RouterLink (ButtonComponent) or the full input widget. They preserve the
// inputs/outputs the template wires to, so two-way bindings and clicks behave.
@Component({
  selector: 'app-button',
  standalone: true,
  template: `<button type="button" (click)="action.emit()">{{ label }}</button>`,
})
class ButtonStubComponent {
  @Input() label = '';
  @Input() size = '';
  @Input() variant = '';
  @Input() disabled = false;
  @Output() action = new EventEmitter<void>();
}

@Component({
  selector: 'app-input',
  standalone: true,
  template: `<input [value]="value" (input)="valueChange.emit($any($event.target).value)" />`,
})
class InputStubComponent {
  @Input() label = '';
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
}

type ImgRef = { id: string; url: string; alt_text?: string | null };

function makeUpload(
  id: string,
  status: AdminProductImageUploadStatus,
  overrides: Partial<AdminProductImageUploadItem> = {},
): AdminProductImageUploadItem {
  return {
    id,
    fileName: `${id}.png`,
    bytes: 2048,
    status,
    progress: 50,
    error: null,
    ...overrides,
  };
}

describe('AdminProductsImageManagerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminProductsImageManagerComponent],
    })
      .overrideComponent(AdminProductsImageManagerComponent, {
        remove: { imports: [ButtonComponent, InputComponent] },
        add: { imports: [ButtonStubComponent, InputStubComponent] },
      })
      .compileComponents();

    TestBed.inject(TranslateService).use('en');
  });

  function createComponent() {
    const fixture = TestBed.createComponent(AdminProductsImageManagerComponent);
    const component = fixture.componentInstance;
    // Required signal inputs — defaults that the rendering tests override as needed.
    component.images = signal<ImgRef[]>([]);
    component.editingImageId = signal<string | null>(null);
    component.imageOrderBusy = signal(false);
    component.imageOrderError = signal<string | null>(null);
    component.imageMetaBusy = signal(false);
    component.imageMetaError = signal<string | null>(null);
    component.deleteImageConfirmBusy = signal(false);
    component.deletedImagesOpen = signal(false);
    component.deletedImagesBusy = signal(false);
    component.deletedImagesError = signal<string | null>(null);
    component.deletedImages = signal<AdminDeletedProductImage[]>([]);
    component.restoringDeletedImage = signal<string | null>(null);
    component.uploads = signal<AdminProductImageUploadItem[]>([]);
    component.imageMeta = {
      en: { alt_text: '', caption: '' },
      ro: { alt_text: '', caption: '' },
    };
    return { fixture, component };
  }

  describe('uploadStatusLabelKey', () => {
    it('maps every known status to its i18n key', () => {
      const { component } = createComponent();
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

    it('falls back to the queued key for an unexpected status (default branch)', () => {
      const { component } = createComponent();
      expect(
        component.uploadStatusLabelKey('weird' as AdminProductImageUploadStatus),
      ).toBe('adminUi.products.form.uploadStatus.queued');
    });
  });

  describe('formatBytes', () => {
    it('returns an em dash for null, undefined and non-finite values', () => {
      const { component } = createComponent();
      expect(component.formatBytes(null)).toBe('—');
      expect(component.formatBytes(undefined)).toBe('—');
      expect(component.formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
      expect(component.formatBytes(Number.NaN)).toBe('—');
    });

    it('rounds bytes to whole numbers without scaling (idx === 0 branch)', () => {
      const { component } = createComponent();
      expect(component.formatBytes(0)).toBe('0 B');
      expect(component.formatBytes(900)).toBe('900 B');
    });

    it('scales to KB and MB with one decimal (idx > 0 branch)', () => {
      const { component } = createComponent();
      expect(component.formatBytes(1536)).toBe('1.5 KB');
      expect(component.formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    });

    it('caps the unit at GB once the largest unit is reached (loop guard)', () => {
      const { component } = createComponent();
      expect(component.formatBytes(3 * 1024 * 1024 * 1024 * 1024)).toBe('3072 GB');
    });
  });

  describe('altHelperImages / altTextNeedsAttention', () => {
    it('flags missing, path-like and filename-like alt text but keeps real captions', () => {
      const { component } = createComponent();
      const images: ImgRef[] = [
        { id: 'empty', url: '/a.png', alt_text: '   ' },
        { id: 'null', url: '/b.png', alt_text: null },
        { id: 'slash', url: '/c.png', alt_text: 'photos/cat' },
        { id: 'backslash', url: '/d.png', alt_text: 'photos\\dog' },
        { id: 'ext', url: '/e.png', alt_text: 'banner.JPEG' },
        { id: 'good', url: '/f.png', alt_text: 'A cosy hand-knit scarf' },
      ];
      component.images = signal(images);

      const flagged = component.altHelperImages().map((img) => img.id);
      expect(flagged).toEqual(['empty', 'null', 'slash', 'backslash', 'ext']);
      expect(flagged).not.toContain('good');
    });

    it('returns an empty list when every image has a descriptive alt text', () => {
      const { component } = createComponent();
      component.images = signal<ImgRef[]>([
        { id: '1', url: '/x.png', alt_text: 'A warm woollen blanket' },
      ]);
      expect(component.altHelperImages()).toEqual([]);
    });
  });

  describe('template rendering and event wiring', () => {
    it('renders the empty state and disables upload when there is no editing slug', () => {
      const { fixture, component } = createComponent();
      component.hasEditingSlug = false;
      fixture.detectChanges();

      const fileInput: HTMLInputElement = fixture.nativeElement.querySelector(
        'input[type="file"]',
      );
      expect(fileInput.disabled).toBe(true);
      const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
      expect(text).toContain('adminUi.products.form.noImages');
    });

    it('renders the upload queue, image list, meta editor and deleted panel, and emits actions', () => {
      const { fixture, component } = createComponent();
      const stats: AdminProductImageOptimizationStats = {
        original_bytes: 4096,
        width: 800,
        height: 600,
        thumb_sm_bytes: 512,
        thumb_md_bytes: 1024,
        thumb_lg_bytes: 2048,
      } as AdminProductImageOptimizationStats;
      const deleted: AdminDeletedProductImage[] = [
        {
          id: 'del-1',
          url: '/deleted.png',
          alt_text: 'gone',
          deleted_at: '2026-01-02T03:04:05Z',
        } as AdminDeletedProductImage,
      ];

      component.hasEditingSlug = true;
      component.images = signal<ImgRef[]>([
        { id: 'img-1', url: '/one.png', alt_text: 'photos/needs-help' },
        { id: 'img-2', url: '/two.png', alt_text: 'A lovely mug' },
      ]);
      component.editingImageId = signal<string | null>('img-2');
      component.imageOrderError = signal<string | null>('order failed');
      component.imageMetaError = signal<string | null>('meta failed');
      component.imageStats = stats;
      component.uploads = signal<AdminProductImageUploadItem[]>([
        makeUpload('u-queued', 'queued'),
        makeUpload('u-uploading', 'uploading'),
        makeUpload('u-success', 'success'),
        makeUpload('u-error', 'error', { error: 'boom' }),
      ]);
      component.deletedImagesOpen = signal(true);
      component.deletedImages = signal(deleted);
      component.restoringDeletedImage = signal<string | null>('del-1');
      fixture.detectChanges();

      const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
      expect(text).toContain('adminUi.products.form.uploadQueue');
      expect(text).toContain('boom');
      expect(text).toContain('2 KB'); // upload bytes via formatBytes
      expect(text).toContain('4 KB'); // imageStats.original_bytes
      expect(text).toContain('800×600');
      expect(text).toContain('order failed');
      expect(text).toContain('meta failed');

      const emitted: Record<string, unknown> = {};
      component.uploadRequested.subscribe(() => (emitted['upload'] = true));
      component.retryUploadRequested.subscribe((id) => (emitted['retry'] = id));
      component.removeUploadRequested.subscribe((id) => (emitted['remove'] = id));
      component.toggleDeletedImagesRequested.subscribe(() => (emitted['toggleDeleted'] = true));
      component.makePrimaryRequested.subscribe((id) => (emitted['primary'] = id));
      component.toggleMetaRequested.subscribe((id) => (emitted['meta'] = id));
      component.deleteRequested.subscribe((id) => (emitted['delete'] = id));
      component.reprocessRequested.subscribe(() => (emitted['reprocess'] = true));
      component.saveMetaRequested.subscribe(() => (emitted['save'] = true));
      component.restoreRequested.subscribe((id) => (emitted['restore'] = id));

      // file upload change
      const fileInput: HTMLInputElement = fixture.nativeElement.querySelector(
        'input[type="file"]',
      );
      fileInput.dispatchEvent(new Event('change'));
      expect(emitted['upload']).toBe(true);

      // click every stub button and confirm the matching output fires
      const buttons = fixture.debugElement.queryAll(By.directive(ButtonStubComponent));
      buttons.forEach((btn) => btn.componentInstance.action.emit());
      expect(emitted['retry']).toBe('u-error');
      expect(emitted['remove']).toBeDefined();
      expect(emitted['toggleDeleted']).toBe(true);
      expect(emitted['primary']).toBe('img-2');
      expect(emitted['meta']).toBeDefined();
      // Every image exposes a delete button; clicking them all in DOM order
      // leaves the last image's id as the most recent emission.
      expect(emitted['delete']).toBe('img-2');
      expect(emitted['reprocess']).toBe(true);
      expect(emitted['save']).toBe(true);
      expect(emitted['restore']).toBe('del-1');
    });

    it('shows the alt-helper details list and the deleted-images empty/loading states', () => {
      const { fixture, component } = createComponent();
      component.hasEditingSlug = true;
      component.images = signal<ImgRef[]>([
        { id: 'img-1', url: '/one.png', alt_text: 'needs.png' },
      ]);
      component.deletedImagesOpen = signal(true);
      component.deletedImagesBusy = signal(true);
      component.deletedImagesError = signal<string | null>('cannot load');
      fixture.detectChanges();

      const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
      expect(text).toContain('adminUi.products.form.altHelperTitle');
      expect(text).toContain('adminUi.actions.loading');
      expect(text).toContain('cannot load');

      // The alt-helper "edit" button wires to toggleMetaRequested with the image id.
      let helperId: string | undefined;
      component.toggleMetaRequested.subscribe((id) => (helperId = id));
      const helperButton = fixture.debugElement.queryAll(By.directive(ButtonStubComponent))[1];
      helperButton.componentInstance.action.emit();
      expect(helperId).toBe('img-1');
    });
  });
});
