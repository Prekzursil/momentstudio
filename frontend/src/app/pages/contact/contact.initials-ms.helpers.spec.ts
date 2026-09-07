import { ContactComponent } from './contact.component';
/** Tip orphan — initialsForLabel MS (2026-09-07T09:34:23Z). */
describe('ContactComponent initialsForLabel MS helpers (golden WU)', () => {
  it('empty label returns MS', () => {
    const cmp = Object.create(ContactComponent.prototype) as ContactComponent;
    expect(cmp.initialsForLabel('')).toBe('MS');
  });
});
