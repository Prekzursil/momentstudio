import { appConfig } from './app-config';

type SentryModule = typeof import('@sentry/browser');

let initPromise: Promise<SentryModule | null> | null = null;

function initSentryAsync(): Promise<SentryModule | null> {
  if (initPromise) return initPromise;
  if (!appConfig.sentryDsn) {
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  initPromise = import('@sentry/browser')
    .then((Sentry) => {
      Sentry.init({
        dsn: appConfig.sentryDsn,
        environment: appConfig.appEnv,
        ...(appConfig.appVersion ? { release: appConfig.appVersion } : {})
      });
      return Sentry;
    })
    .catch(() => null);

  return initPromise;
}

export function initSentry(): void {
  void initSentryAsync();
}

export function captureException(error: unknown): void {
  void initSentryAsync().then((Sentry) => {
    if (!Sentry) return;
    Sentry.captureException(error);
  });
}
