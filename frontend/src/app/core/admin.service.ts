import { Injectable } from '@angular/core';
import type { HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type AdminRequestSource = 'storefront';

export type AdminRequestOptions = {
  source?: AdminRequestSource;
};

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
  alert_thresholds?: AdminDashboardAlertThresholds;
  system?: AdminDashboardSystemHealth;
}

export interface AdminDashboardWindowMetric {
  window_hours?: number;
  window_days?: number;
  current: number;
  previous: number;
  delta_pct: number | null;
  is_alert?: boolean;
  current_denominator?: number;
  previous_denominator?: number;
  current_rate_pct?: number | null;
  previous_rate_pct?: number | null;
  rate_delta_pct?: number | null;
}

export interface AdminDashboardAnomalies {
  failed_payments: AdminDashboardWindowMetric;
  refund_requests: AdminDashboardWindowMetric;
  stockouts: { count: number; is_alert?: boolean };
}

export interface AdminDashboardSystemHealth {
  db_ready: boolean;
  backup_last_at: string | null;
}

export interface AdminDashboardAlertThresholds {
  failed_payments_min_count: number;
  failed_payments_min_delta_pct: number | null;
  refund_requests_min_count: number;
  refund_requests_min_rate_pct: number | null;
  stockouts_min_count: number;
  updated_at: string | null;
}

export interface AdminDashboardAlertThresholdsUpdateRequest {
  failed_payments_min_count: number;
  failed_payments_min_delta_pct: number | null;
  refund_requests_min_count: number;
  refund_requests_min_rate_pct: number | null;
  stockouts_min_count: number;
}

export interface AdminDashboardPaymentsHealthProvider {
  provider: string;
  successful_orders: number;
  pending_payment_orders: number;
  success_rate: number | null;
  webhook_errors: number;
  webhook_backlog: number;
}

export interface AdminDashboardPaymentsHealthWebhookError {
  provider: string;
  event_id: string;
  event_type: string | null;
  attempts: number;
  last_attempt_at: string;
  last_error: string | null;
}

export interface AdminDashboardPaymentsHealthResponse {
  window_hours: number;
  window_start: string;
  window_end: string;
  providers: AdminDashboardPaymentsHealthProvider[];
  recent_webhook_errors: AdminDashboardPaymentsHealthWebhookError[];
}

export interface AdminRefundsBreakdownMetric {
  count: number;
  amount: number;
}

export interface AdminRefundsBreakdownProviderRow {
  provider: string;
  current: AdminRefundsBreakdownMetric;
  previous: AdminRefundsBreakdownMetric;
  delta_pct: { count: number | null; amount: number | null };
}

export interface AdminRefundsBreakdownReasonRow {
  category: string;
  current: number;
  previous: number;
  delta_pct: number | null;
}

export interface AdminRefundsBreakdownResponse {
  window_days: number;
  window_start: string;
  window_end: string;
  providers: AdminRefundsBreakdownProviderRow[];
  missing_refunds: {
    current: AdminRefundsBreakdownMetric;
    previous: AdminRefundsBreakdownMetric;
    delta_pct: { count: number | null; amount: number | null };
  };
  reasons: AdminRefundsBreakdownReasonRow[];
}

export interface AdminShippingPerformanceMetric {
  count: number;
  avg_hours: number | null;
}

export interface AdminShippingPerformanceRow {
  courier: string;
  current: AdminShippingPerformanceMetric;
  previous: AdminShippingPerformanceMetric;
  delta_pct: { avg_hours: number | null; count: number | null };
}

export interface AdminShippingPerformanceResponse {
  window_days: number;
  window_start: string;
  window_end: string;
  time_to_ship: AdminShippingPerformanceRow[];
  delivery_time: AdminShippingPerformanceRow[];
}

export interface AdminStockoutImpactItem {
  product_id: string;
  product_slug: string;
  product_name: string;
  available_quantity: number;
  reserved_in_carts: number;
  reserved_in_orders: number;
  stock_quantity: number;
  demand_units: number;
  demand_revenue: number;
  estimated_missed_revenue: number;
  currency: string;
  allow_backorder: boolean;
}

export interface AdminStockoutImpactResponse {
  window_days: number;
  window_start: string;
  window_end: string;
  items: AdminStockoutImpactItem[];
}

