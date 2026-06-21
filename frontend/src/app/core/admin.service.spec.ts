import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { AdminService } from './admin.service';
import { ApiService } from './api.service';

describe('AdminService', () => {
  let service: AdminService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'get',
      'post',
      'patch',
      'put',
      'delete',
      'getBlob',
      'postWithProgress',
    ]);
    api.get.and.returnValue(of({}));
    api.post.and.returnValue(of({}));
    api.patch.and.returnValue(of({}));
    api.put.and.returnValue(of({}));
    api.delete.and.returnValue(of(undefined));
    api.getBlob.and.returnValue(of(new Blob()));
    api.postWithProgress.and.returnValue(of({ type: 4 }) as never);

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, AdminService],
    });
    service = TestBed.inject(AdminService);
  });

  function sub(obs: Observable<unknown>): void {
    obs.subscribe();
  }

  it('dashboard analytics endpoints', () => {
    sub(service.summary({ range_days: 7 }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/summary', { range_days: 7 });
    sub(service.summary());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/summary', undefined);

    sub(service.paymentsHealth({ since_hours: 1 }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/payments-health', { since_hours: 1 });
    sub(service.refundsBreakdown({ window_days: 3 }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/refunds-breakdown', { window_days: 3 });
    sub(service.shippingPerformance());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/shipping-performance', undefined);
    sub(service.stockoutImpact({ limit: 5 }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/stockout-impact', { limit: 5 });
    sub(service.channelAttribution());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/channel-attribution', undefined);
    sub(service.funnel());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/funnel', undefined);
    sub(service.channelBreakdown());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/channel-breakdown', undefined);
    sub(service.scheduledTasks());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/scheduled-tasks');
  });

  it('globalSearch defaults include_pii to true and honors override', () => {
    sub(service.globalSearch('q'));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/search', { q: 'q', include_pii: true });
    sub(service.globalSearch('q', { include_pii: false }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/search', {
      q: 'q',
      include_pii: false,
    });
  });

  it('logClientError posts silently', () => {
    sub(service.logClientError({ message: 'x' } as never));
    expect(api.post).toHaveBeenCalledWith(
      '/admin/observability/client-errors',
      { message: 'x' },
      {
        'X-Silent': '1',
      },
    );
  });

  it('lists with include_pii defaults', () => {
    sub(service.products());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/products');
    sub(service.orders());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/orders', { include_pii: true });
    sub(service.orders({ include_pii: false }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/orders', { include_pii: false });
    sub(service.users());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/users', { include_pii: true });
    sub(service.userAliases('u1'));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/users/u1/aliases', {
      include_pii: true,
    });
    sub(service.userAliases('u1', { include_pii: false }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/users/u1/aliases', {
      include_pii: false,
    });
  });

  it('content + audit endpoints', () => {
    sub(service.content());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/content');
    sub(service.contentScheduling({ page: 1 }));
    expect(api.get).toHaveBeenCalledWith('/content/admin/scheduling', { page: 1 });
    sub(service.updateContentBlock('k', { value: 'v' } as never));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/k', { value: 'v' });
    sub(service.coupons());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/coupons');
    sub(service.audit());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/audit');
    sub(service.auditEntries({ page: 2 }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/audit/entries', { page: 2 });
    sub(service.exportAuditCsv({ redact: true }));
    expect(api.getBlob).toHaveBeenCalledWith('/admin/dashboard/audit/export.csv', { redact: true });
    sub(service.auditRetention());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/audit/retention');
    sub(service.purgeAuditRetention({ confirm: 'YES' }));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/audit/retention/purge', {
      confirm: 'YES',
    });
    sub(service.transferOwner({ identifier: 'a', confirm: 'b', password: 'c' }));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/owner/transfer', {
      identifier: 'a',
      confirm: 'b',
      password: 'c',
    });
  });

  it('session + inventory endpoints', () => {
    sub(service.revokeSessions('u1'));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/sessions/u1/revoke', {});
    sub(service.listUserSessions('u1'));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/sessions/u1');
    sub(service.revokeSession('u1', 's1'));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/sessions/u1/s1/revoke', {});
    sub(service.lowStock());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/low-stock');
    sub(service.restockList({ page: 1 }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/inventory/restock-list', { page: 1 });
    sub(service.exportRestockListCsv({ include_variants: true }));
    expect(api.getBlob).toHaveBeenCalledWith('/admin/dashboard/inventory/restock-list/export', {
      include_variants: true,
    });
    sub(service.reservedCarts({ product_id: 'p' }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/inventory/reservations/carts', {
      product_id: 'p',
    });
    sub(service.reservedOrders({ product_id: 'p' }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/inventory/reservations/orders', {
      product_id: 'p',
    });
    sub(service.upsertRestockNote({ product_id: 'p' } as never));
    expect(api.put).toHaveBeenCalledWith('/admin/dashboard/inventory/restock-notes', {
      product_id: 'p',
    });
    sub(service.updateOrderStatus('o1', 'paid'));
    expect(api.patch).toHaveBeenCalledWith('/orders/admin/o1', { status: 'paid' });
  });

  it('bulkUpdateProducts passes source param only when provided', () => {
    sub(service.bulkUpdateProducts([{ product_id: 'p' }]));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/products/bulk-update',
      [{ product_id: 'p' }],
      undefined,
      undefined,
    );
    sub(service.bulkUpdateProducts([{ product_id: 'p' }], { source: 'storefront' }));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/products/bulk-update',
      [{ product_id: 'p' }],
      undefined,
      { source: 'storefront' },
    );
  });

  it('category endpoints with and without source', () => {
    const file = new File(['x'], 'a.csv');
    sub(service.getCategories());
    expect(api.get).toHaveBeenCalledWith('/catalog/categories');
    sub(service.createCategory({ slug: 's' }));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories',
      { slug: 's' },
      undefined,
      undefined,
    );
    sub(service.createCategory({ slug: 's' }, { source: 'storefront' }));
    expect(api.post).toHaveBeenCalledWith('/catalog/categories', { slug: 's' }, undefined, {
      source: 'storefront',
    });
    sub(service.updateCategory('s', { name: 'n' }, { source: 'storefront' }));
    expect(api.patch).toHaveBeenCalledWith('/catalog/categories/s', { name: 'n' }, undefined, {
      source: 'storefront',
    });
    sub(service.uploadCategoryImage('s', 'banner', file));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/s/images/banner',
      jasmine.any(FormData),
      undefined,
      undefined,
    );
    sub(service.previewDeleteCategory('s'));
    expect(api.get).toHaveBeenCalledWith('/catalog/categories/s/delete/preview');
    sub(service.previewMergeCategory('a', 'b'));
    expect(api.get).toHaveBeenCalledWith('/catalog/categories/a/merge/preview', {
      target_slug: 'b',
    });
    sub(service.mergeCategory('a', 'b', { source: 'storefront' }));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/a/merge',
      { target_slug: 'b' },
      undefined,
      {
        source: 'storefront',
      },
    );
    sub(service.getCategoryTranslations('s'));
    expect(api.get).toHaveBeenCalledWith('/catalog/categories/s/translations');
    sub(service.upsertCategoryTranslation('s', 'en', { name: 'n' }));
    expect(api.put).toHaveBeenCalledWith(
      '/catalog/categories/s/translations/en',
      { name: 'n' },
      undefined,
      undefined,
    );
    sub(service.deleteCategoryTranslation('s', 'ro', { source: 'storefront' }));
    expect(api.delete).toHaveBeenCalledWith('/catalog/categories/s/translations/ro', undefined, {
      source: 'storefront',
    });
    sub(service.deleteCategory('s'));
    expect(api.delete).toHaveBeenCalledWith('/catalog/categories/s', undefined, undefined);
    sub(service.reorderCategories([{ slug: 's', sort_order: 1 }]));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/reorder',
      [{ slug: 's', sort_order: 1 }],
      undefined,
      undefined,
    );
    sub(service.importCategoriesCsv(file));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/import',
      jasmine.any(FormData),
      undefined,
      {
        dry_run: true,
      },
    );
    sub(service.importCategoriesCsv(file, false));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/import',
      jasmine.any(FormData),
      undefined,
      {
        dry_run: false,
      },
    );
  });

  it('product endpoints', () => {
    const file = new File(['x'], 'a.csv');
    sub(service.getProduct('s'));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s');
    sub(service.exportProductsCsv());
    expect(api.getBlob).toHaveBeenCalledWith('/catalog/products/export');
    sub(service.exportCategoriesCsv());
    expect(api.getBlob).toHaveBeenCalledWith('/catalog/categories/export', { template: false });
    sub(service.exportCategoriesCsv(true));
    expect(api.getBlob).toHaveBeenCalledWith('/catalog/categories/export', { template: true });
    sub(service.importProductsCsv(file));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/products/import',
      jasmine.any(FormData),
      undefined,
      {
        dry_run: true,
      },
    );
    sub(service.getProductAudit('s'));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s/audit', { limit: 50 });
    sub(service.getProductAudit('s', 10));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s/audit', { limit: 10 });
    sub(service.getProductRelationships('s'));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s/relationships');
    sub(service.updateProductRelationships('s', { related: [] } as never));
    expect(api.put).toHaveBeenCalledWith('/catalog/products/s/relationships', { related: [] });
    sub(service.getProductTranslations('s'));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s/translations');
    sub(service.upsertProductTranslation('s', 'en', { name: 'n' }));
    expect(api.put).toHaveBeenCalledWith('/catalog/products/s/translations/en', { name: 'n' });
    sub(service.deleteProductTranslation('s', 'ro'));
    expect(api.delete).toHaveBeenCalledWith('/catalog/products/s/translations/ro');
    sub(service.createProduct({ slug: 's' }));
    expect(api.post).toHaveBeenCalledWith('/catalog/products', { slug: 's' });
    sub(service.updateProduct('s', { name: 'n' }, { source: 'storefront' }));
    expect(api.patch).toHaveBeenCalledWith('/catalog/products/s', { name: 'n' }, undefined, {
      source: 'storefront',
    });
    sub(service.updateProduct('s', { name: 'n' }));
    expect(api.patch).toHaveBeenCalledWith(
      '/catalog/products/s',
      { name: 'n' },
      undefined,
      undefined,
    );
    sub(service.duplicateProduct('s'));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/products/s/duplicate',
      {},
      undefined,
      undefined,
    );
    sub(service.deleteProduct('s'));
    expect(api.delete).toHaveBeenCalledWith('/catalog/products/s');
  });

  it('coupon + product image endpoints', () => {
    const file = new File(['x'], 'a.png');
    sub(service.createCoupon({ code: 'C' }));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/coupons', { code: 'C' });
    sub(service.updateCoupon('c1', { code: 'C' }));
    expect(api.patch).toHaveBeenCalledWith('/admin/dashboard/coupons/c1', { code: 'C' });
    sub(service.invalidateCouponStripeMappings('c1'));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/coupons/c1/stripe/invalidate', {});
    sub(service.uploadProductImage('s', file));
    expect(api.post).toHaveBeenCalledWith('/catalog/products/s/images', jasmine.any(FormData));
    sub(service.uploadProductImageWithProgress('s', file));
    expect(api.postWithProgress).toHaveBeenCalledWith(
      '/catalog/products/s/images',
      jasmine.any(FormData),
    );
    sub(service.deleteProductImage('s', 'i1'));
    expect(api.delete).toHaveBeenCalledWith('/catalog/products/s/images/i1');
    sub(service.listDeletedProductImages('s'));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s/images/deleted');
    sub(service.restoreProductImage('s', 'i1'));
    expect(api.post).toHaveBeenCalledWith('/catalog/products/s/images/i1/restore', {});
    sub(service.reorderProductImage('s', 'i1', 3));
    expect(api.patch).toHaveBeenCalledWith('/catalog/products/s/images/i1/sort', {}, undefined, {
      sort_order: 3,
    });
    sub(service.reorderProductImage('s', 'i1', 3, { source: 'storefront' }));
    expect(api.patch).toHaveBeenCalledWith('/catalog/products/s/images/i1/sort', {}, undefined, {
      sort_order: 3,
      source: 'storefront',
    });
    sub(service.updateProductVariants('s', { variants: [] }));
    expect(api.put).toHaveBeenCalledWith('/catalog/products/s/variants', { variants: [] });
  });

  it('product image translation + stats endpoints', () => {
    sub(service.getProductImageTranslations('s', 'i1'));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s/images/i1/translations');
    sub(service.upsertProductImageTranslation('s', 'i1', 'en', { alt_text: 'a' }));
    expect(api.put).toHaveBeenCalledWith(
      '/catalog/products/s/images/i1/translations/en',
      { alt_text: 'a' },
      undefined,
      undefined,
    );
    sub(
      service.upsertProductImageTranslation(
        's',
        'i1',
        'en',
        { alt_text: 'a' },
        { source: 'storefront' },
      ),
    );
    expect(api.put).toHaveBeenCalledWith(
      '/catalog/products/s/images/i1/translations/en',
      { alt_text: 'a' },
      undefined,
      { source: 'storefront' },
    );
    sub(service.deleteProductImageTranslation('s', 'i1', 'ro'));
    expect(api.delete).toHaveBeenCalledWith(
      '/catalog/products/s/images/i1/translations/ro',
      undefined,
      undefined,
    );
    sub(service.getProductImageStats('s', 'i1'));
    expect(api.get).toHaveBeenCalledWith('/catalog/products/s/images/i1/stats');
    sub(service.reprocessProductImage('s', 'i1'));
    expect(api.post).toHaveBeenCalledWith('/catalog/products/s/images/i1/reprocess', {});
  });

  it('stock adjustment + misc admin endpoints', () => {
    sub(service.listStockAdjustments({ product_id: 'p' }));
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/stock-adjustments', { product_id: 'p' });
    sub(service.exportStockAdjustmentsCsv({ product_id: 'p' }));
    expect(api.getBlob).toHaveBeenCalledWith('/admin/dashboard/stock-adjustments/export', {
      product_id: 'p',
    });
    sub(service.applyStockAdjustment({ product_id: 'p', delta: 1, reason: 'restock' as never }));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/stock-adjustments', {
      product_id: 'p',
      delta: 1,
      reason: 'restock',
    });
    sub(service.updateUserRole('u1', 'admin', 'pw'));
    expect(api.patch).toHaveBeenCalledWith('/admin/dashboard/users/u1/role', {
      role: 'admin',
      password: 'pw',
    });
    sub(service.getMaintenance());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/maintenance');
    sub(service.setMaintenance(true));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/maintenance', { enabled: true });
    sub(service.listFeaturedCollections());
    expect(api.get).toHaveBeenCalledWith('/catalog/collections/featured');
    sub(service.sendScheduledReport({ kind: 'daily' as never }));
    expect(api.post).toHaveBeenCalledWith('/admin/dashboard/reports/send', { kind: 'daily' });
    sub(service.getAlertThresholds());
    expect(api.get).toHaveBeenCalledWith('/admin/dashboard/alert-thresholds');
    sub(service.updateAlertThresholds({ a: 1 } as never));
    expect(api.put).toHaveBeenCalledWith('/admin/dashboard/alert-thresholds', { a: 1 });
    sub(service.createFeaturedCollection({ name: 'n' }));
    expect(api.post).toHaveBeenCalledWith('/catalog/collections/featured', { name: 'n' });
    sub(service.updateFeaturedCollection('s', { name: 'n' }));
    expect(api.patch).toHaveBeenCalledWith('/catalog/collections/featured/s', { name: 'n' });
  });

  it('content block endpoints with optional lang', () => {
    sub(service.getContent('k'));
    expect(api.get).toHaveBeenCalledWith('/content/admin/k');
    sub(service.getContent('k', 'ro'));
    expect(api.get).toHaveBeenCalledWith('/content/admin/k?lang=ro');
    sub(service.createContent('k', { value: 'v' } as never));
    expect(api.post).toHaveBeenCalledWith('/content/admin/k', { value: 'v' });
    sub(service.deleteContent('k'));
    expect(api.delete).toHaveBeenCalledWith('/content/admin/k');
    const file = new File(['x'], 'a.png');
    sub(service.uploadContentImage('k', file));
    expect(api.post).toHaveBeenCalledWith('/content/admin/k/images', jasmine.any(FormData));
    sub(service.uploadContentImage('k', file, 'en'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/k/images?lang=en', jasmine.any(FormData));
    sub(service.listContentVersions('k'));
    expect(api.get).toHaveBeenCalledWith('/content/admin/k/versions');
    sub(service.getContentVersion('k', 2));
    expect(api.get).toHaveBeenCalledWith('/content/admin/k/versions/2');
    sub(service.rollbackContentVersion('k', 2));
    expect(api.post).toHaveBeenCalledWith('/content/admin/k/versions/2/rollback', {});
    sub(service.updateContentTranslationStatus('k', { needs_translation_en: true }));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/k/translation-status', {
      needs_translation_en: true,
    });
  });

  it('content image asset endpoints', () => {
    sub(service.listContentImages({ q: 'x' }));
    expect(api.get).toHaveBeenCalledWith('/content/admin/assets/images', { q: 'x' });
    sub(service.updateContentImage('i1', { alt: 'a' } as never));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/assets/images/i1', { alt: 'a' });
    sub(service.updateContentImageTags('i1', ['a']));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/assets/images/i1/tags', { tags: ['a'] });
    sub(service.updateContentImageFocalPoint('i1', 0.1, 0.2));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/assets/images/i1/focal', {
      focal_x: 0.1,
      focal_y: 0.2,
    });
    sub(service.editContentImage('i1', { rotate: 90 } as never));
    expect(api.post).toHaveBeenCalledWith('/content/admin/assets/images/i1/edit', { rotate: 90 });
    sub(service.getContentImageUsage('i1'));
    expect(api.get).toHaveBeenCalledWith('/content/admin/assets/images/i1/usage');
    sub(service.deleteContentImage('i1'));
    expect(api.delete).toHaveBeenCalledWith(
      '/content/admin/assets/images/i1',
      undefined,
      undefined,
    );
    sub(service.deleteContentImage('i1', { delete_versions: true }));
    expect(api.delete).toHaveBeenCalledWith('/content/admin/assets/images/i1', undefined, {
      delete_versions: true,
    });
  });

  it('media asset endpoints', () => {
    const file = new File(['x'], 'a.png');
    sub(service.listMediaAssets({ q: 'x' }));
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/assets', { q: 'x' });
    sub(service.uploadMediaAsset(file, { auto_finalize: true }));
    expect(api.post).toHaveBeenCalledWith(
      '/content/admin/media/assets/upload',
      jasmine.any(FormData),
      undefined,
      { auto_finalize: true },
    );
    sub(service.finalizeMediaAsset('a1'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/finalize', {});
    sub(service.finalizeMediaAsset('a1', { foo: 1 } as never));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/finalize', { foo: 1 });
    sub(service.updateMediaAsset('a1', { name: 'n' } as never));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/media/assets/a1', { name: 'n' });
    sub(service.approveMediaAsset('a1'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/approve', { note: null });
    sub(service.approveMediaAsset('a1', 'ok'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/approve', { note: 'ok' });
    sub(service.rejectMediaAsset('a1', 'no'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/reject', { note: 'no' });
    sub(service.rejectMediaAsset('a1'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/reject', { note: null });
    sub(service.softDeleteMediaAsset('a1'));
    expect(api.delete).toHaveBeenCalledWith('/content/admin/media/assets/a1');
    sub(service.restoreMediaAsset('a1'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/restore', {});
    sub(service.purgeMediaAsset('a1'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/purge', {});
    sub(service.getMediaAssetUsage('a1'));
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/assets/a1/usage');
    sub(service.requestMediaVariant('a1', 'thumb'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/variants', {
      profile: 'thumb',
    });
    sub(service.editMediaAsset('a1', { rotate: 90 } as never));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/assets/a1/edit', { rotate: 90 });
  });

  it('media job endpoints', () => {
    sub(service.getMediaJob('j1'));
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/jobs/j1');
    sub(service.listMediaJobs({ page: 1 }));
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/jobs', { page: 1 });
    sub(service.retryMediaJob('j1'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/jobs/j1/retry', {});
    sub(service.retryMediaJobsBulk(['j1', 'j2']));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/jobs/retry-bulk', {
      job_ids: ['j1', 'j2'],
    });
    sub(service.updateMediaJobTriage('j1', { state: 'open' } as never));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/media/jobs/j1/triage', {
      state: 'open',
    });
    sub(service.listMediaJobEvents('j1', { limit: 5 }));
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/jobs/j1/events', { limit: 5 });
    sub(service.getMediaTelemetry());
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/telemetry');
  });

  it('media retry policy endpoints', () => {
    sub(service.listMediaRetryPolicies());
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/retry-policies');
    sub(service.listMediaRetryPolicyHistory({ page: 1 }));
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/retry-policies/history', {
      page: 1,
    });
    sub(service.getMediaRetryPolicyPresets('thumbnail' as never));
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/retry-policies/thumbnail/presets');
    sub(service.updateMediaRetryPolicy('thumbnail' as never, { max: 3 } as never));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/media/retry-policies/thumbnail', {
      max: 3,
    });
    sub(service.rollbackMediaRetryPolicy('thumbnail' as never, { to: 1 } as never));
    expect(api.post).toHaveBeenCalledWith(
      '/content/admin/media/retry-policies/thumbnail/rollback',
      {
        to: 1,
      },
    );
    sub(service.markMediaRetryPolicyKnownGood('thumbnail' as never));
    expect(api.post).toHaveBeenCalledWith(
      '/content/admin/media/retry-policies/thumbnail/mark-known-good',
      {},
      undefined,
      undefined,
    );
    sub(service.markMediaRetryPolicyKnownGood('thumbnail' as never, { note: 'n' }));
    expect(api.post).toHaveBeenCalledWith(
      '/content/admin/media/retry-policies/thumbnail/mark-known-good',
      {},
      undefined,
      { note: 'n' },
    );
    sub(service.resetMediaRetryPolicy('thumbnail' as never));
    expect(api.post).toHaveBeenCalledWith(
      '/content/admin/media/retry-policies/thumbnail/reset',
      {},
    );
    sub(service.resetAllMediaRetryPolicies());
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/retry-policies/reset-all', {});
    sub(service.requestMediaUsageReconcile());
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/usage/reconcile', {});
  });

  it('media collection endpoints', () => {
    sub(service.listMediaCollections());
    expect(api.get).toHaveBeenCalledWith('/content/admin/media/collections');
    sub(service.createMediaCollection({ name: 'n', slug: 's' }));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/collections', {
      name: 'n',
      slug: 's',
    });
    sub(service.updateMediaCollection('c1', { name: 'n', slug: 's' }));
    expect(api.patch).toHaveBeenCalledWith('/content/admin/media/collections/c1', {
      name: 'n',
      slug: 's',
    });
    sub(service.replaceMediaCollectionItems('c1', ['a']));
    expect(api.post).toHaveBeenCalledWith('/content/admin/media/collections/c1/items', {
      asset_ids: ['a'],
    });
  });

  it('content tools + redirect + seo endpoints', () => {
    sub(service.linkCheckContent('k'));
    expect(api.get).toHaveBeenCalledWith('/content/admin/tools/link-check', { key: 'k' });
    sub(service.linkCheckContentPreview({ body: 'b' } as never));
    expect(api.post).toHaveBeenCalledWith('/content/admin/tools/link-check/preview', { body: 'b' });
    sub(service.previewFindReplaceContent({ find: 'a' } as never));
    expect(api.post).toHaveBeenCalledWith('/content/admin/tools/find-replace/preview', {
      find: 'a',
    });
    sub(service.applyFindReplaceContent({ find: 'a' } as never));
    expect(api.post).toHaveBeenCalledWith('/content/admin/tools/find-replace/apply', { find: 'a' });
    sub(service.fetchSocialThumbnail('https://x.io'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/social/thumbnail', {
      url: 'https://x.io',
    });
    sub(service.listContentPages());
    expect(api.get).toHaveBeenCalledWith('/content/admin/pages/list');
    sub(service.renameContentPage('s', 'new'));
    expect(api.post).toHaveBeenCalledWith('/content/admin/pages/s/rename', { new_slug: 'new' });
    sub(service.upsertContentRedirect({ from_key: 'a', to_key: 'b' }));
    expect(api.post).toHaveBeenCalledWith('/content/admin/redirects', {
      from_key: 'a',
      to_key: 'b',
    });
    sub(service.listContentRedirects({ q: 'x' }));
    expect(api.get).toHaveBeenCalledWith('/content/admin/redirects', { q: 'x' });
    sub(service.deleteContentRedirect('r1'));
    expect(api.delete).toHaveBeenCalledWith('/content/admin/redirects/r1');
    sub(service.exportContentRedirects({ q: 'x' }));
    expect(api.getBlob).toHaveBeenCalledWith('/content/admin/redirects/export', { q: 'x' });
    const file = new File(['x'], 'a.csv');
    sub(service.importContentRedirects(file));
    expect(api.post).toHaveBeenCalledWith('/content/admin/redirects/import', jasmine.any(FormData));
    sub(service.getSitemapPreview());
    expect(api.get).toHaveBeenCalledWith('/content/admin/seo/sitemap-preview');
    sub(service.validateStructuredData());
    expect(api.get).toHaveBeenCalledWith('/content/admin/seo/structured-data/validate');
  });

  it('source-aware endpoints exercise both branches of the source param', () => {
    const file = new File(['x'], 'a.png');
    // updateCategory without source
    sub(service.updateCategory('s', { name: 'n' }));
    expect(api.patch).toHaveBeenCalledWith(
      '/catalog/categories/s',
      { name: 'n' },
      undefined,
      undefined,
    );
    // uploadCategoryImage with source
    sub(service.uploadCategoryImage('s', 'thumbnail', file, { source: 'storefront' }));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/s/images/thumbnail',
      jasmine.any(FormData),
      undefined,
      { source: 'storefront' },
    );
    // mergeCategory without source
    sub(service.mergeCategory('a', 'b'));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/a/merge',
      { target_slug: 'b' },
      undefined,
      undefined,
    );
    // upsertCategoryTranslation with source
    sub(service.upsertCategoryTranslation('s', 'en', { name: 'n' }, { source: 'storefront' }));
    expect(api.put).toHaveBeenCalledWith(
      '/catalog/categories/s/translations/en',
      { name: 'n' },
      undefined,
      { source: 'storefront' },
    );
    // deleteCategoryTranslation without source
    sub(service.deleteCategoryTranslation('s', 'ro'));
    expect(api.delete).toHaveBeenCalledWith(
      '/catalog/categories/s/translations/ro',
      undefined,
      undefined,
    );
    // deleteCategory with source
    sub(service.deleteCategory('s', { source: 'storefront' }));
    expect(api.delete).toHaveBeenCalledWith('/catalog/categories/s', undefined, {
      source: 'storefront',
    });
    // reorderCategories with source
    sub(service.reorderCategories([{ slug: 's', sort_order: 1 }], { source: 'storefront' }));
    expect(api.post).toHaveBeenCalledWith(
      '/catalog/categories/reorder',
      [{ slug: 's', sort_order: 1 }],
      undefined,
      { source: 'storefront' },
    );
    // duplicateProduct with source
    sub(service.duplicateProduct('s', { source: 'storefront' }));
    expect(api.post).toHaveBeenCalledWith('/catalog/products/s/duplicate', {}, undefined, {
      source: 'storefront',
    });
    // deleteProductImageTranslation with source
    sub(service.deleteProductImageTranslation('s', 'i1', 'ro', { source: 'storefront' }));
    expect(api.delete).toHaveBeenCalledWith(
      '/catalog/products/s/images/i1/translations/ro',
      undefined,
      { source: 'storefront' },
    );
  });

  it('createHomePreviewToken includes expires_minutes when provided', () => {
    sub(service.createHomePreviewToken({ lang: 'ro', expires_minutes: 30 }));
    expect(api.post).toHaveBeenCalledWith(
      '/content/home/preview-token?lang=ro&expires_minutes=30',
      {},
    );
  });

  it('preview token endpoints build query strings conditionally', () => {
    sub(service.createPagePreviewToken('s'));
    expect(api.post).toHaveBeenCalledWith('/content/pages/s/preview-token', {});
    sub(service.createPagePreviewToken('s', { lang: 'ro', expires_minutes: 15 }));
    expect(api.post).toHaveBeenCalledWith(
      '/content/pages/s/preview-token?lang=ro&expires_minutes=15',
      {},
    );
    sub(service.createHomePreviewToken());
    expect(api.post).toHaveBeenCalledWith('/content/home/preview-token', {});
    sub(service.createHomePreviewToken({ lang: 'en' }));
    expect(api.post).toHaveBeenCalledWith('/content/home/preview-token?lang=en', {});
  });
});
