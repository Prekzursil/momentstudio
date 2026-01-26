import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface AdminSummary {
  products: number;
  orders: number;
  users: number;
  low_stock: number;
  sales_30d: number;
  gross_sales_30d: number;
  net_sales_30d: number;
  orders_30d: number;
  sales_range: number;
  gross_sales_range: number;
  net_sales_range: number;
  orders_range: number;
  range_days: number;
  range_from: string;
  range_to: string;
  today_orders: number;
  yesterday_orders: number;
  orders_delta_pct: number | null;
  today_sales: number;
  yesterday_sales: number;
  sales_delta_pct: number | null;
  gross_today_sales: number;
  gross_yesterday_sales: number;
  gross_sales_delta_pct: number | null;
  net_today_sales: number;
  net_yesterday_sales: number;
  net_sales_delta_pct: number | null;
  today_refunds: number;
  yesterday_refunds: number;
  refunds_delta_pct: number | null;
  anomalies?: AdminDashboardAnomalies;
  system?: AdminDashboardSystemHealth;
}

export interface AdminDashboardWindowMetric {
  window_hours?: number;
  window_days?: number;
  current: number;
  previous: number;
  delta_pct: number | null;
}

export interface AdminDashboardAnomalies {
  failed_payments: AdminDashboardWindowMetric;
  refund_requests: AdminDashboardWindowMetric;
  stockouts: { count: number };
}

export interface AdminDashboardSystemHealth {
  db_ready: boolean;
  backup_last_at: string | null;
}

export interface AdminChannelBreakdownRow {
  key: string;
  orders: number;
  gross_sales: number;
  net_sales: number;
}

export interface AdminChannelBreakdownResponse {
  range_days: number;
  range_from: string;
  range_to: string;
  payment_methods: AdminChannelBreakdownRow[];
  couriers: AdminChannelBreakdownRow[];
  delivery_types: AdminChannelBreakdownRow[];
}

export type AdminScheduledReportKind = 'weekly' | 'monthly';

export interface AdminScheduledReportSendResponse {
  kind: AdminScheduledReportKind;
  period_start: string;
  period_end: string;
  attempted: number;
  delivered: number;
  skipped: boolean;
}

export type AdminDashboardSearchResultType = 'order' | 'product' | 'user';

export interface AdminDashboardSearchResult {
  type: AdminDashboardSearchResultType;
  id: string;
  label: string;
  subtitle?: string | null;
  slug?: string | null;
  email?: string | null;
}

export interface AdminDashboardSearchResponse {
  items: AdminDashboardSearchResult[];
}

export type AdminClientErrorKind = 'window_error' | 'unhandled_rejection';

export interface AdminClientErrorIn {
  kind: AdminClientErrorKind;
  message: string;
  stack?: string | null;
  url?: string | null;
  route?: string | null;
  user_agent?: string | null;
  context?: Record<string, any> | null;
  occurred_at?: string | null;
}

export interface ScheduledPublishItem {
  id: string;
  slug: string;
  name: string;
  scheduled_for: string;
  sale_end_at?: string | null;
}

export interface ScheduledPromoItem {
  id: string;
  name: string;
  starts_at?: string | null;
  ends_at?: string | null;
  next_event_at: string;
  next_event_type: string;
}

