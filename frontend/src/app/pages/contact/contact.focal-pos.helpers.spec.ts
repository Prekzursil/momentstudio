import { ContactComponent } from './contact.component';

/** Tip orphan mint — ContactComponent.focalPosition (2026-09-07T08:06:10Z). */
describe('ContactComponent focalPosition helpers (golden WU)', () => {
  function bare(): ContactComponent {
    return Object.create(ContactComponent.prototype) as ContactComponent;
  }

  it('clamps and defaults focal percent pair', () => {
    const cmp = bare();
    expect(cmp.focalPosition()).toBe('50% 50%');
    expect(cmp.focalPosition(0, 100)).toBe('0% 100%');
    expect(cmp.focalPosition(-1, 200)).toBe('0% 100%');
  });
});
