import { HomeComponent } from './home.component';
describe('HomeComponent focalPosition tip (golden WU)', () => {
  function bare(): HomeComponent { return Object.create(HomeComponent.prototype) as HomeComponent; }
  it('clamps focal coords to 0..100', () => {
    expect(bare().focalPosition(-1, 101)).toBe('0% 100%');
    expect(bare().focalPosition()).toBe('50% 50%');
  });
});
