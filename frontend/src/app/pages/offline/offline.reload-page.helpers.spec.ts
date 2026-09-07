import { OfflineComponent } from './offline.component';

/** Golden WU tip orphan — reloadPage. */
describe('OfflineComponent reloadPage (golden WU)', () => {
  it('calls location.reload via component seam', () => {
    const cmp = Object.create(OfflineComponent.prototype) as OfflineComponent;
    const reload = jasmine.createSpy('reload');
    spyOnProperty(window, 'location', 'get').and.returnValue({ reload } as Location);
    cmp.reloadPage();
    expect(reload).toHaveBeenCalled();
  });
});
