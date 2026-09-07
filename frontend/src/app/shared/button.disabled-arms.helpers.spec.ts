import { ButtonComponent } from './button.component';

/** Golden WU shared-button-disabled-arm — disabled click guards. */
describe('ButtonComponent disabled arms (golden WU)', () => {
  it('blocks onClick when disabled', () => {
    const cmp = Object.create(ButtonComponent.prototype) as ButtonComponent;
    cmp.disabled = true;
    cmp.type = 'button';
    cmp.action = { emit: jasmine.createSpy('emit') } as any;
    const ev = { preventDefault: jasmine.createSpy(), stopPropagation: jasmine.createSpy() } as any;
    cmp.onClick(ev);
    expect(cmp.action.emit).not.toHaveBeenCalled();
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('blocks onAnchorClick when disabled', () => {
    const cmp = Object.create(ButtonComponent.prototype) as ButtonComponent;
    cmp.disabled = true;
    const ev = { preventDefault: jasmine.createSpy(), stopPropagation: jasmine.createSpy() } as any;
    cmp.onAnchorClick(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
  });
});
