import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent secondary action tip', () => {
  it('emits when no secondaryActionUrl', () => {
    const c = Object.create(EmptyStateComponent.prototype) as EmptyStateComponent;
    c.secondaryActionUrl = null;
    let hit = false;
    (c as any).secondaryAction = { emit: () => { hit = true; } };
    c.onSecondaryAction();
    expect(hit).toBe(true);
  });
});
