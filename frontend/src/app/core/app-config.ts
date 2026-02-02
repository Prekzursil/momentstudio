export interface AppConfig {
  apiBaseUrl: string;
  appEnv: string;
  appVersion: string;
  stripeEnabled: boolean;
  paypalEnabled: boolean;
  netopiaEnabled: boolean;
  addressAutocompleteEnabled: boolean;
  sentryDsn: string;
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
  captchaSiteKey: ''
};

export const appConfig: AppConfig = (() => {
  if (typeof window === 'undefined') return defaults;
  return { ...defaults, ...(window.__APP_CONFIG__ ?? {}) };
})();
