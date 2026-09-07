import { ContactComponent } from './contact.component';
/** Tip orphan — initialsForLabel two words (2026-09-07T12:02:09Z). */
describe('ContactComponent initialsForLabel two-word helpers (golden WU)', () => {
  it('uses first letters of two words', () => {
    const cmp = Object.create(ContactComponent.prototype) as ContactComponent;
    expect(cmp.initialsForLabel('Jane Doe')).toBe('JD');
  });
});