export interface AdminDashboardScheduledTasksResponse {
  publish_schedules: ScheduledPublishItem[];
  promo_schedules: ScheduledPromoItem[];
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

export interface AdminUserSession {
  id: string;
  created_at: string;
  expires_at: string;
  persistent: boolean;
  is_current: boolean;
  user_agent?: string | null;
  ip_address?: string | null;
  country_code?: string | null;
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
  published_until?: string | null;
  needs_translation_en?: boolean;
  needs_translation_ro?: boolean;
  author?: { id: string; username: string; name?: string | null; name_tag?: number | null } | null;
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
  low_stock_threshold?: number | null;
  parent_id?: string | null;
  tax_group_id?: string | null;
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
  weight_grams?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  depth_cm?: number | null;
  shipping_class?: 'standard' | 'bulky' | 'oversize';
  shipping_allow_locker?: boolean;
  shipping_disallowed_couriers?: string[];
  stock_quantity: number;
  images?: { id: string; url: string; alt_text?: string | null; caption?: string | null }[];
  variants?: AdminProductVariant[];
  tags?: string[];
}

export interface AdminProductRelationships {
  related_product_ids: string[];
  upsell_product_ids: string[];
}

export interface AdminProductTranslation {
  lang: 'en' | 'ro';
  name: string;
  short_description?: string | null;
  long_description?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
}

export interface AdminProductImageTranslation {
  id: string;
  lang: 'en' | 'ro';
  alt_text?: string | null;
  caption?: string | null;
}

export interface AdminProductImageOptimizationStats {
  original_bytes?: number | null;
  thumb_sm_bytes?: number | null;
  thumb_md_bytes?: number | null;
  thumb_lg_bytes?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface AdminDeletedProductImage {
  id: string;
  url: string;
  alt_text?: string | null;
  caption?: string | null;
  deleted_at?: string | null;
}

export interface AdminProductAuditEntry {
  id: string;
  action: string;
  created_at: string;
  user_id?: string | null;
  user_email?: string | null;
  payload?: any | null;
}

export interface AdminProductsImportResult {
  created: number;
  updated: number;
  errors: string[];
}

export interface AdminProductVariant {
  id: string;
  name: string;
  additional_price_delta: number;
  stock_quantity: number;
}

export type StockAdjustmentReason = 'restock' | 'damage' | 'manual_correction';

export interface StockAdjustment {
  id: string;
  product_id: string;
  variant_id?: string | null;
  actor_user_id?: string | null;
  reason: StockAdjustmentReason;
  delta: number;
  before_quantity: number;
  after_quantity: number;
  note?: string | null;
  created_at: string;
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

export interface AdminAuditRetentionPolicy {
  days: number;
  enabled: boolean;
  cutoff: string | null;
}

export interface AdminAuditRetentionCounts {
  total: number;
  expired: number;
}

export interface AdminAuditRetentionResponse {
  now: string;
  policies: Record<'product' | 'content' | 'security', AdminAuditRetentionPolicy>;
  counts: Record<'product' | 'content' | 'security', AdminAuditRetentionCounts>;
}

export interface AdminAuditRetentionPurgeResponse extends AdminAuditRetentionResponse {
  dry_run: boolean;
  deleted: Record<'product' | 'content' | 'security', number>;
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
  threshold: number;
  is_critical: boolean;
  sku: string;
  slug: string;
}

export type RestockListItemKind = 'product' | 'variant';

export interface RestockListItem {
  kind: RestockListItemKind;
  product_id: string;
  variant_id?: string | null;
  sku: string;
  product_slug: string;
  product_name: string;
  variant_name?: string | null;
  stock_quantity: number;
  reserved_in_carts: number;
  reserved_in_orders: number;
  available_quantity: number;
  threshold: number;
  is_critical: boolean;
  restock_at?: string | null;
  supplier?: string | null;
  desired_quantity?: number | null;
  note?: string | null;
  note_updated_at?: string | null;
}

export interface RestockListResponse {
  items: RestockListItem[];
  meta: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

export interface RestockNoteUpsert {
  product_id: string;
  variant_id?: string | null;
  supplier?: string | null;
  desired_quantity?: number | null;
  note?: string | null;
}

export interface RestockNoteRead extends RestockNoteUpsert {
  id: string;
  actor_user_id?: string | null;
  created_at: string;
  updated_at: string;
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
  published_until?: string | null;
  needs_translation_en?: boolean;
  needs_translation_ro?: boolean;
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
  published_until?: string | null;
  translations?: ContentTranslationSnapshot[] | null;
}

export interface ContentPageListItem {
  key: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  updated_at: string;
  published_at?: string | null;
  published_until?: string | null;
  needs_translation_en?: boolean;
  needs_translation_ro?: boolean;
}

export interface ContentPageRenameResponse {
  old_slug: string;
  new_slug: string;
  old_key: string;
  new_key: string;
}

export interface ContentRedirectRead {
  id: string;
  from_key: string;
  to_key: string;
  created_at: string;
  updated_at: string;
  target_exists: boolean;
  chain_error?: 'loop' | 'too_deep' | null;
}

export interface ContentRedirectListResponse {
  items: ContentRedirectRead[];
  meta: { total_items: number; total_pages: number; page: number; limit: number };
}

export interface ContentRedirectImportError {
  line: number;
  from_value?: string | null;
  to_value?: string | null;
  error: string;
}

export interface ContentRedirectImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors?: ContentRedirectImportError[];
}

export interface SitemapPreviewResponse {
  by_lang: Record<string, string[]>;
}

export interface StructuredDataValidationIssue {
  entity_type: 'product' | 'page';
  entity_key: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface StructuredDataValidationResponse {
  checked_products: number;
  checked_pages: number;
  errors: number;
  warnings: number;
  issues: StructuredDataValidationIssue[];
}

export interface ContentImageAssetRead {
  id: string;
  url: string;
  alt_text?: string | null;
  sort_order: number;
  focal_x: number;
  focal_y: number;
  created_at: string;
  content_key: string;
  tags?: string[];
}

export interface ContentImageAssetListResponse {
  items: ContentImageAssetRead[];
  meta: { total_items: number; total_pages: number; page: number; limit: number };
}

export interface ContentLinkCheckIssue {
  key: string;
  kind: 'link' | 'image';
  source: 'markdown' | 'block';
  field: string;
  url: string;
  reason: string;
}

export interface ContentLinkCheckResponse {
  issues: ContentLinkCheckIssue[];
}

export interface ContentSavePayload {
  title?: string;
  body_markdown?: string;
  status?: string;
  meta?: Record<string, any>;
  lang?: string | null;
  sort_order?: number;
  published_at?: string | null;
  published_until?: string | null;
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

