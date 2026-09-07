import { LoadingStateComponent } from './loading-state.component';

/** Golden WU shared-loading-state-label — placeholders getter. */
describe('LoadingStateComponent placeholders (golden WU)', () => {
  it('returns at least one row and respects rows input', () => {
    const cmp = Object.create(LoadingStateComponent.prototype) as LoadingStateComponent;
    cmp.rows = 0;
    expect(cmp.placeholders.length).toBe(1);
    cmp.rows = 4;
    expect(cmp.placeholders).toEqual([0, 1, 2, 3]);
  });
});
