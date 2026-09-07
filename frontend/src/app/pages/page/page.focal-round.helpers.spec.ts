import { PageComponent } from './page.component';
describe('PageComponent focalPosition tip2 (golden WU)', () => {
  function bare(): PageComponent { return Object.create(PageComponent.prototype) as PageComponent; }
  it('rounds and clamps focal coords', () => {
    expect(bare().focalPosition(12.6, 33.4)).toBe('13% 33%');
    expect(bare().focalPosition(undefined, undefined)).toBe('50% 50%');
  });
});
