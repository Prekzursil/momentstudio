import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NEVER, Observable, of, Subject } from 'rxjs';

import { SiteCompanyInfo, SiteCompanyService } from '../core/site-company.service';
import { SiteNavigationService } from '../core/site-navigation.service';
import { SiteSocialService } from '../core/site-social.service';
import { FooterComponent } from './footer.component';

const DEFAULT_SOCIAL = {
  instagramPages: [{ label: 'IG Main', url: 'https://instagram.com/main', thumbnail_url: null }],
  facebookPages: [{ label: 'FB Main', url: 'https://facebook.com/main', thumbnail_url: null }]
};

const DEFAULT_COMPANY: SiteCompanyInfo = {
  name: 'Moment Studio',
  registrationNumber: 'J00/000/2026',
  cui: 'RO123',
  address: 'Main street',
  phone: '+40 700 000',
  email: 'office@example.test'
};

const DEFAULT_NAV = {
  footerHandcraftedLinks: [
    { id: 'shop', url: '/shop', label: { en: 'Shop', ro: 'Magazin' } },
    { id: 'ext', url: 'https://example.test', label: { en: 'External', ro: 'Extern' } }
  ],
  footerLegalLinks: [{ id: 'terms', url: '/pages/terms', label: { en: 'Terms', ro: 'Termeni' } }]
};

const TRANSLATIONS = {
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
    anpc: 'ANPC'
  },
  nav: { shop: 'Shop', about: 'About', contact: 'Contact', terms: 'Terms' }
};

function socialServiceFrom(source: Observable<any>): SiteSocialService {
  return { get: () => source } as unknown as SiteSocialService;
}

function companyServiceFrom(source: Observable<SiteCompanyInfo>): SiteCompanyService {
  return { get: () => source } as unknown as SiteCompanyService;
}

function navigationServiceFrom(source: Observable<any>): SiteNavigationService {
  return { get: () => source } as unknown as SiteNavigationService;
}

function applyTranslations(): void {
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('en', TRANSLATIONS, true);
  translate.use('en');
}

function configureProviders(overrides?: {
  social?: SiteSocialService;
  company?: SiteCompanyService;
  navigation?: SiteNavigationService;
}): void {
  const social = overrides?.social ?? socialServiceFrom(of(DEFAULT_SOCIAL));
  const company = overrides?.company ?? companyServiceFrom(of(DEFAULT_COMPANY));
  const navigation = overrides?.navigation ?? navigationServiceFrom(of(DEFAULT_NAV));

  TestBed.configureTestingModule({
    imports: [RouterTestingModule, TranslateModule.forRoot(), FooterComponent],
    providers: [
      { provide: SiteSocialService, useValue: social },
      { provide: SiteCompanyService, useValue: company },
      { provide: SiteNavigationService, useValue: navigation }
    ]
  });

  applyTranslations();
}

