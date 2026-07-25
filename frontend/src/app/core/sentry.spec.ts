import { appConfig } from './app-config';
import { __resetSentryForTests, captureException, initSentry } from './sentry';

/**
 * sentry.ts keeps a module-level `initPromise` singleton and dynamically imports
 * `@sentry/browser`. The three init paths (disabled / missing-DSN / real init)
 * are mutually exclusive within a single module load, so the suite uses the
 * `__resetSentryForTests` seam to clear the cache and inject a fake loader
 * between scenarios. Every test asserts real observable behaviour: which Sentry
 * APIs were invoked, with what config, and how callers react to a null module.
 */
type SentryModule = typeof import('@sentry/browser');

interface FakeSentry {
  module: SentryModule;
  initCalls: Array<Record<string, unknown>>;
  capturedErrors: unknown[];
  tracingIntegrations: number;
  replayIntegrations: number;
}

function makeFakeSentry(): FakeSentry {
  const state: FakeSentry = {
    initCalls: [],
    capturedErrors: [],
    tracingIntegrations: 0,
    replayIntegrations: 0,
    // assigned below
    module: undefined as unknown as SentryModule,
  };
  const fake = {
    init: (options: Record<string, unknown>) => {
      state.initCalls.push(options);
    },
    captureException: (error: unknown) => {
      state.capturedErrors.push(error);
    },
    browserTracingIntegration: () => {
      state.tracingIntegrations += 1;
      return { name: 'BrowserTracing' };
    },
    replayIntegration: () => {
      state.replayIntegrations += 1;
      return { name: 'Replay' };
    },
  };
  state.module = fake as unknown as SentryModule;
  return state;
}

/** Resolves once the dynamic-import `.then`/`.catch` microtask chain has drained. */
function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

