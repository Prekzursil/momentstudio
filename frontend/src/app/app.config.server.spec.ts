import { ApplicationConfig } from '@angular/core';
import { TranslateLoader } from '@ngx-translate/core';
import { config } from './app.config.server';
import { appConfig } from './app.config';
import { ServerTranslateLoader } from './core/server-translate.loader';

type ClassProvider = { provide: unknown; useClass?: unknown };

describe('app.config.server (config)', () => {
  it('exports a merged ApplicationConfig exposing a providers array', () => {
    const merged: ApplicationConfig = config;
    expect(merged).toBeTruthy();
    expect(Array.isArray(merged.providers)).toBe(true);
    expect(merged.providers.length).toBeGreaterThan(0);
  });

  it('overrides TranslateLoader with the server-side filesystem loader', () => {
    const providers = config.providers as unknown[];
    const serverLoader = providers.find(
      (p): p is ClassProvider =>
        typeof p === 'object' &&
        p !== null &&
        (p as ClassProvider).provide === TranslateLoader &&
        (p as ClassProvider).useClass === ServerTranslateLoader,
    );
    expect(serverLoader)
      .withContext('server config must register ServerTranslateLoader')
      .toBeDefined();
  });

  it('merges the base appConfig with the server-only providers', () => {
    // mergeApplicationConfig concatenates each source config's providers, so the
    // merged result must contain strictly more entries than the base appConfig
    // alone (the server config contributes provideServerRendering() plus the
    // TranslateLoader override).
    const baseCount = (appConfig.providers as unknown[]).length;
    const mergedCount = (config.providers as unknown[]).length;
    expect(mergedCount).toBeGreaterThan(baseCount);
  });

  it('preserves base appConfig providers in the merged result (object identity)', () => {
    // The first base provider instance must still be present after the merge,
    // proving the merge augments rather than replaces the base configuration.
    const baseProviders = appConfig.providers as unknown[];
    const mergedProviders = config.providers as unknown[];
    expect(mergedProviders).toContain(baseProviders[0]);
  });
});
