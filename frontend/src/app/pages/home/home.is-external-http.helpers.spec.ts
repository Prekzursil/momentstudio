import { HomeComponent } from './home.component';

/** Golden WU home-is-external-http — isExternalHttpUrl. */
describe('HomeComponent isExternalHttpUrl (golden WU tip)', () => {
  it('detects http(s) URLs and rejects relative paths', () => {
    const cmp = Object.create(HomeComponent.prototype) as HomeComponent;
    expect(cmp.isExternalHttpUrl('https://x.test')).toBe(true);
    expect(cmp.isExternalHttpUrl('HTTP://x')).toBe(true);
    expect(cmp.isExternalHttpUrl('/local')).toBe(false);
    expect(cmp.isExternalHttpUrl(null)).toBe(false);
    expect(cmp.isExternalHttpUrl('')).toBe(false);
  });
});
