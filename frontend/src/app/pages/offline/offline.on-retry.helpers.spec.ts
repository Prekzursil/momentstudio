import { OfflineComponent } from './offline.component';

/** Golden WU tip orphan — onRetry. */
describe('OfflineComponent onRetry (golden WU)', () => {
  it('reloads only when canReloadNow is true', () => {
    const cmp = Object.create(OfflineComponent.prototype) as OfflineComponent;
    spyOn(cmp, 'canReloadNow').and.returnValue(false);
    const reload = spyOn(cmp, 'reloadPage');
    cmp.onRetry();
    expect(reload).not.toHaveBeenCalled();

    (cmp.canReloadNow as jasmine.Spy).and.returnValue(true);
    cmp.onRetry();
    expect(reload).toHaveBeenCalled();
  });
});
