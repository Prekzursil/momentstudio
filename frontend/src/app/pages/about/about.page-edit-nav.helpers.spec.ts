import { AboutComponent } from './about.component';

/** Golden WU about-page-edit-nav — editPage. */
describe('AboutComponent editPage (golden WU tip)', () => {
  it('navigates to admin content pages with edit=about', () => {
    const cmp = Object.create(AboutComponent.prototype) as AboutComponent;
    const navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
    (cmp as any).router = { navigate };
    cmp.editPage();
    expect(navigate).toHaveBeenCalledWith(['/admin/content/pages'], {
      queryParams: { edit: 'about' },
    });
  });
});
