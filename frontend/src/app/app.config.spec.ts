import { APP_INITIALIZER } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TitleStrategy } from '@angular/router';
import { appConfig } from './app.config';
import { AdminClientErrorLoggerService } from './core/admin-client-error-logger.service';
import { TranslatedTitleStrategy } from './core/translated-title.strategy';

type ProviderRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ProviderRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function plainProviders(): ProviderRecord[] {
  return (appConfig.providers as unknown[]).filter(isRecord);
}

describe('appConfig', () => {
  it('exposes a populated providers array', () => {
    expect(Array.isArray(appConfig.providers)).toBe(true);
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });

  it('binds TitleStrategy to the translated title strategy', () => {
    const titleProvider = plainProviders().find(
      (provider) => provider['provide'] === TitleStrategy,
    );
    expect(titleProvider).toBeDefined();
    expect(titleProvider?.['useClass']).toBe(TranslatedTitleStrategy);
  });

  it('registers a multi APP_INITIALIZER whose factory initialises the client error logger', () => {
    const initProvider = plainProviders().find(
      (provider) =>
        provider['provide'] === APP_INITIALIZER && typeof provider['useFactory'] === 'function',
    );
    expect(initProvider).toBeDefined();
    expect(initProvider?.['multi']).toBe(true);

    const factory = initProvider?.['useFactory'] as () => () => void;
    const init = jasmine.createSpy('init');
    TestBed.configureTestingModule({
      providers: [{ provide: AdminClientErrorLoggerService, useValue: { init } }],
    });

    // useFactory injects AdminClientErrorLoggerService, so it must run inside an
    // injection context; it returns the initialiser function APP_INITIALIZER calls.
    const initializer = TestBed.runInInjectionContext(() => factory());
    expect(init).not.toHaveBeenCalled();

    initializer();
    expect(init).toHaveBeenCalledTimes(1);
  });
});
