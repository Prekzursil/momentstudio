import type { AppConfig } from './app-config';

/**
 * Behavioral coverage for the runtime config resolver in `app-config.ts`.
 *
 * `appConfig` is computed by a module-level IIFE that reads
 * `globalThis.window.__APP_CONFIG__`. Because that work happens once, at module
 * evaluation time, each scenario re-imports the module with a unique webpack
 * query suffix (`?cN`). Under the webpack-based Angular Karma builder a distinct
 * query string yields a distinct module instance, so the IIFE runs again against
 * whatever `window.__APP_CONFIG__` we have staged — letting us assert the real
 * merge behaviour for every branch instead of mutating an already-resolved object.
 */

type AppConfigModule = { appConfig: AppConfig };

type RuntimeWindow = Window & { __APP_CONFIG__?: Partial<AppConfig> };

function runtimeWindow(): RuntimeWindow {
  return globalThis.window as RuntimeWindow;
}

function stageRuntimeConfig(config: Partial<AppConfig> | undefined): void {
  const win = runtimeWindow();
  if (config === undefined) {
    delete win.__APP_CONFIG__;
    return;
  }
  win.__APP_CONFIG__ = config;
}

describe('appConfig runtime resolver', () => {
  afterEach(() => {
    delete runtimeWindow().__APP_CONFIG__;
  });

  it('falls back to the built-in defaults when no runtime config is present', async () => {
    stageRuntimeConfig(undefined);

    // @ts-expect-error query suffix forces a fresh webpack module instance
    const { appConfig } = (await import('./app-config?c1')) as AppConfigModule;

    expect(appConfig.apiBaseUrl).toBe('/api/v1');
    expect(appConfig.appEnv).toBe('development');
    expect(appConfig.siteName).toBe('momentstudio');
    expect(appConfig.sentryEnabled).toBe(true);
    expect(appConfig.supportedLocales).toEqual(['en', 'ro']);
    expect(appConfig.siteProfile.contact.phone).toBe('+40723204204');
    expect(appConfig.siteProfile.contact.email).toBe('momentstudio.ro@gmail.com');
    expect(appConfig.siteProfile.instagramPages.length).toBe(2);
    expect(appConfig.siteProfile.facebookPages.length).toBe(2);
  });

  it('applies scalar runtime overrides while preserving unspecified defaults', async () => {
    stageRuntimeConfig({
      apiBaseUrl: 'https://api.example.test',
      appEnv: 'production',
      stripeEnabled: true,
      sentryEnabled: false,
    });

    // @ts-expect-error query suffix forces a fresh webpack module instance
    const { appConfig } = (await import('./app-config?c2')) as AppConfigModule;

    expect(appConfig.apiBaseUrl).toBe('https://api.example.test');
    expect(appConfig.appEnv).toBe('production');
    expect(appConfig.stripeEnabled).toBe(true);
    expect(appConfig.sentryEnabled).toBe(false);
    // Untouched keys retain their defaults.
    expect(appConfig.siteName).toBe('momentstudio');
    expect(appConfig.supportEmail).toBe('momentstudio.ro@gmail.com');
  });

  it('replaces site-profile collections entirely when the runtime supplies them', async () => {
    const instagramPages = [{ label: 'Runtime IG', url: 'https://instagram.test/runtime' }];
    const facebookPages = [
      { label: 'Runtime FB A', url: 'https://facebook.test/a' },
      { label: 'Runtime FB B', url: 'https://facebook.test/b' },
    ];
    stageRuntimeConfig({
      siteProfile: {
        contact: { phone: '+40700111222', email: 'runtime@example.test' },
        instagramPages,
        facebookPages,
      },
    });

    // @ts-expect-error query suffix forces a fresh webpack module instance
    const { appConfig } = (await import('./app-config?c3')) as AppConfigModule;

    expect(appConfig.siteProfile.contact).toEqual({
      phone: '+40700111222',
      email: 'runtime@example.test',
    });
    expect(appConfig.siteProfile.instagramPages).toEqual(instagramPages);
    expect(appConfig.siteProfile.facebookPages).toEqual(facebookPages);
  });

  it('uses default site-profile collections when the runtime profile omits them', async () => {
    stageRuntimeConfig({ siteProfile: {} as AppConfig['siteProfile'] });

    // @ts-expect-error query suffix forces a fresh webpack module instance
    const { appConfig } = (await import('./app-config?c4')) as AppConfigModule;

    // Empty runtime profile -> contact and collections fall back to defaults.
    expect(appConfig.siteProfile.contact.phone).toBe('+40723204204');
    expect(appConfig.siteProfile.contact.email).toBe('momentstudio.ro@gmail.com');
    expect(appConfig.siteProfile.instagramPages.length).toBe(2);
    expect(appConfig.siteProfile.instagramPages[0].label).toBe('Moments in Clay - Studio');
    expect(appConfig.siteProfile.facebookPages.length).toBe(2);
  });

  it('keeps the default site profile when the runtime config has no siteProfile key', async () => {
    stageRuntimeConfig({ addressAutocompleteEnabled: true });

    // @ts-expect-error query suffix forces a fresh webpack module instance
    const { appConfig } = (await import('./app-config?c5')) as AppConfigModule;

    expect(appConfig.addressAutocompleteEnabled).toBe(true);
    expect(appConfig.siteProfile.contact.phone).toBe('+40723204204');
    expect(appConfig.siteProfile.instagramPages.length).toBe(2);
    expect(appConfig.siteProfile.facebookPages.length).toBe(2);
  });

  it('merges a partial runtime contact onto the default contact', async () => {
    stageRuntimeConfig({
      siteProfile: {
        contact: { phone: '+40799888777' },
      } as AppConfig['siteProfile'],
    });

    // @ts-expect-error query suffix forces a fresh webpack module instance
    const { appConfig } = (await import('./app-config?c6')) as AppConfigModule;

    expect(appConfig.siteProfile.contact.phone).toBe('+40799888777');
    // Email is not provided by the runtime, so the default survives the merge.
    expect(appConfig.siteProfile.contact.email).toBe('momentstudio.ro@gmail.com');
    // Collections fall back to defaults because the runtime omitted them.
    expect(appConfig.siteProfile.instagramPages.length).toBe(2);
    expect(appConfig.siteProfile.facebookPages.length).toBe(2);
  });
});
