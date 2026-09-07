import { ErrorComponent } from './error.component';

/** Golden WU tip orphan — onRetry. */
describe('ErrorComponent onRetry (golden WU)', () => {
  it('invokes reloadFn once when allowed', () => {
    const cmp = Object.create(ErrorComponent.prototype) as ErrorComponent;
    Object.assign(cmp as any, { reloading: false });
    const reloadFn = jasmine.createSpy('reloadFn');
    cmp.onRetry(reloadFn);
    expect(reloadFn).toHaveBeenCalledTimes(1);
    expect((cmp as any).reloading).toBe(true);
  });

  it('skips when already reloading or reloadFn missing', () => {
    const cmp = Object.create(ErrorComponent.prototype) as ErrorComponent;
    Object.assign(cmp as any, { reloading: true });
    const reloadFn = jasmine.createSpy('reloadFn');
    cmp.onRetry(reloadFn);
    expect(reloadFn).not.toHaveBeenCalled();
    cmp.onRetry(null);
  });
});
