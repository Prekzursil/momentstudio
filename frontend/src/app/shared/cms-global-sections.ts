import { PageBlockType } from './page-blocks';

export type CmsGlobalSectionKey = 'site.announcement' | 'site.header-banners' | 'site.footer-promo';

export type CmsGlobalSectionConfig = {
  key: CmsGlobalSectionKey;
  labelKey: string;
  defaultTitle: string;
  allowedTypes: ReadonlyArray<PageBlockType>;
};

export const CMS_GLOBAL_SECTIONS: ReadonlyArray<CmsGlobalSectionConfig> = [
  {
    key: 'site.announcement',
    labelKey: 'adminUi.site.globalSections.announcement',
    defaultTitle: 'Announcement bar',
    allowedTypes: ['text']
  },
  {
    key: 'site.header-banners',
    labelKey: 'adminUi.site.globalSections.headerBanners',
    defaultTitle: 'Header banners',
    allowedTypes: ['banner', 'carousel', 'text', 'image']
  },
  {
    key: 'site.footer-promo',
    labelKey: 'adminUi.site.globalSections.footerPromo',
    defaultTitle: 'Footer promo',
    allowedTypes: ['text', 'banner', 'carousel', 'image', 'gallery']
  }
] as const;

export function isCmsGlobalSectionKey(value: unknown): value is CmsGlobalSectionKey {
  return CMS_GLOBAL_SECTIONS.some((section) => section.key === value);
}

export function cmsGlobalSectionConfig(key: string): CmsGlobalSectionConfig | null {
  const found = CMS_GLOBAL_SECTIONS.find((section) => section.key === key);
  return found || null;
}

export function cmsGlobalSectionAllowedTypes(key: string): ReadonlyArray<PageBlockType> | null {
  return cmsGlobalSectionConfig(key)?.allowedTypes ?? null;
}

export function cmsGlobalSectionDefaultTitle(key: string): string | null {
  return cmsGlobalSectionConfig(key)?.defaultTitle ?? null;
}

