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
    'getCategories',
    'listFeaturedCollections',
    'setMaintenance',
    'fetchSocialThumbnail',
    'getSitemapPreview',
    'validateStructuredData'
  ]);

  admin.content.and.returnValue(of([]));
  admin.products.and.returnValue(of([]));
  admin.coupons.and.returnValue(of([]));
  admin.lowStock.and.returnValue(of([]));
  admin.getContent.and.returnValue(of({ title: '', body_markdown: '', meta: {} }));
  admin.updateContentBlock.and.returnValue(of({ version: 2, meta: {} }));
  admin.createContent.and.returnValue(of({ version: 2, meta: {} }));
  admin.getCategories.and.returnValue(of([]));
  admin.listFeaturedCollections.and.returnValue(of([]));
  admin.setMaintenance.and.returnValue(of({ enabled: false }));
  admin.fetchSocialThumbnail.and.returnValue(of({ thumbnail_url: '/media/thumb.png' }));
  admin.getSitemapPreview.and.returnValue(of({ by_lang: { en: ['/'], ro: ['/ro'] } }));
  admin.validateStructuredData.and.returnValue(of({ valid: true, issues: [] }));

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

describe('AdminComponent coverage wave 3', () => {
  it('normalizes checkout payload values and saves through update', () => {
    const { component, admin } = createComponent();
    (component as any).contentVersions['site.checkout'] = 12;

    component.checkoutSettingsForm = {
      shipping_fee_ron: -5,
      free_shipping_threshold_ron: 199.876,
      phone_required_home: false,
      phone_required_locker: true,
      fee_enabled: true,
      fee_type: 'unknown' as any,
      fee_value: -10,
      vat_enabled: false,
      vat_rate_percent: 999,
      vat_apply_to_shipping: true,
      vat_apply_to_fee: false,
      receipt_share_days: 0,
      money_rounding: 'invalid' as any
    };

    component.saveCheckoutSettings();

    const payload = admin.updateContentBlock.calls.mostRecent().args[1];
    expect(payload.expected_version).toBe(12);
    expect(payload.meta).toEqual(
      jasmine.objectContaining({
        shipping_fee_ron: 20,
        free_shipping_threshold_ron: 199.88,
        phone_required_home: false,
        phone_required_locker: true,
        fee_enabled: true,
        fee_type: 'flat',
        fee_value: 0,
        vat_enabled: false,
        vat_rate_percent: 10,
        vat_apply_to_shipping: true,
        vat_apply_to_fee: false,
        receipt_share_days: 365,
        money_rounding: 'half_up'
      })
    );
    expect(component.checkoutSettingsMessage).toBe('adminUi.site.checkout.success.save');
    expect(component.checkoutSettingsError).toBeNull();
  });

  it('handles checkout conflict by reloading and keeping create path unused', () => {
    const { component, admin, toast } = createComponent();
    const reloadSpy = spyOn(component, 'loadCheckoutSettings');
    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 409 }) as any);

    component.saveCheckoutSettings();

    expect(reloadSpy).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
    expect(component.checkoutSettingsError).toBe('adminUi.site.checkout.errors.save');
    expect(component.checkoutSettingsMessage).toBeNull();
  });

  it('reports checkout save errors when update and create both fail', () => {
    const { component, admin } = createComponent();
    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 500 }) as any);
    admin.createContent.and.returnValue(throwErrorSync({ status: 500 }) as any);

    component.saveCheckoutSettings();

    expect(component.checkoutSettingsError).toBe('adminUi.site.checkout.errors.save');
    expect(component.checkoutSettingsMessage).toBeNull();
  });

  it('loads company metadata and falls back to blank defaults on errors', () => {
    const { component, admin } = createComponent();
    admin.getContent.and.returnValue(
      of({
        version: 7,
        meta: {
          company: {
            name: '  Moment Studio ',
            registration_number: ' J00/123 ',
            cui: ' RO123 ',
            address: ' Main street 1 ',
            phone: ' 0700 ',
            email: ' office@example.com '
          }
        }
      })
    );

    component.loadCompany();

    expect(component.companyForm).toEqual({
      name: 'Moment Studio',
      registration_number: 'J00/123',
      cui: 'RO123',
      address: 'Main street 1',
      phone: '0700',
      email: 'office@example.com'
    });

    (component as any).contentVersions['site.company'] = 33;
    admin.getContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.loadCompany();

    expect(component.companyForm).toEqual({
      name: '',
      registration_number: '',
      cui: '',
      address: '',
      phone: '',
      email: ''
    });
    expect((component as any).contentVersions['site.company']).toBeUndefined();
  });

  it('validates required company fields before save', () => {
    const { component, admin } = createComponent();
    component.companyForm = {
      name: '',
      registration_number: '',
      cui: '',
      address: '',
      phone: '',
      email: ''
    };

    expect(component.companyMissingFields()).toEqual([
      'adminUi.site.company.fields.name',
      'adminUi.site.company.fields.registrationNumber',
      'adminUi.site.company.fields.cui',
      'adminUi.site.company.fields.address',
      'adminUi.site.company.fields.phone',
      'adminUi.site.company.fields.email'
    ]);

    component.saveCompany();

    expect(component.companyError).toBe('adminUi.site.company.errors.required');
    expect(admin.updateContentBlock).not.toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
  });

  it('saves company using create fallback and trims payload fields', () => {
    const { component, admin } = createComponent();
    component.companyForm = {
      name: ' Moment Studio ',
      registration_number: ' J00/999 ',
      cui: ' RO999 ',
      address: ' 123 Street ',
      phone: ' 0711 ',
      email: ' info@example.com '
    };
    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 404 }) as any);
    admin.createContent.and.returnValue(of({ version: 15, meta: {} }));

    component.saveCompany();

    const payload = admin.createContent.calls.mostRecent().args[1];
    expect(payload.meta.company).toEqual({
      name: 'Moment Studio',
      registration_number: 'J00/999',
      cui: 'RO999',
      address: '123 Street',
      phone: '0711',
      email: 'info@example.com'
    });
    expect(component.companyMessage).toBe('adminUi.site.company.success.save');
    expect(component.companyError).toBeNull();
  });

  it('marks company save as failed on conflicts and terminal create errors', () => {
    const { component, admin, toast } = createComponent();
    const reloadSpy = spyOn(component, 'loadCompany');
    component.companyForm = {
      name: 'Moment',
      registration_number: 'J00/1',
      cui: 'RO1',
      address: 'Addr',
      phone: '0700',
      email: 'a@b.com'
    };

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 409 }) as any);
    component.saveCompany();
    expect(reloadSpy).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(admin.createContent).not.toHaveBeenCalled();
    expect(component.companyError).toBe('adminUi.site.company.errors.save');

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 500 }) as any);
    admin.createContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.saveCompany();
    expect(component.companyError).toBe('adminUi.site.company.errors.save');
    expect(component.companyMessage).toBeNull();
  });

  it('loads social settings and keeps defaults on fetch error', () => {
    const { component, admin } = createComponent();
    admin.getContent.and.returnValue(
      of({
        version: 4,
        meta: {
          contact: { phone: ' 0711 ', email: ' hello@example.com ' },
          instagram_pages: [{ label: 'IG', url: ' https://ig.example ', thumbnail_url: '' }],
          facebook_pages: [{ label: 'FB', url: ' https://fb.example ', thumbnail_url: '/media/fb.png' }]
        }
      })
    );

    component.loadSocial();

    expect(component.socialForm.phone).toBe('0711');
    expect(component.socialForm.email).toBe('hello@example.com');
    expect(component.socialForm.instagram_pages.length).toBe(1);
    expect(component.socialForm.facebook_pages.length).toBe(1);

    (component as any).contentVersions['site.social'] = 99;
    admin.getContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.loadSocial();
    expect((component as any).contentVersions['site.social']).toBeUndefined();
  });

  it('adds/removes social links and fetches thumbnails across success and errors', () => {
    const { component, admin, toast } = createComponent();
    component.socialForm.instagram_pages = [];

    component.addSocialLink('instagram');
    expect(component.socialForm.instagram_pages.length).toBe(1);

    component.socialForm.instagram_pages[0].label = 'Insta';
    component.socialForm.instagram_pages[0].url = 'https://instagram.example/post';
    component.fetchSocialThumbnail('instagram', 0);
    expect(component.socialForm.instagram_pages[0].thumbnail_url).toBe('/media/thumb.png');
    expect(toast.success).toHaveBeenCalled();

    component.socialForm.instagram_pages[0].url = '';
    component.fetchSocialThumbnail('instagram', 0);
    expect(component.socialThumbErrors['instagram-0']).toBe('adminUi.site.social.errors.urlRequired');

    component.socialForm.instagram_pages[0].url = 'https://instagram.example/post';
    admin.fetchSocialThumbnail.and.returnValue(throwErrorSync({ error: { detail: 'bad input' } }) as any);
    component.fetchSocialThumbnail('instagram', 0);
    expect(component.socialThumbErrors['instagram-0']).toBe('bad input');

    component.removeSocialLink('instagram', 0);
    expect(component.socialForm.instagram_pages.length).toBe(0);
  });

  it('saves social settings with update, create fallback, and terminal error', () => {
    const { component, admin } = createComponent();

    component.socialForm.phone = ' 0711 ';
    component.socialForm.email = ' admin@example.com ';
    component.socialForm.instagram_pages = [
      { label: 'IG', url: 'https://ig.example', thumbnail_url: '' },
      { label: '', url: '', thumbnail_url: '' }
    ];
    component.socialForm.facebook_pages = [{ label: 'FB', url: 'https://fb.example', thumbnail_url: '/media/fb.png' }];

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 404 }) as any);
    admin.createContent.and.returnValue(of({ version: 8, meta: {} }));
    component.saveSocial();
    expect(component.socialMessage).toBe('adminUi.site.social.success.save');
    expect(component.socialError).toBeNull();

    admin.updateContentBlock.and.returnValue(throwErrorSync({ status: 500 }) as any);
    admin.createContent.and.returnValue(throwErrorSync({ status: 500 }) as any);
    component.saveSocial();
    expect(component.socialError).toBe('adminUi.site.social.errors.save');
  });

  it('loads and saves SEO, then handles sitemap and structured-data errors', () => {
    const { component, admin } = createComponent();

    component.seoPage = 'home';
    component.selectSeoLang('ro');
    expect(admin.getContent).toHaveBeenCalledWith('seo.home', 'ro');

    component.seoForm = { title: 'Homepage', description: 'Meta' };
    component.saveSeo();
    expect(component.seoMessage).toBe('adminUi.site.seo.success.save');

    admin.getSitemapPreview.and.returnValue(throwErrorSync({ error: { detail: 'preview failed' } }) as any);
    component.loadSitemapPreview();
    expect(component.sitemapPreviewError).toBe('preview failed');

    admin.validateStructuredData.and.returnValue(throwErrorSync({ error: { detail: 'schema failed' } }) as any);
    component.runStructuredDataValidation();
    expect(component.structuredDataError).toBe('schema failed');
  });

  it('builds structured-data URLs for known entity types', () => {
    const { component } = createComponent();

    expect(component.structuredDataIssueUrl({ entity_type: 'product', entity_key: 'ring-1' })).toBe('/products/ring-1');
    expect(component.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.contact' })).toBe('/contact');
    expect(component.structuredDataIssueUrl({ entity_type: 'page', entity_key: 'page.custom' })).toBe('/pages/custom');
    expect(component.structuredDataIssueUrl({ entity_type: 'other', entity_key: 'x' })).toBe('/');
  });
});
