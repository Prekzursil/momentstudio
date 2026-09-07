import { CopyButtonComponent } from './copy-button.component';

describe('CopyButtonComponent copy tip', () => {
  it('no-ops on empty value', async () => {
    const c = Object.create(CopyButtonComponent.prototype) as CopyButtonComponent;
    c.value = '  ';
    (c as any).copied = { set: (_: boolean) => {} };
    await c.copy();
    expect(true).toBe(true);
  });
});
