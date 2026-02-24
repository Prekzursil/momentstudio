import { Injectable } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiService } from './api.service';

export type BannerLevel = 'info' | 'warning' | 'promo';

export interface MaintenanceBannerRead {
  id: string;
  is_active: boolean;
  level: BannerLevel;
  message_en: string;
  message_ro: string;
  link_url?: string | null;
  link_label_en?: string | null;
  link_label_ro?: string | null;
  starts_at: string;
  ends_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceBannerPublic {
  level: BannerLevel;
  message_en: string;
  message_ro: string;
  link_url?: string | null;
  link_label_en?: string | null;
  link_label_ro?: string | null;
  starts_at: string;
  ends_at?: string | null;
}

export interface MaintenanceBannerCreatePayload {
  is_active: boolean;
  level: BannerLevel;
  message_en: string;
  message_ro: string;
  link_url?: string | null;
  link_label_en?: string | null;
  link_label_ro?: string | null;
  starts_at: string;
  ends_at?: string | null;
}

export interface MaintenanceBannerUpdatePayload {
  is_active?: boolean | null;
  level?: BannerLevel | null;
  message_en?: string | null;
  message_ro?: string | null;
  link_url?: string | null;
  link_label_en?: string | null;
  link_label_ro?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface ShippingMethodRead {
  id: string;
  name: string;
  rate_flat?: string | number | null;
  rate_per_kg?: string | number | null;
}

export interface ShippingSimulationMethod {
  id: string;
  name: string;
  rate_flat?: string | number | null;
  rate_per_kg?: string | number | null;
  computed_shipping_ron: string | number;
}

export interface ShippingSimulationResult {
  subtotal_ron: string | number;
  discount_ron: string | number;
  taxable_subtotal_ron: string | number;
  shipping_ron: string | number;
  fee_ron: string | number;
  vat_ron: string | number;
  total_ron: string | number;
  shipping_fee_ron?: string | number | null;
  free_shipping_threshold_ron?: string | number | null;
  selected_shipping_method_id?: string | null;
  methods: ShippingSimulationMethod[];
}

export type WebhookProvider = 'stripe' | 'paypal';
export type WebhookStatus = 'received' | 'processed' | 'failed';

export interface FailureCount {
  failed: number;
  since_hours: number;
}

export interface WebhookBacklogCount {
  pending: number;
  pending_recent: number;
  since_hours: number;
}

export interface WebhookEventRead {
  provider: WebhookProvider;
  event_id: string;
  event_type?: string | null;
  created_at: string;
  attempts: number;
  last_attempt_at: string;
  processed_at?: string | null;
  last_error?: string | null;
  status: WebhookStatus;
}

export interface WebhookEventDetail extends WebhookEventRead {
  payload?: any;
}

export interface EmailFailureRead {
  id: string;
  to_email: string;
  subject: string;
  error_message?: string | null;
  created_at: string;
}

export type EmailEventStatus = 'sent' | 'failed';

export interface EmailEventRead {
  id: string;
  to_email: string;
  subject: string;
  status: EmailEventStatus;
  error_message?: string | null;
  created_at: string;
}

export type DiagnosticsStatus = 'ok' | 'warning' | 'error' | 'off';

export interface OpsDiagnosticsCheck {
  status: DiagnosticsStatus;
  configured: boolean;
  healthy: boolean;
  message?: string | null;
}

export interface OpsDiagnosticsRead {
  checked_at: string;
  environment: string;
  app_version: string;
  payments_provider: string;
  smtp: OpsDiagnosticsCheck;
  redis: OpsDiagnosticsCheck;
  storage: OpsDiagnosticsCheck;
  stripe: OpsDiagnosticsCheck;
  paypal: OpsDiagnosticsCheck;
  netopia: OpsDiagnosticsCheck;
}

export type SamedaySyncStatus = 'running' | 'success' | 'failed';

export interface SamedaySyncRunRead {
  id: string;
  provider: 'sameday';
  status: SamedaySyncStatus;
  started_at: string;
  finished_at?: string | null;
  fetched_count: number;
  upserted_count: number;
  deactivated_count: number;
  candidate_count?: number;
  normalized_count?: number;
  normalization_ratio?: number | null;
  schema_signature?: string | null;
  schema_drift_detected?: boolean;
  failure_kind?: string | null;
  challenge_failure?: boolean;
  error_message?: string | null;
  source_url_used?: string | null;
  payload_hash?: string | null;
}

export interface SamedaySyncStatusRead {
  provider: 'sameday';
  total_lockers: number;
  last_success_at?: string | null;
  last_error?: string | null;
  stale: boolean;
  stale_age_seconds?: number | null;
  challenge_failure_streak?: number;
  schema_drift_detected?: boolean;
  last_schema_drift_at?: string | null;
  canary_alert_codes?: string[];
  canary_alert_messages?: string[];
  latest_run?: SamedaySyncRunRead | null;
}

export interface SamedaySyncRunListResponse {
  items: SamedaySyncRunRead[];
  meta: { page: number; limit: number; total: number };
}

@Injectable({ providedIn: 'root' })
export class OpsService {
  constructor(private readonly api: ApiService) {}

