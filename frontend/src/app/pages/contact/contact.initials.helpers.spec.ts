import { ContactComponent } from './contact.component';

/** Tip orphan mint — ContactComponent.initialsForLabel (2026-09-07T07:34:20Z). */
describe('ContactComponent initialsForLabel (golden WU)', () => {
  function bare(): ContactComponent {
    return Object.create(ContactComponent.prototype) as ContactComponent;
  }

  it('initialsForLabel builds initials or MS default', () => {
    const cmp = bare();
    expect(cmp.initialsForLabel('')).toBe('MS');
    expect(cmp.initialsForLabel('Ada Lovelace')).toBe('AL');
    expect(cmp.initialsForLabel('X')).toBe('XS');
  });
});
