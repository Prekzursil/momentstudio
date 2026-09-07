import { ContactComponent } from './contact.component';

/** Tip orphan mint — ContactComponent.focalPosition clamp (2026-09-07T08:32:17Z). */
describe('ContactComponent focalPosition clamp helpers (golden WU)', () => {
  function bare(): ContactComponent {
    return Object.create(ContactComponent.prototype) as ContactComponent;
  }

  it('rounds and clamps focal coords', () => {
    const cmp = bare();
    expect(cmp.focalPosition(12.6, 33.4)).toBe('13% 33%');
    expect(cmp.focalPosition(-5, 150)).toBe('0% 100%');
  });
});
