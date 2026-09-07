import { ContactComponent } from './contact.component';

/** Golden WU contact-avatar-initials — initialsForLabel. */
describe('ContactComponent initialsForLabel (golden WU tip)', () => {
  it('builds initials from label parts with MS fallback', () => {
    const cmp = Object.create(ContactComponent.prototype) as ContactComponent;
    expect(cmp.initialsForLabel('')).toBe('MS');
    expect(cmp.initialsForLabel('   ')).toBe('MS');
    expect(cmp.initialsForLabel('Ada')).toBe('AD');
    expect(cmp.initialsForLabel('Ada Lovelace')).toBe('AL');
    expect(cmp.initialsForLabel('moment studio')).toBe('MS');
  });
});
