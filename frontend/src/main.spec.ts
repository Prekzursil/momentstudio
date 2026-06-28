/**
 * `main.ts` is the application bootstrap entry. Its only statements are the
 * top-level `initSentry()` call and the `bootstrapApplication(...).catch(...)`
 * chain. Under the Angular/Karma (webpack) builder the named exports of
 * `@angular/platform-browser` and `./app/core/sentry` are non-writable getters,
 * so they cannot be replaced with `spyOn`. Instead we drive the real entry: the
 * Karma DOM has no `app-root` element, so the real `bootstrapApplication` call
 * rejects with a selector-mismatch error, which exercises the file's only
 * function/branch — the `.catch` handler that reports the failure via
 * `console.error`. `initSentry()` runs for real and is inert because Sentry is
 * disabled in the test runtime config (no DSN), so importing the module has no
 * lasting side effects.
 */
describe('main (bootstrap entry)', () => {
  let consoleErrorSpy: jasmine.Spy;

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, 'error');
  });

  it('bootstraps the application and reports bootstrap failures via console.error', async () => {
    await import('./main');

    // The rejected bootstrap promise settles asynchronously; wait for the
    // `.catch` handler in main.ts to run (bounded so a regression that never
    // logs fails fast rather than hanging).
    for (let i = 0; i < 100 && !consoleErrorSpy.calls.any(); i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }

    expect(consoleErrorSpy).toHaveBeenCalled();
    // The handler forwards the bootstrap rejection reason verbatim; in a DOM
    // without <app-root> that reason is Angular's selector-mismatch error.
    const loggedBootstrapError = consoleErrorSpy.calls
      .allArgs()
      .map((args) => args[0])
      .find(
        (arg): arg is Error => arg instanceof Error && /app-root/.test(arg.message),
      );
    expect(loggedBootstrapError)
      .withContext('main.ts .catch should log the bootstrap rejection')
      .toEqual(jasmine.any(Error));
  });
});
