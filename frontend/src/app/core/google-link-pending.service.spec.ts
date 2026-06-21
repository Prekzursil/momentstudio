import { TestBed } from '@angular/core/testing';

import { GoogleLinkPendingService } from './google-link-pending.service';

describe('GoogleLinkPendingService', () => {
  let service: GoogleLinkPendingService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [GoogleLinkPendingService] });
    service = TestBed.inject(GoogleLinkPendingService);
  });

  it('starts with no pending link', () => {
    expect(service.getPending()).toBeNull();
  });

  it('stores trimmed code and state', () => {
    service.setPending({ code: '  abc ', state: ' xyz ' });
    expect(service.getPending()).toEqual({ code: 'abc', state: 'xyz' });
  });

  it('ignores payloads missing code or state', () => {
    service.setPending({ code: '', state: 'xyz' });
    expect(service.getPending()).toBeNull();

    service.setPending({ code: 'abc', state: '   ' });
    expect(service.getPending()).toBeNull();

    // Nullish code/state exercise the `|| ''` fallbacks before trimming.
    service.setPending({ code: undefined as never, state: undefined as never });
    expect(service.getPending()).toBeNull();
  });

  it('clears any pending link', () => {
    service.setPending({ code: 'abc', state: 'xyz' });
    service.clear();
    expect(service.getPending()).toBeNull();
  });
});
