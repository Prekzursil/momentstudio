import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface AdminSummary {
  products: number;
  orders: number;
  users: number;
  low_stock: number;
  sales_30d: number;
  orders_30d: number;
}

export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  status: string;
  category: string;
  stock_quantity: number;
  publish_at?: string | null;
  tags?: string[];
}

export interface AdminOrder {
  id: string;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
  customer: string;
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  name?: string | null;
  name_tag?: number;
  role: string;
  created_at: string;
}

export interface AdminUserAliasHistoryItem {
  created_at: string;
}

export interface AdminUserUsernameHistoryItem extends AdminUserAliasHistoryItem {
  username: string;
}

export interface AdminUserDisplayNameHistoryItem extends AdminUserAliasHistoryItem {
  name: string;
  name_tag: number;
}

export interface AdminUserAliasesResponse {
  user: {
    id: string;
    email: string;
    username: string;
    name?: string | null;
    name_tag?: number;
    role: string;
  };
  usernames: AdminUserUsernameHistoryItem[];
  display_names: AdminUserDisplayNameHistoryItem[];
}

export interface AdminContent {
  id: string;
  key: string;
  title: string;
  updated_at: string;
  version: number;
  body_markdown?: string;
  status?: string;
  meta?: Record<string, any> | null;
  lang?: string | null;
  sort_order?: number | null;
  published_at?: string | null;
}

export interface AdminCoupon {
  id: string;
  code: string;
  percentage_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  expires_at?: string | null;
  active: boolean;
  times_used: number;
  max_uses?: number | null;
}

export interface AdminCouponStripeInvalidationResult {
  deleted_mappings: number;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sort_order?: number;
}

export interface AdminCategoryTranslation {
  lang: 'en' | 'ro';
  name: string;
  description?: string | null;
}

export interface AdminProductDetail extends AdminProduct {
  short_description?: string | null;
  long_description?: string | null;
  category_id?: string | null;
  stock_quantity: number;
  images?: { id: string; url: string; alt_text?: string | null }[];
  tags?: string[];
}

export interface AdminProductTranslation {
  lang: 'en' | 'ro';
  name: string;
  short_description?: string | null;
  long_description?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
}

export interface AdminAudit {
  products: AdminAuditItem[];
  content: AdminAuditItem[];
  security?: AdminSecurityAuditItem[];
}

export type AdminAuditEntity = 'all' | 'product' | 'content' | 'security';

export interface AdminAuditEntryUnified {
  entity: AdminAuditEntity;
  id: string;
  action: string;
  created_at: string;
  actor_user_id?: string | null;
  actor_email?: string | null;
  subject_user_id?: string | null;
  subject_email?: string | null;
  ref_id?: string | null;
  ref_key?: string | null;
  data?: string | null;
}

export interface AdminAuditEntriesResponse {
  items: AdminAuditEntryUnified[];
  meta: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

export interface AdminAuditItem {
  id: string;
  product_id?: string;
  block_id?: string;
  action: string;
  version?: number;
  user_id?: string | null;
  created_at: string;
}

export interface AdminSecurityAuditItem {
  id: string;
  action: string;
  actor_user_id?: string | null;
  actor_email?: string | null;
  subject_user_id?: string | null;
  subject_email?: string | null;
  data?: Record<string, any> | null;
  created_at: string;
}

export interface LowStockItem {
  id: string;
  name: string;
  stock_quantity: number;
  sku: string;
  slug: string;
}

export interface FeaturedCollection {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  created_at: string;
  product_ids?: string[];
}

export interface ContentBlock {
  key: string;
  title: string;
  body_markdown: string;
  status: string;
  version: number;
  meta?: Record<string, any> | null;
  lang?: string | null;
  sort_order?: number;
  published_at?: string | null;
  images?: { id: string; url: string; alt_text?: string | null; sort_order?: number }[];
}

export interface ContentBlockVersionListItem {
  id: string;
  version: number;
  title: string;
  status: string;
  created_at: string;
}

export interface ContentTranslationSnapshot {
  lang: string;
  title: string;
  body_markdown: string;
}

export interface ContentBlockVersionRead extends ContentBlockVersionListItem {
  body_markdown: string;
  meta?: Record<string, any> | null;
  lang?: string | null;
  published_at?: string | null;
  translations?: ContentTranslationSnapshot[] | null;
}

export interface ContentImageAssetRead {
  id: string;
  url: string;
  alt_text?: string | null;
  sort_order: number;
  created_at: string;
  content_key: string;
}

export interface ContentImageAssetListResponse {
  items: ContentImageAssetRead[];
  meta: { total_items: number; total_pages: number; page: number; limit: number };
}

export interface ContentSavePayload {
  title?: string;
  body_markdown?: string;
  status?: string;
  meta?: Record<string, any>;
  lang?: string | null;
  sort_order?: number;
  published_at?: string | null;
  expected_version?: number;
}

export interface SocialThumbnailResponse {
  thumbnail_url: string | null;
}

export interface OwnerTransferResponse {
  old_owner_id: string;
  new_owner_id: string;
  email?: string;
  username?: string;
  name?: string | null;
  name_tag?: number;
  role?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  constructor(private api: ApiService) {}