  summary(params?: { range_days?: number; range_from?: string; range_to?: string }): Observable<AdminSummary> {
    return this.api.get<AdminSummary>('/admin/dashboard/summary', params);
  }

  channelBreakdown(params?: { range_days?: number; range_from?: string; range_to?: string }): Observable<AdminChannelBreakdownResponse> {
    return this.api.get<AdminChannelBreakdownResponse>('/admin/dashboard/channel-breakdown', params);
  }

  globalSearch(q: string, opts?: { include_pii?: boolean }): Observable<AdminDashboardSearchResponse> {
    const params: any = { q };
    if (opts?.include_pii) params.include_pii = true;
    return this.api.get<AdminDashboardSearchResponse>('/admin/dashboard/search', params);
  }

  scheduledTasks(): Observable<AdminDashboardScheduledTasksResponse> {
    return this.api.get<AdminDashboardScheduledTasksResponse>('/admin/dashboard/scheduled-tasks');
  }

  logClientError(payload: AdminClientErrorIn): Observable<void> {
    return this.api.post<void>('/admin/observability/client-errors', payload, { 'X-Silent': '1' });
  }

  products(): Observable<AdminProduct[]> {
    return this.api.get<AdminProduct[]>('/admin/dashboard/products');
  }

  orders(opts?: { include_pii?: boolean }): Observable<AdminOrder[]> {
    return this.api.get<AdminOrder[]>('/admin/dashboard/orders', opts as any);
  }

  users(opts?: { include_pii?: boolean }): Observable<AdminUser[]> {
    return this.api.get<AdminUser[]>('/admin/dashboard/users', opts as any);
  }

