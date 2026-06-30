import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject, Subscription, of } from 'rxjs';

import { SiteSocialData } from '../../core/site-social.service';
import { SiteSocialService } from '../../core/site-social.service';
import { NotFoundComponent } from './not-found.component';

function makeSocialData(overrides: Partial<SiteSocialData['contact']> = {}): SiteSocialData {
  return {
    contact: { phone: null, email: null, ...overrides },
    instagramPages: [],
    facebookPages: [],
  };
}

describe('NotFoundComponent', () => {
  let social: jasmine.SpyObj<SiteSocialService>;

  function configure(): void {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, NotFoundComponent],
      providers: [{ provide: SiteSocialService, useValue: social }],
    });
  }

  beforeEach(() => {
    social = jasmine.createSpyObj<SiteSocialService>('SiteSocialService', ['get']);
  });

  it('starts with an empty mailto link before social data resolves', () => {
    social.get.and.returnValue(new Subject<SiteSocialData>().asObservable());
    configure();

    const fixture = TestBed.createComponent(NotFoundComponent);
    // Do not detectChanges so ngOnInit has not run yet.
    expect(fixture.componentInstance.contactHref()).toBe('mailto:');
  });

  it('renders the 404 heading and navigation actions', () => {
    social.get.and.returnValue(of(makeSocialData({ email: 'hello@studio.test' })));
    configure();

    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();

    const heading: HTMLHeadingElement = fixture.nativeElement.querySelector(
      '[data-route-heading="true"]',
    );
    expect(heading.textContent?.trim()).toBe('Page not found');

    const buttons = fixture.nativeElement.querySelectorAll('app-button');
    expect(buttons.length).toBe(3);
  });

  it('builds the contact mailto link from the social contact email', () => {
    social.get.and.returnValue(of(makeSocialData({ email: 'hello@studio.test' })));
    configure();

    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();

    expect(social.get).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.contactHref()).toBe('mailto:hello@studio.test');

    const anchor: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href^="mailto:"]');
    expect(anchor.getAttribute('href')).toBe('mailto:hello@studio.test');
  });

  it('falls back to an empty recipient when the contact email is missing', () => {
    social.get.and.returnValue(of(makeSocialData({ email: null })));
    configure();

    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.contactHref()).toBe('mailto:');
    const anchor: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href^="mailto:"]');
    expect(anchor.getAttribute('href')).toBe('mailto:');
  });

  it('updates the contact link when the social data emits later', () => {
    const subject = new Subject<SiteSocialData>();
    social.get.and.returnValue(subject.asObservable());
    configure();

    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.contactHref()).toBe('mailto:');

    subject.next(makeSocialData({ email: 'late@studio.test' }));
    expect(fixture.componentInstance.contactHref()).toBe('mailto:late@studio.test');
  });

  it('unsubscribes from the social stream on destroy', () => {
    const subject = new Subject<SiteSocialData>();
    social.get.and.returnValue(subject.asObservable());
    configure();

    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();

    expect(subject.observed).toBeTrue();
    fixture.destroy();
    expect(subject.observed).toBeFalse();
  });

  it('does not throw on destroy when init never ran', () => {
    social.get.and.returnValue(of(makeSocialData()));
    configure();

    const cmp = TestBed.createComponent(NotFoundComponent).componentInstance;
    // ngOnInit was never called, so the subscription is undefined.
    expect(() => cmp.ngOnDestroy()).not.toThrow();
    expect(social.get).not.toHaveBeenCalled();
  });

  it('does not re-emit after unsubscribe', () => {
    const subscription = new Subscription();
    const unsubSpy = spyOn(subscription, 'unsubscribe').and.callThrough();
    const stream = new Subject<SiteSocialData>();
    spyOn(stream, 'subscribe').and.returnValue(subscription);
    social.get.and.returnValue(stream.asObservable());
    configure();

    const cmp = TestBed.createComponent(NotFoundComponent).componentInstance;
    cmp.ngOnInit();
    cmp.ngOnDestroy();

    expect(unsubSpy).toHaveBeenCalledTimes(1);
  });
});
