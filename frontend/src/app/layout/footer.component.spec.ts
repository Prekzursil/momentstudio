import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NEVER, of, throwError } from 'rxjs';

import { SiteCompanyInfo, SiteCompanyService } from '../core/site-company.service';
import { SiteNavigationData, SiteNavigationService } from '../core/site-navigation.service';
import { SiteSocialData, SiteSocialService } from '../core/site-social.service';
import { FooterComponent } from './footer.component';

describe('FooterComponent', () => {
  it('renders reserved placeholders before async footer data resolves', () => {
    const social = { get: () => NEVER } as unknown as SiteSocialService;
    const company = { get: () => NEVER } as unknown as SiteCompanyService;
    const navigation = { get: () => NEVER } as unknown as SiteNavigationService;

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), FooterComponent],
      providers: [
        { provide: SiteSocialService, useValue: social },
        { provide: SiteCompanyService, useValue: company },
        { provide: SiteNavigationService, useValue: navigation },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        app: { name: 'momentstudio', tagline: 'art' },
        footer: {
          instagram: 'Instagram',
          facebook: 'Facebook',
          contact: 'Contact',
          handcraftedArt: 'Handcrafted Art',
          legal: 'Legal',
          companyInfo: 'Company info',
          registrationNumber: 'Reg',
          cui: 'CUI',
          address: 'Address',
          phone: 'Phone',
          email: 'Email',
          paymentsAccepted: 'Payments',
          paymentsAcceptedAlt: 'Payments logos',
          privacyPolicy: 'Privacy',
          anpc: 'ANPC',
        },
        nav: { shop: 'Shop', about: 'About', contact: 'Contact', terms: 'Terms' },
      },
      true,
    );
    translate.use('en');

    const fixture = TestBed.createComponent(FooterComponent);
    fixture.detectChanges(false);

    expect(fixture.nativeElement.querySelector('[data-footer-social-loading="true"]')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-footer-nav-loading="handcrafted"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-footer-nav-loading="legal"]')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-footer-company-loading="true"]'),
    ).toBeTruthy();
  });
});

