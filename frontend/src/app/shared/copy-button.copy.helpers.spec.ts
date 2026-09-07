import { CopyButtonComponent } from './copy-button.component';

/** Golden WU shared-copy-button-label — copy blank guard. */
describe('CopyButtonComponent copy (golden WU)', () => {
  it('no-ops on whitespace-only value', async () => {
    const cmp = Object.create(CopyButtonComponent.prototype) as CopyButtonComponent;
    cmp.value = '   ';
    cmp.copied = { set: jasmine.createSpy('set') } as any;
    await cmp.copy();
    expect(cmp.copied.set).not.toHaveBeenCalled();
  });

  it('no-ops on empty value', async () => {
    const cmp = Object.create(CopyButtonComponent.prototype) as CopyButtonComponent;
    cmp.value = '';
    cmp.copied = { set: jasmine.createSpy('set') } as any;
    await cmp.copy();
    expect(cmp.copied.set).not.toHaveBeenCalled();
  });
});
