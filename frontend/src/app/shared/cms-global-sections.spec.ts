import {
  CMS_GLOBAL_SECTIONS,
  cmsGlobalSectionAllowedTypes,
  cmsGlobalSectionConfig,
  cmsGlobalSectionDefaultTitle,
  isCmsGlobalSectionKey,
} from './cms-global-sections';

describe('cms-global-sections', () => {
  it('exposes the three configured global sections', () => {
    expect(CMS_GLOBAL_SECTIONS.length).toBe(3);
  });

  describe('isCmsGlobalSectionKey', () => {
    it('returns true for known keys', () => {
      expect(isCmsGlobalSectionKey('site.announcement')).toBe(true);
    });

    it('returns false for unknown values', () => {
      expect(isCmsGlobalSectionKey('nope')).toBe(false);
      expect(isCmsGlobalSectionKey(null)).toBe(false);
      expect(isCmsGlobalSectionKey(42)).toBe(false);
    });
  });

  describe('cmsGlobalSectionConfig', () => {
    it('returns the matching config', () => {
      const config = cmsGlobalSectionConfig('site.header-banners');
      expect(config?.key).toBe('site.header-banners');
      expect(config?.defaultTitle).toBe('Header banners');
    });

    it('returns null when there is no match', () => {
      expect(cmsGlobalSectionConfig('missing')).toBeNull();
    });
  });

  describe('cmsGlobalSectionAllowedTypes', () => {
    it('returns the allowed types for a known key', () => {
      expect(cmsGlobalSectionAllowedTypes('site.announcement')).toEqual(['text']);
    });

    it('returns null for an unknown key', () => {
      expect(cmsGlobalSectionAllowedTypes('missing')).toBeNull();
    });
  });

  describe('cmsGlobalSectionDefaultTitle', () => {
    it('returns the default title for a known key', () => {
      expect(cmsGlobalSectionDefaultTitle('site.footer-promo')).toBe('Footer promo');
    });

    it('returns null for an unknown key', () => {
      expect(cmsGlobalSectionDefaultTitle('missing')).toBeNull();
    });
  });
});
