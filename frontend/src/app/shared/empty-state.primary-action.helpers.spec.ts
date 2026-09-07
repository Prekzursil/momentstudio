import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent primary action tip', () => {
  it('emits when no primaryActionUrl', () => {
    const c = Object.create(EmptyStateComponent.prototype) as EmptyStateComponent;
    c.primaryActionUrl = null;
    let hit = false;
    (c as any).primaryAction = { emit: () => { hit = true; } };
    c.onPrimaryAction();
    expect(hit).toBe(true);
  });
  it('skips emit when primaryActionUrl set', () => {
    const c = Object.create(EmptyStateComponent.prototype) as EmptyStateComponent;
    c.primaryActionUrl = '/shop';
    let hit = false;
    (c as any).primaryAction = { emit: () => { hit = true; } };
    c.onPrimaryAction();
    expect(hit).toBe(false);
  });
});
