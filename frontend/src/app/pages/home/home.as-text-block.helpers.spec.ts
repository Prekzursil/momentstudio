import { HomeComponent } from './home.component';

/** Golden WU tip orphan — asTextBlock. */
describe('HomeComponent asTextBlock (golden WU)', () => {
  function bare(): HomeComponent {
    return Object.create(HomeComponent.prototype) as HomeComponent;
  }

  it('returns text blocks only', () => {
    const cmp = bare();
    expect(cmp.asTextBlock({ type: 'text', body_html: '<p>x</p>' } as any)?.type).toBe('text');
    expect(cmp.asTextBlock({ type: 'cta' } as any)).toBeNull();
  });
});
