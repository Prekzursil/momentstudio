import { ContactComponent } from './contact.component';
describe('ContactComponent focalPosition tip (golden WU)', () => {
  function bare(): ContactComponent { return Object.create(ContactComponent.prototype) as ContactComponent; }
  it('clamps focal', () => {
    expect(bare().focalPosition(-10, 200)).toBe('0% 100%');
    expect(bare().focalPosition()).toBe('50% 50%');
  });
});
