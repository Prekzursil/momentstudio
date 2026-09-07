import { EmptyStateComponent } from './empty-state.component';

/** Golden WU shared-empty-state-title — onPrimaryAction / onSecondaryAction arms. */
describe('EmptyStateComponent primary/secondary actions (golden WU)', () => {
  function createCmp() {
    return Object.create(EmptyStateComponent.prototype) as EmptyStateComponent;
  }

  it('emits primaryAction when no primaryActionUrl', () => {
    const cmp = createCmp();
    cmp.primaryActionUrl = null;
    cmp.primaryAction = { emit: jasmine.createSpy('emit') } as any;
    cmp.onPrimaryAction();
    expect(cmp.primaryAction.emit).toHaveBeenCalled();
  });

  it('skips primary emit when primaryActionUrl is set', () => {
    const cmp = createCmp();
    cmp.primaryActionUrl = '/shop';
    cmp.primaryAction = { emit: jasmine.createSpy('emit') } as any;
    cmp.onPrimaryAction();
    expect(cmp.primaryAction.emit).not.toHaveBeenCalled();
  });

  it('emits secondaryAction when no secondaryActionUrl', () => {
    const cmp = createCmp();
    cmp.secondaryActionUrl = null;
    cmp.secondaryAction = { emit: jasmine.createSpy('emit') } as any;
    cmp.onSecondaryAction();
    expect(cmp.secondaryAction.emit).toHaveBeenCalled();
  });
});
