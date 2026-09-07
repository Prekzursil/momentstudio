import { AboutComponent } from './about.component';
describe('AboutComponent focalPosition tip2 (golden WU)', () => {
  function bare(): AboutComponent { return Object.create(AboutComponent.prototype) as AboutComponent; }
  it('defaults and clamps', () => {
    expect(bare().focalPosition()).toBe('50% 50%');
    expect(bare().focalPosition(0, 100)).toBe('0% 100%');
  });
});
