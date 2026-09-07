import { OfflineComponent } from './offline.component';

/** Golden WU tip orphan — onRetry / canReloadNow. */
describe('OfflineComponent onRetry tip (golden WU)', () => {
  function bare(): OfflineComponent {
    return Object.create(OfflineComponent.prototype) as OfflineComponent;
  }

  it('onRetry reloads only when canReloadNow is true', () => {
    const cmp = bare();
    const reload = spyOn(cmp, 'reloadPage');
    spyOn(cmp, 'canReloadNow').and.returnValue(false);
    cmp.onRetry();
    expect(reload).not.toHaveBeenCalled();
    (cmp.canReloadNow as jasmine.Spy).and.returnValue(true);
    cmp.onRetry();
    expect(reload).toHaveBeenCalled();
  });
});
