import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { AdminComponent } from './admin.component';

type AdminSpy = jasmine.SpyObj<any>;

type ObserverLike<T> = {
  next?: (value: T) => void;
  error?: (err: unknown) => void;
};

function throwErrorSync(err: unknown): { subscribe: (observer: ObserverLike<unknown>) => void } {
  return {
    subscribe: (observer: ObserverLike<unknown>) => {
      if (observer.error) observer.error(err);
    }
  };
}

function createComponent(): {
  component: AdminComponent;
  admin: AdminSpy;
  toast: jasmine.SpyObj<any>;
} {
  const route = {
    snapshot: { data: { section: 'home' }, queryParams: {} },
    data: of({ section: 'home' }),
    queryParams: of({})
  } as unknown as ActivatedRoute;

  const admin = jasmine.createSpyObj('AdminService', [
    'content',
    'products',
    'coupons',
    'lowStock',
    'getContent',
    'updateContentBlock',
    'createContent',
    'uploadContentImage',
    'getCategories',
    'listFeaturedCollections',
    'setMaintenance',
    'sendScheduledReport',
    'fetchSocialThumbnail',
    'getSitemapPreview'
  ]);

  admin.content.and.returnValue(of([]));
  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.getContent.and.returnValue(of({ title: '', body_markdown: '', meta: {} }));
  admin.updateContentBlock.and.returnValue(of({ version: 1, meta: {} }));
  admin.createContent.and.returnValue(of({ version: 1, meta: {} }));
  admin.uploadContentImage.and.returnValue(of({ images: [] }));
  admin.getCategories.and.returnValue(of([]));
  admin.listFeaturedCollections.and.returnValue(of([]));
  admin.setMaintenance.and.returnValue(of({ enabled: false }));
  admin.sendScheduledReport.and.returnValue(of({ skipped: false }));
  admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: '' }));
  admin.getSitemapPreview.and.returnValue(of({ by_lang: {} }));

  const auth = {
    role: jasmine.createSpy('role').and.returnValue('owner'),
    user: jasmine.createSpy('user').and.returnValue({ id: 'u-admin' })
  };

  const cmsPrefs = {
    mode: jasmine.createSpy('mode').and.returnValue('basic'),
    previewDevice: jasmine.createSpy('previewDevice').and.returnValue('desktop'),
    previewLayout: jasmine.createSpy('previewLayout').and.returnValue('split')
  };

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

  const component = new AdminComponent(
    route,
    admin as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    auth as any,
    cmsPrefs as any,
    toast as any,
    { currentLang: 'en', instant: (key: string) => key } as any,
    { render: (value: string) => value } as any,
    {
      bypassSecurityTrustHtml: (value: string) => value,
      bypassSecurityTrustResourceUrl: (value: string) => value
    } as unknown as DomSanitizer
  );

  return { component, admin, toast };
}

