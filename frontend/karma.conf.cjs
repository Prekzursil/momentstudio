module.exports = function (config) {
  if (!process.env.CHROME_BIN) {
    try {
      // Prefer Playwright's bundled Chromium in environments without system Chrome.
      const { chromium } = require('playwright');
      process.env.CHROME_BIN = chromium.executablePath();
    } catch {
      // Fall back to system Chrome resolution via karma-chrome-launcher.
    }
  }

  const enableJUnitReporter = process.env.KARMA_JUNIT === '1' || process.env.CI === 'true';
  const reporters = enableJUnitReporter ? ['progress', 'kjhtml', 'junit'] : ['progress', 'kjhtml'];

  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('karma-junit-reporter'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      clearContext: false,
    },
    reporters,
    junitReporter: {
      outputDir: 'test-results',
      outputFile: 'karma.junit.xml',
      useBrowserName: false,
    },
    port: 9876,
    listenAddress: '127.0.0.1',
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    browsers: ['ChromeHeadlessNoSandbox'],
    singleRun: false,
    restartOnFileChange: true,
    // Two-tier coverage gate:
    //   1. This karma `check.global` is a NO-REGRESSION FLOOR — global coverage
    //      may not drop below the current legacy surface. It is set a hair below
    //      the live numbers to absorb measurement noise; ratchet it UP as the
    //      surface improves (never down).
    //   2. `scripts/diff-coverage.mjs` (run as `posttest:coverage`) enforces the
    //      strict part: 100% coverage on every source line a PR adds or modifies.
    // Legacy code is thus frozen (can't regress) while all NEW/changed code must
    // be fully covered — replacing the old global-100% floor, which blocked every
    // PR while the legacy surface sat at ~49%.
    coverageReporter: {
      dir: require('path').join(__dirname, 'coverage'),
      subdir: '.',
      reporters: [
        { type: 'html' },
        { type: 'lcovonly' },
        { type: 'json-summary' },
        { type: 'text-summary' },
      ],
      check: {
        global: {
          statements: 48,
          branches: 41,
          functions: 52,
          lines: 49,
        },
      },
    },
  });
};
