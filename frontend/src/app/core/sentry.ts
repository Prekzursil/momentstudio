import { appConfig } from './app-config';

type SentryModule = typeof import('@sentry/browser');

let initPromise: Promise<SentryModule | null> | null = null;

function clampSampleRate(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function initSentryAsync(): Promise<SentryModule | null> {
  if (initPromise) return initPromise;
  if (!appConfig.sentryDsn) {
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  initPromise = import('@sentry/browser')
    .then((Sentry) => {
      const tracesSampleRate = clampSampleRate(appConfig.sentryTracesSampleRate);
      const replaySessionSampleRate = clampSampleRate(appConfig.sentryReplaySessionSampleRate);
      const replayOnErrorSampleRate = clampSampleRate(appConfig.sentryReplayOnErrorSampleRate);
      const integrations = [];
      if (tracesSampleRate > 0) {
        integrations.push(Sentry.browserTracingIntegration());
      }
      if (replaySessionSampleRate > 0 || replayOnErrorSampleRate > 0) {
        integrations.push(Sentry.replayIntegration());
      }

      Sentry.init({
        dsn: appConfig.sentryDsn,
        environment: appConfig.appEnv,
        ...(appConfig.appVersion ? { release: appConfig.appVersion } : {}),
        sendDefaultPii: appConfig.sentrySendDefaultPii,
        tracesSampleRate,
        replaysSessionSampleRate: replaySessionSampleRate,
        replaysOnErrorSampleRate: replayOnErrorSampleRate,
        integrations,
        initialScope: {
          tags: {
            app_env: appConfig.appEnv,
            app_version: appConfig.appVersion || 'local',
          },
        },
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
