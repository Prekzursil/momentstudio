export interface AppConfig {
  apiBaseUrl: string;
  appEnv: string;
  appVersion: string;
  stripeEnabled: boolean;
  paypalEnabled: boolean;
  netopiaEnabled: boolean;
  addressAutocompleteEnabled: boolean;
  sentryDsn: string;
  sentryTracesSampleRate: number;
  sentryReplaySessionSampleRate: number;
  sentryReplayOnErrorSampleRate: number;
  captchaSiteKey: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

const defaults: AppConfig = {
  apiBaseUrl: '/api/v1',
  appEnv: 'development',
  appVersion: '',
  stripeEnabled: false,
  paypalEnabled: false,
  netopiaEnabled: false,
  addressAutocompleteEnabled: false,
  sentryDsn: '',
  sentryTracesSampleRate: 0,
  sentryReplaySessionSampleRate: 0,
  sentryReplayOnErrorSampleRate: 0,
  captchaSiteKey: ''
};

export const appConfig: AppConfig = (() => {
  if (typeof window === 'undefined') {
    const ssrApiBase =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['SSR_API_BASE_URL']?.trim() || '';
    return {
      ...defaults,
      ...(ssrApiBase ? { apiBaseUrl: ssrApiBase.replace(/\/$/, '') } : {}),
    };
  }
  return { ...defaults, ...(window.__APP_CONFIG__ ?? {}) };
})();
