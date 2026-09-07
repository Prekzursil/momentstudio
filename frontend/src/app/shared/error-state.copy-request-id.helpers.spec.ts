import { ErrorStateComponent } from './error-state.component';

/** Golden WU shared-error-state-retry — copyRequestId blank guard. */
describe('ErrorStateComponent copyRequestId (golden WU)', () => {
  it('no-ops when requestId is blank', async () => {
    const cmp = Object.create(ErrorStateComponent.prototype) as ErrorStateComponent;
    cmp.requestId = '   ';
    cmp.copied = { set: jasmine.createSpy('set') } as any;
    await cmp.copyRequestId();
    expect(cmp.copied.set).not.toHaveBeenCalled();
  });

  it('no-ops when requestId is null', async () => {
    const cmp = Object.create(ErrorStateComponent.prototype) as ErrorStateComponent;
    cmp.requestId = null;
    cmp.copied = { set: jasmine.createSpy('set') } as any;
    await cmp.copyRequestId();
    expect(cmp.copied.set).not.toHaveBeenCalled();
  });
});
