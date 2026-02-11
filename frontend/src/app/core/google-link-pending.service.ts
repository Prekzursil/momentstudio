import { Injectable } from '@angular/core';

export type PendingGoogleLink = {
  code: string;
  state: string;
};

@Injectable({ providedIn: 'root' })
export class GoogleLinkPendingService {
  private pending: PendingGoogleLink | null = null;

  setPending(payload: PendingGoogleLink): void {
    const code = (payload.code || '').trim();
    const state = (payload.state || '').trim();
    this.pending = code && state ? { code, state } : null;
  }

  getPending(): PendingGoogleLink | null {
    return this.pending;
  }

  clear(): void {
    this.pending = null;
  }
}
