import { HomeComponent } from './home.component';

/** Golden WU tip orphan — focalPosition. */
describe('HomeComponent focalPosition (golden WU)', () => {
  function bare(): HomeComponent {
    return Object.create(HomeComponent.prototype) as HomeComponent;
  }

  it('clamps and defaults to 50% 50%', () => {
    expect(bare().focalPosition()).toBe('50% 50%');
    expect(bare().focalPosition(10, 90)).toBe('10% 90%');
    expect(bare().focalPosition(-5, 150)).toBe('0% 100%');
  });
});