export interface AdminChannelAttributionRow {
  source: string;
  medium: string | null;
  campaign: string | null;
  orders: number;
  gross_sales: number;
}

export interface AdminChannelAttributionResponse {
  range_days: number;
  range_from: string;
  range_to: string;
  total_orders: number;
  total_gross_sales: number;
  tracked_orders: number;
  tracked_gross_sales: number;
  coverage_pct: number | null;
  channels: AdminChannelAttributionRow[];
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

export interface AdminFunnelCounts {
  sessions: number;
  carts: number;
  checkouts: number;
  orders: number;
}

export interface AdminFunnelConversions {
  to_cart: number | null;
  to_checkout: number | null;
  to_order: number | null;
}

export interface AdminFunnelMetricsResponse {
  range_days: number;
  range_from: string;
  range_to: string;
  opt_in_only: boolean;
  counts: AdminFunnelCounts;
  conversions: AdminFunnelConversions;
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

export interface PaginationMeta {
  total_items: number;
  total_pages: number;
  page: number;
  limit: number;
}

export interface ContentSchedulingItem {
  key: string;
  title: string;
  status: string;
  lang?: string | null;
  published_at?: string | null;
  published_until?: string | null;
  updated_at: string;
}

export interface ContentSchedulingListResponse {
  items: ContentSchedulingItem[];
  meta: PaginationMeta;
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
  thumbnail_url?: string | null;
  banner_url?: string | null;
  is_visible?: boolean;
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

export interface AdminCategoryDeletePreview {
  slug: string;
  product_count: number;
  child_count: number;
  can_delete: boolean;
}

export interface AdminCategoryMergePreview {
  source_slug: string;
  target_slug: string;
  product_count: number;
  child_count: number;
  can_merge: boolean;
  reason?: string | null;
}

export interface AdminCategoryMergeResult {
  source_slug: string;
  target_slug: string;
  moved_products: number;
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

export interface AdminCategoriesImportResult {
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

export interface CartReservationItem {
  cart_id: string;
  updated_at: string;
  customer_email?: string | null;
  quantity: number;
}

export interface CartReservationsResponse {
  cutoff: string;
  items: CartReservationItem[];
}

export interface OrderReservationItem {
  order_id: string;
  reference_code?: string | null;
  status: string;
  created_at: string;
  customer_email?: string | null;
  quantity: number;
}

export interface OrderReservationsResponse {
  items: OrderReservationItem[];
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
  images?: { id: string; url: string; alt_text?: string | null; sort_order?: number; focal_x?: number; focal_y?: number }[];
}

export interface ContentPreviewTokenResponse {
  token: string;
  expires_at: string;
  url: string;
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
  status: 'draft' | 'review' | 'published';
  hidden?: boolean;
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
  root_image_id?: string | null;
  source_image_id?: string | null;
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

export interface ContentImageAssetUpdateRequest {
  alt_text?: string | null;
}

export interface ContentImageEditRequest {
  rotate_cw?: 0 | 90 | 180 | 270;
  crop_aspect_w?: number;
  crop_aspect_h?: number;
  resize_max_width?: number;
  resize_max_height?: number;
}

export interface ContentImageAssetUsageResponse {
  image_id: string;
  url: string;
  stored_in_key?: string | null;
  keys: string[];
}

export type MediaAssetType = 'image' | 'video' | 'document';
export type MediaAssetStatus = 'draft' | 'approved' | 'rejected' | 'archived' | 'trashed';
export type MediaAssetVisibility = 'public' | 'private';
export type MediaJobType = 'ingest' | 'variant' | 'edit' | 'ai_tag' | 'duplicate_scan';
export type MediaJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface MediaAssetI18n {
  lang: 'en' | 'ro';
  title?: string | null;
  alt_text?: string | null;
  caption?: string | null;
  description?: string | null;
}

export interface MediaVariant {
  id: string;
  profile: string;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  public_url: string;
  size_bytes?: number | null;
  created_at: string;
}

export interface MediaAsset {
  id: string;
  asset_type: MediaAssetType;
  status: MediaAssetStatus;
  visibility: MediaAssetVisibility;
  source_kind: string;
  source_ref?: string | null;
  storage_key: string;
  public_url: string;
  original_filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  page_count?: number | null;
  checksum_sha256?: string | null;
  perceptual_hash?: string | null;
  dedupe_group?: string | null;
  rights_license?: string | null;
  rights_owner?: string | null;
  rights_notes?: string | null;
  approved_at?: string | null;
  trashed_at?: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  i18n: MediaAssetI18n[];
  variants: MediaVariant[];
}

export interface MediaAssetListResponse {
  items: MediaAsset[];
  meta: { total_items: number; total_pages: number; page: number; limit: number };
}

export interface MediaAssetUpdateRequest {
  status?: MediaAssetStatus;
  visibility?: MediaAssetVisibility;
  rights_license?: string | null;
  rights_owner?: string | null;
  rights_notes?: string | null;
  tags?: string[];
  i18n?: MediaAssetI18n[];
}

export interface MediaFinalizeRequest {
  run_ai_tagging?: boolean;
  run_duplicate_scan?: boolean;
}

export interface MediaVariantRequest {
  profile: string;
}

export interface MediaEditRequest {
  rotate_cw?: 0 | 90 | 180 | 270;
  crop_aspect_w?: number;
  crop_aspect_h?: number;
  resize_max_width?: number;
  resize_max_height?: number;
}

export interface MediaUsageEdge {
  source_type: string;
  source_key: string;
  source_id?: string | null;
  field_path: string;
  lang?: string | null;
  last_seen_at: string;
}

export interface MediaUsageResponse {
  asset_id: string;
  public_url: string;
  items: MediaUsageEdge[];
}

export interface MediaJob {
  id: string;
  asset_id?: string | null;
  job_type: MediaJobType;
  status: MediaJobStatus;
  progress_pct: number;
  attempt: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface MediaCollection {
  id: string;
  name: string;
  slug: string;
  visibility: MediaAssetVisibility;
  created_at: string;
  updated_at: string;
  item_count: number;
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

export interface ContentLinkCheckPreviewRequest {
  key: string;
  body_markdown?: string;
  meta?: Record<string, any> | null;
  images?: string[];
}

export interface ContentFindReplacePreviewRequest {
  find: string;
  replace?: string;
  key_prefix?: string | null;
  case_sensitive?: boolean;
  limit?: number;
}

export interface ContentFindReplaceApplyRequest {
  find: string;
  replace?: string;
  key_prefix?: string | null;
  case_sensitive?: boolean;
}

export interface ContentFindReplacePreviewTranslationCount {
  lang: string;
  matches: number;
}

export interface ContentFindReplacePreviewItem {
  key: string;
  title: string;
  matches: number;
  base_matches: number;
  translations: ContentFindReplacePreviewTranslationCount[];
}

export interface ContentFindReplacePreviewResponse {
  items: ContentFindReplacePreviewItem[];
  total_items: number;
  total_matches: number;
  truncated: boolean;
}

export interface ContentFindReplaceApplyError {
  key: string;
  error: string;
}

export interface ContentFindReplaceApplyResponse {
  updated_blocks: number;
  updated_translations: number;
  total_replacements: number;
  errors: ContentFindReplaceApplyError[];
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

  paymentsHealth(params?: { since_hours?: number }): Observable<AdminDashboardPaymentsHealthResponse> {
    return this.api.get<AdminDashboardPaymentsHealthResponse>('/admin/dashboard/payments-health', params as any);
  }

  refundsBreakdown(params?: { window_days?: number }): Observable<AdminRefundsBreakdownResponse> {
    return this.api.get<AdminRefundsBreakdownResponse>('/admin/dashboard/refunds-breakdown', params as any);
  }

  shippingPerformance(params?: { window_days?: number }): Observable<AdminShippingPerformanceResponse> {
    return this.api.get<AdminShippingPerformanceResponse>('/admin/dashboard/shipping-performance', params as any);
  }

  stockoutImpact(params?: { window_days?: number; limit?: number }): Observable<AdminStockoutImpactResponse> {
    return this.api.get<AdminStockoutImpactResponse>('/admin/dashboard/stockout-impact', params as any);
  }

  channelAttribution(
    params?: { range_days?: number; range_from?: string; range_to?: string; limit?: number }
  ): Observable<AdminChannelAttributionResponse> {
    return this.api.get<AdminChannelAttributionResponse>('/admin/dashboard/channel-attribution', params as any);
  }

  funnel(params?: { range_days?: number; range_from?: string; range_to?: string }): Observable<AdminFunnelMetricsResponse> {
    return this.api.get<AdminFunnelMetricsResponse>('/admin/dashboard/funnel', params);
  }

  channelBreakdown(params?: { range_days?: number; range_from?: string; range_to?: string }): Observable<AdminChannelBreakdownResponse> {
    return this.api.get<AdminChannelBreakdownResponse>('/admin/dashboard/channel-breakdown', params);
  }

  globalSearch(q: string, opts?: { include_pii?: boolean }): Observable<AdminDashboardSearchResponse> {
    const params: any = { q, include_pii: opts?.include_pii ?? true };
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
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.get<AdminOrder[]>('/admin/dashboard/orders', params as any);
  }

  users(opts?: { include_pii?: boolean }): Observable<AdminUser[]> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.get<AdminUser[]>('/admin/dashboard/users', params as any);
  }

  userAliases(userId: string, opts?: { include_pii?: boolean }): Observable<AdminUserAliasesResponse> {
    const params = { include_pii: opts?.include_pii ?? true };
    return this.api.get<AdminUserAliasesResponse>(`/admin/dashboard/users/${userId}/aliases`, params as any);
  }

  content(): Observable<AdminContent[]> {
    return this.api.get<AdminContent[]>('/admin/dashboard/content');
  }

  contentScheduling(params?: { window_days?: number; window_start?: string; page?: number; limit?: number }): Observable<ContentSchedulingListResponse> {
    return this.api.get<ContentSchedulingListResponse>('/content/admin/scheduling', params as any);
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

  reservedCarts(params: {
    product_id: string;
    variant_id?: string | null;
    include_pii?: boolean;
    limit?: number;
    offset?: number;
  }): Observable<CartReservationsResponse> {
    return this.api.get<CartReservationsResponse>('/admin/dashboard/inventory/reservations/carts', params as any);
  }

  reservedOrders(params: {
    product_id: string;
    variant_id?: string | null;
    include_pii?: boolean;
    limit?: number;
    offset?: number;
  }): Observable<OrderReservationsResponse> {
    return this.api.get<OrderReservationsResponse>('/admin/dashboard/inventory/reservations/orders', params as any);
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
    is_featured?: boolean | null;
    sort_order?: number | null;
    category_id?: string | null;
    publish_scheduled_for?: string | null;
    unpublish_scheduled_for?: string | null;
    status?: string | null;
  }[], opts?: AdminRequestOptions): Observable<any[]> {
    return this.api.post<any[]>('/catalog/products/bulk-update', payload, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  getCategories(): Observable<AdminCategory[]> {
    return this.api.get<AdminCategory[]>('/catalog/categories');
  }

  createCategory(payload: Partial<AdminCategory>, opts?: AdminRequestOptions): Observable<AdminCategory> {
    return this.api.post<AdminCategory>('/catalog/categories', payload, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  updateCategory(slug: string, payload: Partial<AdminCategory>, opts?: AdminRequestOptions): Observable<AdminCategory> {
    return this.api.patch<AdminCategory>(`/catalog/categories/${slug}`, payload, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  uploadCategoryImage(slug: string, kind: 'thumbnail' | 'banner', file: File, opts?: AdminRequestOptions): Observable<AdminCategory> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<AdminCategory>(`/catalog/categories/${slug}/images/${kind}`, form, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  previewDeleteCategory(slug: string): Observable<AdminCategoryDeletePreview> {
    return this.api.get<AdminCategoryDeletePreview>(`/catalog/categories/${slug}/delete/preview`);
  }

  previewMergeCategory(sourceSlug: string, targetSlug: string): Observable<AdminCategoryMergePreview> {
    return this.api.get<AdminCategoryMergePreview>(`/catalog/categories/${sourceSlug}/merge/preview`, { target_slug: targetSlug });
  }

  mergeCategory(sourceSlug: string, targetSlug: string, opts?: AdminRequestOptions): Observable<AdminCategoryMergeResult> {
    return this.api.post<AdminCategoryMergeResult>(`/catalog/categories/${sourceSlug}/merge`, { target_slug: targetSlug }, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  getCategoryTranslations(slug: string): Observable<AdminCategoryTranslation[]> {
    return this.api.get<AdminCategoryTranslation[]>(`/catalog/categories/${slug}/translations`);
  }

  upsertCategoryTranslation(slug: string, lang: 'en' | 'ro', payload: { name: string; description?: string | null }, opts?: AdminRequestOptions): Observable<AdminCategoryTranslation> {
    return this.api.put<AdminCategoryTranslation>(`/catalog/categories/${slug}/translations/${lang}`, payload, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  deleteCategoryTranslation(slug: string, lang: 'en' | 'ro', opts?: AdminRequestOptions): Observable<void> {
    return this.api.delete<void>(`/catalog/categories/${slug}/translations/${lang}`, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  deleteCategory(slug: string, opts?: AdminRequestOptions): Observable<AdminCategory> {
    return this.api.delete<AdminCategory>(`/catalog/categories/${slug}`, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  reorderCategories(items: { slug: string; sort_order: number }[], opts?: AdminRequestOptions): Observable<AdminCategory[]> {
    return this.api.post<AdminCategory[]>('/catalog/categories/reorder', items, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  importCategoriesCsv(file: File, dryRun = true): Observable<AdminCategoriesImportResult> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<AdminCategoriesImportResult>('/catalog/categories/import', form, undefined, { dry_run: dryRun });
  }

  getProduct(slug: string): Observable<AdminProductDetail> {
    return this.api.get<AdminProductDetail>(`/catalog/products/${slug}`);
  }

  exportProductsCsv(): Observable<Blob> {
    return this.api.getBlob('/catalog/products/export');
  }

  exportCategoriesCsv(template = false): Observable<Blob> {
    return this.api.getBlob('/catalog/categories/export', { template });
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

  updateProduct(slug: string, payload: Partial<AdminProductDetail>, opts?: AdminRequestOptions): Observable<AdminProductDetail> {
    return this.api.patch<AdminProductDetail>(`/catalog/products/${slug}`, payload, undefined, opts?.source ? { source: opts.source } : undefined);
  }

  duplicateProduct(slug: string, opts?: AdminRequestOptions): Observable<AdminProductDetail> {
    return this.api.post<AdminProductDetail>(`/catalog/products/${slug}/duplicate`, {}, undefined, opts?.source ? { source: opts.source } : undefined);
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

  uploadProductImageWithProgress(slug: string, file: File): Observable<HttpEvent<AdminProductDetail>> {
    const form = new FormData();
    form.append('file', file);
    return this.api.postWithProgress<AdminProductDetail>(`/catalog/products/${slug}/images`, form);
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

  reorderProductImage(slug: string, imageId: string, sortOrder: number, opts?: AdminRequestOptions): Observable<AdminProductDetail> {
    const params: Record<string, string | number> = { sort_order: sortOrder };
    if (opts?.source) params['source'] = opts.source;
    return this.api.patch<AdminProductDetail>(`/catalog/products/${slug}/images/${imageId}/sort`, {}, undefined, params);
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
    payload: { alt_text?: string | null; caption?: string | null },
    opts?: AdminRequestOptions
  ): Observable<AdminProductImageTranslation> {
    return this.api.put<AdminProductImageTranslation>(
      `/catalog/products/${slug}/images/${imageId}/translations/${lang}`,
      payload,
      undefined,
      opts?.source ? { source: opts.source } : undefined
    );
  }

  deleteProductImageTranslation(slug: string, imageId: string, lang: 'en' | 'ro', opts?: AdminRequestOptions): Observable<void> {
    return this.api.delete<void>(`/catalog/products/${slug}/images/${imageId}/translations/${lang}`, undefined, opts?.source ? { source: opts.source } : undefined);
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

  exportStockAdjustmentsCsv(params: {
    product_id: string;
    from_date?: string;
    to_date?: string;
    reason?: StockAdjustmentReason;
    limit?: number;
  }): Observable<Blob> {
    return this.api.getBlob('/admin/dashboard/stock-adjustments/export', params as any);
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

  getAlertThresholds(): Observable<AdminDashboardAlertThresholds> {
    return this.api.get<AdminDashboardAlertThresholds>('/admin/dashboard/alert-thresholds');
  }

  updateAlertThresholds(payload: AdminDashboardAlertThresholdsUpdateRequest): Observable<AdminDashboardAlertThresholds> {
    return this.api.put<AdminDashboardAlertThresholds>('/admin/dashboard/alert-thresholds', payload);
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

  deleteContent(key: string): Observable<void> {
    return this.api.delete<void>(`/content/admin/${encodeURIComponent(key)}`);
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

  listContentImages(params?: {
    key?: string;
    q?: string;
    tag?: string;
    sort?: 'newest' | 'oldest' | 'key_asc' | 'key_desc';
    created_from?: string;
    created_to?: string;
    page?: number;
    limit?: number;
  }): Observable<ContentImageAssetListResponse> {
    return this.api.get<ContentImageAssetListResponse>('/content/admin/assets/images', params as any);
  }

  updateContentImage(imageId: string, payload: ContentImageAssetUpdateRequest): Observable<ContentImageAssetRead> {
    return this.api.patch<ContentImageAssetRead>(`/content/admin/assets/images/${encodeURIComponent(imageId)}`, payload);
  }

  updateContentImageTags(imageId: string, tags: string[]): Observable<ContentImageAssetRead> {
    return this.api.patch<ContentImageAssetRead>(`/content/admin/assets/images/${encodeURIComponent(imageId)}/tags`, { tags });
  }

  updateContentImageFocalPoint(imageId: string, focal_x: number, focal_y: number): Observable<ContentImageAssetRead> {
    return this.api.patch<ContentImageAssetRead>(`/content/admin/assets/images/${encodeURIComponent(imageId)}/focal`, { focal_x, focal_y });
  }

  editContentImage(imageId: string, payload: ContentImageEditRequest): Observable<ContentImageAssetRead> {
    return this.api.post<ContentImageAssetRead>(`/content/admin/assets/images/${encodeURIComponent(imageId)}/edit`, payload);
  }

  getContentImageUsage(imageId: string): Observable<ContentImageAssetUsageResponse> {
    return this.api.get<ContentImageAssetUsageResponse>(`/content/admin/assets/images/${encodeURIComponent(imageId)}/usage`);
  }

  deleteContentImage(imageId: string, params?: { delete_versions?: boolean }): Observable<void> {
    return this.api.delete<void>(`/content/admin/assets/images/${encodeURIComponent(imageId)}`, undefined, params as any);
  }

  listMediaAssets(params?: {
    q?: string;
    tag?: string;
    asset_type?: MediaAssetType | '';
    status?: MediaAssetStatus | '';
    visibility?: MediaAssetVisibility | '';
    include_trashed?: boolean;
    created_from?: string;
    created_to?: string;
    page?: number;
    limit?: number;
    sort?: 'newest' | 'oldest' | 'name_asc' | 'name_desc';
  }): Observable<MediaAssetListResponse> {
    return this.api.get<MediaAssetListResponse>('/content/admin/media/assets', params as any);
  }

  uploadMediaAsset(
    file: File,
    params?: { visibility?: MediaAssetVisibility; auto_finalize?: boolean }
  ): Observable<MediaAsset> {
    const form = new FormData();
    form.append('file', file);
    return this.api.post<MediaAsset>('/content/admin/media/assets/upload', form, undefined, params as any);
  }

  finalizeMediaAsset(assetId: string, payload?: MediaFinalizeRequest): Observable<MediaJob> {
    return this.api.post<MediaJob>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/finalize`, payload || {});
  }

  updateMediaAsset(assetId: string, payload: MediaAssetUpdateRequest): Observable<MediaAsset> {
    return this.api.patch<MediaAsset>(`/content/admin/media/assets/${encodeURIComponent(assetId)}`, payload);
  }

  approveMediaAsset(assetId: string, note?: string): Observable<MediaAsset> {
    return this.api.post<MediaAsset>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/approve`, { note: note || null });
  }

  rejectMediaAsset(assetId: string, note?: string): Observable<MediaAsset> {
    return this.api.post<MediaAsset>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/reject`, { note: note || null });
  }

  softDeleteMediaAsset(assetId: string): Observable<void> {
    return this.api.delete<void>(`/content/admin/media/assets/${encodeURIComponent(assetId)}`);
  }

  restoreMediaAsset(assetId: string): Observable<MediaAsset> {
    return this.api.post<MediaAsset>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/restore`, {});
  }

  purgeMediaAsset(assetId: string): Observable<void> {
    return this.api.post<void>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/purge`, {});
  }

  getMediaAssetUsage(assetId: string): Observable<MediaUsageResponse> {
    return this.api.get<MediaUsageResponse>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/usage`);
  }

  requestMediaVariant(assetId: string, profile: string): Observable<MediaJob> {
    return this.api.post<MediaJob>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/variants`, { profile });
  }

  editMediaAsset(assetId: string, payload: MediaEditRequest): Observable<MediaJob> {
    return this.api.post<MediaJob>(`/content/admin/media/assets/${encodeURIComponent(assetId)}/edit`, payload);
  }

  getMediaJob(jobId: string): Observable<MediaJob> {
    return this.api.get<MediaJob>(`/content/admin/media/jobs/${encodeURIComponent(jobId)}`);
  }

  listMediaCollections(): Observable<MediaCollection[]> {
    return this.api.get<MediaCollection[]>('/content/admin/media/collections');
  }

  createMediaCollection(payload: { name: string; slug: string; visibility?: MediaAssetVisibility }): Observable<MediaCollection> {
    return this.api.post<MediaCollection>('/content/admin/media/collections', payload);
  }

  updateMediaCollection(
    collectionId: string,
    payload: { name: string; slug: string; visibility?: MediaAssetVisibility }
  ): Observable<MediaCollection> {
    return this.api.patch<MediaCollection>(`/content/admin/media/collections/${encodeURIComponent(collectionId)}`, payload);
  }

  replaceMediaCollectionItems(collectionId: string, assetIds: string[]): Observable<void> {
    return this.api.post<void>(`/content/admin/media/collections/${encodeURIComponent(collectionId)}/items`, {
      asset_ids: assetIds
    });
  }

  linkCheckContent(key: string): Observable<ContentLinkCheckResponse> {
    return this.api.get<ContentLinkCheckResponse>('/content/admin/tools/link-check', { key });
  }

  linkCheckContentPreview(payload: ContentLinkCheckPreviewRequest): Observable<ContentLinkCheckResponse> {
    return this.api.post<ContentLinkCheckResponse>('/content/admin/tools/link-check/preview', payload);
  }

  previewFindReplaceContent(payload: ContentFindReplacePreviewRequest): Observable<ContentFindReplacePreviewResponse> {
    return this.api.post<ContentFindReplacePreviewResponse>('/content/admin/tools/find-replace/preview', payload);
  }

  applyFindReplaceContent(payload: ContentFindReplaceApplyRequest): Observable<ContentFindReplaceApplyResponse> {
    return this.api.post<ContentFindReplaceApplyResponse>('/content/admin/tools/find-replace/apply', payload);
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

  upsertContentRedirect(payload: { from_key: string; to_key: string }): Observable<ContentRedirectRead> {
    return this.api.post<ContentRedirectRead>('/content/admin/redirects', payload);
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

  createPagePreviewToken(
    slug: string,
    params: { lang?: string; expires_minutes?: number } = {}
  ): Observable<ContentPreviewTokenResponse> {
    const qs = new URLSearchParams();
    if (params.lang) qs.set('lang', params.lang);
    if (params.expires_minutes) qs.set('expires_minutes', String(params.expires_minutes));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.api.post<ContentPreviewTokenResponse>(`/content/pages/${encodeURIComponent(slug)}/preview-token${suffix}`, {});
  }

  createHomePreviewToken(params: { lang?: string; expires_minutes?: number } = {}): Observable<ContentPreviewTokenResponse> {
    const qs = new URLSearchParams();
    if (params.lang) qs.set('lang', params.lang);
    if (params.expires_minutes) qs.set('expires_minutes', String(params.expires_minutes));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.api.post<ContentPreviewTokenResponse>(`/content/home/preview-token${suffix}`, {});
  }
}
