export interface AppConfig {
  apiBaseUrl: string;
  appEnv: string;
  stripePublishableKey: string;
  sentryDsn: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

const defaults: AppConfig = {
  apiBaseUrl: '/api/v1',
  appEnv: 'development',
  stripePublishableKey: '',
  sentryDsn: ''
};

export const appConfig: AppConfig = (() => {
  if (typeof window === 'undefined') return defaults;
  return { ...defaults, ...(window.__APP_CONFIG__ ?? {}) };
})();
