import { BannerBlockComponent } from './banner-block.component';

/** Golden WU shared-banner-block-cta — isInternalUrl arms. */
describe('BannerBlockComponent isInternalUrl (golden WU)', () => {
  function cmp() {
    return Object.create(BannerBlockComponent.prototype) as BannerBlockComponent;
  }

  it('accepts root-relative internal paths', () => {
    expect(cmp().isInternalUrl('/shop')).toBeTrue();
    expect(cmp().isInternalUrl(' /about ')).toBeTrue();
  });

  it('rejects external and protocol-relative urls', () => {
    expect(cmp().isInternalUrl('https://example.com')).toBeFalse();
    expect(cmp().isInternalUrl('//cdn.example.com/x')).toBeFalse();
    expect(cmp().isInternalUrl(null)).toBeFalse();
  });
});
