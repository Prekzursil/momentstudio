import { PageComponent } from './page.component';

/** Golden WU tip orphan — editPage slug gate. */
describe('PageComponent editPage (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): PageComponent {
    const cmp = Object.create(PageComponent.prototype) as PageComponent;
    Object.assign(cmp as any, {
      slug: '',
      router: { navigate: jasmine.createSpy('navigate') },
      ...overrides,
    });
    return cmp;
  }

  it('no-ops when slug is empty or whitespace', () => {
    const cmp = bare({ slug: '  ' });
    cmp.editPage();
    expect((cmp as any).router.navigate).not.toHaveBeenCalled();
  });

  it('navigates to admin content pages with edit query', () => {
    const cmp = bare({ slug: 'shipping' });
    cmp.editPage();
    expect((cmp as any).router.navigate).toHaveBeenCalledWith(['/admin/content/pages'], {
      queryParams: { edit: 'shipping' },
    });
  });
});
