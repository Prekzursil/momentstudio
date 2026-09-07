import { HomeComponent } from './home.component';
describe('HomeComponent focalPosition tip2 (golden WU)', () => {
  function bare(): HomeComponent { return Object.create(HomeComponent.prototype) as HomeComponent; }
  it('rounds values', () => {
    expect(bare().focalPosition(12.6, 33.4)).toBe('13% 33%');
  });
});
