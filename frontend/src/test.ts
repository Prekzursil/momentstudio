import 'zone.js/testing';

async function bootstrapTests() {
  const { getTestBed } = await import('@angular/core/testing');
  const { BrowserDynamicTestingModule, platformBrowserDynamicTesting } = await import(
    '@angular/platform-browser-dynamic/testing'
  );

  getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
}

bootstrapTests();