describe('FooterComponent', () => {
  it('renders reserved placeholders before async footer data resolves', () => {
    configureProviders({
      social: socialServiceFrom(NEVER),
      company: companyServiceFrom(NEVER),
      navigation: navigationServiceFrom(NEVER)
    });

    const fixture = TestBed.createComponent(FooterComponent);
    fixture.detectChanges(false);

    expect(fixture.nativeElement.querySelector('[data-footer-social-loading="true"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-footer-nav-loading="handcrafted"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-footer-nav-loading="legal"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-footer-company-loading="true"]')).toBeTruthy();
  });

  it('hydrates social/nav/company sections and clears loading flags', fakeAsync(() => {
    configureProviders();
    spyOn(globalThis, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    const fixture = TestBed.createComponent(FooterComponent);
    fixture.detectChanges();
    tick(0);
    fixture.detectChanges();

    const cmp = fixture.componentInstance;
    expect(cmp.socialLoading).toBeFalse();
    expect(cmp.navLoading).toBeFalse();
    expect(cmp.companyLoading).toBeFalse();
    expect(cmp.instagramPages.length).toBe(1);
    expect(cmp.footerHandcraftedLinks?.length).toBe(2);
    expect(cmp.companyInfo.name).toBe('Moment Studio');
  }));

  it('falls back to timer update path when requestAnimationFrame is unavailable', fakeAsync(() => {
    configureProviders();
    const frameHost = globalThis as Omit<typeof globalThis, 'requestAnimationFrame'> & {
      requestAnimationFrame?: typeof requestAnimationFrame;
    };
    const originalRaf = frameHost.requestAnimationFrame;
    frameHost.requestAnimationFrame = undefined;

    const fixture = TestBed.createComponent(FooterComponent);
    fixture.detectChanges();
    tick(1);
    fixture.detectChanges();

    expect(fixture.componentInstance.socialLoading).toBeFalse();
    frameHost.requestAnimationFrame = originalRaf;
  }));

  it('uses localized labels and falls back safely', () => {
    configureProviders();
    const fixture = TestBed.createComponent(FooterComponent);
    const translate = TestBed.inject(TranslateService);

    translate.use('ro');
    const roLabel = fixture.componentInstance.navLabel({
      id: 'a',
      url: '/x',
      label: { en: 'English', ro: 'Romana' }
    } as any);
    expect(roLabel).toBe('Romana');

    translate.use('en');
    const enLabel = fixture.componentInstance.navLabel({
      id: 'a',
      url: '/x',
      label: { en: 'English', ro: 'Romana' }
    } as any);
    expect(enLabel).toBe('English');
  });

  it('detects external links and tracks nav keys', () => {
    configureProviders();
    const fixture = TestBed.createComponent(FooterComponent);
    const cmp = fixture.componentInstance;

    expect(cmp.isExternalLink('https://example.test')).toBeTrue();
    expect(cmp.isExternalLink('/local')).toBeFalse();
    expect(cmp.trackSiteNavLink(0, { id: 'id-1', url: '/abc', label: { en: 'A', ro: 'A' } } as any)).toBe('id-1');
    expect(cmp.trackSiteNavLink(0, { id: ' ', url: '/abc', label: { en: 'A', ro: 'A' } } as any)).toBe('/abc');
  });

  it('toggles and closes social menus', () => {
    configureProviders();
    const fixture = TestBed.createComponent(FooterComponent);
    const cmp = fixture.componentInstance;

    cmp.toggleMenu('instagram');
    expect(cmp.openMenu).toBe('instagram');

    cmp.toggleMenu('instagram');
    expect(cmp.openMenu).toBeNull();

    cmp.toggleMenu('facebook');
    cmp.closeMenu();
    expect(cmp.openMenu).toBeNull();
  });

  it('closes menu on outside click and preserves on dropdown click', () => {
    configureProviders();
    const fixture = TestBed.createComponent(FooterComponent);
    const cmp = fixture.componentInstance;

    cmp.openMenu = 'instagram';
    cmp.onDocumentClick({ target: null } as unknown as MouseEvent);
    expect(cmp.openMenu).toBe('instagram');

    const inside = document.createElement('button');
    const wrapper = document.createElement('div');
    wrapper.dataset['footerDropdown'] = 'true';
    wrapper.appendChild(inside);
    cmp.onDocumentClick({ target: inside } as unknown as MouseEvent);
    expect(cmp.openMenu).toBe('instagram');

    const outside = document.createElement('div');
    cmp.onDocumentClick({ target: outside } as unknown as MouseEvent);
    expect(cmp.openMenu).toBeNull();
  });

  it('closes menu on Escape key', () => {
    configureProviders();
    const fixture = TestBed.createComponent(FooterComponent);
    const cmp = fixture.componentInstance;

    cmp.openMenu = 'facebook';
    cmp.onKeydown({ key: 'Escape' } as KeyboardEvent);
    expect(cmp.openMenu).toBeNull();
  });

  it('generates initials and page metadata from social labels', () => {
    configureProviders();
    const fixture = TestBed.createComponent(FooterComponent);
    const cmp = fixture.componentInstance as any;

    expect(cmp.initialsForLabel('Moments Studio')).toBe('MS');
    expect(cmp.initialsForLabel('A')).toBe('AS');
    expect(cmp.initialsForLabel('')).toBe('MS');

    const pages = cmp.toFooterPages('facebook', [{ label: 'Hello World', url: 'https://x', thumbnail_url: null }]);
    expect(pages[0].avatarClass).toContain('bg-gradient');
    expect(pages[0].initials).toBe('HW');
  });

  it('unsubscribes active streams on destroy', () => {
    const social$ = new Subject<any>();
    const company$ = new Subject<SiteCompanyInfo>();
    const navigation$ = new Subject<any>();
    configureProviders({
      social: socialServiceFrom(social$),
      company: companyServiceFrom(company$),
      navigation: navigationServiceFrom(navigation$)
    });

    const fixture = TestBed.createComponent(FooterComponent);
    fixture.detectChanges();

    const cmp = fixture.componentInstance as any;
    spyOn(cmp.socialSub, 'unsubscribe').and.callThrough();
    spyOn(cmp.companySub, 'unsubscribe').and.callThrough();
    spyOn(cmp.navSub, 'unsubscribe').and.callThrough();

    fixture.destroy();

    expect(cmp.socialSub.unsubscribe).toHaveBeenCalled();
    expect(cmp.companySub.unsubscribe).toHaveBeenCalled();
    expect(cmp.navSub.unsubscribe).toHaveBeenCalled();
  });
});
