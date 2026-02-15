import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AdminService, MediaAsset } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { DamAssetLibraryComponent } from './dam-asset-library.component';

describe('DamAssetLibraryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;

  const baseAsset: MediaAsset = {
    id: 'asset-1',
    asset_type: 'image',
    status: 'draft',
    visibility: 'private',
    source_kind: 'upload',
    source_ref: null,
    storage_key: 'originals/asset-1/pic.jpg',
    public_url: '/media/originals/asset-1/pic.jpg',
    original_filename: 'pic.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    width: 1200,
    height: 800,
    duration_ms: null,
    page_count: null,
    checksum_sha256: null,
    perceptual_hash: null,
    dedupe_group: null,
    rights_license: null,
    rights_owner: null,
    rights_notes: null,
    approved_at: null,
    trashed_at: null,
    created_at: '2026-02-16T00:00:00Z',
    updated_at: '2026-02-16T00:00:00Z',
    tags: ['hero'],
    i18n: [],
    variants: []
  };

  beforeEach(() => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'listMediaAssets',
      'listMediaCollections',
      'uploadMediaAsset',
      'updateMediaAsset',
      'getMediaAssetUsage',
      'requestMediaVariant',
      'editMediaAsset',
      'approveMediaAsset',
      'rejectMediaAsset',
      'softDeleteMediaAsset',
      'restoreMediaAsset',
      'purgeMediaAsset',
      'createMediaCollection',
      'updateMediaCollection',
      'replaceMediaCollectionItems'
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    admin.listMediaAssets.and.returnValue(
      of({
        items: [baseAsset],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 24 }
      })
    );
    admin.listMediaCollections.and.returnValue(of([]));

    TestBed.configureTestingModule({
      imports: [DamAssetLibraryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast }
      ]
    });
  });

  it('loads assets on init with default list filters', () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();

    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({
        page: 1,
        limit: 24,
        sort: 'newest'
      })
    );
    expect(fixture.componentInstance.assets().length).toBe(1);
  });

  it('switches to review tab and applies draft status filter', () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaAssets.calls.reset();

    component.switchTab('review');

    expect(component.tab()).toBe('review');
    expect(component.statusFilter).toBe('draft');
    expect(admin.listMediaAssets).toHaveBeenCalledWith(jasmine.objectContaining({ status: 'draft' }));
  });
});

