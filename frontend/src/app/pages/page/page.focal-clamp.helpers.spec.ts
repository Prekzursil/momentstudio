import { PageComponent } from './page.component';

/** Golden WU page-focal-clamp — focalPosition. */
describe('PageComponent focalPosition (golden WU tip)', () => {
  it('clamps and defaults to 50% 50%', () => {
    const cmp = Object.create(PageComponent.prototype) as PageComponent;
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(10, 90)).toBe('10% 90%');
    expect(cmp.focalPosition(-5, 150)).toBe('0% 100%');
    expect(cmp.focalPosition(12.6, 33.4)).toBe('13% 33%');
  });
});
