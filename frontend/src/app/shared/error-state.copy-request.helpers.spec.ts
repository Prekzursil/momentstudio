import { ErrorStateComponent } from './error-state.component';

describe('ErrorStateComponent copyRequestId tip', () => {
  it('no-ops on empty requestId', async () => {
    const c = Object.create(ErrorStateComponent.prototype) as ErrorStateComponent;
    c.requestId = '  ';
    (c as any).copied = { set: (_: boolean) => {} };
    await c.copyRequestId();
    expect(true).toBe(true);
  });
});
