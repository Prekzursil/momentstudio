import { appConfig } from './app-config';

type SentryModule = typeof import('@sentry/browser');

let initPromise: Promise<SentryModule | null> | null = null;

// Test seam: the dynamic import is indirected through a swappable loader so the
// success and failure branches of the init chain can be exercised
// deterministically without resolving the real (heavy) @sentry/browser bundle.
// Production code never touches the swap; it always uses `defaultLoadSentry`.
const defaultLoadSentry = (): Promise<SentryModule> => import('@sentry/browser');
let loadSentry: () => Promise<SentryModule> = defaultLoadSentry;

/**
 * Test-only seam. Resets the module-level init cache and (optionally) swaps the
 * dynamic-import loader so each scenario can drive a fresh, mutually-exclusive
 * branch of `initSentryAsync` (disabled / no-DSN / init success / init failure),
 * which is otherwise impossible because `initPromise` is a one-shot singleton.
 * Greppable name keeps it trivially auditable; it is inert in production.
 */
export function __resetSentryForTests(
  loader: (() => Promise<SentryModule>) | null = null,
): void {
  initPromise = null;
  loadSentry = loader ?? defaultLoadSentry;
}

function clampSampleRate(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function initSentryAsync(): Promise<SentryModule | null> {
  if (initPromise) return initPromise;
  if (!appConfig.sentryEnabled) {
    initPromise = Promise.resolve(null);
    return initPromise;
  }
  if (!appConfig.sentryDsn) {
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  initPromise = loadSentry()
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
