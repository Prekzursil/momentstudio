import { GoogleLinkPendingService } from './google-link-pending.service';

/** Golden WU tip orphan — GoogleLinkPendingService pending payload helpers. */
describe('GoogleLinkPendingService pending helpers (golden WU tip5)', () => {
  function bare(): GoogleLinkPendingService {
    const svc = Object.create(GoogleLinkPendingService.prototype) as GoogleLinkPendingService & {
      pending: unknown;
    };
    svc.pending = null;
    return svc;
  }

  it('stores trimmed code/state and clears invalid payloads', () => {
    const svc = bare();
    GoogleLinkPendingService.prototype.setPending.call(svc, { code: ' abc ', state: ' st ' });
    expect(GoogleLinkPendingService.prototype.getPending.call(svc)).toEqual({ code: 'abc', state: 'st' });

    GoogleLinkPendingService.prototype.setPending.call(svc, { code: '', state: 'x' });
    expect(GoogleLinkPendingService.prototype.getPending.call(svc)).toBeNull();

    GoogleLinkPendingService.prototype.clear.call(svc);
    expect(GoogleLinkPendingService.prototype.getPending.call(svc)).toBeNull();
  });
});
