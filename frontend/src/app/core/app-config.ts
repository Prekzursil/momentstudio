export interface AppConfig {
  apiBaseUrl: string;
  appEnv: string;
  appVersion: string;
  stripeEnabled: boolean;
  paypalEnabled: boolean;
  netopiaEnabled: boolean;
  addressAutocompleteEnabled: boolean;
  clarityProjectId: string;
  clarityEnabled: boolean;
  sentryEnabled: boolean;
  sentryDsn: string;
  sentrySendDefaultPii: boolean;
  sentryTracesSampleRate: number;
  sentryReplaySessionSampleRate: number;
  sentryReplayOnErrorSampleRate: number;
  captchaSiteKey: string;
  siteName: string;
  publicBaseUrl: string;
  supportEmail: string;
  defaultLocale: string;
  supportedLocales: string[];
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
  clarityProjectId: '',
  clarityEnabled: false,
  sentryEnabled: true,
  sentryDsn: '',
  sentrySendDefaultPii: true,
  sentryTracesSampleRate: 1,
  sentryReplaySessionSampleRate: 0.25,
  sentryReplayOnErrorSampleRate: 1,
  captchaSiteKey: '',
  siteName: 'momentstudio',
  publicBaseUrl: 'https://momentstudio.ro',
  supportEmail: 'momentstudio.ro@gmail.com',
  defaultLocale: 'en',
  supportedLocales: ['en', 'ro']
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
