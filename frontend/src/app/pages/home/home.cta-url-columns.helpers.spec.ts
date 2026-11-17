import { HomeComponent } from './home.component';

describe('HomeComponent isExternalHttpUrl / asCtaBlock / columnsGridClasses (golden WU)', () => {
  function createCmp() {
    return Object.create(HomeComponent.prototype) as HomeComponent;
  }

  it('isExternalHttpUrl detects http(s)', () => {
    const cmp = createCmp();
    expect(cmp.isExternalHttpUrl('https://x.test')).toBe(true);
    expect(cmp.isExternalHttpUrl('HTTP://x')).toBe(true);
    expect(cmp.isExternalHttpUrl('/local')).toBe(false);
    expect(cmp.isExternalHttpUrl(null)).toBe(false);
  });

  it('asCtaBlock returns only cta blocks', () => {
    const cmp = createCmp();
    expect(cmp.asCtaBlock({ type: 'cta' } as any)?.type).toBe('cta');
    expect(cmp.asCtaBlock({ type: 'hero' } as any)).toBeNull();
  });

  it('columnsGridClasses joins responsive classes', () => {
    const cmp = createCmp();
    expect(cmp.columnsGridClasses({ columns_count: 3, breakpoint: 'md' } as any)).toBe(
      'grid gap-6 grid-cols-1 md:grid-cols-3',
    );
  });
});
