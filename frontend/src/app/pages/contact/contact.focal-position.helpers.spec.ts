import { ContactComponent } from './contact.component';

/** Golden WU tip orphan — focalPosition. */
describe('ContactComponent focalPosition (golden WU)', () => {
  function bare(): ContactComponent {
    return Object.create(ContactComponent.prototype) as ContactComponent;
  }

  it('clamps and defaults to 50% 50%', () => {
    expect(bare().focalPosition()).toBe('50% 50%');
    expect(bare().focalPosition(10, 90)).toBe('10% 90%');
    expect(bare().focalPosition(-5, 150)).toBe('0% 100%');
  });
});