  userAliases(userId: string, opts?: { include_pii?: boolean }): Observable<AdminUserAliasesResponse> {
    return this.api.get<AdminUserAliasesResponse>(`/admin/dashboard/users/${userId}/aliases`, opts as any);
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

  exportAuditCsv(params: { entity?: AdminAuditEntity; action?: string; user?: string; redact?: boolean }): Observable<Blob> {
    return this.api.getBlob('/admin/dashboard/audit/export.csv', params);
  }

  auditRetention(): Observable<AdminAuditRetentionResponse> {
    return this.api.get<AdminAuditRetentionResponse>('/admin/dashboard/audit/retention');
  }

  purgeAuditRetention(payload: { confirm: string; dry_run?: boolean }): Observable<AdminAuditRetentionPurgeResponse> {
    return this.api.post<AdminAuditRetentionPurgeResponse>('/admin/dashboard/audit/retention/purge', payload);
  }

  transferOwner(payload: { identifier: string; confirm: string; password: string }): Observable<OwnerTransferResponse> {
    return this.api.post<OwnerTransferResponse>('/admin/dashboard/owner/transfer', payload);
  }

  revokeSessions(userId: string): Observable<void> {
    return this.api.post<void>(`/admin/dashboard/sessions/${userId}/revoke`, {});
  }

  listUserSessions(userId: string): Observable<AdminUserSession[]> {
    return this.api.get<AdminUserSession[]>(`/admin/dashboard/sessions/${userId}`);
  }

  revokeSession(userId: string, sessionId: string): Observable<void> {
    return this.api.post<void>(`/admin/dashboard/sessions/${userId}/${sessionId}/revoke`, {});
  }

  lowStock(): Observable<LowStockItem[]> {
    return this.api.get<LowStockItem[]>('/admin/dashboard/low-stock');
  }

  restockList(params: {
    page?: number;
    limit?: number;
    include_variants?: boolean;
    default_threshold?: number;
  }): Observable<RestockListResponse> {
    return this.api.get<RestockListResponse>('/admin/dashboard/inventory/restock-list', params as any);
  }

  exportRestockListCsv(params: { include_variants?: boolean; default_threshold?: number }): Observable<Blob> {
    return this.api.getBlob('/admin/dashboard/inventory/restock-list/export', params as any);
  }

  upsertRestockNote(payload: RestockNoteUpsert): Observable<RestockNoteRead | null> {
    return this.api.put<RestockNoteRead | null>('/admin/dashboard/inventory/restock-notes', payload);
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
    category_id?: string | null;
    publish_scheduled_for?: string | null;
    unpublish_scheduled_for?: string | null;
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

  updateCategory(slug: string, payload: Partial<AdminCategory>): Observable<AdminCategory> {
    return this.api.patch<AdminCategory>(`/catalog/categories/${slug}`, payload);
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

  exportProductsCsv(): Observable<Blob> {
    return this.api.getBlob('/catalog/products/export');
  }

  importProductsCsv(file: File, dryRun = true): Observable<AdminProductsImportResult> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<AdminProductsImportResult>('/catalog/products/import', form, undefined, { dry_run: dryRun });
  }

  getProductAudit(slug: string, limit = 50): Observable<AdminProductAuditEntry[]> {
    return this.api.get<AdminProductAuditEntry[]>(`/catalog/products/${slug}/audit`, { limit } as any);
  }

  getProductRelationships(slug: string): Observable<AdminProductRelationships> {
    return this.api.get<AdminProductRelationships>(`/catalog/products/${slug}/relationships`);
  }

  updateProductRelationships(slug: string, payload: AdminProductRelationships): Observable<AdminProductRelationships> {
    return this.api.put<AdminProductRelationships>(`/catalog/products/${slug}/relationships`, payload);
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

  listDeletedProductImages(slug: string): Observable<AdminDeletedProductImage[]> {
    return this.api.get<AdminDeletedProductImage[]>(`/catalog/products/${slug}/images/deleted`);
  }

  restoreProductImage(slug: string, imageId: string): Observable<AdminProductDetail> {
    return this.api.post<AdminProductDetail>(`/catalog/products/${slug}/images/${imageId}/restore`, {});
  }

  reorderProductImage(slug: string, imageId: string, sortOrder: number): Observable<AdminProductDetail> {
    return this.api.patch<AdminProductDetail>(
      `/catalog/products/${slug}/images/${imageId}/sort?sort_order=${sortOrder}`,
      {}
    );
  }

  updateProductVariants(
    slug: string,
    payload: {
      variants: Array<{ id?: string | null; name: string; additional_price_delta: number; stock_quantity: number }>;
      delete_variant_ids?: string[];
    }
  ): Observable<AdminProductVariant[]> {
    return this.api.put<AdminProductVariant[]>(`/catalog/products/${slug}/variants`, payload);
  }

  getProductImageTranslations(slug: string, imageId: string): Observable<AdminProductImageTranslation[]> {
    return this.api.get<AdminProductImageTranslation[]>(`/catalog/products/${slug}/images/${imageId}/translations`);
  }

  upsertProductImageTranslation(
    slug: string,
    imageId: string,
    lang: 'en' | 'ro',
    payload: { alt_text?: string | null; caption?: string | null }
  ): Observable<AdminProductImageTranslation> {
    return this.api.put<AdminProductImageTranslation>(
      `/catalog/products/${slug}/images/${imageId}/translations/${lang}`,
      payload
    );
  }

  deleteProductImageTranslation(slug: string, imageId: string, lang: 'en' | 'ro'): Observable<void> {
    return this.api.delete<void>(`/catalog/products/${slug}/images/${imageId}/translations/${lang}`);
  }

  getProductImageStats(slug: string, imageId: string): Observable<AdminProductImageOptimizationStats> {
    return this.api.get<AdminProductImageOptimizationStats>(`/catalog/products/${slug}/images/${imageId}/stats`);
  }

  reprocessProductImage(slug: string, imageId: string): Observable<AdminProductImageOptimizationStats> {
    return this.api.post<AdminProductImageOptimizationStats>(`/catalog/products/${slug}/images/${imageId}/reprocess`, {});
  }

  listStockAdjustments(params: { product_id: string; limit?: number; offset?: number }): Observable<StockAdjustment[]> {
    return this.api.get<StockAdjustment[]>('/admin/dashboard/stock-adjustments', params as any);
  }

  applyStockAdjustment(payload: {
    product_id: string;
    variant_id?: string | null;
    delta: number;
    reason: StockAdjustmentReason;
    note?: string | null;
  }): Observable<StockAdjustment> {
    return this.api.post<StockAdjustment>('/admin/dashboard/stock-adjustments', payload);
  }

  updateUserRole(userId: string, role: string, password: string): Observable<AdminUser> {
    return this.api.patch<AdminUser>(`/admin/dashboard/users/${userId}/role`, { role, password });
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

  sendScheduledReport(payload: { kind: AdminScheduledReportKind; force?: boolean }): Observable<AdminScheduledReportSendResponse> {
    return this.api.post<AdminScheduledReportSendResponse>('/admin/dashboard/reports/send', payload);
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

  updateContentTranslationStatus(key: string, payload: { needs_translation_en?: boolean | null; needs_translation_ro?: boolean | null }): Observable<ContentBlock> {
    return this.api.patch<ContentBlock>(`/content/admin/${encodeURIComponent(key)}/translation-status`, payload);
  }

  listContentImages(params?: { key?: string; q?: string; tag?: string; page?: number; limit?: number }): Observable<ContentImageAssetListResponse> {
    return this.api.get<ContentImageAssetListResponse>('/content/admin/assets/images', params as any);
  }

  updateContentImageTags(imageId: string, tags: string[]): Observable<ContentImageAssetRead> {
    return this.api.patch<ContentImageAssetRead>(`/content/admin/assets/images/${encodeURIComponent(imageId)}/tags`, { tags });
  }

  updateContentImageFocalPoint(imageId: string, focal_x: number, focal_y: number): Observable<ContentImageAssetRead> {
    return this.api.patch<ContentImageAssetRead>(`/content/admin/assets/images/${encodeURIComponent(imageId)}/focal`, { focal_x, focal_y });
  }

  linkCheckContent(key: string): Observable<ContentLinkCheckResponse> {
    return this.api.get<ContentLinkCheckResponse>('/content/admin/tools/link-check', { key });
  }

  fetchSocialThumbnail(url: string): Observable<SocialThumbnailResponse> {
    return this.api.post<SocialThumbnailResponse>('/content/admin/social/thumbnail', { url });
  }

  listContentPages(): Observable<ContentPageListItem[]> {
    return this.api.get<ContentPageListItem[]>('/content/admin/pages/list');
  }

  renameContentPage(slug: string, newSlug: string): Observable<ContentPageRenameResponse> {
    return this.api.post<ContentPageRenameResponse>(`/content/admin/pages/${encodeURIComponent(slug)}/rename`, { new_slug: newSlug });
  }

  listContentRedirects(params?: { q?: string; page?: number; limit?: number }): Observable<ContentRedirectListResponse> {
    return this.api.get<ContentRedirectListResponse>('/content/admin/redirects', params as any);
  }

  deleteContentRedirect(id: string): Observable<void> {
    return this.api.delete<void>(`/content/admin/redirects/${encodeURIComponent(id)}`);
  }

  exportContentRedirects(params?: { q?: string }): Observable<Blob> {
    return this.api.getBlob('/content/admin/redirects/export', params as any);
  }

  importContentRedirects(file: File): Observable<ContentRedirectImportResult> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<ContentRedirectImportResult>('/content/admin/redirects/import', form);
  }

  getSitemapPreview(): Observable<SitemapPreviewResponse> {
    return this.api.get<SitemapPreviewResponse>('/content/admin/seo/sitemap-preview');
  }

  validateStructuredData(): Observable<StructuredDataValidationResponse> {
    return this.api.get<StructuredDataValidationResponse>('/content/admin/seo/structured-data/validate');
  }
}
