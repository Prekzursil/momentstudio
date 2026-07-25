import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { StripeMockComponent } from './stripe-mock.component';

/**
 * StripeMockComponent renders a local-only mock Stripe checkout used by
 * automated tests. It reads `session_id` from the query params on init and
 * exposes three actions (success / decline / cancel) that each navigate to a
 * matching return/cancel route, but only when a session id is present.
 *
 * These specs render the real template and assert observable behaviour: the
 * DOM reflects whether a session id exists, the action buttons are gated on it,
 * and clicking each button navigates with the correct query params.
 */
describe('StripeMockComponent', () => {
  let routerNavigate: jasmine.Spy;

  function configure(queryParams: Record<string, string>): void {
    routerNavigate = jasmine.createSpy('navigate').and.resolveTo(true);

    TestBed.configureTestingModule({
      imports: [StripeMockComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: { navigate: routerNavigate } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    });
  }

  function create(queryParams: Record<string, string>): {
    component: StripeMockComponent;
    fixture: ReturnType<typeof TestBed.createComponent<StripeMockComponent>>;
  } {
    configure(queryParams);
    const fixture = TestBed.createComponent(StripeMockComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance, fixture };
  }

  function buttons(fixture: ReturnType<typeof TestBed.createComponent>): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
  }

  it('creates', () => {
    const { component } = create({ session_id: 'sess_123' });
    expect(component).toBeTruthy();
  });

  it('reads the session id from the query params on init', () => {
    const { component } = create({ session_id: 'sess_123' });
    expect(component.sessionId).toBe('sess_123');
  });

  it('defaults the session id to an empty string when the query param is absent', () => {
    const { component } = create({});
    expect(component.sessionId).toBe('');
  });

  it('hides the missing-session warning and enables the actions when a session id is present', () => {
    const { fixture } = create({ session_id: 'sess_123' });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Missing session id');
    const actionButtons = buttons(fixture);
    expect(actionButtons.length).toBe(3);
    for (const button of actionButtons) {
      expect(button.disabled).toBeFalse();
    }
  });

  it('shows the missing-session warning and disables the actions when no session id is present', () => {
    const { fixture } = create({});
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Missing session id');
    const actionButtons = buttons(fixture);
    expect(actionButtons.length).toBe(3);
    for (const button of actionButtons) {
      expect(button.disabled).toBeTrue();
    }
  });

  it('navigates to the return route with a success outcome when the success button is clicked', () => {
    const { fixture } = create({ session_id: 'sess_123' });
    buttons(fixture)[0].click();
    expect(routerNavigate).toHaveBeenCalledOnceWith(['/checkout/stripe/return'], {
      queryParams: { session_id: 'sess_123', mock: 'success' },
    });
  });

  it('navigates to the return route with a decline outcome when the decline button is clicked', () => {
    const { fixture } = create({ session_id: 'sess_123' });
    buttons(fixture)[1].click();
    expect(routerNavigate).toHaveBeenCalledOnceWith(['/checkout/stripe/return'], {
      queryParams: { session_id: 'sess_123', mock: 'decline' },
    });
  });

  it('navigates to the cancel route when the cancel button is clicked', () => {
    const { fixture } = create({ session_id: 'sess_123' });
    buttons(fixture)[2].click();
    expect(routerNavigate).toHaveBeenCalledOnceWith(['/checkout/stripe/cancel'], {
      queryParams: { session_id: 'sess_123' },
    });
  });

  it('does not navigate on complete() when there is no session id', () => {
    const { component } = create({});
    component.complete('success');
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate on cancel() when there is no session id', () => {
    const { component } = create({});
    component.cancel();
    expect(routerNavigate).not.toHaveBeenCalled();
  });
});
