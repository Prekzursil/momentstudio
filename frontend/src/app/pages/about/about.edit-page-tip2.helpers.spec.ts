import { AboutComponent } from './about.component';
describe('AboutComponent editPage tip (golden WU)', () => {
  it('navigates to admin about edit', () => {
    const cmp = Object.create(AboutComponent.prototype) as AboutComponent;
    Object.assign(cmp as any, { router: { navigate: jasmine.createSpy('navigate') } });
    cmp.editPage();
    expect((cmp as any).router.navigate).toHaveBeenCalledWith(['/admin/content/pages'], { queryParams: { edit: 'about' } });
  });
});
