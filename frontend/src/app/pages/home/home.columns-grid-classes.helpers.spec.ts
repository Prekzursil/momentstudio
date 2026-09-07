import { HomeComponent } from './home.component';

/** Golden WU tip orphan — columnsGridClasses. */
describe('HomeComponent columnsGridClasses (golden WU)', () => {
  function bare(): HomeComponent {
    return Object.create(HomeComponent.prototype) as HomeComponent;
  }

  it('joins responsive grid classes', () => {
    const cmp = bare();
    expect(cmp.columnsGridClasses({ columns_count: 3, breakpoint: 'md' } as any)).toBe(
      'grid gap-6 grid-cols-1 md:grid-cols-3',
    );
  });
});