  summary(): Observable<AdminSummary> {
    return this.api.get<AdminSummary>('/admin/dashboard/summary');
  }

  products(): Observable<AdminProduct[]> {
    return this.api.get<AdminProduct[]>('/admin/dashboard/products');
  }

  orders(): Observable<AdminOrder[]> {
    return this.api.get<AdminOrder[]>('/admin/dashboard/orders');
  }

  users(): Observable<AdminUser[]> {
    return this.api.get<AdminUser[]>('/admin/dashboard/users');
  }

  userAliases(userId: string): Observable<AdminUserAliasesResponse> {
    return this.api.get<AdminUserAliasesResponse>(`/admin/dashboard/users/${userId}/aliases`);
  }

  content(): Observable<AdminContent[]> {
    return this.api.get<AdminContent[]>('/admin/dashboard/content');
  }

  updateContentBlock(key: string, payload: ContentSavePayload): Observable<ContentBlock> {
    return this.api.patch<ContentBlock>(`/content/admin/${key}`, payload);
  }

  coupons(): Observable<AdminCoupon[]> {
    return this.api.get<AdminCoupon[]>('/admin/dashboard/coupons');
  }

  audit(): Observable<AdminAudit> {
    return this.api.get<AdminAudit>('/admin/dashboard/audit');
  }

  auditEntries(params: {
    entity?: AdminAuditEntity;
    action?: string;
    user?: string;
    page?: number;
    limit?: number;
  }): Observable<AdminAuditEntriesResponse> {
    return this.api.get<AdminAuditEntriesResponse>('/admin/dashboard/audit/entries', params);
  }

  exportAuditCsv(params: { entity?: AdminAuditEntity; action?: string; user?: string }): Observable<Blob> {
    return this.api.getBlob('/admin/dashboard/audit/export.csv', params);
  }

  transferOwner(payload: { identifier: string; confirm: string; password: string }): Observable<OwnerTransferResponse> {
    return this.api.post<OwnerTransferResponse>('/admin/dashboard/owner/transfer', payload);
  }

  revokeSessions(userId: string): Observable<void> {
    return this.api.post<void>(`/admin/dashboard/sessions/${userId}/revoke`, {});
  }

  lowStock(): Observable<LowStockItem[]> {
    return this.api.get<LowStockItem[]>('/admin/dashboard/low-stock');
  }

  updateOrderStatus(orderId: string, status: string): Observable<AdminOrder> {
    return this.api.patch<AdminOrder>(`/orders/admin/${orderId}`, { status });
  }

  bulkUpdateProducts(payload: {
    product_id: string;
    base_price?: number | null;
    sale_type?: 'percent' | 'amount' | null;
    sale_value?: number | null;
    stock_quantity?: number | null;
    status?: string | null;
  }[]): Observable<any[]> {
    return this.api.post<any[]>('/catalog/products/bulk-update', payload);
  }

  getCategories(): Observable<AdminCategory[]> {
    return this.api.get<AdminCategory[]>('/catalog/categories');
  }

  createCategory(payload: Partial<AdminCategory>): Observable<AdminCategory> {
    return this.api.post<AdminCategory>('/catalog/categories', payload);
  }

  getCategoryTranslations(slug: string): Observable<AdminCategoryTranslation[]> {
    return this.api.get<AdminCategoryTranslation[]>(`/catalog/categories/${slug}/translations`);
  }

  upsertCategoryTranslation(slug: string, lang: 'en' | 'ro', payload: { name: string; description?: string | null }): Observable<AdminCategoryTranslation> {
    return this.api.put<AdminCategoryTranslation>(`/catalog/categories/${slug}/translations/${lang}`, payload);
  }

  deleteCategoryTranslation(slug: string, lang: 'en' | 'ro'): Observable<void> {
    return this.api.delete<void>(`/catalog/categories/${slug}/translations/${lang}`);
  }

  deleteCategory(slug: string): Observable<AdminCategory> {
    return this.api.delete<AdminCategory>(`/catalog/categories/${slug}`);
  }

  reorderCategories(items: { slug: string; sort_order: number }[]): Observable<AdminCategory[]> {
    return this.api.post<AdminCategory[]>('/catalog/categories/reorder', items);
  }

  getProduct(slug: string): Observable<AdminProductDetail> {
    return this.api.get<AdminProductDetail>(`/catalog/products/${slug}`);
  }

  getProductTranslations(slug: string): Observable<AdminProductTranslation[]> {
    return this.api.get<AdminProductTranslation[]>(`/catalog/products/${slug}/translations`);
  }

  upsertProductTranslation(
    slug: string,
    lang: 'en' | 'ro',
    payload: {
      name: string;
      short_description?: string | null;
      long_description?: string | null;
      meta_title?: string | null;
      meta_description?: string | null;
    }
  ): Observable<AdminProductTranslation> {
    return this.api.put<AdminProductTranslation>(`/catalog/products/${slug}/translations/${lang}`, payload);
  }