describe('FooterComponent (resolved data + interaction)', () => {
  let fixture: ComponentFixture<FooterComponent>;
  let component: FooterComponent;
  let social: jasmine.SpyObj<SiteSocialService>;
  let company: jasmine.SpyObj<SiteCompanyService>;
  let navigation: jasmine.SpyObj<SiteNavigationService>;
  let rafSpy: jasmine.Spy;

  const companyInfo: SiteCompanyInfo = {
    name: 'Acme SRL',
    registrationNumber: 'J40/1/2020',
    cui: 'RO123',
    address: 'Str. Test 1',
    phone: '+40700000000',
    email: 'hi@acme.test',
  };

  function configure(
    socialData: SiteSocialData | Error,
    navData: SiteNavigationData | null | Error,
    companyData: SiteCompanyInfo | Error,
  ): void {
    social = jasmine.createSpyObj<SiteSocialService>('SiteSocialService', ['get']);
    company = jasmine.createSpyObj<SiteCompanyService>('SiteCompanyService', ['get']);
    navigation = jasmine.createSpyObj<SiteNavigationService>('SiteNavigationService', ['get']);
    social.get.and.returnValue(
      socialData instanceof Error ? throwError(() => socialData) : of(socialData),
    );
    navigation.get.and.returnValue(
      navData instanceof Error ? throwError(() => navData) : of(navData),
    );
    company.get.and.returnValue(
      companyData instanceof Error ? throwError(() => companyData) : of(companyData),
    );

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), FooterComponent],
      providers: [
        { provide: SiteSocialService, useValue: social },
        { provide: SiteCompanyService, useValue: company },
        { provide: SiteNavigationService, useValue: navigation },
      ],
    });
    fixture = TestBed.createComponent(FooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    // Run the rAF-deferred state updates synchronously.
    rafSpy = spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  const socialData: SiteSocialData = {
    contact: { phone: null, email: null },
    instagramPages: [
      { label: 'Insta One', url: 'https://instagram.com/one', thumbnail_url: '/thumb.png' },
      { label: 'two', url: 'https://instagram.com/two' },
    ],
    facebookPages: [{ label: 'FB Page', url: 'https://facebook.com/fb' }],
  };

  const navData: SiteNavigationData = {
    headerLinks: [],
    footerHandcraftedLinks: [
      { id: 'h1', url: '/shop', label: { en: 'Shop', ro: 'Magazin' } },
      { id: 'h2', url: 'https://external.test', label: { en: 'External', ro: 'Extern' } },
    ],
    footerLegalLinks: [{ id: 'l1', url: '/pages/terms', label: { en: 'Terms', ro: 'Termeni' } }],
  };

  it('renders resolved social, navigation and company data', () => {
    configure(socialData, navData, companyInfo);
    expect(rafSpy).toHaveBeenCalled();
    expect(component.socialLoading).toBeFalse();
    expect(component.navLoading).toBeFalse();
    expect(component.companyLoading).toBeFalse();
    expect(component.instagramPages[0].label).toBe('Insta One');
    expect(component.footerHandcraftedLinks?.length).toBe(2);
    expect(component.companyInfo.name).toBe('Acme SRL');
  });

  it('falls back to default pages and null links when data is empty', () => {
    configure(
      { contact: { phone: null, email: null }, instagramPages: [], facebookPages: [] },
      { headerLinks: [], footerHandcraftedLinks: [], footerLegalLinks: [] },
      companyInfo,
    );
    expect(component.instagramPages.length).toBeGreaterThan(0); // DEFAULT_INSTAGRAM_PAGES
    expect(component.footerHandcraftedLinks).toBeNull();
    expect(component.footerLegalLinks).toBeNull();
  });

  it('handles null navigation data', () => {
    configure(socialData, null, companyInfo);
    expect(component.footerHandcraftedLinks).toBeNull();
  });

  it('clears loading flags when the services error', () => {
    configure(new Error('s'), new Error('n'), new Error('c'));
    expect(component.socialLoading).toBeFalse();
    expect(component.navLoading).toBeFalse();
    expect(component.companyLoading).toBeFalse();
  });

  it('toggles and closes the dropdown menus', () => {
    configure(socialData, navData, companyInfo);
    component.toggleMenu('instagram');
    expect(component.openMenu).toBe('instagram');
    component.toggleMenu('instagram');
    expect(component.openMenu).toBeNull();
    component.toggleMenu('facebook');
    expect(component.openMenu).toBe('facebook');
    component.closeMenu();
    expect(component.openMenu).toBeNull();
  });

  it('resolves nav labels per language and external links', () => {
    configure(socialData, navData, companyInfo);
    const translate = TestBed.inject(TranslateService);
    translate.use('en');
    expect(component.navLabel(navData.footerHandcraftedLinks[0])).toBe('Shop');
    translate.use('ro');
    expect(component.navLabel(navData.footerHandcraftedLinks[0])).toBe('Magazin');
    expect(component.navLabel({ id: 'x', url: '/y', label: null as never })).toBe('');
    expect(component.isExternalLink('https://x.test')).toBeTrue();
    expect(component.isExternalLink('/internal')).toBeFalse();
    expect(component.isExternalLink('')).toBeFalse();
  });

  it('tracks nav links by id then url, tolerating nullish fields', () => {
    configure(socialData, navData, companyInfo);
    expect(component.trackSiteNavLink(0, { id: 'a', url: '/u', label: { en: '', ro: '' } })).toBe(
      'a',
    );
    expect(component.trackSiteNavLink(0, { id: '', url: '/u', label: { en: '', ro: '' } })).toBe(
      '/u',
    );
    expect(
      component.trackSiteNavLink(0, {
        id: null as never,
        url: null as never,
        label: { en: '', ro: '' },
      }),
    ).toBe('');
  });

  it('returns empty nav labels when the localized string is blank', () => {
    configure(socialData, navData, companyInfo);
    const translate = TestBed.inject(TranslateService);
    translate.use('en');
    expect(component.navLabel({ id: 'x', url: '/y', label: { en: '', ro: '' } })).toBe('');
    translate.use('ro');
    expect(component.navLabel({ id: 'x', url: '/y', label: { en: '', ro: '' } })).toBe('');
  });

  it('derives initials for single-character and single-word labels', () => {
    configure(
      {
        contact: { phone: null, email: null },
        instagramPages: [{ label: 'X', url: 'https://x/1' }],
        facebookPages: [],
      },
      navData,
      companyInfo,
    );
    // 'X' -> first='X', second falls back to 'S'.
    expect(component.instagramPages[0].initials).toBe('XS');
  });

  it('closes the menu on outside document clicks but not inside dropdowns', () => {
    configure(socialData, navData, companyInfo);
    component.openMenu = 'instagram';
    const inside = document.createElement('div');
    inside.setAttribute('data-footer-dropdown', '');
    const child = document.createElement('span');
    inside.appendChild(child);
    component.onDocumentClick({ target: child } as unknown as MouseEvent);
    expect(component.openMenu).toBe('instagram'); // click inside dropdown keeps it open

    const outside = document.createElement('div');
    component.onDocumentClick({ target: outside } as unknown as MouseEvent);
    expect(component.openMenu).toBeNull();
  });

  it('ignores document clicks when no menu is open or target is missing', () => {
    configure(socialData, navData, companyInfo);
    component.openMenu = null;
    component.onDocumentClick({ target: document.createElement('div') } as unknown as MouseEvent);
    expect(component.openMenu).toBeNull();
    component.openMenu = 'facebook';
    component.onDocumentClick({ target: null } as unknown as MouseEvent);
    expect(component.openMenu).toBe('facebook');
  });

  it('closes the menu on Escape but ignores other keys', () => {
    configure(socialData, navData, companyInfo);
    component.openMenu = 'instagram';
    component.onKeydown({ key: 'a' } as KeyboardEvent);
    expect(component.openMenu).toBe('instagram');
    component.onKeydown({ key: 'Escape' } as KeyboardEvent);
    expect(component.openMenu).toBeNull();
  });

  it('derives initials for social avatar labels', () => {
    configure(
      {
        contact: { phone: null, email: null },
        instagramPages: [
          { label: 'Two Words', url: 'https://x/1' },
          { label: 'Single', url: 'https://x/2' },
          { label: '', url: 'https://x/3' },
        ],
        facebookPages: [],
      },
      navData,
      companyInfo,
    );
    expect(component.instagramPages[0].initials).toBe('TW');
    expect(component.instagramPages[1].initials).toBe('SI');
    expect(component.instagramPages[2].initials).toBe('MS');
  });

  it('unsubscribes on destroy', () => {
    configure(socialData, navData, companyInfo);
    expect(() => component.ngOnDestroy()).not.toThrow();
  });

  it('falls back to setTimeout when requestAnimationFrame is unavailable', () => {
    rafSpy.and.stub();
    (window as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame =
      undefined as never;
    spyOn(window, 'setTimeout').and.callFake(((cb: () => void) => {
      cb();
      return 0;
    }) as never);
    configure(socialData, navData, companyInfo);
    expect(component.socialLoading).toBeFalse();
  });
});
