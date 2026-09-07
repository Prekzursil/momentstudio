import { ContactComponent } from './contact.component';

/** Golden WU tip orphan — initialsForLabel. */
describe('ContactComponent initialsForLabel (golden WU)', () => {
  function bare(): ContactComponent {
    return Object.create(ContactComponent.prototype) as ContactComponent;
  }

  it('returns MS for blank and initials for names', () => {
    expect(bare().initialsForLabel('')).toBe('MS');
    expect(bare().initialsForLabel('  ')).toBe('MS');
    expect(bare().initialsForLabel('Ada Lovelace')).toBe('AL');
    expect(bare().initialsForLabel('Moment')).toBe('MO');
  });
});
