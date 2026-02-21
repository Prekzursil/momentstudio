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
  siteProfile: {
    contact: {
      phone: string;
      email: string;
    };
    instagramPages: Array<{ label: string; url: string }>;
    facebookPages: Array<{ label: string; url: string }>;
  };
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
  siteProfile: {
    contact: { phone: '+40723204204', email: 'momentstudio.ro@gmail.com' },
    instagramPages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.instagram.com/moments_in_clay_studio?igsh=ZmdnZTdudnNieDQx' },
      { label: 'adrianaartizanat', url: 'https://www.instagram.com/adrianaartizanat?igsh=ZmZmaDU1MGcxZHEy' }
    ],
    facebookPages: [
      { label: 'Moments in Clay - Studio', url: 'https://www.facebook.com/share/17YqBmfX5x/' },
      { label: 'adrianaartizanat', url: 'https://www.facebook.com/share/1APqKJM6Zi/' }
    ]
  }
};

export const appConfig: AppConfig = (() => {
  const runtime = typeof window === 'undefined' ? undefined : window.__APP_CONFIG__;
  const runtimeSiteProfile = runtime?.siteProfile as Partial<AppConfig['siteProfile']> | undefined;
  if (typeof window === 'undefined') {
    const ssrApiBase =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['SSR_API_BASE_URL']?.trim() || '';
    return {
      ...defaults,
      ...(ssrApiBase ? { apiBaseUrl: ssrApiBase.replace(/\/$/, '') } : {}),
    };
  }
  return {
    ...defaults,
    ...(runtime ?? {}),
    siteProfile: {
      ...defaults.siteProfile,
      ...(runtimeSiteProfile ?? {}),
      contact: {
        ...defaults.siteProfile.contact,
        ...(runtimeSiteProfile?.contact ?? {}),
      },
      instagramPages: runtimeSiteProfile?.instagramPages ?? defaults.siteProfile.instagramPages,
      facebookPages: runtimeSiteProfile?.facebookPages ?? defaults.siteProfile.facebookPages,
    }
  };
})();
