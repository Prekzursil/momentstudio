import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NEVER } from 'rxjs';

import { SiteCompanyService } from '../core/site-company.service';
import { SiteNavigationService } from '../core/site-navigation.service';
import { SiteSocialService } from '../core/site-social.service';
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
    expect(fixture.nativeElement.querySelector('[data-footer-nav-loading="handcrafted"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-footer-nav-loading="legal"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-footer-company-loading="true"]')).toBeTruthy();
  });
});