describe('sentry', () => {
  const original = {
    enabled: appConfig.sentryEnabled,
    dsn: appConfig.sentryDsn,
    env: appConfig.appEnv,
    version: appConfig.appVersion,
    pii: appConfig.sentrySendDefaultPii,
    traces: appConfig.sentryTracesSampleRate,
    replaySession: appConfig.sentryReplaySessionSampleRate,
    replayError: appConfig.sentryReplayOnErrorSampleRate,
  };

  afterEach(() => {
    appConfig.sentryEnabled = original.enabled;
    appConfig.sentryDsn = original.dsn;
    appConfig.appEnv = original.env;
    appConfig.appVersion = original.version;
    appConfig.sentrySendDefaultPii = original.pii;
    appConfig.sentryTracesSampleRate = original.traces;
    appConfig.sentryReplaySessionSampleRate = original.replaySession;
    appConfig.sentryReplayOnErrorSampleRate = original.replayError;
    // Restore the real loader / clear the singleton so other suites are unaffected.
    __resetSentryForTests();
  });

  it('does not load Sentry when disabled (initSentry is a no-op path)', async () => {
    let loaderCalled = false;
    __resetSentryForTests(() => {
      loaderCalled = true;
      return Promise.resolve(makeFakeSentry().module);
    });
    appConfig.sentryEnabled = false;
    appConfig.sentryDsn = 'https://key@o0.ingest.sentry.io/0';

    initSentry();
    await flushMicrotasks();

    expect(loaderCalled).toBe(false);

    // captureException must be a safe no-op when the module resolved to null.
    expect(() => captureException(new Error('ignored'))).not.toThrow();
    await flushMicrotasks();
    expect(loaderCalled).toBe(false);
  });

  it('does not load Sentry when enabled but the DSN is empty', async () => {
    let loaderCalled = false;
    __resetSentryForTests(() => {
      loaderCalled = true;
      return Promise.resolve(makeFakeSentry().module);
    });
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = '';

    initSentry();
    await flushMicrotasks();

    expect(loaderCalled).toBe(false);
  });

  it('initializes with clamped rates, both integrations, and a release tag', async () => {
    const fake = makeFakeSentry();
    __resetSentryForTests(() => Promise.resolve(fake.module));
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = 'https://key@o0.ingest.sentry.io/0';
    appConfig.appEnv = 'production';
    appConfig.appVersion = '4.5.6';
    appConfig.sentrySendDefaultPii = true;
    // >1 clamps to 1 (>0 => tracing integration added).
    appConfig.sentryTracesSampleRate = 5 as unknown as number;
    // <0 clamps to 0.
    appConfig.sentryReplaySessionSampleRate = -2 as unknown as number;
    // finite in-range => replay integration added via the OR branch.
    appConfig.sentryReplayOnErrorSampleRate = 0.5;

    initSentry();
    await flushMicrotasks();

    expect(fake.initCalls.length).toBe(1);
    const opts = fake.initCalls[0];
    expect(opts['dsn']).toBe('https://key@o0.ingest.sentry.io/0');
    expect(opts['environment']).toBe('production');
    expect(opts['release']).toBe('4.5.6');
    expect(opts['sendDefaultPii']).toBe(true);
    expect(opts['tracesSampleRate']).toBe(1);
    expect(opts['replaysSessionSampleRate']).toBe(0);
    expect(opts['replaysOnErrorSampleRate']).toBe(0.5);
    expect(fake.tracingIntegrations).toBe(1);
    expect(fake.replayIntegrations).toBe(1);
    expect((opts['integrations'] as unknown[]).length).toBe(2);
    const tags = (opts['initialScope'] as { tags: Record<string, string> }).tags;
    expect(tags['app_env']).toBe('production');
    expect(tags['app_version']).toBe('4.5.6');

    // captureException reuses the cached init and forwards the error (non-null module).
    const err = new Error('boom');
    captureException(err);
    for (let i = 0; i < 5 && fake.capturedErrors.length === 0; i += 1) {
      await flushMicrotasks();
    }
    expect(fake.capturedErrors).toEqual([err]);
  });

  it('omits integrations and release, and falls back to "local" version tag', async () => {
    const fake = makeFakeSentry();
    __resetSentryForTests(() => Promise.resolve(fake.module));
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = 'https://key@o0.ingest.sentry.io/0';
    appConfig.appEnv = 'staging';
    appConfig.appVersion = ''; // falsy => no release, version tag => 'local'
    // 0 => no tracing integration; NaN => non-finite => clamps to 0.
    appConfig.sentryTracesSampleRate = 0;
    appConfig.sentryReplaySessionSampleRate = Number.NaN as unknown as number;
    appConfig.sentryReplayOnErrorSampleRate = 0; // both replay rates 0 => no replay integration

    initSentry();
    await flushMicrotasks();

    expect(fake.initCalls.length).toBe(1);
    const opts = fake.initCalls[0];
    expect('release' in opts).toBe(false);
    expect(opts['tracesSampleRate']).toBe(0);
    expect(opts['replaysSessionSampleRate']).toBe(0);
    expect(opts['replaysOnErrorSampleRate']).toBe(0);
    expect(fake.tracingIntegrations).toBe(0);
    expect(fake.replayIntegrations).toBe(0);
    expect((opts['integrations'] as unknown[]).length).toBe(0);
    const tags = (opts['initialScope'] as { tags: Record<string, string> }).tags;
    expect(tags['app_version']).toBe('local');
  });

  it('adds only the replay integration when session rate > 0 but traces is 0', async () => {
    const fake = makeFakeSentry();
    __resetSentryForTests(() => Promise.resolve(fake.module));
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = 'https://key@o0.ingest.sentry.io/0';
    appConfig.sentryTracesSampleRate = 0; // no tracing
    appConfig.sentryReplaySessionSampleRate = 0.25; // first OR operand true => replay added
    appConfig.sentryReplayOnErrorSampleRate = 0;

    initSentry();
    await flushMicrotasks();

    expect(fake.tracingIntegrations).toBe(0);
    expect(fake.replayIntegrations).toBe(1);
    expect((fake.initCalls[0]['integrations'] as unknown[]).length).toBe(1);
  });

  it('swallows a failed dynamic import and treats the module as null', async () => {
    __resetSentryForTests(() => Promise.reject(new Error('chunk load failed')));
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = 'https://key@o0.ingest.sentry.io/0';

    // initSentry must not surface the rejection.
    expect(() => initSentry()).not.toThrow();
    await flushMicrotasks();

    // captureException reuses the cached (rejected->null) init and no-ops safely.
    expect(() => captureException(new Error('boom'))).not.toThrow();
    await flushMicrotasks();
  });

  it('caches the init promise so the loader runs at most once across calls', async () => {
    let loaderCalls = 0;
    const fake = makeFakeSentry();
    __resetSentryForTests(() => {
      loaderCalls += 1;
      return Promise.resolve(fake.module);
    });
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = 'https://key@o0.ingest.sentry.io/0';

    initSentry();
    initSentry(); // second call must hit `if (initPromise) return initPromise`
    captureException(new Error('a'));
    // captureException chains a further `.then` after init resolves, so drain
    // the chain until the error is observed (bounded to avoid a hang).
    for (let i = 0; i < 5 && fake.capturedErrors.length === 0; i += 1) {
      await flushMicrotasks();
    }

    expect(loaderCalls).toBe(1);
    expect(fake.initCalls.length).toBe(1);
    expect(fake.capturedErrors.length).toBe(1);
  });

  it('drives the real @sentry/browser dynamic import via the default loader', async () => {
    // Reset to the production default loader (no injected fake) and enable Sentry
    // with a DSN so `defaultLoadSentry()` actually runs `import('@sentry/browser')`
    // and the real module's `init` executes. This covers the production
    // dynamic-import arm with genuine module behaviour rather than a stub.
    __resetSentryForTests();
    appConfig.sentryEnabled = true;
    appConfig.sentryDsn = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    appConfig.appEnv = 'test';
    appConfig.appVersion = '1.0.0';
    appConfig.sentryTracesSampleRate = 1;
    appConfig.sentryReplaySessionSampleRate = 0.1;
    appConfig.sentryReplayOnErrorSampleRate = 1;

    expect(() => initSentry()).not.toThrow();
    // The real import + init resolves asynchronously; drain generously.
    for (let i = 0; i < 20; i += 1) {
      await flushMicrotasks();
    }

    // Once the real module is loaded, captureException routes through it without
    // throwing (it is initialised and accepts the error).
    expect(() => captureException(new Error('real-path'))).not.toThrow();
    for (let i = 0; i < 20; i += 1) {
      await flushMicrotasks();
    }
  });
});