  deleteProductTranslation(slug: string, lang: 'en' | 'ro'): Observable<void> {
    return this.api.delete<void>(`/catalog/products/${slug}/translations/${lang}`);
  }

  createProduct(payload: Partial<AdminProductDetail>): Observable<AdminProductDetail> {
    return this.api.post<AdminProductDetail>('/catalog/products', payload);
  }

  updateProduct(slug: string, payload: Partial<AdminProductDetail>): Observable<AdminProductDetail> {
    return this.api.patch<AdminProductDetail>(`/catalog/products/${slug}`, payload);
  }

  duplicateProduct(slug: string): Observable<AdminProductDetail> {
    return this.api.post<AdminProductDetail>(`/catalog/products/${slug}/duplicate`, {});
  }

  deleteProduct(slug: string): Observable<void> {
    return this.api.delete<void>(`/catalog/products/${slug}`);
  }

  createCoupon(payload: Partial<AdminCoupon>): Observable<AdminCoupon> {
    return this.api.post<AdminCoupon>('/admin/dashboard/coupons', payload);
  }

  updateCoupon(id: string, payload: Partial<AdminCoupon>): Observable<AdminCoupon> {
    return this.api.patch<AdminCoupon>(`/admin/dashboard/coupons/${id}`, payload);
  }

  invalidateCouponStripeMappings(id: string): Observable<AdminCouponStripeInvalidationResult> {
    return this.api.post<AdminCouponStripeInvalidationResult>(`/admin/dashboard/coupons/${id}/stripe/invalidate`, {});
  }

  uploadProductImage(slug: string, file: File): Observable<AdminProductDetail> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<AdminProductDetail>(`/catalog/products/${slug}/images`, form);
  }

  deleteProductImage(slug: string, imageId: string): Observable<AdminProductDetail> {
    return this.api.delete<AdminProductDetail>(`/catalog/products/${slug}/images/${imageId}`);
  }

  reorderProductImage(slug: string, imageId: string, sortOrder: number): Observable<AdminProductDetail> {
    return this.api.patch<AdminProductDetail>(
      `/catalog/products/${slug}/images/${imageId}/sort?sort_order=${sortOrder}`,
      {}
    );
  }

  updateUserRole(userId: string, role: string): Observable<AdminUser> {
    return this.api.patch<AdminUser>(`/admin/dashboard/users/${userId}/role`, { role });
  }

  getMaintenance(): Observable<{ enabled: boolean }> {
    return this.api.get<{ enabled: boolean }>('/admin/dashboard/maintenance');
  }

  setMaintenance(enabled: boolean): Observable<{ enabled: boolean }> {
    return this.api.post<{ enabled: boolean }>('/admin/dashboard/maintenance', { enabled });
  }

  listFeaturedCollections(): Observable<FeaturedCollection[]> {
    return this.api.get<FeaturedCollection[]>('/catalog/collections/featured');
  }

  createFeaturedCollection(payload: { name: string; description?: string | null; product_ids?: string[] }): Observable<FeaturedCollection> {
    return this.api.post<FeaturedCollection>('/catalog/collections/featured', payload);
  }

  updateFeaturedCollection(slug: string, payload: Partial<FeaturedCollection> & { product_ids?: string[] }): Observable<FeaturedCollection> {
    return this.api.patch<FeaturedCollection>(`/catalog/collections/featured/${slug}`, payload);
  }

  getContent(key: string, lang?: string): Observable<ContentBlock> {
    const suffix = lang ? `?lang=${lang}` : '';
    return this.api.get<ContentBlock>(`/content/admin/${key}${suffix}`);
  }

  createContent(key: string, payload: Partial<ContentBlock>): Observable<ContentBlock> {
    return this.api.post<ContentBlock>(`/content/admin/${key}`, payload);
  }

  uploadContentImage(key: string, file: File, lang?: string): Observable<ContentBlock> {
    const form = new FormData();
    form.append('file', file);
    const suffix = lang ? `?lang=${lang}` : '';
    return this.api.post<ContentBlock>(`/content/admin/${key}/images${suffix}`, form);
  }

  listContentVersions(key: string): Observable<ContentBlockVersionListItem[]> {
    return this.api.get<ContentBlockVersionListItem[]>(`/content/admin/${key}/versions`);
  }

  getContentVersion(key: string, version: number): Observable<ContentBlockVersionRead> {
    return this.api.get<ContentBlockVersionRead>(`/content/admin/${key}/versions/${version}`);
  }

  rollbackContentVersion(key: string, version: number): Observable<ContentBlock> {
    return this.api.post<ContentBlock>(`/content/admin/${key}/versions/${version}/rollback`, {});
  }

  listContentImages(params?: { key?: string; q?: string; page?: number; limit?: number }): Observable<ContentImageAssetListResponse> {
    return this.api.get<ContentImageAssetListResponse>('/content/admin/assets/images', params as any);
  }

  fetchSocialThumbnail(url: string): Observable<SocialThumbnailResponse> {
    return this.api.post<SocialThumbnailResponse>('/content/admin/social/thumbnail', { url });
  }
}
