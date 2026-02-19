module.exports = function (config) {
  if (!process.env.CHROME_BIN) {
    try {
      // Prefer Playwright's bundled Chromium in environments without system Chrome.
      const { chromium } = require('playwright');
      process.env.CHROME_BIN = chromium.executablePath();
    } catch (_) {
      // Fall back to system Chrome resolution via karma-chrome-launcher.
    }
  }

  const enableJUnitReporter = process.env.KARMA_JUNIT === '1' || process.env.CI === 'true';
  const reporters = enableJUnitReporter
    ? ['progress', 'kjhtml', 'junit']
    : ['progress', 'kjhtml'];

  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('karma-junit-reporter'),
      require('@angular-devkit/build-angular/plugins/karma')
    ],
    client: {
      clearContext: false
    },
    reporters,
    junitReporter: {
      outputDir: 'test-results',
      outputFile: 'karma.junit.xml',
      useBrowserName: false
    },
    port: 9876,
    listenAddress: '127.0.0.1',
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
      }
    },
    browsers: ['ChromeHeadlessNoSandbox'],
    singleRun: false,
    restartOnFileChange: true
  });
};
