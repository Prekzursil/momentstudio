import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { captureException } from './sentry';

export interface UserNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  url?: string | null;
  created_at: string;
  read_at?: string | null;
  dismissed_at?: string | null;
}

interface NotificationListResponse {
  items: UserNotification[];
}

interface UnreadCountResponse {
  count: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly itemsSignal = signal<UserNotification[]>([]);
  private readonly unreadCountSignal = signal<number>(0);
  private readonly loadingSignal = signal<boolean>(false);
  private lastErrorAt = 0;

  items = () => this.itemsSignal();
  unreadCount = () => this.unreadCountSignal();
  loading = () => this.loadingSignal();

  constructor(private api: ApiService) {}

  reset(): void {
    this.itemsSignal.set([]);
    this.unreadCountSignal.set(0);
    this.loadingSignal.set(false);
  }

  refreshUnreadCount(): void {
    if (this.lastErrorAt && Date.now() - this.lastErrorAt < 15_000) return;
    this.api.get<UnreadCountResponse>('/notifications/unread-count').subscribe({
      next: (resp) => this.unreadCountSignal.set(Number(resp.count) || 0),
      error: (err) => {
        this.lastErrorAt = Date.now();
        captureException(err);
      }
    });
  }

  load(limit = 20): void {
    if (this.loadingSignal()) return;
    this.loadingSignal.set(true);
    this.api.get<NotificationListResponse>('/notifications', { limit }).subscribe({
      next: (resp) => {
        const items = Array.isArray(resp.items) ? resp.items : [];
        this.itemsSignal.set(items);
        this.unreadCountSignal.set(items.filter((n) => !n.read_at && !n.dismissed_at).length);
        this.loadingSignal.set(false);
      },
      error: (err) => {
        this.lastErrorAt = Date.now();
        captureException(err);
        this.loadingSignal.set(false);
      }
    });
  }

  markRead(id: string): void {
    if (!id) return;
    this.api.post<UserNotification>(`/notifications/${encodeURIComponent(id)}/read`, {}).subscribe({
      next: (updated) => {
        const next = this.itemsSignal().map((n) => (n.id === updated.id ? updated : n));
        this.itemsSignal.set(next);
        this.unreadCountSignal.set(next.filter((n) => !n.read_at && !n.dismissed_at).length);
      },
      error: (err) => captureException(err)
    });
  }

  dismiss(id: string): void {
    if (!id) return;
    this.api.post<UserNotification>(`/notifications/${encodeURIComponent(id)}/dismiss`, {}).subscribe({
      next: (updated) => {
        const next = this.itemsSignal().filter((n) => n.id !== updated.id);
        this.itemsSignal.set(next);
        this.unreadCountSignal.set(next.filter((n) => !n.read_at && !n.dismissed_at).length);
      },
      error: (err) => captureException(err)
    });
  }
}