  getActiveBanner(): Observable<MaintenanceBannerPublic | null> {
    return this.api.get<MaintenanceBannerPublic | null>('/ops/banner').pipe(
      map((res) => res || null),
      catchError(() => of(null))
    );
  }

  listBanners(): Observable<MaintenanceBannerRead[]> {
    return this.api.get<MaintenanceBannerRead[]>('/ops/admin/banners');
  }

  createBanner(payload: MaintenanceBannerCreatePayload): Observable<MaintenanceBannerRead> {
    return this.api.post<MaintenanceBannerRead>('/ops/admin/banners', payload);
  }

  updateBanner(bannerId: string, payload: MaintenanceBannerUpdatePayload): Observable<MaintenanceBannerRead> {
    return this.api.patch<MaintenanceBannerRead>(`/ops/admin/banners/${bannerId}`, payload);
  }

  deleteBanner(bannerId: string): Observable<void> {
    return this.api.delete<void>(`/ops/admin/banners/${bannerId}`);
  }

  listShippingMethods(): Observable<ShippingMethodRead[]> {
    return this.api.get<ShippingMethodRead[]>('/orders/shipping-methods');
  }

  simulateShipping(payload: {
    subtotal_ron: string;
    discount_ron?: string;
    shipping_method_id?: string;
    country?: string;
    postal_code?: string;
  }): Observable<ShippingSimulationResult> {
    return this.api.post<ShippingSimulationResult>('/ops/admin/shipping-simulate', payload as any);
  }

  listWebhooks(limit = 50): Observable<WebhookEventRead[]> {
    return this.api.get<WebhookEventRead[]>('/ops/admin/webhooks', { limit });
  }

  getWebhookFailureStats(params?: { since_hours?: number }): Observable<FailureCount> {
    return this.api.get<FailureCount>('/ops/admin/webhooks/stats', params as any);
  }

  getWebhookBacklogStats(params?: { since_hours?: number }): Observable<WebhookBacklogCount> {
    return this.api.get<WebhookBacklogCount>('/ops/admin/webhooks/backlog', params as any);
  }

  getWebhookDetail(provider: WebhookProvider, eventId: string): Observable<WebhookEventDetail> {
    return this.api.get<WebhookEventDetail>(`/ops/admin/webhooks/${provider}/${encodeURIComponent(eventId)}`);
  }

  retryWebhook(provider: WebhookProvider, eventId: string): Observable<WebhookEventRead> {
    return this.api.post<WebhookEventRead>(`/ops/admin/webhooks/${provider}/${encodeURIComponent(eventId)}/retry`, {});
  }

  getEmailFailureStats(params?: { since_hours?: number }): Observable<FailureCount> {
    return this.api.get<FailureCount>('/ops/admin/email-failures/stats', params as any);
  }

  listEmailFailures(params?: { limit?: number; since_hours?: number; to_email?: string }): Observable<EmailFailureRead[]> {
    return this.api.get<EmailFailureRead[]>('/ops/admin/email-failures', params as any);
  }

  listEmailEvents(params?: {
    limit?: number;
    since_hours?: number;
    to_email?: string;
    status?: EmailEventStatus;
  }): Observable<EmailEventRead[]> {
    return this.api.get<EmailEventRead[]>('/ops/admin/email-events', params as any);
  }

  getDiagnostics(): Observable<OpsDiagnosticsRead> {
    return this.api.get<OpsDiagnosticsRead>('/ops/admin/diagnostics');
  }

  getSamedaySyncStatus(): Observable<SamedaySyncStatusRead> {
    return this.api.get<SamedaySyncStatusRead>('/admin/shipping/sameday-sync/status');
  }

  listSamedaySyncRuns(params?: { page?: number; limit?: number }): Observable<SamedaySyncRunListResponse> {
    return this.api.get<SamedaySyncRunListResponse>('/admin/shipping/sameday-sync/runs', params as any);
  }

  runSamedaySyncNow(): Observable<SamedaySyncRunRead> {
    return this.api.post<SamedaySyncRunRead>('/admin/shipping/sameday-sync/run', {});
  }

  downloadNewsletterConfirmedSubscribersExport(): Observable<Blob> {
    return this.api.getBlob('/newsletter/admin/export');
  }
}
