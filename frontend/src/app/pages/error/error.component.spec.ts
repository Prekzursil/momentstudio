import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject, of } from 'rxjs';

import { SiteSocialData, SiteSocialService } from '../../core/site-social.service';
import { ErrorComponent } from './error.component';

function socialData(email: string | null): SiteSocialData {
  return {
    contact: { phone: null, email },
    instagramPages: [],
    facebookPages: [],
  };
}

describe('ErrorComponent', () => {
  function configure(social: Partial<SiteSocialService>) {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, ErrorComponent],
      providers: [{ provide: SiteSocialService, useValue: social }],
    });
    const fixture = TestBed.createComponent(ErrorComponent);
    return { fixture, component: fixture.componentInstance };
  }

  it('renders the error alert with heading and action buttons', () => {
    const { fixture } = configure({ get: () => of(socialData('help@momentstudio.ro')) });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.getAttribute('aria-live')).toBe('assertive');

    const heading = el.querySelector('[data-route-heading="true"]');
    expect(heading?.textContent?.trim()).toBe('Something went wrong');

    const buttons = el.querySelectorAll('app-button');
    expect(buttons.length).toBe(4);
  });

  it('sets the contact mailto href from the social contact email on init', () => {
    const { fixture, component } = configure({
      get: () => of(socialData('help@momentstudio.ro')),
    });
    expect(component.contactHref()).toBe('mailto:');

    fixture.detectChanges();

    expect(component.contactHref()).toBe('mailto:help@momentstudio.ro');
    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href^="mailto:"]');
    expect(link?.getAttribute('href')).toBe('mailto:help@momentstudio.ro');
  });

  it('falls back to a bare mailto when the contact email is empty', () => {
    const { fixture, component } = configure({ get: () => of(socialData(null)) });

    fixture.detectChanges();

    expect(component.contactHref()).toBe('mailto:');
  });

  it('unsubscribes from the social subscription on destroy', () => {
    const subject = new Subject<SiteSocialData>();
    const { fixture, component } = configure({ get: () => subject.asObservable() });

    fixture.detectChanges();
    expect(subject.observers.length).toBe(1);

    component.ngOnDestroy();

    expect(subject.observers.length).toBe(0);
  });

  it('tolerates destroy when init never ran (no active subscription)', () => {
    const { component } = configure({ get: () => of(socialData('help@momentstudio.ro')) });

    expect(() => component.ngOnDestroy()).not.toThrow();
  });

  it('wires the Retry button action to onRetry', () => {
    const { fixture, component } = configure({
      get: () => of(socialData('help@momentstudio.ro')),
    });
    // Spy so the click does not trigger a real window.location.reload(), which
    // would reload the Karma host page; this asserts the template (action) binding.
    const onRetry = spyOn(component, 'onRetry');
    fixture.detectChanges();

    const retryButton = (fixture.nativeElement as HTMLElement).querySelector(
      'app-button button',
    ) as HTMLButtonElement;
    retryButton.click();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