describe('AdminComponent coverage wave 4', () => {
  it('parses reports settings metadata and recipients from content', () => {
    const { component, admin } = createComponent();
    admin.getContent.and.returnValue(
      of({
        version: 4,
        meta: {
          reports_weekly_enabled: 'on',
          reports_weekly_weekday: '8',
          reports_weekly_hour_utc: '-1',
          reports_monthly_enabled: 1,
          reports_monthly_day: 99,
          reports_monthly_hour_utc: '17',
          reports_recipients: ['A@EXAMPLE.COM', ' test@example.com '],
          reports_weekly_last_sent_period_end: '2026-02-25',
          reports_weekly_last_error: 'smtp timeout',
          reports_monthly_last_sent_period_end: '2026-02-01',
          reports_monthly_last_error: 'mailbox full'
        }
      })
    );

    component.loadReportsSettings();

    expect(component.reportsSettingsForm).toEqual({
      weekly_enabled: true,
      weekly_weekday: 6,
      weekly_hour_utc: 0,
      monthly_enabled: true,
      monthly_day: '28',
      monthly_hour_utc: 17,
      recipients: 'A@EXAMPLE.COM, test@example.com'
    });
    expect(component.reportsWeeklyLastSent).toBe('2026-02-25');
    expect(component.reportsWeeklyLastError).toBe('smtp timeout');
    expect(component.reportsMonthlyLastSent).toBe('2026-02-01');
    expect(component.reportsMonthlyLastError).toBe('mailbox full');
  });

  it('restores reports defaults and clears versions on load errors', () => {
    const { component, admin } = createComponent();
    (component as any).contentVersions['site.reports'] = 66;
    admin.getContent.and.returnValue(throwErrorSync({ status: 500 }) as any);

    component.loadReportsSettings();

    expect(component.reportsSettingsMeta).toEqual({});
    expect(component.reportsSettingsForm).toEqual({
      weekly_enabled: false,
      weekly_weekday: 0,
      weekly_hour_utc: 8,
      monthly_enabled: false,
      monthly_day: 1,
      monthly_hour_utc: 8,
      recipients: ''
    });
    expect((component as any).contentVersions['site.reports']).toBeUndefined();
  });

  it('saves reports settings with normalized recipients and default report limits', () => {
    const { component, admin } = createComponent();
    component.reportsSettingsMeta = {};
    component.reportsSettingsForm = {
      weekly_enabled: true,
      weekly_weekday: 10 as any,
      weekly_hour_utc: -3 as any,
      monthly_enabled: true,
      monthly_day: '99',
      monthly_hour_utc: 26 as any,
      recipients: 'Ops@Example.com; ops@example.com, bad-mail, legal@example.com'
    };
    admin.updateContentBlock.and.returnValue(
      of({
        version: 9,
        meta: {
          reports_recipients: ['ops@example.com', 'legal@example.com'],
          reports_top_products_limit: 5,
          reports_low_stock_limit: 20,
          reports_retry_cooldown_minutes: 60
        }
      })
    );

    component.saveReportsSettings();

    const payload = admin.updateContentBlock.calls.mostRecent().args[1];
    expect(payload.meta).toEqual(
      jasmine.objectContaining({
        reports_weekly_enabled: true,
        reports_weekly_weekday: 6,
        reports_weekly_hour_utc: 0,
        reports_monthly_enabled: true,
        reports_monthly_day: 28,
        reports_monthly_hour_utc: 23,
        reports_recipients: ['ops@example.com', 'legal@example.com'],
        reports_top_products_limit: 5,
        reports_low_stock_limit: 20,
        reports_retry_cooldown_minutes: 60
      })
    );
    expect(component.reportsSettingsMessage).toBe('adminUi.reports.success.save');
    expect(component.reportsSettingsError).toBeNull();
  });

  it('handles reports conflicts by reloading instead of creating', () => {
    const { component, admin, toast } = createComponent();
    const reloadSpy = spyOn(component, 'loadReportsSettings');
    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 409 }) as any);

    component.saveReportsSettings();

    expect(reloadSpy).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
    expect(component.reportsSettingsError).toBe('adminUi.reports.errors.save');
  });

  it('marks reports save as failed when update and create both fail', () => {
    const { component, admin } = createComponent();
    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 500 }) as any);
    admin.createContent.and.returnValue(throwErrorSync({ status: 500 }) as any);

    component.saveReportsSettings();

    expect(component.reportsSettingsError).toBe('adminUi.reports.errors.save');
    expect(component.reportsSettingsMessage).toBeNull();
  });

  it('sends reports immediately with skipped/sent messaging and error handling', () => {
    const { component, admin } = createComponent();
    const reloadSpy = spyOn(component, 'loadReportsSettings');

    component.reportsSending = true;
    component.sendReportNow('weekly');
    expect(admin.sendScheduledReport).not.toHaveBeenCalled();

    component.reportsSending = false;
    admin.sendScheduledReport.and.returnValue(of({ skipped: true }));
    component.sendReportNow('weekly', true);
    expect(admin.sendScheduledReport).toHaveBeenCalledWith({ kind: 'weekly', force: true });
    expect(component.reportsSettingsMessage).toBe('adminUi.reports.success.skipped');
    expect(reloadSpy).toHaveBeenCalled();

    admin.sendScheduledReport.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.sendReportNow('monthly');
    expect(component.reportsSending).toBeFalse();
    expect(component.reportsSettingsError).toBe('adminUi.reports.errors.send');
  });

  it('loads social metadata and keeps defaults on load errors', () => {
    const { component, admin } = createComponent();

    admin.getContent.and.returnValue(
      of({
        version: 3,
        meta: {
          contact: { phone: ' 0700 ', email: ' hi@example.com ' },
          instagram_pages: [{ label: 'Insta', url: 'https://ig.example', thumbnail_url: 'https://thumb/1' }],
          facebook_pages: [{ label: 'FB', url: 'https://fb.example', thumbnail_url: '' }]
        }
      })
    );

    component.loadSocial();

    expect(component.socialForm.phone).toBe('0700');
    expect(component.socialForm.email).toBe('hi@example.com');
    expect(component.socialForm.instagram_pages.length).toBe(1);
    expect(component.socialForm.facebook_pages.length).toBe(1);

    admin.getContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.loadSocial();

    expect(component.socialForm.instagram_pages.length).toBeGreaterThan(0);
  });

  it('validates thumbnail URL presence before requesting social thumbnail', () => {
    const { component, admin } = createComponent();

    component.socialForm.instagram_pages = [{ label: 'Insta', url: '', thumbnail_url: '' }];

    component.fetchSocialThumbnail('instagram', 0);

    expect(component.socialThumbErrors['instagram-0']).toBe('adminUi.site.social.errors.urlRequired');
    expect(admin.fetchSocialThumbnail).not.toHaveBeenCalled();
  });

  it('updates social thumbnail and notifies on success', () => {
    const { component, admin, toast } = createComponent();

    component.socialForm.facebook_pages = [{ label: 'Meta page', url: 'https://fb.example', thumbnail_url: '' }];
    admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: 'https://cdn.example/new.jpg' }));

    component.fetchSocialThumbnail('facebook', 0);

    expect(component.socialForm.facebook_pages[0].thumbnail_url).toBe('https://cdn.example/new.jpg');
    expect(component.socialThumbLoading['facebook-0']).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('stores fetch thumbnail API detail on error', () => {
    const { component, admin } = createComponent();

    component.socialForm.instagram_pages = [{ label: 'IG', url: 'https://ig.example', thumbnail_url: '' }];
    admin.fetchSocialThumbnail.and.returnValue(throwErrorSync({ error: { detail: 'not reachable' } }) as any);

    component.fetchSocialThumbnail('instagram', 0);

    expect(component.socialThumbLoading['instagram-0']).toBeFalse();
    expect(component.socialThumbErrors['instagram-0']).toBe('not reachable');
  });

  it('sanitizes social payload and falls back to create on update errors', () => {
    const { component, admin } = createComponent();

    component.socialForm.phone = ' 0700 100 ';
    component.socialForm.email = ' office@example.com ';
    component.socialForm.instagram_pages = [
      { label: '', url: 'https://ignored.example', thumbnail_url: '' },
      { label: 'IG', url: 'https://ig.example', thumbnail_url: '' }
    ];
    component.socialForm.facebook_pages = [{ label: 'FB', url: 'https://fb.example', thumbnail_url: '  ' }];

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 500 }) as any);
    admin.createContent.and.returnValue(of({ version: 9, meta: {} }));

    component.saveSocial();

    expect(admin.createContent).toHaveBeenCalled();
    const payload = admin.createContent.calls.mostRecent().args[1];
    expect(payload.meta.contact).toEqual({ phone: '0700 100', email: 'office@example.com' });
    expect(payload.meta.instagram_pages).toEqual([{ label: 'IG', url: 'https://ig.example', thumbnail_url: null }]);
    expect(payload.meta.facebook_pages).toEqual([{ label: 'FB', url: 'https://fb.example', thumbnail_url: null }]);
    expect(component.socialMessage).toBe('adminUi.site.social.success.save');
  });

  it('loads seo state and saves via create fallback when update fails', () => {
    const { component, admin } = createComponent();

    component.seoPage = 'home';
    component.seoLang = 'ro';
    admin.getContent.and.returnValue(of({ version: 2, title: 'Salut', meta: { description: 'Descriere' } }));

    component.loadSeo();

    expect(component.seoForm).toEqual({ title: 'Salut', description: 'Descriere' });

    component.seoForm = { title: 'Titlu nou', description: 'Descriere noua' };
    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 500 }) as any);
    admin.createContent.and.returnValue(of({ version: 3, meta: {} }));

    component.saveSeo();

    expect(admin.createContent).toHaveBeenCalledWith(
      'seo.home',
      jasmine.objectContaining({ title: 'Titlu nou', lang: 'ro', meta: { description: 'Descriere noua' } })
    );
    expect(component.seoMessage).toBe('adminUi.site.seo.success.save');
  });

  it('handles seo conflicts by reloading instead of creating', () => {
    const { component, admin, toast } = createComponent();

    const reloadSpy = spyOn(component, 'loadSeo');
    component.seoPage = 'about';
    component.seoLang = 'en';
    component.seoForm = { title: 'Title', description: 'Desc' };

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 409 }) as any);

    component.saveSeo();

    expect(reloadSpy).toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(component.seoError).toBe('adminUi.site.seo.errors.save');
  });

  it('loads asset defaults on error and saves assets successfully', () => {
    const { component, admin } = createComponent();

    admin.getContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.loadAssets();
    expect(component.assetsForm).toEqual({ logo_url: '', favicon_url: '', social_image_url: '' });

    component.assetsForm = {
      logo_url: 'https://cdn.example/logo.svg',
      favicon_url: 'https://cdn.example/favicon.ico',
      social_image_url: 'https://cdn.example/og.jpg'
    };
    admin.updateContentBlock.and.returnValue(of({ version: 5, meta: {} }));

    component.saveAssets();

    expect(admin.updateContentBlock).toHaveBeenCalled();
    expect(component.assetsMessage).toBe('adminUi.site.assets.success.save');
    expect(component.assetsError).toBeNull();

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 500 }) as any);
    admin.createContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.saveAssets();
    expect(component.assetsError).toBe('adminUi.site.assets.errors.save');
  });

  it('loads sitemap preview and maps error messages', () => {
    const { component, admin } = createComponent();

    admin.getSitemapPreview.and.returnValue(of({ by_lang: { en: [{ url: '/shop' }] } }));
    component.loadSitemapPreview();

    expect(component.sitemapPreviewLoading).toBeFalse();
    expect(component.sitemapPreviewByLang?.['en']?.length).toBe(1);

    admin.getSitemapPreview.and.returnValue(throwErrorSync({ error: { detail: 'preview unavailable' } }) as any);
    component.loadSitemapPreview();

    expect(component.sitemapPreviewLoading).toBeFalse();
    expect(component.sitemapPreviewByLang).toBeNull();
    expect(component.sitemapPreviewError).toBe('preview unavailable');
  });

  it('uploads blog cover images and handles guard/error branches', () => {
    const { component, admin, toast } = createComponent();

    component.selectedBlogKey = '';
    component.blogEditLang = 'en';
    component.blogBaseLang = 'en';
    component.uploadBlogCoverImage({ target: { files: [new Blob(['x'])], value: 'x' } } as any);
    expect(admin.uploadContentImage).not.toHaveBeenCalled();

    component.selectedBlogKey = 'blog.post';
    component.blogEditLang = 'ro';
    component.blogBaseLang = 'en';
    component.uploadBlogCoverImage({ target: { files: [new Blob(['x'])], value: 'x' } } as any);
    expect(admin.uploadContentImage).not.toHaveBeenCalled();

    component.blogEditLang = 'en';
    component.blogImages = [];
    component.blogForm.cover_image_url = '';
    admin.uploadContentImage.and.returnValue(
      of({
        images: [
          { id: 'img-2', url: 'https://cdn/2.jpg', sort_order: 2 },
          { id: 'img-1', url: 'https://cdn/1.jpg', sort_order: 1 }
        ]
      })
    );
    const input = { files: [new Blob(['cover'])], value: 'x' };
    component.uploadBlogCoverImage({ target: input } as any);

    expect(admin.uploadContentImage).toHaveBeenCalledWith('blog.post', jasmine.any(Blob));
    expect(component.blogImages[0].id).toBe('img-1');
    expect(component.blogForm.cover_image_url).toBe('https://cdn/2.jpg');
    expect(input.value).toBe('');
    expect(toast.success).toHaveBeenCalledWith('adminUi.blog.images.success.uploaded');

    admin.uploadContentImage.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.uploadBlogCoverImage({ target: { files: [new Blob(['cover'])], value: 'x' } } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.blog.images.errors.upload');
  });

  it('reloads content blocks and restores empty state on errors', () => {
    const { component, admin } = createComponent();
    const syncContentVersions = spyOn<any>(component, 'syncContentVersions').and.stub();
    const pruneBlogBulkSelection = spyOn<any>(component, 'pruneBlogBulkSelection').and.stub();

    admin.content.and.returnValue(of([{ key: 'blog.post' }]));
    (component as any).reloadContentBlocks();
    expect(component.contentBlocks.length).toBe(1);
    expect(syncContentVersions).toHaveBeenCalled();
    expect(pruneBlogBulkSelection).toHaveBeenCalled();

    admin.content.and.returnValue(throwErrorSync({ status: 500 }) as any);
    (component as any).reloadContentBlocks();
    expect(component.contentBlocks).toEqual([]);
  });

  it('parses reusable blocks metadata while ignoring invalid entries', () => {
    const { component } = createComponent();

    const parsed = (component as any).parseReusableBlocks({
      snippets: [
        null,
        { id: '', title: 'Invalid', block: { type: 'text' } },
        { id: 'one', title: 'One', block: { type: 'text', text: 'A' } },
        { id: 'one', title: 'Duplicate', block: { type: 'text', text: 'B' } },
        { id: 'two', title: 'Two', block: 'invalid' },
        { id: 'three', title: 'Three', block: { type: 'image', url: '/img.png' } }
      ]
    });

    expect(parsed.map((entry: any) => entry.id)).toEqual(['one', 'three']);
    expect(parsed[1].block.type).toBe('image');
  });
});
