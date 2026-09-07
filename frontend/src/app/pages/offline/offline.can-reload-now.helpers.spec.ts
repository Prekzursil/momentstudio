import { OfflineComponent } from './offline.component';
import * as offlineHelpers from './offline.helpers';

/** Golden WU tip orphan — canReloadNow. */
describe('OfflineComponent canReloadNow (golden WU)', () => {
  function bare(): OfflineComponent {
    return Object.create(OfflineComponent.prototype) as OfflineComponent;
  }

  it('delegates to offline helper online detection + retry gate', () => {
    spyOn(offlineHelpers, 'detectBrowserOnline').and.returnValue(true);
    spyOn(offlineHelpers, 'shouldReloadOnRetry').and.returnValue(true);
    expect(bare().canReloadNow()).toBe(true);
    (offlineHelpers.shouldReloadOnRetry as jasmine.Spy).and.returnValue(false);
    expect(bare().canReloadNow()).toBe(false);
  });
});
