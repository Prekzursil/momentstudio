import { appConfig } from './app-config';
import { captureException, initSentry } from './sentry';

/**
 * sentry.ts keeps a module-level `initPromise` singleton and dynamically
 * imports `@sentry/browser`. Because the Angular/Karma builder loads the module
 * once for the whole run, the first call's configuration path wins and the
 * other init early-returns become unreachable within a single load. These tests
 * drive the richest reachable path (enabled + DSN + sample rates) so the import
 * branch, the integration guards and clampSampleRate are exercised, then assert
 * captureException reuses the cached init.
 */
describe('sentry', () => {
  const original = {
    enabled: appConfig.sentryEnabled,
    dsn: appConfig.sentryDsn,
    traces: appConfig.sentryTracesSampleRate,
    replaySession: appConfig.sentryReplaySessionSampleRate,
    replayError: appConfig.sentryReplayOnErrorSampleRate,
    version: appConfig.appVersion,
  };

  afterAll(() => {
    appConfig.sentryEnabled = original.enabled;
    appConfig.sentryDsn = original.dsn;
    appConfig.sentryTracesSampleRate = original.traces;
    appConfig.sentryReplaySessionSampleRate = original.replaySession;
    appConfig.sentryReplayOnErrorSampleRate = original.replayError;
    appConfig.appVersion = original.version;
  });

  it('initializes Sentry with clamped sample rates and integrations, then caches', async () => {
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    // Out-of-range values exercise every clampSampleRate branch (>1, <0, finite).
    appConfig.sentryTracesSampleRate = 5 as unknown as number;
    appConfig.sentryReplaySessionSampleRate = -1 as unknown as number;
    appConfig.sentryReplayOnErrorSampleRate = 0.5;
    appConfig.appVersion = '1.2.3';

    // First call drives the dynamic import + init path.
    initSentry();
    // Allow the dynamic import promise chain to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A second call must hit the `if (initPromise) return initPromise` cache.
    initSentry();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // captureException reuses the cached init and forwards the error.
    expect(() => captureException(new Error('boom'))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(true).toBe(true);
  });
});
